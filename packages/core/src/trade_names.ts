/**
 * Real item names from GGG's trade data (trade(2)/data/items), cached on disk. Port of poe_price_trade/trade_names.py.
 * Used by the whitelist filter as a second opinion on names NeverSink's base filter does not use. Never throws - no data
 * = empty set.
 */
import { FsPort, HttpPort } from "./ports.ts";
import { Log, dumps, noopLog, sortedStr, truthy } from "./py.ts";

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

export async function getNames(game: string, cacheDir: string | null, env: NamesEnv): Promise<Set<string>> {
  const warn = env.warn ?? noopLog;
  const path = cacheDir ? env.fs.join(cacheDir, `trade_items_${game}.json`) : null;
  let cached: string[] | null = null;
  try {
    if (path && (await env.fs.exists(path))) {
      cached = JSON.parse(await env.fs.readText(path));
      if (env.now() - (await env.fs.mtimeSec(path)) < TTL_SECONDS) return new Set(cached!);
    }
  } catch (e) {
    warn(`trade names cache read failed: ${(e as Error).message}`, "warn");
  }
  try {
    const names = namesFromPayload(JSON.parse(await env.http.getText(URLS[game], HEADERS)));
    if (names.size && path) {
      await env.fs.mkdirp(cacheDir!);
      await env.fs.writeText(path, dumps(sortedStr(names), { ensureAscii: false }));
    }
    if (names.size) return names;
  } catch (e) {
    warn(`trade names fetch failed: ${(e as Error).message}`, "warn");
  }
  return new Set(cached ?? []);
}
