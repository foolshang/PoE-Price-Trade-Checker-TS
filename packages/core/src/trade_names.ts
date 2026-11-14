/**
 * Real item names from GGG's trade data (trade(2)/data/items), cached on disk (with their GGG groups, see ggg_names.ts).
 * Port of poe_price_trade/trade_names.py.
 * Used by the whitelist filter as a second opinion on names NeverSink's base filter does not use. Never throws - no data
 * = empty set.
 */
import { FsPort, HttpPort } from "./ports.ts";
import * as ggg from "./ggg_names.ts";
import { Log, noopLog, truthy } from "./py.ts";

export const URLS: Record<string, string> = {
  poe1: "https://www.pathofexile.com/api/trade/data/items",
  poe2: "https://www.pathofexile.com/api/trade2/data/items",
};
export const HEADERS: Record<string, string> = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
};
export const TTL_SECONDS = 7 * 86400;

export function namesFromPayload(data: any): Set<string> {
  const out = new Set<string>();
  const result = data && truthy(data.result) ? data.result : [];
  for (const grp of result) {
    for (const e of truthy(grp.entries) ? grp.entries : []) {
      for (const k of ["name", "type", "text"]) if (truthy(e[k])) out.add(String(e[k]));
    }
  }
  return out;
}

export interface NamesEnv {
  fs: FsPort;
  http: HttpPort;
  /** seconds since the epoch */
  now: () => number;
  warn?: Log;
}

export interface Items {
  /** every name GGG has */
  names: Set<string>;
  /** the names per GGG group; null = only a cache of the old form (names only) was there */
  groups: ggg.Groups | null;
}

/**
 * GGG's item list: the cache (<cacheDir>/trade_items_<game>.json) when it is under 7 days old, else GGG's payload (then cached).
 * The cache is the groups ({format: 2, groups}); the old cache (a bare list of names) still gives the names for the check, no
 * groups, and is replaced when it is due. Never throws: no data = empty names.
 */
export async function getItems(game: string, cacheDir: string | null, env: NamesEnv): Promise<Items> {
  const warn = env.warn ?? noopLog;
  const path = cacheDir ? env.fs.join(cacheDir, `trade_items_${game}.json`) : null;
  let cached: ggg.Loaded | null = null;
  try {
    if (path && (await env.fs.exists(path))) {
      cached = ggg.parseSnapshot(JSON.parse(await env.fs.readText(path)));
      if (cached && env.now() - (await env.fs.mtimeSec(path)) < TTL_SECONDS) return { names: cached.names, groups: cached.snapshot?.groups ?? null };
    }
  } catch (e) {
    warn(`trade names cache read failed: ${(e as Error).message}`, "warn");
  }
  try {
    const groups = ggg.groupsFromPayload(JSON.parse(await env.http.getText(URLS[game], HEADERS)));
    const names = ggg.namesOfGroups(groups);
    if (names.size && path) {
      await env.fs.mkdirp(cacheDir!);
      await env.fs.writeText(path, ggg.snapshotJson(groups, {}));
    }
    if (names.size) return { names, groups };
  } catch (e) {
    warn(`trade names fetch failed: ${(e as Error).message}`, "warn");
  }
  return { names: cached?.names ?? new Set(), groups: cached?.snapshot?.groups ?? null };
}
