/**
 * Generate a loot filter from config - checker-independent core. Port of poe_price_trade/filter_service.py.
 *
 * No UI, no app state: takes config + game + league path + a log callback and returns what was produced, so the caller
 * can persist state / notify. Network and file system come in through `ServiceEnv`.
 */
import * as filterCore from "./filter_core.ts";
import * as filterOutput from "./filter_output.ts";
import { HubClient } from "./hub_client.ts";
import * as neversinkSource from "./neversink_source.ts";
import { ConfigLike, FsPort, HttpPort } from "./ports.ts";
import { Log, PyError, has, noopLog, pyInt, truthy } from "./py.ts";
import * as tradeNames from "./trade_names.ts";

/** The steps of generateFilter that touch the outside world, replaceable one by one (tests spy on them; the defaults are the real ones). */
export interface ServiceDeps {
  getPrices?: (path: string) => Promise<any>;
  fetchBaseFilter?: (game: string, strictness: number, cacheDir: string, force: boolean) => Promise<[string | null, string | null]>;
  getNames?: (game: string, cacheDir: string) => Promise<Set<string>>;
  copySounds?: (dir: string, soundMap: Record<string, string | null>, decide: filterCore.Decide | null, notify: (text: string) => void) => Promise<Record<string, string>>;
  writeFilter?: (dir: string, section: string, baseText: string | null, name: string) => Promise<string>;
}

export interface ServiceEnv {
  fs: FsPort;
  http: HttpPort;
  /** the Documents folder (Electron: app.getPath("documents")) */
  documentsDir: string;
  /** ms since the epoch */
  nowMs: () => number;
  /** the program version recorded in the embedded settings */
  appVersion: string;
  /** name of the exe for the Controlled Folder Access message ("โปรแกรมนี้" when running unpackaged) */
  exeName?: string;
  /** developer log (debug.event in Python) */
  debugEvent?: (text: string) => void;
  warn?: Log;
  deps?: ServiceDeps;
}

// error codes Windows hands back when something refuses the write (Controlled Folder Access surfaces as EBADF / EACCES /
// ENOENT / EPERM depending on the caller, so the raw text alone is useless)
const BLOCKED_CODES = new Set(["EBADF", "EACCES", "ENOENT", "EPERM"]);

/** User-facing text for a failed filter write. */
export function writeFailMsg(err: unknown, outDir: string, exeName = "โปรแกรมนี้"): string {
  const code = (err as any)?.code;
  if (typeof code === "string" && BLOCKED_CODES.has(code)) {
    return `✗ เขียน filter ลงโฟลเดอร์ไม่ได้: ${outDir}\n` +
      `   Windows อาจบล็อกการเขียน (Controlled Folder Access / Ransomware protection) — ` +
      `อนุญาต ${exeName} ใน Windows Security → Ransomware protection ` +
      `หรือเลือก Game folder override เป็นโฟลเดอร์อื่น\n` +
      `   (${(err as Error).message})`;
  }
  return `✗ เขียน filter ไม่ได้: ${(err as Error).message}`;
}

const isValueError = (e: unknown): boolean => e instanceof PyError && e.kind === "ValueError";
const isOsError = (e: unknown): boolean => typeof (e as any)?.code === "string";

/** The file name (without .filter) of the tier tab / the whitelist tab. */
export function filterNameFor(fgCfg: Record<string, any>, mode: string): string {
  if (mode === "whitelist") return truthy(fgCfg.filter_name_whitelist) ? fgCfg.filter_name_whitelist : filterCore.DEFAULT_WHITELIST_NAME;
  return truthy(fgCfg.filter_name_tier) ? fgCfg.filter_name_tier : filterCore.DEFAULT_TIER_NAME;
}

export interface GenResult {
  mode: "whitelist" | "tier";
  path: string;
  filter_name: string;
  count?: number;
  base_tag?: string | null;
}

/** Persist what a successful generate tells the next one (the name just used, the NeverSink tag of the tier tab). */
export async function rememberResult(config: ConfigLike, gameVersion: string, res: GenResult | null): Promise<void> {
  if (!res) return;
  const fg: Record<string, any> = { ...(truthy(config.get("filter_gen", {})) ? config.get("filter_gen", {}) : {}) };
  fg[`last_filter_name_${res.mode}`] = res.filter_name ?? null;
  if (res.mode === "tier" && truthy(res.base_tag)) fg[`neversink_tag_${gameVersion}`] = res.base_tag;
  config.set("filter_gen", fg);
  await config.save();
}

/** null when there is nothing to do; else {old, new, auto}. */
export async function checkNeversinkUpdate(config: ConfigLike, gameVersion: string,
  getLatest: (game: string) => Promise<string | null>): Promise<{ old: string; new: string; auto: boolean } | null> {
  const fg: Record<string, any> = truthy(config.get("filter_gen", {})) ? config.get("filter_gen", {}) : {};
  const last = fg[`neversink_tag_${gameVersion}`];
  if (!truthy(last)) return null;
  const latest = await getLatest(gameVersion);
  if (!latest || latest === last) return null;
  return { old: last, new: latest, auto: truthy(fg.auto_regen_neversink) };
}

export function neversinkUpdateMessage(info: { old: string; new: string }, regenerated: boolean): string {
  if (regenerated) return `NeverSink อัปเดต ${info.old} → ${info.new} สร้าง filter ใหม่แล้ว`;
  return `NeverSink มีเวอร์ชันใหม่ ${info.new} (filter ปัจจุบันสร้างจาก ${info.old}) — กด Generate เพื่ออัปเดต`;
}

export interface GenerateOptions {
  forceBase?: boolean;
  league?: string;
  log?: Log;
  mode?: "tier" | "whitelist" | null;
  /** asked when a sound file of the same name but different content is already in the folder (default: keep) */
  askSound?: filterCore.Decide | null;
}

/**
 * Build + write the filter for one game. Returns {mode:"whitelist", path, count, filter_name} or {mode:"tier", path,
 * base_tag, filter_name}; null when nothing was written (nothing selected / error already logged).
 */
export async function generateFilter(config: ConfigLike, gameVersion: string, leaguePath: string, env: ServiceEnv,
  opts: GenerateOptions = {}): Promise<GenResult | null> {
  const { forceBase = false, league = "", log = noopLog, mode: modeIn = null, askSound = null } = opts;
  const gv = gameVersion;
  const fs = env.fs;
  const cacheDir = fs.join(config.appDir(), "cache");
  const fgCfg: Record<string, any> = { ...(truthy(config.get("filter_gen", {})) ? config.get("filter_gen", {}) : {}) };
  if (modeIn === "tier" || modeIn === "whitelist") fgCfg.whitelist_enabled = modeIn === "whitelist";
  const mode = truthy(fgCfg.whitelist_enabled) ? "whitelist" : "tier";
  const outDir = filterOutput.gameFilterDir(fs, env.documentsDir, gv, truthy(fgCfg[`game_dir_${gv}`]) ? fgCfg[`game_dir_${gv}`] : "");
  const fname = filterNameFor(fgCfg, mode);
  const [, nameErr] = filterCore.validateFilterName(fname);
  if (nameErr) {
    log(`✗ ชื่อ filter ใช้ไม่ได้: ${nameErr}`, "err");
    return null;
  }
  const lastName = fgCfg[`last_filter_name_${mode}`];
  if (truthy(lastName) && lastName !== fname && (await fs.exists(filterOutput.filterPath(fs, outDir, lastName)))) {
    log(`ℹ ไฟล์เดิม ${lastName}.filter ยังอยู่ในโฟลเดอร์ (ไม่ลบ ไม่ทับ)`, "info");
  }

  const plan = filterCore.planFetch(fgCfg, gv);
  const hubClient = new HubClient(env.http, env.warn);
  const nsEnv: neversinkSource.NeverSinkEnv = { fs, http: env.http, nowMs: env.nowMs, warn: env.warn };
  const deps = env.deps ?? {};
  const getPrices = deps.getPrices ?? ((p: string) => hubClient.getPrices(p));
  const fetchBase = deps.fetchBaseFilter ?? ((g: string, st: number, cd: string, force: boolean) => neversinkSource.fetchBaseFilter(g, st, cd, nsEnv, force));
  const getNames = deps.getNames ?? ((g: string, cd: string) => tradeNames.getNames(g, cd, { fs, http: env.http, now: () => env.nowMs() / 1000, warn: env.warn }));
  const copyTo = deps.copySounds ?? ((d: string, m: Record<string, string | null>, dec: filterCore.Decide | null, notify: (t: string) => void) =>
    filterOutput.copySounds(fs, d, m, dec, notify, env.warn));
  const writeTo = deps.writeFilter ?? ((d: string, sec: string, base: string | null, name: string) => filterOutput.writeFilter(fs, d, sec, base, name));
  const copySoundsFn: filterCore.CopySounds = (soundMap) => copyTo(outDir, soundMap, askSound, (text) => log(text, "info"));

  if (plan.mode === "whitelist") {
    let hubData: any = null;
    if (plan.hub) {
      try {
        hubData = await getPrices(leaguePath);
      } catch (e) {
        log(`⚠ ดึง hub ไม่ได้ ใช้เฉพาะ currency/ชื่อที่ติ๊ก: ${(e as Error).message}`, "warn");
      }
    }
    let wlBase: string | null = null;
    if (plan.neversink) { // starting tiers come from NeverSink strictness 2, whatever the tier tab uses
      [wlBase] = await fetchBase(gv, 2, cacheDir, forceBase);
      if (wlBase === null) log("⚠ ไม่มี NeverSink base filter ให้ใช้ (GitHub ล่ม + ไม่มี cache)", "warn");
    }
    const extraNames = plan.neversink ? await getNames(gv, cacheDir) : null;
    const res = await filterCore.buildFilterText(fgCfg, gv, { hubData, baseText: wlBase, extraNames, copySoundsFn,
      appVersion: env.appVersion, log });
    if (res === null) return null;
    let outPath: string;
    try {
      outPath = await writeTo(outDir, res.generated_section, null, fname);
    } catch (e) {
      if (isOsError(e)) log(writeFailMsg(e, outDir, env.exeName), "err");
      else log(`✗ generate ล้มเหลว: ${(e as Error).message}`, "err");
      return null;
    }
    const count = res.count;
    env.debugEvent?.(`whitelist filter generated gv=${gv} items=${count} path=${outPath}`);
    log(`✓ filter โหมดโชว์เฉพาะ (${count} รายการ) → ${outPath}`, "ok");
    log("Filter updated — reload in game (Options → Game)", "ok");
    return { mode: "whitelist", path: outPath, count, filter_name: fname };
  }

  log(`⟳ ดึง NeverSink base filter (${gv})…`, "info");
  const strictness = pyInt(has(fgCfg, `strictness_${gv}`) ? fgCfg[`strictness_${gv}`] : 2);
  const [baseText, tag] = await fetchBase(gv, strictness, cacheDir, forceBase);
  if (baseText === null) log("⚠ ไม่มี NeverSink base filter ให้ใช้ (GitHub ล่ม + ไม่มี cache)", "warn");
  else log(`✓ NeverSink base filter พร้อม (tag=${tag})`, "ok");

  const res = (await filterCore.buildFilterText(fgCfg, gv, { baseText, baseTag: tag, copySoundsFn, log }))!;
  try {
    const written = await writeTo(outDir, res.generated_section, res.base_text, fname);
    env.debugEvent?.(`filter generated gv=${gv} league=${league} base_tag=${tag} path=${written}`);
    log(`✓ เขียน filter แล้ว: ${written}`, "ok");
    log("Filter updated — reload in game (Options → Game)", "ok");
    return { mode: "tier", path: written, base_tag: res.base_tag, filter_name: fname };
  } catch (e) {
    if (isValueError(e)) log(`✗ ${(e as Error).message} — ไฟล์เดิมไม่ถูกแตะ`, "err");
    else if (isOsError(e)) log(writeFailMsg(e, outDir, env.exeName), "err");
    else log(`✗ generate ล้มเหลว: ${(e as Error).message}`, "err");
  }
  return null;
}

/** [hub data | null, NeverSink strictness-2 text | "", real item names] for the whitelist tab's lists. */
export async function loadWhitelistInputs(config: ConfigLike, gameVersion: string, hubLoader: (() => Promise<any>) | null,
  env: ServiceEnv, log: Log = noopLog): Promise<[any, string, Set<string>]> {
  const cacheDir = env.fs.join(config.appDir(), "cache");
  let hub: any = null;
  if (hubLoader !== null) {
    try {
      hub = await hubLoader();
    } catch (e) {
      log(`⚠ ดึง hub ไม่ได้: ${(e as Error).message}`, "warn");
    }
  }
  let base: string | null = null;
  try {
    [base] = await neversinkSource.fetchBaseFilter(gameVersion, 2, cacheDir, { fs: env.fs, http: env.http, nowMs: env.nowMs, warn: env.warn });
  } catch (e) {
    log(`⚠ ดึง NeverSink base filter ไม่ได้: ${(e as Error).message}`, "warn");
  }
  if (!base) log("⚠ ไม่มี NeverSink base filter (GitHub ล่ม + ไม่มี cache) — รายการ tier เริ่มต้นไม่ครบ", "warn");
  const names = await tradeNames.getNames(gameVersion, cacheDir, { fs: env.fs, http: env.http, now: () => env.nowMs() / 1000, warn: env.warn });
  return [hub, base || "", names];
}
