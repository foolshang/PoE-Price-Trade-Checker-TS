/**
 * Filter Generator - pure helpers. Port of poe_price_trade/filter_gen.py.
 *  - custom alert sounds in tier mode (NeverSink's own sound numbers mark its value ladders)
 *  - whitelist ("show only") mode: build_whitelist_section and the category helpers
 */
import { PY_S, firstIsSpace, pyInt, pyStrip, sortedBy, splitWs, truthy, isDict, sortedStr, pyStr } from "./py.ts";

export const SOUND_VOLUME = 300;

const S = PY_S;
const BASETYPE_LINE = new RegExp(`^[${S}]*BaseType[${S}]*(?:==)?[${S}]*((?:"[^"]*"[${S}]*)+)$`);
const PLAY_ALERT_LINE = new RegExp(`^[${S}]*PlayAlertSound[${S}]+([^\\n]+?)[${S}]*$`);

export const findQuoted = (text: string): string[] => [...text.matchAll(/"([^"]*)"/g)].map((m) => m[1]);

/**
 * One active (non-commented) Show/Hide block located within some `text.split("\n")` list. `start`/`end` index that
 * list: `lines[start]` is the "Show"/"Hide" header line, `end` is exclusive.
 */
export class Block {
  constructor(
    public blockType: string,
    public start: number,
    public end: number,
    public basetypeLine: number | null,
    public basetypeNames: string[],
  ) {}
}

/** Locate Show/Hide blocks: a block starts at an unindented line whose first token is exactly "Show" or "Hide". */
export function parseBlocks(lines: string[]): Block[] {
  const blocks: Block[] = [];
  let blockType: string | null = null;
  let start = 0;
  let basetypeLine: number | null = null;
  let basetypeNames: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const firstToken = pyStrip(raw) ? splitWs(raw, 1)[0] : "";
    const isStart = !firstIsSpace(raw) && (firstToken === "Show" || firstToken === "Hide");
    if (isStart) {
      if (blockType !== null) blocks.push(new Block(blockType, start, i, basetypeLine, basetypeNames));
      blockType = firstToken;
      start = i;
      basetypeLine = null;
      basetypeNames = [];
      continue;
    }
    if (blockType !== null) {
      const m = BASETYPE_LINE.exec(raw);
      if (m) {
        basetypeLine = i;
        basetypeNames = findQuoted(m[1]);
      }
    }
  }
  if (blockType !== null) blocks.push(new Block(blockType, start, lines.length, basetypeLine, basetypeNames));
  return blocks;
}

// ---------------------------------------------------------------------------
// Custom sounds by NeverSink's own sound numbers (tier mode)
// ---------------------------------------------------------------------------

const TYPE_TAG = /\$type->(\S+)/;
const TIER_TAG = /\$tier->(\S+)/;
export const SOUND_SLOT_OF_ID: Record<string, string> = { "6": "1", "1": "2", "2": "3", "3": "4", "4": "5", "5": "6" };
export const SOUND_SLOTS = ["1", "2", "3", "4", "5", "6"];

export function headerTags(lines: string[], block: Block): [string | null, string | null] {
  const mType = TYPE_TAG.exec(lines[block.start]);
  const mTier = TIER_TAG.exec(lines[block.start]);
  return [mType ? mType[1] : null, mTier ? mTier[1] : null];
}

/** `style_lines` with the custom sound added (CustomAlertSoundOptional; an existing CustomAlertSound[Optional] is replaced). */
export function customSoundLines(styleLines: string[], fileName: string, indent = "    "): string[] {
  const filtered = styleLines.filter((l) => {
    const first = splitWs(l, 1)[0] ?? "";
    return first !== "CustomAlertSound" && first !== "CustomAlertSoundOptional";
  });
  filtered.push(`${indent}CustomAlertSoundOptional "${fileName}" ${SOUND_VOLUME}`);
  return filtered;
}

/** The id of the first PlayAlertSound line of a block body, or null. */
export function soundIdOf(body: string[]): string | null {
  for (const l of body) {
    const m = PLAY_ALERT_LINE.exec(l);
    if (m && splitWs(m[1]).length) return splitWs(m[1])[0];
  }
  return null;
}

/**
 * [new_text, {slot: blocks changed}]. `soundMap` = {"1".."6": file name or null}. Every Show block whose PlayAlertSound id
 * belongs to a slot with a file gets that file as CustomAlertSoundOptional.
 */
export function applyNumberedSounds(baseText: string, soundMap: Record<string, string | null> | null | undefined): [string, Record<string, number>] {
  const files = new Map<string, string>();
  for (const [k, v] of Object.entries(soundMap ?? {})) if (truthy(v) && SOUND_SLOTS.includes(k)) files.set(k, v as string);
  if (!files.size) return [baseText, {}];
  const lines = baseText.split("\n");
  const edits: [number, number, string[]][] = [];
  const done = new Map<string, number>();
  for (const b of parseBlocks(lines)) {
    if (b.blockType !== "Show") continue;
    const bodyAll = lines.slice(b.start + 1, b.end);
    const id = soundIdOf(bodyAll) ?? "";
    const slot = Object.prototype.hasOwnProperty.call(SOUND_SLOT_OF_ID, id) ? SOUND_SLOT_OF_ID[id] : undefined;
    if (slot === undefined || !files.has(slot)) continue;
    let end = b.end;
    while (end - 1 > b.start && (!pyStrip(lines[end - 1]) || !firstIsSpace(lines[end - 1]))) end--;
    const body = lines.slice(b.start + 1, end);
    const first = body.find((l) => pyStrip(l));
    const indent = first === undefined ? "    " : new RegExp(`^[${S}]*`).exec(first)![0];
    edits.push([b.start + 1, end, customSoundLines(body, files.get(slot)!, indent)]);
    done.set(slot, (done.get(slot) ?? 0) + 1);
  }
  for (const [start, end, add] of edits.reverse()) lines.splice(start, end - start, ...add);
  return [lines.join("\n"), Object.fromEntries(done)];
}

// ---------------------------------------------------------------------------
// Whitelist ("show only") mode - standalone filter, no NeverSink involved.
// ---------------------------------------------------------------------------

export const GOLD_BASETYPES = ["Gold"];

export const WHITELIST_GEM_UNCUT: Record<string, string[]> = {
  poe2: ["Uncut Skill Gem", "Uncut Spirit Gem", "Uncut Support Gem"],
  poe1: [],
};

export const WHITELIST_CATEGORIES: Record<string, string[]> = {
  poe2: ["Currency", "Fragment", "Rune", "Essence", "SoulCore", "Omen", "Catalyst", "Delirium", "Verisium", "AbyssalBone",
    "Artifact", "LineageGem", "Idol", "Expedition"],
  poe1: ["Currency", "Fragment", "Essence", "Fossil", "Resonator", "Oil", "Scarab", "Artifact", "DeliriumOrb", "DivinationCard"],
};

/** Every entry of a hub prices payload (currency[] + items[]). */
export function* iterHubItems(hubData: any): Generator<Record<string, any>> {
  for (const section of ["currency", "items"]) {
    const list = hubData && isDict(hubData) ? hubData[section] : undefined;
    for (const it of truthy(list) ? list : []) if (isDict(it)) yield it;
  }
}

/** Every entry name (= BaseType) in the chosen hub categories, regardless of price. */
export function namesInCategories(hubData: any, categories: Iterable<unknown> | null | undefined): string[] {
  const want = new Set([...(categories ?? [])].map((c) => pyStr(c).toLowerCase()));
  const out: string[] = [];
  for (const it of iterHubItems(hubData)) {
    const name = pyStrip(truthy(it.name) ? it.name : "");
    if (name && want.has((truthy(it.category) ? pyStr(it.category) : "").toLowerCase())) out.push(name);
  }
  return out;
}

/** namesInCategories per category minus that category's exclude list. */
export function expandCategories(hubData: any, categories: Iterable<string> | null | undefined, exclude?: Record<string, string[]> | null): string[] {
  const ex = exclude ?? {};
  const out: string[] = [];
  for (const cat of categories ?? []) {
    const skip = new Set(Object.prototype.hasOwnProperty.call(ex, cat) ? ex[cat] : []);
    out.push(...namesInCategories(hubData, [cat]).filter((n) => !skip.has(n)));
  }
  return out;
}

const RARITY_ORDER = ["Normal", "Magic", "Rare", "Unique"];

/** list[str] (any rarity) and list[{name, rarities}] -> [[name, rarities in canonical order]]. */
export function normalizeCustom(containsNames: unknown): [string, string[]][] {
  const out: [string, string[]][] = [];
  for (const e of (Array.isArray(containsNames) ? containsNames : [])) {
    let nm: string, rar: string[];
    if (typeof e === "string") {
      nm = pyStrip(e);
      rar = [...RARITY_ORDER];
    } else if (isDict(e)) {
      nm = pyStrip(Object.prototype.hasOwnProperty.call(e, "name") ? pyStr(e.name) : "");
      const have = new Set(Array.isArray(e.rarities) ? e.rarities : []);
      const rs = RARITY_ORDER.filter((r) => have.has(r));
      rar = rs.length ? rs : [...RARITY_ORDER];
    } else continue;
    if (nm) out.push([nm, rar]);
  }
  return out;
}

/** Show exact BaseTypes + typed names + unique bases + Hide catch-all. "" when all inputs are empty. */
export function buildWhitelistSection(
  exactBasetypes: Iterable<string> | null | undefined,
  uniqueBases: Iterable<string> | null | undefined = null,
  containsNames: unknown = null,
  opts: { gemUncut?: [string, unknown][] | null; gold?: boolean; goldMin?: unknown; uniqueAll?: boolean } = {},
): string {
  const { gemUncut = null, gold = false, uniqueAll = false } = opts;
  const goldMin = opts.goldMin ?? 0;
  const exact = sortedStr(new Set([...(exactBasetypes ?? [])].filter((b) => b)));
  const uniq = sortedStr(new Set([...(uniqueBases ?? [])].filter((b) => b)));
  const cont = normalizeCustom(containsNames);
  const gems: [string, number][] = (gemUncut ?? []).filter(([b]) => truthy(b)).map(([b, lv]) => [pyStr(b), pyInt(lv)]);
  if (!exact.length && !uniq.length && !cont.length && !gems.length && !gold && !uniqueAll) return "";
  const lines: string[] = ["# === PoE Checker - Whitelist (show only) ==="];
  if (gold) {
    // own block: StackSize must not constrain the other exact BaseTypes
    const gm = Math.max(0, pyInt(truthy(goldMin) ? goldMin : 0));
    lines.push("# gold" + (gm > 0 ? ` (stack >= ${gm})` : ""), "Show", `    BaseType == "${GOLD_BASETYPES[0]}"`);
    if (gm > 0) lines.push(`    StackSize >= ${gm}`);
    lines.push(
      "    SetFontSize 45",
      "    SetTextColor 255 255 255 255",
      "    SetBorderColor 255 200 0 255",
      "    SetBackgroundColor 75 50 0 255",
      "    PlayAlertSound 6 300",
      "    MinimapIcon 0 Yellow Star",
      "    PlayEffect Yellow",
      "",
    );
  }
  if (exact.length) {
    const names = exact.map((b) => `"${b}"`).join(" ");
    lines.push(
      "Show",
      `    BaseType == ${names}`,
      "    SetFontSize 45",
      "    SetTextColor 255 255 255 255",
      "    SetBorderColor 255 200 0 255",
      "    SetBackgroundColor 75 50 0 255",
      "    PlayAlertSound 6 300",
      "    MinimapIcon 0 Yellow Star",
      "    PlayEffect Yellow",
      "",
    );
  }
  if (cont.length) {
    // one Show block per rarity set (a block carries one BaseType + one Rarity line)
    const groups = new Map<string, { rar: string[]; names: Set<string> }>();
    for (const [nm, rar] of cont) {
      const k = rar.join("|");
      if (!groups.has(k)) groups.set(k, { rar, names: new Set() });
      groups.get(k)!.names.add(nm);
    }
    const allset = new Set(RARITY_ORDER);
    const ordered = sortedBy([...groups.values()], (g) => g.rar.map((r) => RARITY_ORDER.indexOf(r)));
    for (const { rar, names: namesSet } of ordered) {
      const joined = sortedStr(namesSet).map((c) => `"${c}"`).join(" ");
      const isAll = rar.length === allset.size && rar.every((r) => allset.has(r));
      const tag = isAll ? "any rarity" : rar.join("/");
      lines.push(`# typed names (contains match, ${tag})`, "Show", `    BaseType ${joined}`);
      if (!isAll) lines.push(`    Rarity ${rar.join(" ")}`);
      lines.push(
        "    SetFontSize 45",
        "    SetTextColor 0 255 255 255",
        "    SetBorderColor 0 255 255 255",
        "    SetBackgroundColor 0 50 60 255",
        "    PlayAlertSound 2 300",
        "    MinimapIcon 0 Cyan Star",
        "    PlayEffect Cyan",
        "",
      );
    }
  }
  if (uniq.length) {
    const names = uniq.map((b) => `"${b}"`).join(" ");
    lines.push(
      "# uniques above the value threshold (shows every unique on these bases)",
      "Show",
      `    BaseType == ${names}`,
      "    Rarity Unique",
      "    SetFontSize 45",
      "    SetTextColor 175 96 37 255",
      "    SetBorderColor 175 96 37 255",
      "    SetBackgroundColor 50 30 10 255",
      "    PlayAlertSound 3 300",
      "    MinimapIcon 0 Brown Star",
      "    PlayEffect Brown",
      "",
    );
  }
  for (const [base, lvl] of gems) {
    lines.push(
      `# uncut gem: ${base} (GemLevel >= ${lvl})`,
      "Show",
      `    BaseType "${base}"`,
      `    GemLevel >= ${lvl}`,
      "    SetFontSize 45",
      "    SetTextColor 255 255 255 255",
      "    SetBorderColor 60 220 120 255",
      "    SetBackgroundColor 10 50 25 255",
      "    PlayAlertSound 1 300",
      "    MinimapIcon 0 Green Star",
      "    PlayEffect Green",
      "",
    );
  }
  if (uniqueAll) {
    lines.push(
      "# all uniques",
      "Show",
      "    Rarity Unique",
      "    SetFontSize 45",
      "    SetTextColor 175 96 37 255",
      "    SetBorderColor 175 96 37 255",
      "    SetBackgroundColor 50 30 10 255",
      "    PlayAlertSound 3 300",
      "    MinimapIcon 0 Brown Star",
      "    PlayEffect Brown",
      "",
    );
  }
  lines.push("# hide everything else", "Hide", "");
  return lines.join("\n");
}
