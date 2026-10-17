/**
 * Filter generation core - pure, no I/O. Port of poe_price_trade/filter_core.py.
 *
 * Everything between "data fetched" and "file written": URL building for the NeverSink source, file-body
 * composition, and the whitelist / tier builders. Side effects (network, files, sound copy) come in through parameters
 * and callbacks, so the same code runs in the browser and in Node / Electron.
 */
import * as filterGen from "./filter_gen.ts";
import * as filterStyle from "./filter_style.ts";
import * as filterWhitelist from "./filter_whitelist.ts";
import * as wlEmbed from "./wl_embed.ts";
import { Log, PyError, cmpStr, get, has, intOr, isDict, noopLog, pyIndex, pyInt, pyStrip, sortedStr, splitLines, truthy } from "./py.ts";

type Cfg = Record<string, any>;

// ---------------------------------------------------------------------------
// NeverSink source: names and URLs (fetching itself stays in neversink_source)
// ---------------------------------------------------------------------------

export const NEVERSINK_REPO: Record<string, string> = {
  poe1: "NeverSinkDev/NeverSink-Filter",
  poe2: "NeverSinkDev/NeverSink-Filter-for-PoE2",
};
export const NEVERSINK_LEVELS = ["SOFT", "REGULAR", "SEMI-STRICT", "STRICT", "VERY-STRICT", "UBER-STRICT", "UBER-PLUS-STRICT"];
export const LEVELS = NEVERSINK_LEVELS;

const URL_SAFE = new Set("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_.-~/");

/** Percent-encode like urllib.parse.quote(s) (safe="/"). */
export function quote(s: string): string {
  let out = "";
  for (const b of new TextEncoder().encode(s)) {
    const ch = String.fromCharCode(b);
    out += b < 128 && URL_SAFE.has(ch) ? ch : "%" + b.toString(16).toUpperCase().padStart(2, "0");
  }
  return out;
}

export function neversinkFilename(game: string, strictness: number): string {
  const level = pyIndex(NEVERSINK_LEVELS, strictness);
  const prefix = game === "poe2" ? "NeverSink's filter 2" : "NeverSink's filter";
  return `${prefix} - ${strictness}-${level}.filter`;
}

export const neversinkLatestApiUrl = (game: string): string => `https://api.github.com/repos/${NEVERSINK_REPO[game]}/releases/latest`;

export function neversinkFileUrl(game: string, tag: string, strictness: number): string {
  const fn = neversinkFilename(game, strictness);
  return `https://raw.githubusercontent.com/${NEVERSINK_REPO[game]}/${tag}/${quote(fn)}`;
}

// ---------------------------------------------------------------------------
// File body
// ---------------------------------------------------------------------------

/** generated_section + base_text. Throws ValueError if both are empty (the caller must not touch the existing file). */
export function composeFilterBody(generatedSection: string, baseText: string | null | undefined): string {
  if (!pyStrip(generatedSection) && !baseText) throw new PyError("ValueError", "nothing to write — no NeverSink base filter available");
  let body = generatedSection;
  if (baseText) body += "\n# ===== base filter below =====\n" + baseText;
  return body;
}

// ---------------------------------------------------------------------------
// Filter name / sound file names (the rules the game and Windows impose)
// ---------------------------------------------------------------------------

export const DEFAULT_TIER_NAME = "poe-checker";
export const DEFAULT_WHITELIST_NAME = "poe-checker-whitelist";
export const MAX_FILTER_NAME = 100;
const BAD_NAME_CHARS = new Set('<>:"/\\|?*');
const RESERVED_NAMES = new Set(["CON", "PRN", "AUX", "NUL",
  ...Array.from({ length: 9 }, (_, i) => `COM${i + 1}`), ...Array.from({ length: 9 }, (_, i) => `LPT${i + 1}`)]);

/** [name, null] when usable as a Windows file name (without ".filter"), else [name, reason]. */
export function validateFilterName(name: unknown): [string, string | null] {
  const n = name === null || name === undefined ? "" : String(name);
  if (!pyStrip(n)) return [n, "ชื่อ filter ว่างอยู่"];
  const bad = sortedStr(new Set([...n].filter((c) => BAD_NAME_CHARS.has(c))));
  if (bad.length) return [n, "ชื่อ filter ห้ามมีตัวอักษร " + bad.join(" ")];
  if ([...n].some((c) => c.codePointAt(0)! < 32)) return [n, "ชื่อ filter ห้ามมีตัวควบคุม (ขึ้นบรรทัดใหม่/tab ฯลฯ)"];
  let end = n.length;
  while (end > 0 && (n[end - 1] === " " || n[end - 1] === ".")) end--;
  if (n !== n.slice(0, end)) return [n, "ชื่อ filter ห้ามลงท้ายด้วยจุดหรือช่องว่าง"];
  if (RESERVED_NAMES.has(pyStrip(n.split(".")[0]).toUpperCase())) return [n, `“${n}” เป็นชื่อสงวนของ Windows (CON, PRN, AUX, NUL, COM1-9, LPT1-9)`];
  const len = [...n].length;
  if (len > MAX_FILTER_NAME) return [n, `ชื่อ filter ยาวเกิน ${MAX_FILTER_NAME} ตัวอักษร (ตอนนี้ ${len})`];
  return [n, null];
}

/** [file name the game can play, explanation or null]: "#" and ";" become "_". */
export function safeSoundName(name: string): [string, string | null] {
  const reasons: string[] = [];
  let n = name;
  if (n.includes("#")) {
    n = n.replaceAll("#", "_");
    reasons.push("เกมเล่นไฟล์ที่ชื่อมี # ไม่ได้");
  }
  if (n.includes(";")) {
    n = n.replaceAll(";", "_");
    reasons.push("เกมใช้ ; คั่นหลายไฟล์");
  }
  if (!reasons.length) return [name, null];
  return [n, `เปลี่ยนชื่อ "${name}" เป็น "${n}" เพราะ` + reasons.join(" และ")];
}

export function freeName(name: string, taken: { has(n: string): boolean }): string {
  const i = name.lastIndexOf(".");
  const stem = i < 0 ? name : name.slice(0, i);
  const ext = i < 0 ? "" : name.slice(i);
  let n = 2;
  while (taken.has(`${stem}-${n}${ext}`)) n++;
  return `${stem}-${n}${ext}`;
}

export interface SoundItem {
  dest: string;
  label: string;
  hash: string;
  status: "new" | "same" | "conflict";
  alt?: null;
}
export interface SoundPlan {
  dest: Record<string, string>;
  items: SoundItem[];
  notes: string[];
  taken: Set<string>;
}

/**
 * Decide the destination name of every sound file before anything is copied.
 * requests: [label, original file name, content hash][]; existing: {file name: content hash | null}.
 */
export function planSoundFiles(requests: [string, string, string][], existing: Record<string, string | null>): SoundPlan {
  const used = new Map<string, string>();
  const items: SoundItem[] = [];
  const dest: Record<string, string> = {};
  const notes: string[] = [];
  const existingNames = new Set(Object.keys(existing));
  for (const [label, name, h] of requests) {
    const [cand0, msg] = safeSoundName(name);
    let cand = cand0;
    if (msg && !notes.includes(msg)) notes.push(msg);
    if (used.has(cand)) {
      if (used.get(cand) === h) {
        dest[label] = cand;
        continue;
      }
      const other = freeName(cand, new Set([...used.keys(), ...existingNames]));
      notes.push(`ไฟล์เสียง "${name}" ชื่อซ้ำกับอีกไฟล์ที่เลือกไว้ (คนละเนื้อหา) ใช้ชื่อ "${other}"`);
      cand = other;
      used.set(cand, h);
      items.push({ dest: cand, label, hash: h, status: "new", alt: null });
      dest[label] = cand;
      continue;
    }
    const status = !existingNames.has(cand) ? "new" : existing[cand] === h ? "same" : "conflict";
    used.set(cand, h);
    items.push({ dest: cand, label, hash: h, status });
    dest[label] = cand;
  }
  return { dest, items, notes, taken: new Set([...existingNames, ...used.keys()]) };
}

export type Decide = (name: string, alt: string) => "overwrite" | "keep" | string;

/** [dest map, copies, messages] from planSoundFiles. decide(name, alt) is asked once per conflicting name (default: keep). */
export function resolveSoundPlan(plan: SoundPlan, decide?: Decide | null): [Record<string, string>, [string, string][], string[]] {
  const dest = { ...plan.dest };
  const taken = new Set(plan.taken);
  const copies: [string, string][] = [];
  const msgs = [...plan.notes];
  for (const it of plan.items) {
    let final = it.dest;
    if (it.status === "same") {
      msgs.push(`ใช้ไฟล์เดิม "${final}" (เนื้อไฟล์ตรงกัน ไม่ก๊อปซ้ำ)`);
      continue;
    }
    if (it.status === "conflict") {
      const alt = freeName(final, taken);
      const choice = decide ? decide(final, alt) : "keep";
      if (choice === "overwrite") msgs.push(`ทับไฟล์เสียง "${final}"`);
      else {
        final = alt;
        taken.add(final);
        msgs.push(`เก็บไฟล์เดิม "${it.dest}" ไว้ ไฟล์ใหม่ใช้ชื่อ "${final}"`);
      }
    }
    copies.push([it.label, final]);
    for (const [lab, d] of Object.entries(dest)) if (d === it.dest) dest[lab] = final;
  }
  return [dest, copies, msgs];
}

// ---------------------------------------------------------------------------
// Quest items (Q): the game never hides them (tested), so they only get a style
// ---------------------------------------------------------------------------

export const QUEST_CLASSES: Record<string, string[]> = {
  poe1: ["Quest Items", "Cursed Ducat", "Pantheon Souls", "Labyrinth Items", "Labyrinth Trinkets"],
  poe2: ["Quest Items", "Instance Local Items"],
};
export const QUEST_BASETYPES: Record<string, string[]> = { poe1: [], poe2: ["Bronze Key", "Gold Key", "Silver Key"] };

const quoteNames = (names: string[]): string => names.map((n) => `"${n}"`).join(" ");

/** The Q blocks ("" when the style writes nothing and there are no `defaultLines` to fall back on). */
export function buildQuestBlocks(game: string, style: unknown, soundFile: string | null | undefined = null, defaultLines: string[] | null = null): string {
  const own = filterStyle.styleLines(style, soundFile);
  const lines = own.length ? own : [...(defaultLines ?? [])];
  if (!lines.length) return "";
  let out = ["# quest items (poe-checker)", "Show", `    Class == ${quoteNames(get(QUEST_CLASSES, game, ["Quest Items"])!)}`];
  out = [...out, ...lines, ""];
  const bt = get(QUEST_BASETYPES, game);
  if (bt && bt.length) out = [...out, "Show", `    BaseType == ${quoteNames(bt)}`, ...lines, ""];
  return out.join("\n") + "\n";
}

/** {label: source file or null} the NeverSink tab wants copied: sound_1 .. sound_6 plus Q's file sound. */
export function tierSoundRequests(fgCfg: Cfg): Record<string, string | null> {
  const sm: Record<string, string | null> = {};
  for (const n of filterGen.SOUND_SLOTS) sm[n] = truthy(fgCfg[`sound_${n}`]) ? fgCfg[`sound_${n}`] : null;
  sm.Q = truthy(fgCfg.style_q) ? filterStyle.usesSoundFile(fgCfg.style_q) : null;
  return sm;
}

export const SOUND_FORMAT = 2;

/** [config, notes]: a config from before the sounds were split (sound_s / sound_a / sound_b / sound_c) is converted once. */
export function migrateSounds(fg: Cfg): [Cfg, string[]] {
  if (fg.sound_format === SOUND_FORMAT) return [fg, []];
  const out: Cfg = { ...fg };
  const old: Record<string, string> = {};
  for (const t of ["S", "A", "B", "C"]) old[t] = truthy(fg[`sound_${t.toLowerCase()}`]) ? fg[`sound_${t.toLowerCase()}`] : "";
  for (const [t, n] of [["S", "1"], ["A", "2"], ["B", "3"]] as const) {
    if (old[t] && !truthy(out[`sound_${n}`])) out[`sound_${n}`] = old[t];
  }
  const styles: Record<string, any> = {};
  for (const [k, v] of Object.entries(truthy(fg.wl_tier_style) ? fg.wl_tier_style : {})) styles[k] = isDict(v) ? { ...v } : v;
  for (const t of ["S", "A", "B", "C"]) {
    if (!old[t]) continue;
    const cur: Record<string, any> = isDict(styles[t]) ? styles[t] : {};
    const snd: Record<string, any> = isDict(cur.sound) ? cur.sound : {};
    if (snd.kind === "file" || snd.kind === "game") continue; // the tier already has a sound of its own
    styles[t] = { ...cur, sound: { kind: "file", id: 1, file: old[t], volume: filterGen.SOUND_VOLUME } };
  }
  if (Object.keys(styles).length) out.wl_tier_style = styles;
  for (const k of ["sound_s", "sound_a", "sound_b", "sound_c"]) delete out[k];
  out.sound_format = SOUND_FORMAT;
  const notes: string[] = [];
  if (Object.values(old).some((v) => v)) {
    notes.push("เสียงเดิม " +
      ["S", "A", "B", "C"].filter((t) => old[t]).map((t) => `${t}: ${old[t].replaceAll("\\", "/").split("/").pop()}`).join(" / ") +
      " ถูกแปลงแล้ว — แท็บ NeverSink: เสียง 1 / 2 / 3 (= เสียง 6 / 1 / 2 ของ NeverSink) · " +
      "แท็บ Whitelist: เสียงของ tier S / A / B (C) ชุดเดิม · สองแท็บแยกกันแล้ว");
  }
  return [out, notes];
}

// ---------------------------------------------------------------------------
// Generate
// ---------------------------------------------------------------------------

/** What the caller has to fetch before buildFilterText. */
export function planFetch(fgCfg: Cfg, game: string): { mode: string; hub: boolean; neversink: boolean } {
  if (truthy(fgCfg.whitelist_enabled) && truthy(fgCfg.wl_v2)) return { mode: "whitelist", hub: true, neversink: true };
  if (truthy(fgCfg.whitelist_enabled)) {
    return { mode: "whitelist", hub: truthy(get(fgCfg, `whitelist_cats_${game}`, [])), neversink: false };
  }
  return { mode: "tier", hub: false, neversink: true };
}

export const TIER_HEADER = "# Generated by PoE Price & Trade Checker (Filter Generator) - NeverSink base filter, no price data\n";

/** copies the chosen sound files next to the filter and returns {label: name written}; may be async */
export type CopySounds = (wanted: Record<string, string>) => Record<string, string> | Promise<Record<string, string>>;

export interface BuildOptions {
  hubData?: any;
  baseText?: string | null;
  baseTag?: string | null;
  copySoundsFn?: CopySounds | null;
  extraNames?: Iterable<string> | null;
  appVersion?: string;
  log?: Log;
}

export type BuildResult = Record<string, any>;

/**
 * Returns whitelist: {mode:"whitelist", generated_section, base_text:null, count, ...}; tier: {mode:"tier",
 * generated_section, base_text, base_tag}; null: whitelist with nothing selected (warning already logged).
 */
export async function buildFilterText(fgCfgIn: Cfg, game: string, opts: BuildOptions = {}): Promise<BuildResult | null> {
  const { hubData = null, baseText = null, baseTag = null, copySoundsFn = null, extraNames = null, appVersion = "", log = noopLog } = opts;
  const [fgCfg] = migrateSounds(fgCfgIn); // a config that still has sound_s / sound_a / sound_b (read once)
  if (truthy(fgCfg.whitelist_enabled) && truthy(fgCfg.wl_v2)) {
    return await buildWhitelistV2(fgCfg, game, hubData, baseText, copySoundsFn, extraNames, log, appVersion);
  }
  if (truthy(fgCfg.whitelist_enabled)) return await buildWhitelist(fgCfg, game, hubData, log, copySoundsFn);
  return await buildTier(fgCfg, game, baseText, baseTag, copySoundsFn, log);
}

const PLAY_ALERT = /^(\s*)PlayAlertSound\s+(\d+)/;

/** The NeverSink tab's numbered sound next to the PlayAlertSound of the old whitelist's blocks. */
export function addSharedTierSounds(section: string, copied: Record<string, string>): string {
  const out: string[] = [];
  for (const line of splitLines(section)) {
    out.push(line);
    const m = PLAY_ALERT.exec(line);
    const slot = m && has(filterGen.SOUND_SLOT_OF_ID, m[2]) ? filterGen.SOUND_SLOT_OF_ID[m[2]] : undefined;
    const f = slot !== undefined ? get(copied, slot) : undefined;
    if (m && truthy(f)) out.push(`${m[1]}CustomAlertSoundOptional "${f}" ${filterGen.SOUND_VOLUME}`);
  }
  return out.join("\n") + (section.endsWith("\n") ? "\n" : "");
}

function nonNull(m: Record<string, string | null>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(m)) if (truthy(v)) out[k] = v as string;
  return out;
}

async function buildWhitelist(fgCfg: Cfg, gv: string, hubData: any, log: Log, copySoundsFn: BuildOptions["copySoundsFn"]): Promise<BuildResult | null> {
  const exact: string[] = [];
  const goldOn = truthy(fgCfg.whitelist_gold);
  const uniqueAll = truthy(fgCfg.whitelist_unique_all);
  const gold_min = Math.max(0, intOr(truthy(fgCfg.whitelist_gold_min) ? fgCfg.whitelist_gold_min : 0, 0));
  const contains: unknown[] = [...(get(fgCfg, `whitelist_custom_${gv}`, []) as unknown[])];
  // poe2: uncut gem + level per type | poe1: gem names -> contains
  const gemUncut: [string, number][] = Object.entries(truthy(fgCfg[`whitelist_gem_uncut_${gv}`]) ? fgCfg[`whitelist_gem_uncut_${gv}`] : {})
    .map(([b, lv]) => [b, pyInt(lv)]);
  contains.push(...(get(fgCfg, `whitelist_gem_names_${gv}`, []) as unknown[]));
  const cats = get(fgCfg, `whitelist_cats_${gv}`, []) as string[];
  const uniqBases: string[] = [];

  if (truthy(cats) && hubData !== null && hubData !== undefined) {
    try {
      exact.push(...filterGen.expandCategories(hubData, cats, get(fgCfg, `whitelist_cat_exclude_${gv}`, {})));
    } catch (e) {
      log(`⚠ ดึง hub ไม่ได้ ใช้เฉพาะ currency/ชื่อที่ติ๊ก: ${(e as Error).message}`, "warn");
    }
  }

  if (!exact.length && !uniqBases.length && !contains.length && !gemUncut.length && !goldOn && !uniqueAll) {
    log("⚠ โหมดโชว์เฉพาะ: ยังไม่ได้เลือกอะไร — ไม่ generate", "warn");
    return null;
  }
  let section = filterGen.buildWhitelistSection(exact, uniqBases, contains, { gemUncut, gold: goldOn, goldMin: gold_min, uniqueAll });
  const count = new Set(exact).size + new Set(uniqBases).size + contains.length + gemUncut.length + Number(goldOn) + Number(uniqueAll);
  const wanted = nonNull(tierSoundRequests(fgCfg)); // S / A / B / Q files
  const copied = Object.keys(wanted).length && copySoundsFn ? await copySoundsFn(wanted) : {};
  if (Object.keys(copied).length) section = addSharedTierSounds(section, copied);
  const quest = truthy(fgCfg.style_q) ? buildQuestBlocks(gv, fgCfg.style_q, get(copied, "Q")) : "";
  if (quest) { // quest items are never hidden by the game, but they still get their own look / sound
    const i = section.indexOf("\n");
    const head = i < 0 ? section : section.slice(0, i);
    const rest = i < 0 ? "" : section.slice(i + 1);
    section = head + "\n" + quest + rest;
  }
  return { mode: "whitelist", generated_section: section, base_text: null, count };
}

async function buildWhitelistV2(fgCfg: Cfg, gv: string, hubData: any, baseText: string | null, copySoundsFn: BuildOptions["copySoundsFn"],
  extraNames: Iterable<string> | null, log: Log, appVersion = ""): Promise<BuildResult | null> {
  if (!baseText) {
    log("⚠ ไม่มี NeverSink base filter — whitelist ไม่มี tier เริ่มต้น ไม่ generate", "warn");
    return null;
  }
  const soundMap = filterWhitelist.soundRequests(fgCfg, gv);
  soundMap.Q = truthy(fgCfg.style_q) ? filterStyle.usesSoundFile(fgCfg.style_q) : null;
  const copied = copySoundsFn ? await copySoundsFn(soundMap as Record<string, string>) : {};
  // the whitelist ends in `Hide`, so the quest blocks are always written: the player's Q style, else NeverSink's own look
  const quest = buildQuestBlocks(gv, fgCfg.style_q, get(copied, "Q"), filterWhitelist.neversinkQuestLines(baseText));
  const res = filterWhitelist.buildWhitelistFilter(gv, fgCfg, baseText, hubData, quest, copied, extraNames);
  for (const [base, tiers] of res.unique_conflicts) {
    log(`⚠ unique หลายตัวบน base ${base} มี tier ไม่เท่ากัน — ใช้ tier สูงสุด: ` +
      Object.entries(tiers).sort((a, b) => cmpStr(a[0], b[0])).map(([n, t]) => `${n}=${t}`).join(", "), "warn");
  }
  if (res.skipped.length) {
    const shown = res.skipped.slice(0, 8).map(([n, where]) => `${n} (${where})`).join(", ");
    const more = res.skipped.length > 8 ? ` … +${res.skipped.length - 8}` : "";
    log(`⚠ ข้าม ${res.skipped.length} ชื่อที่ไม่ยืนยันว่าเป็นชื่อจริงของเกม (ไม่เขียนลงไฟล์): ${shown}${more}`, "warn");
  }
  if (res.bad_names.length) {
    const shown = res.bad_names.slice(0, 8).map(([n, where]) => `${n} (${where})`).join(", ");
    const more = res.bad_names.length > 8 ? ` … +${res.bad_names.length - 8}` : "";
    log(`⚠ ข้าม ${res.bad_names.length} ชื่อที่รู้ว่าไม่ใช่ชื่อไอเท็ม (เช่น [DNT], INCOMPLETE) ไม่เขียนลงไฟล์: ${shown}${more}`, "warn");
  }
  // the settings go into the file too (comment lines), so the Whitelist tab can open and edit it again
  return { mode: "whitelist", generated_section: wlEmbed.embed(res.text, fgCfg, gv, appVersion), base_text: null, count: res.count,
    report: res.report, skipped: res.skipped, bad_names: res.bad_names };
}

async function buildTier(fgCfg: Cfg, gv: string, baseTextIn: string | null, baseTag: string | null, copySoundsFn: BuildOptions["copySoundsFn"], log: Log): Promise<BuildResult> {
  if (!baseTextIn) return { mode: "tier", generated_section: "", base_text: null, base_tag: baseTag };
  const soundMap = tierSoundRequests(fgCfg);
  const copied = copySoundsFn ? await copySoundsFn(soundMap as Record<string, string>) : {};
  const [baseText, done] = filterGen.applyNumberedSounds(baseTextIn, copied);
  if (Object.keys(done).length) {
    const total = Object.values(done).reduce((a, b) => a + b, 0);
    log(`✓ ใส่เสียง custom ใน ${total} block ตามเลขเสียงของ NeverSink ` +
      `(${Object.entries(done).sort((a, b) => cmpStr(a[0], b[0])).map(([k, v]) => `เสียง ${k}: ${v}`).join(", ")})`, "ok");
  }
  const quest = truthy(fgCfg.style_q) ? buildQuestBlocks(gv, fgCfg.style_q, get(copied, "Q")) : "";
  const section = TIER_HEADER + (quest ? "\n" + quest : "");
  return { mode: "tier", generated_section: section, base_text: baseText, base_tag: baseTag };
}
