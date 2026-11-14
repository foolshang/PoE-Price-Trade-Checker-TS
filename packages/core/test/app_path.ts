/**
 * Test harness: make a filter the way the programs do, not through a service function of core.
 *
 * What the apps run (Filter Generator, Checker's filter page, web page):
 *   packages/ui/src/app.ts generate()  - config of the page + mode, name check, base text / hub / names, the sound store, `existing`
 *   packages/ui/src/api.ts WebApi.generate - filterCore.buildFilterText + the sound plan (REAL code, called here)
 *   packages/ui/src/app.ts deliver() -> files.ts writeToFolder - sound files first, then `<name>.filter` as toCrlf(text)
 * app.ts needs a DOM, so its few lines of orchestration are repeated here (each step names its line); every piece of logic it calls is the real
 * function. The end-to-end tests of the installed programs (tests/desktop, tests/checker) run app.ts itself.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { filterCore, filterStyle } from "../src/index.ts";
import { WebApi, setAppVersion } from "../../ui/src/api.ts";
import { toCrlf } from "../../ui/src/dom.ts";

type Cfg = Record<string, any>;
const sha256 = (b: Buffer | Uint8Array): string => createHash("sha256").update(b).digest("hex");
const SOUND_LABELS = ["1", "2", "3", "4", "5", "6"];

/** the page's sound store: label -> the file the config names for that slot (the page keeps the bytes under the same labels) */
export function soundSources(cfgIn: Cfg): Record<string, string> {
  const [cfg] = filterCore.migrateSounds(cfgIn);
  const out: Record<string, string> = {};
  for (const n of SOUND_LABELS) if (cfg[`sound_${n}`]) out[n] = cfg[`sound_${n}`];
  const q = cfg.style_q ? filterStyle.usesSoundFile(cfg.style_q) : null;
  if (q) out.Q = q;
  for (const [k, st] of Object.entries<any>(cfg.wl_tier_style || {})) if (st?.sound?.kind === "file" && st.sound.file) out[k] = st.sound.file;
  return out;
}

export interface AppGenInput {
  /** the page's settings (the `filter_gen` block); `whitelist_enabled` is set from `mode` like collectCfg() */
  fg: Cfg;
  game: string;
  mode: "tier" | "whitelist";
  /** the game's filter folder (the page's folder handle / the desktop's Documents\My Games\...) */
  gameDir: string;
  /** NeverSink's text and tag as fetchBase() gives them ([null, null] = nothing to be had) */
  base: [string | null, string | null];
  /** the hub's prices (null = could not be loaded) */
  hub?: any;
  /** the league the hub's lists are from (the page's dropdown); the log names it */
  league?: { label: string; path: string };
  /** the real item names the page loaded (the whitelist tab) */
  names?: Iterable<string> | null;
  /** the names the page adds from GGG's item list ({name: category}); none = a run like the original's (the goldens) */
  added?: Record<string, string> | null;
  decisions?: Record<string, string>;
  /** make writing `<name>.filter` fail with this error (the page then logs it and hands nothing over) */
  failWrite?: Error;
  log?: (m: string, tag?: string) => void;
}
export interface AppGenResult {
  status: "ok" | "none" | "error" | "ask" | "aborted" | "name-error" | "write-failed";
  mode?: string;
  path?: string;
  filter_name?: string;
  count?: number;
  base_tag?: string | null;
  text?: string;
  message?: string;
}

/** `appVersion` is what the page records in the embedded settings (the golden of the original was made with 0.13.5) */
export async function appGenerate(i: AppGenInput, appVersion = "t"): Promise<AppGenResult> {
  setAppVersion(appVersion);
  const log = i.log ?? ((): void => {});
  const api = new WebApi();
  api.game = i.game;
  const cfg: Cfg = { ...i.fg, whitelist_enabled: i.mode === "whitelist" }; // app.ts collectCfg(mode)
  const key = i.mode === "whitelist" ? "filter_name_whitelist" : "filter_name_tier";
  const v = api.validateName(cfg[key] ?? (i.mode === "whitelist" ? filterCore.DEFAULT_WHITELIST_NAME : filterCore.DEFAULT_TIER_NAME)); // app.ts:198 (the page's box always has a value)
  if (v.error) {
    log(`✗ ชื่อ filter ใช้ไม่ได้: ${v.error}`, "err");
    return { status: "name-error", message: v.error };
  }
  const name = v.name || cfg[key];
  const [base, tag] = i.base;
  if (i.mode === "whitelist") { // app.ts:221-225 (the league the lists are from is named first)
    log(`ℹ ลีกที่ใช้กับรายการของ hub: ${i.league ? `${i.league.label} (${i.league.path})` : "-"}`, "info");
    if (!base) {
      log("⚠ ไม่มี NeverSink base filter — whitelist ไม่มี tier เริ่มต้น ไม่ generate", "warn");
      return { status: "aborted" };
    }
  }
  if (i.mode === "tier" && base === null) { // app.ts:230-234
    log("⚠ ไม่มี NeverSink base filter ให้ใช้ (GitHub ล่ม + ไม่มี cache)", "warn");
    log("✗ nothing to write — no NeverSink base filter available — ไฟล์เดิมไม่ถูกแตะ", "err");
    return { status: "aborted" };
  }
  const srcs = soundSources(cfg);
  const hashes = Object.fromEntries(Object.entries(srcs).map(([l, p]) => [l, sha256(readFileSync(p))])); // sounds.hashes()
  const existing: Record<string, string | null> = {}; // FS.existingFor(wanted)
  if (existsSync(i.gameDir)) {
    const wanted = new Set(Object.values(srcs).map((p) => api.safeName(path.basename(p))));
    for (const n of readdirSync(i.gameDir)) existing[n] = wanted.has(n) ? sha256(readFileSync(path.join(i.gameDir, n))) : null;
  }
  const hub = i.mode === "whitelist" ? (i.hub ?? null) : null; // tier mode never reads the hub (app.ts:213-235)
  const names = i.mode === "whitelist" ? (i.names ? [...i.names] : []) : null;
  const res = await api.generate({ cfg, game: i.game, hub, baseText: base, baseTag: tag, log, hashes, names, added: i.mode === "whitelist" ? (i.added ?? null) : null, existing, decisions: i.decisions ?? {} }); // app.ts:252
  if (res.status !== "ok") return { status: res.status, message: res.message };
  const filePath = path.join(i.gameDir, `${name}.filter`);
  try { // deliver() -> writeToFolder: sounds, then the filter, CRLF once
    if (i.failWrite) throw i.failWrite;
    mkdirSync(i.gameDir, { recursive: true });
    for (const [label, final] of res.copies ?? []) writeFileSync(path.join(i.gameDir, final), readFileSync(srcs[label]));
    writeFileSync(filePath, Buffer.from(toCrlf(res.text as string), "utf-8"));
  } catch (e) {
    log(String((e as Error).message), "err");
    return { status: "write-failed", message: (e as Error).message };
  }
  return { status: "ok", mode: res.mode, path: filePath, filter_name: name, count: res.count, base_tag: res.base_tag, text: res.text };
}

/** what Python's text-mode read gave: CRLF -> LF */
export const readLf = (p: string): string => readFileSync(p, "utf-8").split("\r\n").join("\n");
