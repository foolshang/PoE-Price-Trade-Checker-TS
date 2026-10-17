/**
 * Where the data comes from: NeverSink (GitHub: release tag + raw file, cached in localStorage), the hub (item names,
 * Google Cloud Storage, CORS set for this site), the real item names (the snapshot shipped with the page:
 * data/trade_names_<game>.json), the gem list (poe1). The localStorage keys are the ones the Pyodide page used.
 */
import { platform } from "./platform.ts";
import { S } from "./state.ts";
import { readJson, store } from "./storage.ts";

/**
 * The hub's CORS header allows only https://foolshang.github.io, so a page served from localhost reaches it through a proxy of
 * the dev / preview server (`npm run web:local` builds with VITE_HUB_BASE=/__hub); the deployed page uses the hub directly.
 */
const HUB: string = (import.meta as any).env?.VITE_HUB_BASE || "https://storage.googleapis.com/poe-data-hub";
const KEY_NS = "poeFilterGen.ns.";
const NS_CHECK_HOURS = 24;
const hubCache: Record<string, { data: any; at: number }> = {};

export async function fetchText(url: string, label: string, headers?: Record<string, string>): Promise<string> {
  let res: { ok: boolean; status: number; text: string };
  try {
    if (/^https?:/i.test(url)) res = await platform().getText(url, headers); // the network: the platform decides how
    else { // a file shipped with the page
      const r = await fetch(url);
      res = { ok: r.ok, status: r.status, text: r.ok ? await r.text() : "" };
    }
  } catch (e) {
    throw new Error(`${label} fetch failed (${url}): ${(e as Error).message || e}`);
  }
  if (!res.ok) throw new Error(`${label} HTTP ${res.status}: ${url}`);
  return res.text;
}

/** the hub's prices of a game (kept 5 minutes, like the hub's own cache header) */
export async function getHub(g: string): Promise<any> {
  const c = hubCache[g];
  if (c && Date.now() - c.at < 5 * 60 * 1000) return c.data;
  const url = `${HUB}/${g}/prices/latest.json`;
  const text = await fetchText(url, "hub");
  let data: any;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new Error(`hub fetch failed (${url}): ${(e as Error).message}`);
  }
  hubCache[g] = { data, at: Date.now() };
  return data;
}

/**
 * The real item names (GGG's trade list, which a browser cannot call) = the snapshot shipped with the page
 * (data/trade_names_<game>.json, made by `npm run names:refresh`). Returns {names, from} or null.
 */
export async function getNames(g: string, base = "./"): Promise<{ names: string[]; from: string } | null> {
  const better = platform().getNames;
  if (better) {
    try {
      const live = await better(g);
      if (live && live.length >= 500) return { names: live, from: "live" };
    } catch { /* the snapshot below */ }
  }
  try {
    const list = JSON.parse(await fetchText(`${base}data/trade_names_${g}.json`, "names snapshot"));
    if (!Array.isArray(list) || list.length < 500) throw new Error("too few names");
    return { names: list, from: "snapshot" };
  } catch {
    return null;
  }
}

let gemAll: string[] | null = null;
export async function getGemNames(g: string): Promise<string[]> {
  if (g !== "poe1") return [];
  if (gemAll) return gemAll;
  try {
    gemAll = S.api.gemNames(JSON.parse(await fetchText(`${HUB}/${g}/gems.json`, "gems")));
  } catch {
    gemAll = [];
  }
  return gemAll;
}

// ---- NeverSink base filter: same flow as neversink_source.fetchBaseFilter, cache = localStorage ----

export const nsLast = (g: string): { tag?: string; checked_at?: string } => readJson(`${KEY_NS}last.${g}`, {});
const nsTextKey = (g: string, tag: string, s: number): string => `${KEY_NS}text.${g}|${tag}|${s}`;

export async function nsLatestTag(g: string): Promise<string | null> {
  try {
    const text = await fetchText(S.api.nsLatestUrl(g), "neversink release", { Accept: "application/vnd.github+json" });
    return JSON.parse(text).tag_name || null;
  } catch {
    return null;
  }
}

function nsCachePut(g: string, tag: string, s: number, text: string): void {
  const prefix = `${KEY_NS}text.${g}|`;
  store.keys().filter((k) => k.startsWith(prefix) && !k.startsWith(`${prefix}${tag}|`)).forEach((k) => store.del(k));
  if (!store.set(nsTextKey(g, tag, s), text, false)) {
    store.keys().filter((k) => k.startsWith(KEY_NS + "text.")).forEach((k) => store.del(k)); // quota: start over
    store.set(nsTextKey(g, tag, s), text, false); // still too big -> not cached
  }
}

/** [text, tag] of NeverSink's filter for this strictness ([null, null] when nothing can be had). */
export async function fetchBase(g: string, strictness: number, force: boolean): Promise<[string | null, string | null]> {
  const last = nsLast(g);
  let stale = true;
  if (last.checked_at) {
    const hrs = (Date.now() - Date.parse(last.checked_at)) / 3600000;
    stale = !(hrs <= NS_CHECK_HOURS);
  }
  let tag: string | null = last.tag || null;
  if (force || stale || !tag) {
    const fresh = await nsLatestTag(g);
    if (fresh) {
      tag = fresh;
      store.set(`${KEY_NS}last.${g}`, JSON.stringify({ tag, checked_at: new Date().toISOString() }));
    }
  }
  if (tag) {
    const key = nsTextKey(g, tag, strictness);
    const cached = store.get(key);
    if (cached && !force) return [cached, tag];
    try {
      const text = await fetchText(S.api.nsFileUrl(g, tag, strictness), "neversink");
      nsCachePut(g, tag, strictness, text);
      return [text, tag];
    } catch {
      if (cached) return [cached, tag];
    }
  }
  const suffix = `|${strictness}`; // last resort: any cached tag for this game+strictness
  const keys = store.keys().filter((k) => k.startsWith(`${KEY_NS}text.${g}|`) && k.endsWith(suffix)).sort();
  if (keys.length) {
    const k = keys[keys.length - 1];
    const t = store.get(k);
    if (t) return [t, k.slice(`${KEY_NS}text.${g}|`.length, -suffix.length)];
  }
  return [null, null];
}
