/**
 * NeverSink's latest release tag (the update check of the Checker's main process). Port of get_latest_tag of poe_price_trade/neversink_source.py.
 * The base filter itself is fetched and cached by the page: packages/ui/src/data.ts fetchBase (the original's fetch_base_filter() is not here).
 * HTTP is injected.
 */
import * as filterCore from "./filter_core.ts";
import { HttpPort } from "./ports.ts";
import { Log, noopLog } from "./py.ts";

export const REPO = filterCore.NEVERSINK_REPO;
export const HEADERS: Record<string, string> = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
};

export interface NeverSinkEnv {
  http: HttpPort;
  warn?: Log;
}

export async function getLatestTag(game: string, env: NeverSinkEnv): Promise<string | null> {
  if (!Object.prototype.hasOwnProperty.call(REPO, game)) return null;
  const url = filterCore.neversinkLatestApiUrl(game);
  try {
    const data = JSON.parse(await env.http.getText(url, { ...HEADERS, Accept: "application/vnd.github+json" }));
    return data.tag_name === undefined ? null : data.tag_name;
  } catch (e) {
    (env.warn ?? noopLog)(`NeverSink release lookup failed (${game}): ${(e as Error).message}`, "warn");
    return null;
  }
}
