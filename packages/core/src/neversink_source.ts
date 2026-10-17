/**
 * NeverSink base filter - GitHub fetch + cache. Port of poe_price_trade/neversink_source.py. The .filter files live in the
 * repo itself at the release tag (GitHub releases carry no assets). HTTP and file system are injected.
 */
import * as filterCore from "./filter_core.ts";
import { FsPort, HttpPort } from "./ports.ts";
import { Log, dumps, noopLog, truthy } from "./py.ts";

export const REPO = filterCore.NEVERSINK_REPO;
export const LEVELS = filterCore.LEVELS;
export const DEFAULT_STRICTNESS = 2; // Semi-Strict
export const HEADERS: Record<string, string> = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
};
const CHECK_INTERVAL_HOURS = 24; // GitHub release check cadence - the Refresh button (force) bypasses this

export interface NeverSinkEnv {
  fs: FsPort;
  http: HttpPort;
  /** ms since the epoch */
  nowMs: () => number;
  warn?: Log;
}

export const filename = filterCore.neversinkFilename;

export async function getLatestTag(game: string, env: Pick<NeverSinkEnv, "http" | "warn">): Promise<string | null> {
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

async function downloadFile(game: string, tag: string, strictness: number, env: NeverSinkEnv): Promise<string> {
  return env.http.getText(filterCore.neversinkFileUrl(game, tag, strictness), HEADERS);
}

const gameCacheDir = async (cacheDir: string, game: string, env: NeverSinkEnv): Promise<string> => {
  const d = env.fs.join(cacheDir, "neversink", game);
  await env.fs.mkdirp(d);
  return d;
};

async function loadLastCheck(cacheDir: string, game: string, env: NeverSinkEnv): Promise<Record<string, any>> {
  try {
    return JSON.parse(await env.fs.readText(env.fs.join(await gameCacheDir(cacheDir, game, env), "last_check.json")));
  } catch {
    return {};
  }
}

async function saveLastCheck(cacheDir: string, game: string, tag: string, env: NeverSinkEnv): Promise<void> {
  try {
    // like Python's isoformat(): microseconds and +00:00
    const iso = new Date(env.nowMs()).toISOString().replace("Z", "000+00:00");
    await env.fs.writeText(env.fs.join(await gameCacheDir(cacheDir, game, env), "last_check.json"), dumps({ tag, checked_at: iso }));
  } catch (e) {
    (env.warn ?? noopLog)(`NeverSink last_check save failed: ${(e as Error).message}`, "warn");
  }
}

/** Last-resort fallback: any previously cached file for this strictness, regardless of tag. */
async function findAnyCached(cacheDir: string, game: string, strictness: number, env: NeverSinkEnv): Promise<string | null> {
  const d = await gameCacheDir(cacheDir, game, env);
  const suffix = `_${strictness}.filter`;
  const matches = (await env.fs.listDir(d)).filter((n) => n.endsWith(suffix) && !n.startsWith(".")).sort();
  return matches.length ? env.fs.join(d, matches[matches.length - 1]) : null;
}

/**
 * [filter_text, tag_used] - filter_text is null if nothing could be fetched or found in cache at all. Never throws.
 */
export async function fetchBaseFilter(game: string, strictness: number, cacheDir: string, env: NeverSinkEnv,
  force = false): Promise<[string | null, string | null]> {
  const warn = env.warn ?? noopLog;
  const last = await loadLastCheck(cacheDir, game, env);
  let staleCheck = true;
  const checkedAt = last.checked_at;
  if (truthy(checkedAt)) {
    const t = Date.parse(checkedAt);
    staleCheck = Number.isNaN(t) ? true : (env.nowMs() - t) / 3600000 > CHECK_INTERVAL_HOURS;
  }
  let tag: string | null = truthy(last.tag) ? last.tag : null;
  if (force || staleCheck || !tag) {
    const fresh = await getLatestTag(game, env);
    if (fresh) {
      tag = fresh;
      await saveLastCheck(cacheDir, game, tag, env);
    }
    // fresh being null just means "keep whatever tag we already knew" - the disk cache for that tag may still be usable
  }
  if (tag) {
    const cached = env.fs.join(await gameCacheDir(cacheDir, game, env), `${tag}_${strictness}.filter`);
    if ((await env.fs.exists(cached)) && !force) {
      try {
        return [await env.fs.readText(cached), tag];
      } catch (e) {
        warn(`NeverSink cache read failed: ${(e as Error).message}`, "warn");
      }
    }
    try {
      const text = await downloadFile(game, tag, strictness, env);
      try {
        await env.fs.writeText(cached, text);
      } catch (e) {
        warn(`NeverSink cache write failed: ${(e as Error).message}`, "warn");
      }
      return [text, tag];
    } catch (e) {
      warn(`NeverSink download failed (${game} tag=${tag}): ${(e as Error).message}`, "warn");
      if (await env.fs.exists(cached)) {
        try {
          return [await env.fs.readText(cached), tag];
        } catch {
          /* fall through */
        }
      }
    }
  }
  const fallback = await findAnyCached(cacheDir, game, strictness, env);
  if (fallback) {
    const stem = env.fs.basename(fallback).replace(/\.filter$/, "");
    const fallbackTag = stem.includes("_") ? stem.slice(0, stem.lastIndexOf("_")) : stem;
    try {
      return [await env.fs.readText(fallback), fallbackTag];
    } catch (e) {
      warn(`NeverSink fallback cache read failed: ${(e as Error).message}`, "warn");
    }
  }
  return [null, null];
}
