/**
 * What the main process lets the page do - kept free of Electron so it can be tested on its own.
 * The page never sends a path: it sends a game id and a file NAME, and a URL for the network. Both are checked here.
 */
import path from "node:path";

export const GAMES = ["poe1", "poe2"] as const;
export const isGame = (g: unknown): g is "poe1" | "poe2" => g === "poe1" || g === "poe2";

const AUDIO = [".mp3", ".wav", ".ogg", ".flac", ".m4a", ".aac", ".wma"];
export const MAX_FILE_BYTES = 64 * 1024 * 1024;

/** A file name the page may read or write in a game folder: a plain name of a .filter or a sound file, no folders. */
export function isAllowedName(name: unknown): name is string {
  if (typeof name !== "string" || !name || name.length > 200) return false;
  if (name !== path.basename(name) || name !== path.win32.basename(name) || name !== path.posix.basename(name)) return false;
  if (name === "." || name === ".." || /[<>:"|?*\u0000-\u001f]/.test(name)) return false;
  if (/[\\/]/.test(name) || /[. ]$/.test(name)) return false; // (Windows drops a trailing dot / space)
  const ext = path.extname(name).toLowerCase();
  if (/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\.|$)/i.test(name)) return false;
  return ext === ".filter" || AUDIO.includes(ext);
}

/** The hosts (and path prefixes) the page may read through the main process: the hub bucket and NeverSink on GitHub. */
const ALLOWED: { host: string; prefix: string }[] = [
  { host: "storage.googleapis.com", prefix: "/poe-data-hub/" },
  { host: "api.github.com", prefix: "/repos/NeverSinkDev/" },
  { host: "raw.githubusercontent.com", prefix: "/NeverSinkDev/" },
];

export function isAllowedUrl(url: unknown): boolean {
  if (typeof url !== "string") return false;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== "https:" || u.username || u.password || u.port) return false;
  return ALLOWED.some((a) => u.hostname === a.host && decodeURIComponent(u.pathname).startsWith(a.prefix) && !decodeURIComponent(u.pathname).includes(".."));
}

/** Only these request headers are passed on. */
export function cleanHeaders(h: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (h && typeof h === "object") {
    for (const [k, v] of Object.entries(h as Record<string, unknown>)) {
      if (k.toLowerCase() === "accept" && typeof v === "string") out.Accept = v.slice(0, 100);
    }
  }
  return out;
}

/** A page link may be handed to the browser only when it is a plain web address. */
export function isExternalLink(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

/** Inside `root`? (for the files the app:// protocol serves) */
export function isInside(root: string, file: string): boolean {
  const rel = path.relative(path.resolve(root), path.resolve(file));
  return !!rel && !rel.startsWith("..") && !path.isAbsolute(rel);
}

/** A value of the config that names a sound of the original program by a path (a folder separator in it). */
export function looksLikeSoundPath(v: unknown): v is string {
  return typeof v === "string" && /[\\/]/.test(v) && AUDIO.includes(path.extname(v).toLowerCase());
}

/** Every string anywhere in `x` that looks like such a path (the main process may read exactly these, nothing else). */
export function collectSoundPaths(x: unknown, out = new Set<string>()): Set<string> {
  if (looksLikeSoundPath(x)) out.add(x);
  else if (Array.isArray(x)) x.forEach((v) => collectSoundPaths(v, out));
  else if (x && typeof x === "object") Object.values(x as object).forEach((v) => collectSoundPaths(v, out));
  return out;
}

/**
 * The game_dir_<game> values the page may keep in its settings: what the main process approved (a picked folder or the
 * config's own value). Anything else the page writes there is put back.
 */
export function enforceGameDirs(cfg: Record<string, any>, approved: Record<string, string>): Record<string, any> {
  const out = { ...cfg };
  for (const g of GAMES) {
    const key = `game_dir_${g}`;
    if (key in out || approved[g]) {
      if (out[key] !== approved[g] && out[key] !== "") out[key] = approved[g] ?? "";
      else if (out[key] === "") approved[g] = "";
    }
  }
  return out;
}
