/**
 * Read a whitelist filter written by an older build of this program (no settings embedded in it) back into whitelist
 * settings, so the Whitelist tab can open and edit it. Port of poe_price_trade/wl_import.py.
 *
 * Two kinds are known, both recognised by the first lines of the file: v1 "# === PoE Checker - Whitelist (show only) ==="
 * and v2 "# === PoE Checker - Whitelist (own tiers, starting tiers ...) ===". `summarize` turns the text into plain
 * sections; `read` maps them onto a WlModel. A name the file does not list is hidden (tier D).
 */
import * as filterGen from "./filter_gen.ts";
import * as filterStyle from "./filter_style.ts";
import * as w from "./filter_whitelist.ts";
import { HIDE, WlModel } from "./wl_model.ts";
import { PY_S, pyStrip, splitAll, splitLines } from "./py.ts";

const S = PY_S;
export const V1_HEADER = "# === PoE Checker - Whitelist (show only)";
export const V2_HEADER = "# === PoE Checker - Whitelist (own tiers";
const STYLE_KW = new Set([
  "SetFontSize", "SetTextColor", "SetBorderColor", "SetBackgroundColor", "PlayAlertSound", "PlayEffect", "MinimapIcon",
  "CustomAlertSoundOptional"]);
const TIERS3 = ["S", "A", "B"];
const ALL_RAR = ["Normal", "Magic", "Rare", "Unique"];

/** "v1" | "v2" | null (not a whitelist file of this program). */
export function versionOf(text: string): "v1" | "v2" | null {
  const head = text.slice(0, 600);
  if (head.includes(V2_HEADER)) return "v2";
  if (head.includes(V1_HEADER)) return "v1";
  return null;
}

export class FBlock {
  conds: [string, string][] = []; // [(keyword, rest of the line)]
  style: string[] = []; // the style lines, stripped
  constructor(public title: string, public kind: string) {}

  values(kw: string): string[] {
    return this.conds.filter(([k]) => k === kw).map(([, r]) => r);
  }

  /** BaseType == "a" "b" ... (exact names), and the bare `BaseType "a"` lines our own blocks use. */
  names(): string[] {
    return this.values("BaseType").flatMap((r) => filterGen.findQuoted(r));
  }

  /** BaseType "a" "b" ... (a bare line = substring match). */
  fragments(): string[] {
    return this.values("BaseType").filter((r) => !r.startsWith("==")).flatMap((r) => filterGen.findQuoted(r));
  }

  classes(): string[] {
    return this.values("Class").flatMap((r) => filterGen.findQuoted(r));
  }

  soundFile(): [string, number] | null {
    for (const l of this.style) {
      if (l.startsWith("CustomAlertSoundOptional")) {
        const m = SOUND_LINE.exec(l);
        if (m) return [m[1], m[2] ? parseInt(m[2], 10) : 300];
      }
    }
    return null;
  }
}

const SOUND_LINE = new RegExp(`^CustomAlertSoundOptional[${S}]+"([^"]+)"[${S}]*([0-9]+)?`);

/** "poe2" / "poe1" when the file says so (waystones / tablets vs maps), else null. */
export function guessGame(text: string): "poe2" | "poe1" | null {
  if (/Waystone|"Tablet"|^# tablets/m.test(text)) return "poe2";
  if (/Class == "Maps"|MapTier|^# maps:/m.test(text)) return "poe1";
  return null;
}

/** [FBlock] of a filter file: the comment line right above Show / Hide is the block's title. */
export function parseBlocks(text: string): FBlock[] {
  const out: FBlock[] = [];
  let cur: FBlock | null = null;
  let title = "";
  for (const raw of splitLines(text)) {
    const s = pyStrip(raw);
    if (!s) {
      cur = null;
      title = "";
      continue;
    }
    if (s.startsWith("#")) {
      title = s;
      cur = null;
      continue;
    }
    const i = s.indexOf(" ");
    const kw = i < 0 ? s : s.slice(0, i);
    const rest = i < 0 ? "" : s.slice(i + 1);
    if (kw === "Show" || kw === "Hide") {
      cur = new FBlock(title, kw);
      out.push(cur);
      title = "";
    } else if (cur !== null) {
      if (STYLE_KW.has(kw)) cur.style.push(s);
      else cur.conds.push([kw, pyStrip(rest)]);
    }
  }
  return out;
}

export interface Summary {
  version: string;
  shown: Map<string, [string, number]>; // name -> (tier, stack minimum)   (S/A/B blocks)
  tier_lines: Map<string, string[]>; // tier -> style lines of its first block
  tier_sound: Map<string, string>; // tier -> shared sound file name
  quest_sound: string;
  names_v1: Set<string>; // v1: the one block of names
  unique_bases: Map<string, string>; // base -> tier
  unique_all: boolean;
  tablet_own: Map<string, string>; // tablet name -> tier (S/A/B/D)
  tablet_block: FBlock | null;
  map_on: boolean | null;
  map_tier: number;
  map_rarity: string;
  map_block: FBlock | null;
  gold_on: boolean | null;
  gold_min: number;
  gold_block: FBlock | null;
  gem_uncut: Map<string, number>;
  gem_names: string[];
  gem_blocks: FBlock[];
  custom: [string, string[], string][]; // (name, rarities, tier)
  classes: Map<string, string>; // class -> tier
  fragments: Map<string, string>; // name fragment -> tier
  gear_types: string[]; // the block types of `# gear:` blocks (gear is NeverSink's now: only named in the notes)
  hidden_c: Set<string>;
}

const newSummary = (version: string): Summary => ({
  version, shown: new Map(), tier_lines: new Map(), tier_sound: new Map(), quest_sound: "", names_v1: new Set(),
  unique_bases: new Map(), unique_all: false, tablet_own: new Map(), tablet_block: null, map_on: null, map_tier: 1,
  map_rarity: "Normal", map_block: null, gold_on: null, gold_min: 0, gold_block: null, gem_uncut: new Map(), gem_names: [],
  gem_blocks: [], custom: [], classes: new Map(), fragments: new Map(), gear_types: [], hidden_c: new Set(),
});

/** The sections of an old whitelist file, or null when it is not one. */
export function summarize(text: string): Summary | null {
  const ver = versionOf(text);
  if (!ver) return null;
  const sm = newSummary(ver);
  for (const b of parseBlocks(text)) {
    const t = b.title;
    const names = b.names();
    const sound = b.soundFile();
    if (t.startsWith("# quest items")) {
      if (sound && !sm.quest_sound) sm.quest_sound = sound[0];
      continue;
    }
    let m = /^# tier ([SABC])(?: - stack >= ([0-9]+))?$/.exec(t); // (an old file's hidden "tier C (hidden" never matches)
    if (m && b.kind === "Show") {
      const tier = m[1], need = m[2] ? parseInt(m[2], 10) : 1;
      for (const n of names) sm.shown.set(n, [tier, need]);
      if (!sm.tier_lines.has(tier)) sm.tier_lines.set(tier, b.style);
      if (sound && !sm.tier_sound.has(tier)) sm.tier_sound.set(tier, sound[0]);
      continue;
    }
    if (t.startsWith("# tier C (hidden") || t.startsWith("# tier D (hidden")) { // C = an old file's hidden tier, D = the new one's
      for (const n of names) sm.hidden_c.add(n);
      continue;
    }
    m = /^# tier ([SAB]) - special classes/.exec(t);
    if (m) {
      for (const c of b.classes()) sm.classes.set(c, m[1]);
      continue;
    }
    m = /^# tier ([SAB]) - names by fragment/.exec(t);
    if (m) {
      for (const f of b.fragments()) sm.fragments.set(f, m[1]);
      continue;
    }
    m = /^# uniques - tier ([SABC])/.exec(t);
    if (m) {
      for (const n of names) sm.unique_bases.set(n, m[1]);
      continue;
    }
    if (t.startsWith("# uniques above the value threshold")) { // v1
      for (const n of names) sm.unique_bases.set(n, "B");
      continue;
    }
    if (t.startsWith("# all uniques")) {
      sm.unique_all = true;
      continue;
    }
    m = /^# tablets - tier ([SABCD])( \(hidden)?/.exec(t);
    if (m) {
      const hide = m[1] === "D" || !!m[2]; // "tier C (hidden by the player)" of an old file = hidden
      for (const n of names) sm.tablet_own.set(n, hide ? HIDE : m[1]);
      continue;
    }
    if (t === "# tablets") {
      sm.tablet_block = b;
      continue;
    }
    m = /^# (maps|waystones): tier >= ([0-9]+) and rarity >= ([\p{L}\p{N}_]+)/u.exec(t);
    if (m) {
      sm.map_on = true;
      sm.map_tier = parseInt(m[2], 10);
      sm.map_rarity = m[3];
      sm.map_block = b;
      continue;
    }
    if (/^# (maps|waystones): not filtered/.test(t)) {
      sm.map_on = false;
      continue;
    }
    if (t.startsWith("# gold:")) {
      sm.gold_on = false;
      continue;
    }
    if (t.startsWith("# gold")) {
      sm.gold_on = true;
      sm.gold_block = b;
      const mm = /stack >= ([0-9]+)/.exec(t);
      sm.gold_min = mm ? parseInt(mm[1], 10) : 0;
      continue;
    }
    m = /^# uncut gem: ([^\n]+) \(GemLevel >= ([0-9]+)\)/.exec(t);
    if (m) {
      sm.gem_uncut.set(m[1], parseInt(m[2], 10));
      sm.gem_blocks.push(b);
      continue;
    }
    if (t === "# gems") {
      sm.gem_names.push(...names);
      sm.gem_blocks.push(b);
      continue;
    }
    m = /^# typed names \(contains(?:,| match,) ?([^)]*)\)(?: - tier ([SABC]))?/.exec(t);
    if (m) {
      const rarVals = b.values("Rarity").map((x) => splitAll(x).join(" "));
      let rar = ALL_RAR.filter((r) => rarVals.some((x) => x.includes(r)));
      if (!rar.length) rar = [...ALL_RAR];
      for (const n of b.fragments()) sm.custom.push([n, rar, m[2] || "B"]);
      continue;
    }
    m = /^# gear: [^\n]+ - tier [SABCD] \(([^\n]+)\)$/.exec(t);
    if (m) {
      sm.gear_types.push(m[1]);
      continue;
    }
    if (t.startsWith("# hide everything")) continue;
    if (ver === "v1" && !t && b.kind === "Show" && names.length && !b.values("Rarity").length && !b.values("StackSize").length &&
        !b.values("Class").length) {
      for (const n of names) sm.names_v1.add(n); // v1: the one block of names
    }
  }
  return sm;
}

// ---------------------------------------------------------------------------------------------------------
// onto a WlModel
// ---------------------------------------------------------------------------------------------------------

/** A folder next to the opened filter: used to turn a sound file name into a real path when the file exists. */
export interface FolderLike {
  /** the path the program would use for `name` inside the folder (str(folder / name)) */
  path(name: string): string;
  isFile(name: string): boolean;
}

/** The style dict of a block's style lines, the file sound included (CustomAlertSoundOptional). */
function linesStyle(lines: string[], folder: FolderLike | null): filterStyle.Style {
  const style = filterStyle.linesToStyle(lines);
  for (const l of lines) {
    const m = SOUND_LINE.exec(l);
    if (m) {
      style.sound = { kind: "file", id: 1, file: folder && folder.isFile(m[1]) ? folder.path(m[1]) : m[1], volume: m[2] ? parseInt(m[2], 10) : 300 };
    }
  }
  return style;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a as object), kb = Object.keys(b as object);
  return ka.length === kb.length && ka.every((k) => deepEqual((a as any)[k], (b as any)[k]));
}

const sameLook = (a: string[], b: string[]): boolean => deepEqual(filterStyle.linesToStyle(a), filterStyle.linesToStyle(b));

export interface ReadResult {
  model: WlModel;
  notes: string[];
  sounds: Record<string, string>;
  version: string;
  summary: Summary;
  overlap: number;
  unique_mismatch: Set<string>;
}

/**
 * The settings of the old file on top of `current` (the settings the program remembered, with its data loaded), or null
 * when the text is not a whitelist file of this program.
 */
export function read(text: string, game: string, current: WlModel, folder: FolderLike | null = null): ReadResult | null {
  const sm = summarize(text);
  if (sm === null) return null;
  const notes: string[] = [];
  let guessed: string[] = [];
  const baseCfg = current.cfg();
  const wm = WlModel.fromConfig(baseCfg, game);
  wm.setData(current.hub, current.base_text, current.extra_names);
  wm.item_tier = {};
  wm.cat_tier = {};
  wm.unique_tier = {};
  wm.block_tier = {};
  wm.item_stack = {};
  wm.tier_stack = {};
  wm.rarity_rows = {}; // no old file has them
  const v1 = sm.version === "v1";
  const stackable = wm._stackable;
  // ---- names
  const newCat = new Set((w.NAMED_CATEGORIES[game] ?? []).map(([c]) => c));
  for (const [n, cat] of wm._names) {
    if (newCat.has(cat)) continue; // a list the old file cannot have: NeverSink's own tiers
    if (w.isTablet(game, n)) {
      if (sm.tablet_own.has(n)) {
        if (sm.tablet_own.get(n) !== "T") wm.item_tier[n] = sm.tablet_own.get(n);
      } else if (v1 && !sm.names_v1.has(n)) wm.item_tier[n] = HIDE;
      else if (!v1 && sm.tablet_block === null) wm.item_tier[n] = HIDE;
      continue;
    }
    const dflt = wm._defaults.get(n) || "B";
    let tier: string, need: number;
    if (v1) {
      tier = sm.names_v1.has(n) ? (dflt !== HIDE ? dflt : "B") : HIDE;
      need = 1;
    } else [tier, need] = sm.shown.get(n) ?? [HIDE, 1];
    if (tier !== dflt) wm.item_tier[n] = tier;
    if (tier !== HIDE && stackable.has(n)) {
      const d = (wm._stackDefaults.get(n) ?? [1])[0];
      if (need !== d) wm.item_stack[n] = need;
    }
  }
  // ---- uniques
  if (!sm.unique_bases.size && !sm.unique_all) wm.cat_tier[w.UNIQUE_CATEGORY] = HIDE;
  else if (!(v1 && sm.unique_all)) {
    const byBase = new Map<string, string[]>();
    for (const [name, base] of wm._entries) {
      if (!byBase.has(base)) byBase.set(base, []);
      byBase.get(base)!.push(name);
    }
    const hidden = [...byBase.keys()].filter((b) => !sm.unique_bases.has(b)).length;
    const wholeC = hidden > byBase.size / 2; // mostly hidden: one category tier + the few shown ones by name
    if (wholeC) wm.cat_tier[w.UNIQUE_CATEGORY] = HIDE;
    for (const [base, nms] of byBase) {
      const tier = sm.unique_bases.get(base) ?? HIDE;
      if ((wholeC && tier !== HIDE) || (!wholeC && tier !== (wm._uniqueDefaults.get(base) || "B"))) {
        for (const nm of nms) wm.unique_tier[nm] = tier;
      }
    }
  }
  // a unique's tier is set by its name, so a name that sits on two bases cannot get a different tier for each one
  let uniqueMismatch = new Set<string>();
  if (!v1 && sm.unique_bases.size) {
    const [got] = w.resolveUniqueTiers(game, wm.cfg(), wm._entries, wm._uniqueDefaults);
    uniqueMismatch = new Set([...sm.unique_bases].filter(([b, t]) => got.has(b) && got.get(b) !== t).map(([b]) => b));
    if (uniqueMismatch.size) {
      notes.push(`unique ${uniqueMismatch.size} ฐานได้ tier ไม่ตรงไฟล์เดิม (ชื่อ unique ชื่อเดียวกันอยู่หลายฐาน ` +
        `ตั้ง tier ได้ทีละชื่อ — ตรวจที่หมวด Unique)`);
    }
  }
  // ---- what the tab does not set any more: NeverSink's own blocks (equipment groups, keys / special classes)
  const gnames: Record<string, string> = {};
  for (const [gid, n] of w.GEAR_GROUPS[game] ?? []) gnames[gid] = n;
  const cut: string[] = [];
  for (const ty of sm.gear_types) {
    const gid = w.gearGroupOf(game, ty);
    if (gid && !cut.includes(gnames[gid])) cut.push(gid !== w.FLASK_GROUP ? gnames[gid] : "Flask / Charm");
  }
  if (sm.classes.size || sm.fragments.size) cut.push("กุญแจ/ของพิเศษ (class)");
  if (cut.length) notes.push("หมวดที่ตัดออกแล้ว ไฟล์ใหม่ใช้ block ของ NeverSink แทนค่าในไฟล์เก่า: " + cut.join(", "));
  const fresh = (w.NAMED_CATEGORIES[game] ?? []).map(([c]) => c);
  if (fresh.length) notes.push("หมวดที่ไฟล์รุ่นนั้นยังไม่มี ใช้ค่าเริ่มต้นของ NeverSink (ไม่ใช่ D): " + fresh.join(", "));
  // ---- gold / map / gems / typed names
  wm.gold = !!sm.gold_on;
  if (sm.gold_on) wm.gold_min = sm.gold_min;
  wm.map_on = !!sm.map_on;
  if (sm.map_on) {
    wm.map_tier = Math.max(1, Math.min(16, sm.map_tier));
    wm.map_rarity = ALL_RAR.includes(sm.map_rarity) ? sm.map_rarity : "Normal";
  } else if (v1) {
    notes.push("ไฟล์ v1 ซ่อน map/waystone ทั้งหมด (ไม่มีใน block) แต่แท็บนี้เลือกได้แค่ \"โชว์ตามเกม\" หรือ " +
      "\"โชว์ตามเกณฑ์\" — ตั้งเป็นโชว์ตามเกม");
  }
  if ((filterGen.WHITELIST_GEM_UNCUT[game] ?? []).length) wm.gem_uncut = Object.fromEntries(sm.gem_uncut);
  else wm.gem_names = [...sm.gem_names];
  wm.custom = sm.custom.map(([n, r, t]) => ({ name: n, rarities: [...r], tier: t }));
  // ---- looks
  const tierLines = new Map(sm.tier_lines);
  for (const tier of [...TIERS3, "C"]) {
    if (tierLines.has(tier)) wm.setStyleFromEditor(tier, linesStyle(tierLines.get(tier)!, folder));
    else if (tier !== "C") guessed.push(`สไตล์ tier ${tier}`); // (a file from before tier C has no C look: nothing to guess)
  }
  if (sm.gold_block !== null) wm.setStyleFromEditor("G", linesStyle(sm.gold_block.style, folder));
  else guessed.push("สไตล์ Gold");
  if (game === "poe2") {
    if (sm.tablet_block !== null) wm.setStyleFromEditor("Tablet", linesStyle(sm.tablet_block.style, folder));
    else guessed.push("สไตล์ Tablet");
  }
  if (sm.map_block !== null) wm.setStyleFromEditor("Map", linesStyle(sm.map_block.style, folder));
  else guessed.push("สไตล์ Map/Waystone");
  if (sm.gem_blocks.length) {
    const gemLines = sm.gem_blocks[0].style;
    const hit = [...TIERS3, "C"].find((t) => tierLines.has(t) && sameLook(tierLines.get(t)!, gemLines));
    if (hit) wm.gem_tier = hit;
    else {
      wm.gem_tier = "B";
      guessed.push("tier ของ Gem");
    }
  }
  if (v1) {
    guessed = guessed.filter((g) => g.startsWith("สไตล์"));
    notes.push("ไฟล์ v1 ไม่มี tier: ชื่อที่โชว์ใช้ tier เริ่มต้นของ NeverSink (ถ้าเริ่มที่ D ใช้ B), ชื่ออื่นเป็น D, " +
      "อุปกรณ์/ของพิเศษทั้งหมด D เหมือนที่ไฟล์เดิมไม่มี");
  }
  if (guessed.length) notes.push("ส่วนที่อ่านกลับจากไฟล์ไม่ได้ ใช้ค่าที่โปรแกรมจำไว้ล่าสุด: " + guessed.join(", "));
  const stackOff = Object.keys(wm.item_stack).filter((n) => wm.item_stack[n] === 1);
  if (stackOff.length && !v1 && ![...sm.shown.values()].some(([, need]) => need > 1)) {
    notes.push(`ไฟล์เก่าไม่มีเงื่อนไข StackSize: ${stackOff.length} ชื่อที่ NeverSink โชว์เฉพาะกอง ` +
      `ตั้ง "จำนวนขั้นต่ำ" เป็น 1 (โชว์ทุกกอง) ให้ตรงกับไฟล์เดิม`);
  }
  const sounds: Record<string, string> = Object.fromEntries(sm.tier_sound);
  if (sm.quest_sound) sounds.Q = sm.quest_sound;
  const listed = new Set([...sm.shown.keys(), ...sm.names_v1]);
  const overlap = listed.size ? [...listed].filter((n) => wm._names.has(n)).length / listed.size : 1.0;
  return { model: wm, notes, sounds, version: sm.version, summary: sm, overlap, unique_mismatch: uniqueMismatch };
}
