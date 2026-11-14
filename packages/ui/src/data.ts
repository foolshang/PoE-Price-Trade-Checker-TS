/**
 * Where the data comes from: NeverSink (GitHub: release tag + raw file, cached in localStorage), the hub (item names,
 * Google Cloud Storage, CORS set for this site), the real item names (the snapshot shipped with the page:
 * data/trade_names_<game>.json), the gem list (poe1). The localStorage keys are the ones the Pyodide page used.
 */
import { gggNames, hubClient, hubSchema } from "@poe/core";
import { LeagueOption, isPricesPath, mainOnly, mainPath, optionsFromFiles } from "./leagues.ts";
import { platform } from "./platform.ts";
import { S } from "./state.ts";
import { readJson, store } from "./storage.ts";

/**
 * The hub's CORS header allows only https://foolshang.github.io, so a page served from localhost reaches it through a proxy of
 * the dev / preview server (`npm run web:local` builds with VITE_HUB_BASE=/__hub); the deployed page uses the hub directly.
 */
const HUB: string = (import.meta as any).env?.VITE_HUB_BASE || hubClient.HUB_BASE_URL;
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

/**
 * The hub's prices file of a league (kept 5 minutes, like the hub's own cache header). `path` is the file of that league (from the index; default:
 * the main league's latest.json). The cache is by path: the answer for one league is never given for another. Throws when the file cannot be had
 * or its schema_version is not the one expected (the caller then has no hub list).
 */
export async function getHub(g: string, path: string = mainPath(g)): Promise<any> {
  if (!isPricesPath(g, path)) throw new Error(`hub path not allowed: ${path}`);
  const c = hubCache[path];
  if (c && Date.now() - c.at < 5 * 60 * 1000) return c.data;
  const url = `${HUB}/${path}`;
  const text = await fetchText(url, "hub");
  let data: any;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new Error(`hub fetch failed (${url}): ${(e as Error).message}`);
  }
  // a schema this page does not know is read like a hub that could not be reached (the caller shows no hub list)
  if (!hubSchema.checkSchema(data, hubSchema.PRICES_SCHEMA_VERSION, path, (m) => console.warn(m), "treated as not loaded")) {
    throw new Error(`hub schema mismatch: ${url}`);
  }
  hubCache[path] = { data, at: Date.now() };
  return data;
}

const leagueCache: Record<string, { options: LeagueOption[]; at: number }> = {};

/**
 * The leagues of a game for the dropdown, from {game}/prices/index.json (5 minutes). When the index cannot be had (network, not JSON, schema_version
 * not 1) the only league is the main one (latest.json) and `warning` says why; that answer is not cached, so the next load asks again.
 */
export async function getLeagues(g: string): Promise<{ options: LeagueOption[]; warning: string | null }> {
  const c = leagueCache[g];
  if (c && Date.now() - c.at < 5 * 60 * 1000) return { options: c.options, warning: null };
  const file = `${g}/prices/index.json`;
  const fail = (why: string): { options: LeagueOption[]; warning: string } =>
    ({ options: mainOnly(g), warning: `⚠ อ่านรายชื่อลีกของ hub ไม่ได้ (${why}) — ใช้ลีกหลักอย่างเดียว (latest.json)` });
  let data: any;
  try {
    data = JSON.parse(await fetchText(`${HUB}/${file}`, "hub index"));
  } catch (e) {
    return fail((e as Error).message);
  }
  const msgs: string[] = [];
  if (!hubSchema.checkSchema(data, hubSchema.INDEX_SCHEMA_VERSION, file, (m) => msgs.push(m), "treated as not loaded")) return fail(msgs[0] || "schema_version");
  const options = optionsFromFiles(g, hubClient.leagueFilesFromIndex(g, data));
  leagueCache[g] = { options, at: Date.now() };
  return { options, warning: null };
}

/**
 * The real item names (GGG's trade list, which a browser cannot call) = the snapshot shipped with the page
 * (data/trade_names_<game>.json, made by `npm run names:refresh`); the desktop apps read GGG live and use the snapshot as the
 * baseline for what is new. `added` = {name: category} of the names the whitelist adds from GGG (core ggg_names.addedNames); empty
 * when the snapshot is of the old form (names only), and only by the rules when there is no snapshot. Returns null when there are no names at all.
 */
export async function getNames(g: string, base = "./"): Promise<{ names: string[]; from: string; added: Record<string, string> } | null> {
  let snap: gggNames.Loaded | null = null;
  try {
    snap = gggNames.parseSnapshot(JSON.parse(await fetchText(`${base}data/trade_names_${g}.json`, "names snapshot")));
    if (snap && snap.names.size < 500) snap = null; // too few to be a real list
  } catch { /* no snapshot */ }
  const addedFor = (groups: Record<string, string[]> | null | undefined): Record<string, string> => {
    // a snapshot of the old form (names only) adds nothing; no snapshot at all = only the rules (nothing can be told new)
    if (!groups || (snap && !snap.snapshot)) return {};
    return Object.fromEntries(gggNames.addedNames(g, groups, snap?.snapshot ?? null));
  };
  const better = platform().getNames;
  if (better) {
    try {
      const live = await better(g);
      if (live && live.names.length >= 500) {
        // live groups when the cache has them; else the snapshot's own groups (the shipped list: its rules and assigned names)
        return { names: live.names, from: "live", added: addedFor(live.groups ?? snap?.snapshot?.groups) };
      }
    } catch { /* the snapshot below */ }
  }
  if (!snap) return null;
  return { names: [...snap.names], from: "snapshot", added: addedFor(snap.snapshot?.groups) };
}

let gemAll: string[] | null = null;
export async function getGemNames(g: string): Promise<string[]> {
  if (g !== "poe1") return [];
  if (gemAll) return gemAll;
  try {
    const payload = hubSchema.gemsPayload(JSON.parse(await fetchText(`${HUB}/${g}/gems.json`, "gems")), `${g}/gems.json`, (m) => console.warn(m));
    gemAll = payload ? S.api.gemNames(payload) : [];
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
