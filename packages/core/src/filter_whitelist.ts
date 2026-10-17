/**
 * Whitelist tab engine - port of poe_price_trade/filter_whitelist.py. The filter file is written entirely by us (no
 * NeverSink blocks), but the starting tier of every item comes from NeverSink's strictness-2 base filter.
 * Pure: everything it needs comes in as text / dicts.
 *
 * Tiers: S, A, B, C are shown, each with its own style; D = hidden (the file ends with Hide). See the Python module
 * docstring for the rules (default tier of a name = the first ordinary Show / Hide block that lists it, ...).
 */
import * as filterGen from "./filter_gen.ts";
import type { Block } from "./filter_gen.ts";
import * as filterStyle from "./filter_style.ts";
import { PY_S, cmpStr, cmpTuple, get, intOr, isDict, pyInt, pyLstrip, pyRstrip, pyStrip, sortedBy, sortedSet,
  sortedStr, splitAll, splitWs, truthy, uniq, PyError, pyStr } from "./py.ts";

const S = PY_S;
const re = (src: string, flags = ""): RegExp => new RegExp(src, flags);

export const TIERS = ["S", "A", "B", "C"] as const;             // the shown tiers (each has a style)
export const HIDE_TIER = "D";                                    // hidden
export const ALL_TIERS = [...TIERS, HIDE_TIER];
export const TIER_FORMAT = 2;                                    // wl_tier_format of a config that knows C is shown and D is hidden
const RANK: Record<string, number> = { S: 0, A: 1, B: 2, C: 3, D: 4 };
export const LADDER_LETTER_TIER: Record<string, string> = { s: "S", a: "S", b: "A", c: "A", d: "B", e: "B" };
const STYLE_TOKENS = new Set(["SetFontSize", "SetTextColor", "SetBorderColor", "SetBackgroundColor", "PlayAlertSound", "PlayEffect", "MinimapIcon"]);
export const SPECIAL_CONDITIONS = ["StackSize", "AreaLevel", "Rarity", "ItemLevel", "Quality", "DropLevel", "MapTier", "WaystoneTier"];
const UNIQUE_BLOCKING = ["StackSize", "AreaLevel", "ItemLevel", "Quality", "DropLevel", "MapTier", "WaystoneTier"];
const VALUE_PREFIXES = ["currency", "fragments", "divination", "sockets->general", "xenotiering"];
export const OTHER_CATEGORY = "NeverSink";

export const SPECIAL_CLASSES: Record<string, string[]> = {
  poe1: ["Vault Keys", "Incursion Items", "Relics", "Sanctum Research", "Blueprints", "Contracts", "Heist Targets", "Corpses",
    "Wombgifts", "Chart", "Pieces"],
  poe2: ["Pinnacle Keys", "Vault Keys", "Expedition Logbook"],
};
export const NEW_GEAR_GROUPS = ["gems"];
export const SPECIAL_BASE: Record<string, string[]> = { poe1: ["Runegraft", "Vial of"], poe2: [] };
export const BASE_PREFIX = "BaseType:";
export const NAMED_CATEGORIES: Record<string, [string, string[]][]> = {
  poe1: [["Runegraft", ["runesgrafts"]], ["Vial", ["vials"]], ["Corpse", ["corpses"]], ["Wombgift", ["exotic->wombgifts"]],
    ["Relic", ["artefact->sanctifiedrelics"]]],
  poe2: [["Relic", ["relics"]]],
};
export const HUB_EXCLUDED = ["UncutGem", "SkillGem", "BaseType", "ClusterJewel", "Map", "PrecursorTablet"];

export const GEAR_CATEGORY = "Gear";
export const GEAR_PREFIX = "gear:";
export const UNIQUE_CATEGORY = "Unique";
/** (id, Thai name, default tier). Order = display order. */
export const GEAR_GROUPS: Record<string, [string, string, string][]> = {
  poe1: [
    ["story", "เนื้อเรื่อง/เลเวลลิ่ง", "B"], ["links", "6-link / 5-link", "A"],
    ["heist", "Heist (cloak/brooch/gear/tool)", "B"], ["jewel", "Jewel (abyss/cluster/ทั่วไป/พิเศษ)", "B"],
    ["flask", "Flask / Tincture endgame", "B"], ["influenced", "Influenced", "B"],
    ["rare_ilvl", "Rare ตาม ilvl (แหวน/สร้อย/เข็มขัด)", "B"], ["rare_mod", "Rare ที่ระบุแล้วมี mod ดี", "B"],
    ["magic_mod", "Magic ที่ระบุแล้วมี mod ดี", "B"], ["exotic", "Exotic base/mod", "B"],
    ["craft", "ฐานคราฟต์", "B"], ["special", "Memory Strand / Gear พิเศษ", "B"],
    ["gems", "Gem ทั่วไป", "B"],
  ],
  poe2: [
    ["story", "เนื้อเรื่อง/เลเวลลิ่ง", "B"], ["zone", "Magic/Rare ตามเลเวลโซน", "B"],
    ["jewellery", "เครื่องประดับ", "B"], ["rare_ilvl", "Rare ตาม ilvl", "B"], ["jewel", "Jewel", "B"],
    ["flask", "Flask / Charm", "B"], ["craft", "Craft base", "B"], ["exotic", "Exotic base/mod", "B"],
    ["salvage", "Salvage (Quality/Sockets)", "B"], ["alwaysshow", "ของที่เกมบังคับโชว์ (AlwaysShow)", "B"],
  ],
};
export const GEAR_LISTED: Record<string, string[]> = { poe1: [], poe2: [] };
export const FLASK_GROUP = "flask";
export const FLASK_CATEGORY = "flaskcharm";
export const RARITY_CHOICES = ["Normal", "Magic"];
export const RARITY_REMOVED = "Rare";
export const RARITY_ROWS: Record<string, [string, string, string[]][]> = {
  poe1: [["Flask", "Flask", ["Life Flasks", "Mana Flasks", "Hybrid Flasks", "Utility Flasks"]], ["Tincture", "Tincture", ["Tinctures"]]],
  poe2: [["Flask", "Flask", ["Life Flasks", "Mana Flasks"]], ["Charm", "Charm", ["Charms"]]],
};
export const FLASK_LABEL: Record<string, string> = { poe1: "Flask / Tincture", poe2: "Flask / Charm" };

export const EQUIP_CATEGORY = "equipclass";
export const EQUIP_LABEL = "อุปกรณ์ตาม class";
export const EQUIP_CHOICES = ["Normal", "Magic", "Rare"];
export const EQUIP_GROUPS: Record<string, [string, string, string[]][]> = {
  poe1: [
    ["weapon", "อาวุธ", ["Bows", "Claws", "Daggers", "One Hand Axes", "One Hand Maces", "One Hand Swords",
      "Thrusting One Hand Swords", "Rune Daggers", "Two Hand Axes", "Two Hand Maces", "Two Hand Swords", "Staves",
      "Warstaves", "Wands", "Sceptres", "Quivers"]],
    ["armour", "เกราะ", ["Body Armours", "Boots", "Gloves", "Helmets", "Shields"]],
    ["jewellery", "เครื่องประดับ", ["Amulets", "Rings", "Belts"]],
    ["other", "อื่นๆ", ["Jewels", "Abyss Jewels"]],
  ],
  poe2: [
    ["weapon", "อาวุธ", ["Bows", "Crossbows", "Quarterstaves", "Staves", "Talismans", "Spears", "One Hand Maces",
      "Two Hand Maces", "Wands", "Sceptres", "Quivers"]],
    ["armour", "เกราะ", ["Body Armours", "Boots", "Gloves", "Helmets", "Shields", "Bucklers", "Foci"]],
    ["jewellery", "เครื่องประดับ", ["Amulets", "Rings", "Belts"]],
    ["other", "อื่นๆ", ["Jewels"]],
  ],
};
export const EQUIP_DISPLAY: Record<string, string> = { Foci: "Focus" };

export const equipLabel = (cls: string): string => get(EQUIP_DISPLAY, cls, cls)!;
export const equipGroups = (game: string): [string, string, string[]][] =>
  (EQUIP_GROUPS[game] ?? []).map(([g, n, c]) => [g, n, [...c]]);
export const equipClasses = (game: string): string[] => (EQUIP_GROUPS[game] ?? []).flatMap(([, , cs]) => cs);

export const LEGACY_RARITY_KEY = "wl_rarity_tier";
const GEAR_NOT = ["exoticmap", "exotic->wombgifts", "currency"];
const sw = (t: string, prefixes: string[]): boolean => prefixes.some((p) => t.startsWith(p));
const GEAR_RULES: Record<string, [string, (t: string) => boolean][]> = {
  poe1: [
    ["story", (t) => t.includes("leveling")],
    ["links", (t) => t === "6l" || t === "socketslinks"],
    ["heist", (t) => t.startsWith("heist->") && !sw(t, ["heist->contract", "heist->blueprint"])],
    ["jewel", (t) => t.startsWith("jewels")],
    ["flask", (t) => sw(t, ["endgameflasks", "endgametinctures"])],
    ["influenced", (t) => t.startsWith("influenced")],
    ["rare_ilvl", (t) => sw(t, ["rr", "decorators->rareeg"])],
    ["rare_mod", (t) => sw(t, ["rareid", "rareblendid"])],
    ["magic_mod", (t) => t === "magicid"],
    ["exotic", (t) => sw(t, ["exotic", "rare->exotic", "rare->eater", "rare->exarch", "corruptedid"])],
    ["craft", (t) => t.startsWith("crafting")],
    ["special", (t) => t.startsWith("gear->")],
    ["gems", (t) => t.startsWith("gems")],
  ],
  poe2: [
    ["story", (t) => t.includes("leveling")],
    ["zone", (t) => t.startsWith("ut->")],
    ["jewellery", (t) => sw(t, ["endgame->jewellery", "rr->jewellery"])],
    ["rare_ilvl", (t) => t === "rr" || sw(t, ["decorators->rareeg", "rare->salvagable"])],
    ["jewel", (t) => t.startsWith("jewels")],
    ["flask", (t) => sw(t, ["endgame->flasks", "endgame->charms"])],
    ["craft", (t) => t.startsWith("endgame->normalcraft")],
    ["exotic", (t) => sw(t, ["exotic", "chancing"])],
    ["salvage", (t) => t.startsWith("endgame->salvagable")],
    ["alwaysshow", (t) => t === "special->alwaysshow"],
  ],
};
const NOT_CONDITION = new Set([...STYLE_TOKENS, "DisableDropSound", "CustomAlertSound", "CustomAlertSoundOptional"]);

export const gearCat = (gid: string): string => GEAR_PREFIX + gid;

export function gearGroupOf(game: string, ty: string | null | undefined): string | null {
  if (!ty || sw(ty, GEAR_NOT)) return null;
  for (const [gid, rule] of GEAR_RULES[game] ?? []) if (rule(ty)) return gid;
  return null;
}

export const listedGearGroups = (game: string): [string, string, string][] =>
  (GEAR_GROUPS[game] ?? []).filter((g) => (GEAR_LISTED[game] ?? []).includes(g[0]));

export const rarityRows = (game: string): [string, string, string[]][] => [...(RARITY_ROWS[game] ?? [])];

const FALLBACK_TYPES = ["runesgrafts", "vials"];

function copyReason(game: string, ty: string | null, classes: string[], hasNames: boolean): string | null {
  const gid = gearGroupOf(game, ty);
  if (gid && !(GEAR_LISTED[game] ?? []).includes(gid)) return gid;
  const special = new Set(SPECIAL_CLASSES[game] ?? []);
  if (classes.some((c) => special.has(c))) return "special";
  if (sw(ty ?? "", FALLBACK_TYPES) && !hasNames) return "special";
  return null;
}

export type GearListed = [string, string, string | null, string | null, string[]]; // key, gid, ty, tag, conds
export type GearEntry =
  | ["listed", GearListed]
  | ["copy", string, string | null, string | null, string, string[]];

const CLASS_LINE = re(`^[${S}]*Class\\b`);

/** NeverSink's blocks the whitelist file takes over, in file order. */
export function gearSequence(game: string, baseText: string): GearEntry[] {
  const [lines, blocks] = scan(baseText);
  const out: GearEntry[] = [];
  const seen = new Map<string, number>();
  for (const b of blocks) {
    const [ty, tag] = filterGen.headerTags(lines, b);
    const body = lines.slice(b.start + 1, b.end);
    const classes = body.filter((l) => CLASS_LINE.test(l)).flatMap((l) => filterGen.findQuoted(l));
    const reason = copyReason(game, ty, classes, exactNames(lines, b).length > 0);
    if (reason) {
      let end = body.length;
      while (end && (!pyStrip(body[end - 1]) || pyLstrip(body[end - 1]).startsWith("#"))) end--;
      out.push(["copy", reason, ty, tag, b.blockType, body.slice(0, end).map(pyRstrip)]);
      continue;
    }
    const gid = gearGroupOf(game, ty);
    if (!gid || b.blockType !== "Show") continue;
    const conds: string[] = [];
    for (const l of body) {
      const t = pyStrip(l);
      if (t && !t.startsWith("#") && !NOT_CONDITION.has(splitWs(t, 1)[0])) conds.push("    " + t);
    }
    // `Continue` blocks only decorate (size / colour tweaks) and carry on to later blocks: not a selection
    if (conds.length && !conds.some((c) => pyStrip(c) === "Continue")) {
      const k = `${ty}\u0000${tag ?? ""}`;
      const n = (seen.get(k) ?? 0) + 1;
      seen.set(k, n);
      out.push(["listed", [`${pyStr(ty)}|${tag || ""}|${n}`, gid, ty, tag, conds]]);
    }
  }
  return out;
}

export const gearBlockItems = (game: string, baseText: string): GearListed[] =>
  gearSequence(game, baseText).filter((e): e is ["listed", GearListed] => e[0] === "listed").map((e) => e[1]);

export const gearBlocks = (game: string, baseText: string): [string, string | null, string[]][] =>
  gearBlockItems(game, baseText).map(([, gid, ty, , conds]) => [gid, ty, conds]);

const WEAPON_CLASSES = new Set(["Bows", "Claws", "Daggers", "One Hand Axes", "One Hand Maces", "One Hand Swords", "Rune Daggers",
  "Sceptres", "Staves", "Thrusting One Hand Swords", "Two Hand Axes", "Two Hand Maces", "Two Hand Swords", "Wands", "Warstaves",
  "Crossbows", "Quarterstaves", "Spears", "Talismans", "Flails"]);
const ARMOUR_CLASSES = new Set(["Body Armours", "Boots", "Gloves", "Helmets", "Shields", "Bucklers", "Foci", "Quivers"]);
const CLASS_THAI: Record<string, string> = { Rings: "แหวน", Amulets: "สร้อย", Belts: "เข็มขัด", Jewels: "Jewel",
  "Abyss Jewels": "Abyss Jewel", "Life Flasks": "Flask", "Mana Flasks": "Flask", "Utility Flasks": "Flask",
  "Hybrid Flasks": "Flask", Tinctures: "Tincture", Charms: "Charm", "Heist Cloaks": "Heist Cloak",
  "Heist Brooches": "Heist Brooch", "Skill Gems": "Gem", "Support Gems": "Gem" };
const RARITY_ORDER = ["Normal", "Magic", "Rare", "Unique"];
const CMP = [">=", "<=", "<", ">", "==", "="];

const subset = (a: Set<string>, b: Set<string>): boolean => [...a].every((x) => b.has(x));

function shortList(names: string[], limit = 2): string {
  return names.slice(0, limit).join(", ") + (names.length > limit ? ` +${names.length - limit}` : "");
}

/** A readable name for one gear block, summed up from its conditions. */
export function blockLabel(ty: string, conds: string[]): string {
  let rar = "", cls = "", base = "";
  const extra: string[] = [];
  let ilvlLo: string | null = null, ilvlHi: string | null = null;
  for (const c of conds) {
    const cs = pyStrip(c);
    const i = cs.indexOf(" ");
    const kw = i < 0 ? cs : cs.slice(0, i);
    const rest = i < 0 ? "" : cs.slice(i + 1);
    const toks = splitAll(rest);
    const names = filterGen.findQuoted(rest);
    if (kw === "Rarity") {
      const ranks = toks.filter((t) => RARITY_ORDER.includes(t));
      if (toks.length && CMP.includes(toks[0]) && ranks.length) rar = `${toks[0]} ${ranks[0]}`;
      else if (ranks.length && !(new Set(ranks).size === 3 && ["Normal", "Magic", "Rare"].every((r) => ranks.includes(r)))) rar = ranks.join("/");
    } else if (kw === "Class") {
      if (names.length && subset(new Set(names), WEAPON_CLASSES)) cls = "อาวุธ";
      else if (names.length && subset(new Set(names), ARMOUR_CLASSES)) cls = "เกราะ";
      else cls = shortList(uniq(names.map((x) => get(CLASS_THAI, x, x)!)), 2);
    } else if (kw === "BaseType") base = shortList(names, 1);
    else if (kw === "ItemLevel" && toks.length === 2) {
      if (toks[0] === ">=") ilvlLo = toks[1];
      else if (toks[0] === "<=") ilvlHi = toks[1];
      else extra.push(`ilvl ${toks[0]} ${toks[1]}`);
    } else if (["AreaLevel", "Quality", "DropLevel", "LinkedSockets", "Sockets", "UnidentifiedItemTier", "MemoryStrands", "GemLevel"].includes(kw)) {
      extra.push(`${kw} ${rest}`.replaceAll(">=", "≥").replaceAll("<=", "≤"));
    } else if (kw === "HasInfluence") extra.push("influence");
    else if ((kw === "Corrupted" || kw === "TwiceCorrupted") && pyStrip(rest) === "True") extra.push("corrupted");
    else if (kw === "Identified" && pyStrip(rest) === "True") extra.push("ระบุแล้ว");
    else if (kw === "HasExplicitMod") extra.push("มี mod ที่ระบุ");
    else if (kw === "TransfiguredGem" && pyStrip(rest) === "True") extra.push("Transfigured");
    else if (["AnyEnchantment", "FracturedItem", "AlwaysShow"].includes(kw) && pyStrip(rest) === "True") extra.push(kw);
  }
  if (ilvlLo && ilvlHi) extra.unshift(`ilvl ${ilvlLo}–${ilvlHi}`);
  else if (ilvlLo) extra.unshift(`ilvl ≥ ${ilvlLo}`);
  else if (ilvlHi) extra.unshift(`ilvl ≤ ${ilvlHi}`);
  if (cls && base) extra.push(`base ${base}`);
  const what = cls || (base ? `base ${base}` : "");
  const head = [rar, what].filter((x) => x).join(" ") || "ทุกชิ้น";
  return head + (extra.length ? "  " + uniq(extra).join(" · ") : "") + `   [${ty}]`;
}

const valid = (t: unknown): string | null => (typeof t === "string" && ALL_TIERS.includes(t) ? t : null);
const dget = (o: unknown, k: string): any => get(o, k);
const orEmpty = (v: unknown): Record<string, any> => (truthy(v) ? (v as Record<string, any>) : {});

function legacyGearTier(game: string, cfg: Record<string, any>, gid: string): string | null {
  return valid(dget(orEmpty(cfg[`wl_gear_tier_${game}`]), gid)) || valid(dget(orEmpty(cfg[`wl_cat_tier_${game}`]), GEAR_CATEGORY));
}

/** {group id: tier}: the player's tier for the group's category > the group's default. */
export function gearTiers(game: string, cfg: Record<string, any>): Record<string, string> {
  const cats = orEmpty(cfg[`wl_cat_tier_${game}`]);
  const out: Record<string, string> = {};
  for (const [gid, , dflt] of listedGearGroups(game)) out[gid] = valid(dget(cats, gearCat(gid))) || legacyGearTier(game, cfg, gid) || dflt;
  return out;
}

/** {block key: tier} for every gear block: the block's own tier > its group's tier. */
export function gearBlockTiers(game: string, cfg: Record<string, any>, items: GearListed[]): Record<string, string> {
  const group = gearTiers(game, cfg);
  const own = orEmpty(cfg[`wl_block_tier_${game}`]);
  const out: Record<string, string> = {};
  for (const [key, gid] of items) out[key] = valid(dget(own, key)) || group[gid];
  return out;
}

/** The style lines of NeverSink's own quest-item block (`$tier->questitems`). */
export function neversinkQuestLines(baseText: string): string[] {
  const [lines, blocks] = scan(baseText || "");
  for (const b of blocks) {
    if (b.blockType === "Show" && filterGen.headerTags(lines, b)[1] === "questitems") {
      const got = lines.slice(b.start + 1, b.end).filter((l) => pyStrip(l) && STYLE_TOKENS.has(splitWs(l, 1)[0])).map((l) => "    " + pyStrip(l));
      if (got.length) return got;
    }
  }
  return filterStyle.styleLines(filterStyle.defaultQuestStyle());
}

const TIER_STEP = /^(?:t([0-9]+)[\p{L}\p{N}_]*|(s|a|b|c|d|e))$/u;

/** S = t1-t2, A = t3-t4, B = t5-t6, C = t7-t8; letter steps by LADDER_LETTER_TIER; any other tag is not a step. */
export function tierOfStep(tag: string | null | undefined): string | null {
  const m = TIER_STEP.exec(tag ?? "");
  if (!m) return null;
  if (m[1]) {
    const n = parseInt(m[1], 10);
    return n <= 2 ? "S" : n <= 4 ? "A" : n <= 6 ? "B" : n <= 8 ? "C" : null;
  }
  return LADDER_LETTER_TIER[m[2]];
}

export const EXACT_LINE = re(`^[${S}]*BaseType[${S}]*==[${S}]*((?:"[^"]*"[${S}]*)+)$`);

/** The names of a block's `BaseType == ...` lines. */
export function exactNames(lines: string[], b: Block): string[] {
  const out: string[] = [];
  for (const l of lines.slice(b.start + 1, b.end)) {
    const m = EXACT_LINE.exec(l);
    if (m) out.push(...filterGen.findQuoted(m[1]));
  }
  return out;
}

/** Every name any `BaseType ==` line of the base filter uses. */
export function knownNames(baseText: string): Set<string> {
  const [lines, blocks] = scan(baseText);
  const out = new Set<string>();
  for (const b of blocks) for (const n of exactNames(lines, b)) out.add(n);
  return out;
}

export function conds(lines: string[], b: Block): Set<string> {
  const out = new Set<string>();
  for (const l of lines.slice(b.start + 1, b.end)) {
    const t = pyStrip(l);
    if (t && !t.startsWith("#")) out.add(splitWs(t, 1)[0]);
  }
  return out;
}
const intersects = (a: Set<string>, b: Iterable<string>): boolean => [...b].some((x) => a.has(x));

/** [lines, blocks] of a NeverSink base filter. */
export function scan(baseText: string): [string[], Block[]] {
  const lines = baseText.split("\n");
  return [lines, filterGen.parseBlocks(lines)];
}

/** {name: tier} by the rule in the module docstring (first ordinary-step / Hide block wins). */
export function defaultTiers(baseText: string): Map<string, string> {
  const [lines, blocks] = scan(baseText);
  const out = new Map<string, string>();
  for (const b of blocks) {
    const names = exactNames(lines, b);
    if (!names.length) continue;
    const cs = conds(lines, b);
    if (intersects(cs, SPECIAL_CONDITIONS) || cs.has("Continue")) continue;
    const tier = b.blockType === "Hide" ? HIDE_TIER : tierOfStep(filterGen.headerTags(lines, b)[1]) || "B";
    for (const n of names) if (!out.has(n)) out.set(n, tier);
  }
  return out;
}

/** Every name NeverSink lists in its value-ladder blocks. */
export function ladderNames(baseText: string): Set<string> {
  const [lines, blocks] = scan(baseText);
  const out = new Set<string>();
  for (const b of blocks) {
    const ty = filterGen.headerTags(lines, b)[0] || "";
    if (sw(ty, VALUE_PREFIXES) && !ty.includes("leveling")) for (const n of exactNames(lines, b)) out.add(n);
  }
  return out;
}

const bodyStyleLines = (lines: string[], b: Block): string[] =>
  lines.slice(b.start + 1, b.end).filter((l) => pyStrip(l) && STYLE_TOKENS.has(splitWs(l, 1)[0])).map((l) => "    " + pyStrip(l));

/** {"S"|"A"|"B"|"C": style lines}: S / A / B copy the look of NeverSink's currency ladder steps 1, 2, 3; C is the faded preset. */
export function defaultTierLines(baseText: string): Record<string, string[]> {
  const [lines, blocks] = scan(baseText);
  const steps: Block[] = [];
  for (const b of blocks) {
    const [ty, tag] = filterGen.headerTags(lines, b);
    if (ty === "currency" && b.blockType === "Show" && exactNames(lines, b).length > 0 && tierOfStep(tag) &&
        !intersects(conds(lines, b), SPECIAL_CONDITIONS)) steps.push(b);
  }
  const out: Record<string, string[]> = {};
  TIERS.slice(0, 3).forEach((tier, i) => {
    if (i < steps.length) out[tier] = bodyStyleLines(lines, steps[i]);
  });
  out.C = filterStyle.styleLines(filterStyle.DEFAULT_STYLES.C);
  for (const tier of TIERS) if (!(tier in out)) out[tier] = filterStyle.styleLines(filterStyle.DEFAULT_STYLES.Map);
  return out;
}

export const STACKABLE_CLASSES = ["Stackable Currency", "Map Fragments", "Divination Cards", "Misc Map Items", "Augment", "Omen"];
const STACK_GE = re(`^[${S}]*StackSize[${S}]*>=[${S}]*([0-9]+)[${S}]*$`);
const BASETYPE_SUBSTR = re(`^[${S}]*BaseType\\b(?![${S}]*==)`);

type StackBlock = [number, string, string[], string[], string[], number, string];

function stackBlocks(lines: string[], blocks: Block[]): StackBlock[] {
  const out: StackBlock[] = [];
  const special = SPECIAL_CONDITIONS.filter((c) => c !== "StackSize");
  blocks.forEach((b, i) => {
    if (intersects(conds(lines, b), special)) return;
    const body = lines.slice(b.start + 1, b.end);
    if (body.some((l) => pyStrip(l) === "Continue")) return;
    const classes = body.filter((l) => CLASS_LINE.test(l)).flatMap((l) => filterGen.findQuoted(l));
    const names = exactNames(lines, b);
    const subs = body.filter((l) => BASETYPE_SUBSTR.test(l)).flatMap((l) => filterGen.findQuoted(l)).map((x) => x.toLowerCase());
    if (!(classes.length || names.length || subs.length)) return;
    const ns = body.map((l) => STACK_GE.exec(l)).filter((m): m is RegExpExecArray => !!m).map((m) => parseInt(m[1], 10));
    const tag = filterGen.headerTags(lines, b)[1];
    out.push([i, b.blockType, classes, names, subs, ns.length ? ns[0] : 1, b.blockType === "Hide" ? HIDE_TIER : tierOfStep(tag) || "B"]);
  });
  return out;
}

/** (defaults, stackable): defaults = {name: [N, tier]} for the names NeverSink hides alone and shows from a stack of N. */
export function stackInfo(baseText: string): [Map<string, [number, string]>, Set<string>] {
  const [lines, blocks] = scan(baseText);
  const sb = stackBlocks(lines, blocks);
  const byName = new Map<string, number[]>();
  const byClass = new Map<string, number[]>();
  const subsBlocks: number[] = [];
  const nameClass = new Map<string, string>();
  sb.forEach(([, , classes, names, subs], k) => {
    for (const n of names) {
      if (!byName.has(n)) byName.set(n, []);
      byName.get(n)!.push(k);
      for (const c of classes) if (!nameClass.has(n)) nameClass.set(n, c);
    }
    if (!names.length && classes.length) {
      for (const c of classes) {
        if (!byClass.has(c)) byClass.set(c, []);
        byClass.get(c)!.push(k);
      }
    }
    if (subs.length && !names.length) subsBlocks.push(k);
  });
  const stackable = new Set<string>();
  for (const [n, c] of nameClass) if (STACKABLE_CLASSES.includes(c)) stackable.add(n);
  for (const [, , classes, names] of sb) if (classes.some((c) => STACKABLE_CLASSES.includes(c))) for (const n of names) stackable.add(n);
  const defaults = new Map<string, [number, string]>();
  for (const n of byName.keys()) {
    const cls = nameClass.get(n);
    const cand = new Set<number>(byName.get(n)!);
    for (const k of (cls !== undefined ? byClass.get(cls) : undefined) ?? []) cand.add(k);
    const low = n.toLowerCase();
    for (const k of subsBlocks) {
      if (sb[k][4].some((x) => low.includes(x)) && (!sb[k][2].length || (cls !== undefined && sb[k][2].includes(cls)))) cand.add(k);
    }
    const order = [...cand].sort((a, b) => a - b);
    if (!order.length) continue;
    const decide = (stack: number): [string, string] => {
      for (const k of order) {
        const [, kind, classes, names, subs, need, tier] = sb[k];
        if (stack < need || (classes.length && !(cls !== undefined && classes.includes(cls)))) continue;
        if (names.length && !names.includes(n)) continue;
        if (subs.length && !subs.some((x) => low.includes(x))) continue;
        return [kind, tier];
      }
      return ["Show", "B"];
    };
    if (decide(1)[0] === "Show") continue;
    const needs = [...new Set(order.map((k) => sb[k][5]).filter((x) => x > 1))].sort((a, b) => a - b);
    for (const need of needs) {
      const [kind, tier] = decide(need);
      if (kind === "Show") {
        defaults.set(n, [need, tier]);
        break;
      }
    }
  }
  for (const n of defaults.keys()) stackable.add(n);
  return [defaults, stackable];
}

/** (tiers, stackDefaults): NeverSink's starting tier of every name. */
export function startTiers(baseText: string): [Map<string, string>, Map<string, [number, string]>] {
  const tiers = defaultTiers(baseText);
  const [stackDefaults] = stackInfo(baseText);
  for (const [n, [, t]] of stackDefaults) {
    const cur = tiers.get(n);
    if (cur === undefined || cur === HIDE_TIER) tiers.set(n, t);
  }
  return [tiers, stackDefaults];
}

/** {name: N} (N > 1 only): the larger of the tier's minimum and the name's own. */
export function stackMinimums(cfg: Record<string, any>, game: string, tiers: Map<string, string>,
  defaults: Map<string, [number, string]>, stackable: Set<string>): Map<string, number> {
  const tierN = orEmpty(cfg.wl_tier_stack);
  const own = orEmpty(cfg[`wl_item_stack_${game}`]);
  const out = new Map<string, number>();
  for (const [n, t] of tiers) {
    if (!stackable.has(n) || !(TIERS as readonly string[]).includes(t)) continue;
    let item = dget(own, n);
    item = item === undefined || item === null ? (defaults.get(n) ?? [1])[0] : item;
    let eff: number;
    try {
      const a = dget(tierN, t);
      eff = Math.max(pyInt(truthy(a) ? a : 1), pyInt(truthy(item) ? item : 1));
    } catch (e) {
      if (!(e instanceof PyError)) throw e;
      eff = 1;
    }
    if (eff > 1) out.set(n, eff);
  }
  return out;
}

/** {unique BaseType: tier} - the highest tier among NeverSink's unique tier steps listing the base. */
export function uniqueBaseDefaults(baseText: string): Map<string, string> {
  const [lines, blocks] = scan(baseText);
  const out = new Map<string, string>();
  for (const b of blocks) {
    const [ty, tag] = filterGen.headerTags(lines, b);
    const names = exactNames(lines, b);
    if (!(ty || "").startsWith("uniques") || b.blockType !== "Show" || !names.length) continue;
    const tier = tierOfStep(tag);
    if (!tier || intersects(conds(lines, b), UNIQUE_BLOCKING)) continue;
    for (const n of names) if (!out.has(n) || RANK[tier] < RANK[out.get(n)!]) out.set(n, tier);
  }
  return out;
}

/** BaseTypes of the maps NeverSink treats outside the tier ladder - poe1 only. */
export function poe1SpecialMapBases(baseText: string): string[] {
  const [lines, blocks] = scan(baseText);
  let out: string[] = [];
  for (const b of blocks) {
    const ty = filterGen.headerTags(lines, b)[0] || "";
    if ((ty === "maps->nightmare" || ty === "maps->vaaltemple") && b.blockType === "Show") {
      const snapshot = out;
      out = [...out, ...exactNames(lines, b).filter((n) => !snapshot.includes(n))];
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// What exists (the item universe) and what tier it ends up in
// ---------------------------------------------------------------------------

const TYPE_CATEGORY: Record<string, [string, string | null][]> = {
  poe1: [["currency->trial->tattoo", null], ["currency->essence", "Essence"], ["currency->splinter", "Fragment"],
    ["currency->stackedsplinters", "Fragment"], ["fragments->scarabs", "Scarab"], ["fragments", "Fragment"],
    ["divination", "DivinationCard"], ["currency", "Currency"]],
  poe2: [["currency->omen", "Omen"], ["currency->splinter", "Fragment"], ["sockets->general", "Rune"], ["fragments", "Fragment"],
    ["currency", "Currency"]],
};

export function typeCategory(game: string, ty: string | null | undefined): string | null {
  for (const [prefix, cat] of TYPE_CATEGORY[game] ?? []) if ((ty || "").startsWith(prefix)) return cat;
  return null;
}

/** {name: `$type` of the first value-ladder block that lists it}. */
export function ladderNameTypes(baseText: string): Map<string, string> {
  const [lines, blocks] = scan(baseText);
  const out = new Map<string, string>();
  for (const b of blocks) {
    const ty = filterGen.headerTags(lines, b)[0] || "";
    if (sw(ty, VALUE_PREFIXES) && !ty.includes("leveling")) for (const n of exactNames(lines, b)) if (!out.has(n)) out.set(n, ty);
  }
  return out;
}

/** {name: category} of the lists in NAMED_CATEGORIES, first block wins. */
export function namedCategories(game: string, baseText: string): Map<string, string> {
  const rules = NAMED_CATEGORIES[game] ?? [];
  const out = new Map<string, string>();
  if (!rules.length || !baseText) return out;
  const [lines, blocks] = scan(baseText);
  for (const b of blocks) {
    const ty = filterGen.headerTags(lines, b)[0] || "";
    const hit = rules.find(([, prefixes]) => sw(ty, prefixes));
    if (hit) for (const n of exactNames(lines, b)) if (!out.has(n)) out.set(n, hit[0]);
  }
  return out;
}

/** {name: category}: hub names of the whitelist categories, plus the names only NeverSink tiers. */
export function universe(game: string, hubData: any, baseText: string): Map<string, string> {
  const wanted = new Set(filterGen.WHITELIST_CATEGORIES[game] ?? []);
  const out = new Map<string, string>();
  for (const it of filterGen.iterHubItems(hubData || {})) {
    const cat = truthy(it.category) ? String(it.category) : "";
    const name = pyStrip(truthy(it.name) ? it.name : "");
    if (name && wanted.has(cat) && !HUB_EXCLUDED.includes(cat) && !out.has(name)) out.set(name, cat);
  }
  for (const [n, ty] of [...ladderNameTypes(baseText)].sort((a, b) => cmpTuple(a, b))) {
    const cat = typeCategory(game, ty);
    if (!out.has(n)) out.set(n, cat !== null && wanted.has(cat) ? cat : OTHER_CATEGORY);
  }
  for (const [n, cat] of namedCategories(game, baseText)) if (!out.has(n)) out.set(n, cat);
  return out;
}

const NL_END = "(?=\\n?$)"; // Python's `$` also matches before a final newline
export const BAD_NAME_PATTERNS: RegExp[] = [
  /\[DNT\]/i,
  /\bINCOMPLETE\b/,
  /\(not visible to players\)/i,
  re(String.raw`^\p{Nd}+` + NL_END, "u"), // Python's \d is any Unicode decimal digit
  re(`^[${S}]|[${S}]${NL_END}`),
  re(`^(?:[A-Z][a-z]+){3,}${NL_END}`),
];

/** True for a name that cannot be an item's BaseType (see BAD_NAME_PATTERNS). */
export const badName = (name: string | null | undefined): boolean => BAD_NAME_PATTERNS.some((p) => p.test(name || ""));

export const TABLET_DEFAULT = "T";
export const TABLET_CATEGORY = "Tablet";

/** poe2 precursor tablets (Class "Tablet"): "Abyss Tablet", "Ritual Tablet" ... */
export const isTablet = (game: string, name: string): boolean => game === "poe2" && name.endsWith(" Tablet");

/** {name: tier}: the user's item tier > the user's category tier > NeverSink's default > B. */
export function resolveTiers(game: string, cfg: Record<string, any>, names: Map<string, string>, defaults: Map<string, string>): Map<string, string> {
  const items = orEmpty(cfg[`wl_item_tier_${game}`]);
  const cats = orEmpty(cfg[`wl_cat_tier_${game}`]);
  const out = new Map<string, string>();
  for (const [n, cat] of names) {
    if (isTablet(game, n)) out.set(n, valid(dget(items, n)) || valid(dget(cats, TABLET_CATEGORY)) || TABLET_DEFAULT);
    else out.set(n, valid(dget(items, n)) || valid(dget(cats, cat)) || defaults.get(n) || "B");
  }
  return out;
}

/** [(unique name, base)] from the hub's Unique* categories. */
export function uniqueEntries(hubData: any): [string, string][] {
  const out: [string, string][] = [];
  const seen = new Set<string>();
  for (const it of filterGen.iterHubItems(hubData || {})) {
    if ((truthy(it.category) ? String(it.category) : "").startsWith("Unique")) {
      const name = pyStrip(truthy(it.name) ? it.name : ""), base = pyStrip(truthy(it.base) ? it.base : "");
      const k = `${name}\u0000${base}`;
      if (name && base && !seen.has(k)) {
        seen.add(k);
        out.push([name, base]);
      }
    }
  }
  return out;
}

/** ({base: tier}, conflicts): the tier is per base: the HIGHEST tier of the uniques on the base wins. */
export function resolveUniqueTiers(game: string, cfg: Record<string, any>, entries: [string, string][],
  baseDefaults: Map<string, string>): [Map<string, string>, [string, Record<string, string>][]] {
  const user = orEmpty(cfg[`wl_unique_tier_${game}`]);
  const whole = valid(dget(orEmpty(cfg[`wl_cat_tier_${game}`]), UNIQUE_CATEGORY));
  const perBase = new Map<string, Map<string, string>>();
  for (const [name, base] of entries) {
    if (!perBase.has(base)) perBase.set(base, new Map());
    perBase.get(base)!.set(name, valid(dget(user, name)) || whole || baseDefaults.get(base) || "B");
  }
  const baseTier = new Map<string, string>();
  const conflicts: [string, Record<string, string>][] = [];
  for (const [base, tiers] of perBase) {
    let best: string | null = null;
    for (const t of tiers.values()) if (best === null || RANK[t] < RANK[best]) best = t;
    baseTier.set(base, best!);
    if (new Set(tiers.values()).size > 1) conflicts.push([base, Object.fromEntries(tiers)]);
  }
  return [baseTier, conflicts];
}

// ---------------------------------------------------------------------------
// The file
// ---------------------------------------------------------------------------

/** The user's style for a label (S / A / B / C / G / Tablet / Map / Gem), sound included. */
export const effectiveStyle = (cfg: Record<string, any>, key: string): any => dget(orEmpty(cfg.wl_tier_style), key);

/** {label: source file or null} for every tier style that plays a file. */
export function soundRequests(cfg: Record<string, any>, game?: string | null): Record<string, string | null> {
  const unused = new Set<string>();
  if (game) {
    if (game !== "poe2") unused.add("Tablet");
    if (!truthy(cfg.whitelist_gold)) unused.add("G");
    if (!truthy(cfg.wl_map_on)) unused.add("Map");
    if (cfg.whitelist_gem_tier === HIDE_TIER) unused.add("Gem");
  }
  const out: Record<string, string | null> = {};
  for (const k of ["S", "A", "B", "C", "G", "Tablet", "Map", "Gem"]) {
    const st = effectiveStyle(cfg, k);
    out[k] = truthy(st) && !unused.has(k) ? filterStyle.usesSoundFile(st) : null;
  }
  return out;
}

const quote = (names: Iterable<string>): string => [...names].map((n) => `"${n}"`).join(" ");

/** Test seam (the original's tests replace `_bt_groups`): when set, it writes the BaseType lines instead of btGroups. */
export const _testHooks: { btGroups: ((names: string[], exactOk: Set<string>) => string[]) | null } = { btGroups: null };

/** The `BaseType` condition lines for these names: `==` for names NeverSink itself writes with `==`, bare for the rest. */
function btGroups(names: Iterable<string>, exactOk: Set<string>): string[] {
  if (_testHooks.btGroups) return _testHooks.btGroups([...names], exactOk);
  const all = [...names];
  const exact = all.filter((n) => exactOk.has(n));
  const rest = all.filter((n) => !exactOk.has(n));
  return [...(exact.length ? [`BaseType == ${quote(exact)}`] : []), ...(rest.length ? [`BaseType ${quote(rest)}`] : [])];
}

const STYLE_ORDER = ["SetFontSize", "SetTextColor", "SetBorderColor", "SetBackgroundColor", "PlayAlertSound",
  "CustomAlertSoundOptional", "PlayEffect", "MinimapIcon"];

/** `over` replaces the lines of `base` with the same keyword; the rest of `base` stays. */
function mergeLines(base: string[], over: string[]): string[] {
  const byKey = new Map<string, string>();
  for (const l of [...base, ...over]) byKey.set(splitWs(l, 1)[0], l);
  return STYLE_ORDER.filter((k) => byKey.has(k)).map((k) => byKey.get(k)!);
}

function styleFor(key: string, cfg: Record<string, any>, defaultLines: Record<string, string[]>, soundNames: Record<string, string>): string[] {
  let dflt = dget(defaultLines, key);
  if (!truthy(dflt)) {
    const preset = get(filterStyle.DEFAULT_STYLES, key);
    if (preset === undefined) throw new PyError("ValueError", `KeyError: ${key}`);
    dflt = filterStyle.styleLines(preset);
  }
  const user = effectiveStyle(cfg, key);
  if (!truthy(user) || filterStyle.isEmpty(user)) return dflt;
  const lines = mergeLines(dflt, filterStyle.styleLines(user, dget(soundNames ?? {}, key)));
  const drop = new Set<string>();
  for (const part of filterStyle.normalizeStyle(user).off ?? []) for (const kw of filterStyle.PART_KEYWORDS[part]) drop.add(kw);
  return lines.filter((l) => !drop.has(splitWs(l, 1)[0]));
}

function mapBlocks(game: string, cfg: Record<string, any>, style: string[], baseText: string): string[] {
  const cls = game === "poe1" ? "Maps" : "Waystones";
  const tierKey = game === "poe1" ? "MapTier" : "WaystoneTier";
  if (!truthy(cfg.wl_map_on)) return [`# ${cls.toLowerCase()}: not filtered - the game's own look`, "Show", `    Class == "${cls}"`, ""];
  const n = Math.max(1, Math.min(16, intOr(truthy(cfg.wl_map_tier_min) ? cfg.wl_map_tier_min : 1, 1)));
  let rar = cfg.wl_map_rarity_min;
  rar = ["Normal", "Magic", "Rare", "Unique"].includes(rar) ? rar : "Normal";
  const out = [`# ${cls.toLowerCase()}: tier >= ${n} and rarity >= ${rar}`, "Show", `    Class == "${cls}"`, `    ${tierKey} >= ${n}`];
  if (rar !== "Normal") out.push(`    Rarity >= ${rar}`);
  out.push(...style, "");
  if (game === "poe1") { // special maps never go through the tier / rarity test
    const specials: string[][] = [["Rarity Unique"], ["BlightedMap True"], ["UberBlightedMap True"], ["ZanaMemory True"],
      ["HasInfluence Crusader Elder Hunter Redeemer Shaper Warlord"], ["AnyEnchantment True"]];
    const names = poe1SpecialMapBases(baseText);
    if (names.length) specials.push([`BaseType == ${quote(names)}`]);
    for (const cs of specials) out.push("Show", `    Class == "${cls}"`, ...cs.map((c) => `    ${c}`), ...style, "");
  }
  return out;
}

export interface WhitelistResult {
  text: string;
  count: number;
  tiers: Map<string, string>;
  categories: Map<string, string>;
  unique_conflicts: [string, Record<string, string>][];
  report: Record<string, number>;
  skipped: [string, string][];
  bad_names: [string, string][];
  gear_tiers: Record<string, string>;
  block_tiers: Record<string, string>;
  stack_min: Map<string, number>;
}

/**
 * The whole whitelist file. Order, specific before general (first match wins):
 * Q, S, uniques, tablet, maps, gold, A, gems, B, C, D (names hidden), typed names, rarity / equipment rows,
 * NeverSink's copied blocks, Hide.
 */
export function buildWhitelistFilter(game: string, cfgIn: Record<string, any> | null, baseText: string, hubData: any,
  questText = "", soundNamesIn: Record<string, string> | null = null, extraNames: Iterable<string> | null = null): WhitelistResult {
  const cfg = cfgIn || {};
  const soundNames = soundNamesIn || {};
  // a single unknown name in a `BaseType ==` line makes the game reject the whole filter, so only names the base filter
  // itself uses (or `extraNames`, e.g. GGG's item list) are ever written
  const real = new Set<string>([...knownNames(baseText), ...(extraNames ?? []), ...filterGen.GOLD_BASETYPES,
    ...(filterGen.WHITELIST_GEM_UNCUT[game] ?? [])]);
  const skipped = new Map<string, string>();
  const bad = new Map<string, string>();

  const usable = (n: string, where: string): boolean => {
    if (badName(n)) {
      if (!bad.has(n)) bad.set(n, where);
      return false;
    }
    if (real.has(n)) return true;
    if (!skipped.has(n)) skipped.set(n, where);
    return false;
  };
  const keep = (names: string[], where: string): string[] => names.filter((n) => usable(n, where));

  const exactOk = new Set<string>([...knownNames(baseText), ...filterGen.GOLD_BASETYPES]);
  const defaultLines = defaultTierLines(baseText);
  const names = universe(game, hubData, baseText);
  const [start, stackDefaults] = startTiers(baseText);
  const stackable = stackInfo(baseText)[1];
  const resolved = resolveTiers(game, cfg, names, start);
  let tiers = new Map<string, string>();
  for (const [n, t] of resolved) if (usable(n, "item")) tiers.set(n, t);
  const stackMin = stackMinimums(cfg, game, tiers, stackDefaults, stackable);
  // tablets the player gave a tier leave the Tablet block and follow that tier like any other item
  const tabletTier = new Map<string, string>();
  for (const [n, t] of tiers) if (isTablet(game, n) && t !== TABLET_DEFAULT) tabletTier.set(n, t);
  const allTiers = tiers;
  tiers = new Map([...tiers].filter(([n]) => !tabletTier.has(n)));
  const entries = uniqueEntries(hubData);
  const [baseTier, conflicts] = resolveUniqueTiers(game, cfg, entries, uniqueBaseDefaults(baseText));
  const style: Record<string, string[]> = {};
  for (const k of ["S", "A", "B", "C", "G", "Tablet", "Map"]) style[k] = styleFor(k, cfg, defaultLines, soundNames);
  const out: string[] = ["# === PoE Checker - Whitelist (own tiers, starting tiers from NeverSink strictness 2) ===", ""];
  let count = 0;
  if (truthy(questText)) out.push(rstripNl(questText), "");

  const namesBlock = (t: string): void => {
    const shown = sortedStr([...tiers].filter(([, nt]) => nt === t).map(([n]) => n));
    if (!shown.length) return;
    count += shown.length;
    const groups = new Map<number, string[]>();
    for (const n of shown) {
      const k = stackMin.get(n) ?? 1;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k)!.push(n);
    }
    for (const need of [...groups.keys()].sort((a, b) => a - b)) {
      for (const bt of btGroups(groups.get(need)!, exactOk)) {
        if (need === 1) {
          out.push(`# tier ${t}`, "Show", `    ${bt}`, ...style[t], "");
          continue;
        }
        // a stack under the minimum is hidden right here, so no later (broader) block can show it
        out.push(`# tier ${t} - stack >= ${need}`, "Show", `    ${bt}`, `    StackSize >= ${need}`, ...style[t], "");
        out.push(`# tier ${t} - smaller stacks hidden`, "Hide", `    ${bt}`, "");
      }
    }
  };

  namesBlock("S");

  for (const t of TIERS) { // uniques, by base
    const bases = keep(sortedStr([...baseTier].filter(([, bt]) => bt === t).map(([b]) => b)), "unique base");
    if (bases.length) {
      for (const bt of btGroups(bases, exactOk)) {
        out.push(`# uniques - tier ${t} (by base type)`, "Show", "    Rarity Unique", `    ${bt}`, ...style[t], "");
      }
      count += bases.length;
    }
  }

  if (game === "poe2") { // tablets
    for (const t of ALL_TIERS) { // the ones with their own tier come first, then the generic Tablet block
      const own = keep(sortedStr([...tabletTier].filter(([, nt]) => nt === t).map(([n]) => n)), "tablet");
      if (own.length && t === HIDE_TIER) {
        for (const bt of btGroups(own, exactOk)) out.push(`# tablets - tier ${t} (hidden by the player)`, "Hide", `    ${bt}`, "");
      } else if (own.length) {
        for (const bt of btGroups(own, exactOk)) out.push(`# tablets - tier ${t}`, "Show", `    ${bt}`, ...style[t], "");
        count += own.length;
      }
    }
    out.push("# tablets", "Show", '    Class "Tablet"', "    Rarity < Unique", ...style.Tablet, "");
  }
  out.push(...mapBlocks(game, cfg, style.Map, baseText));

  if (truthy(cfg.whitelist_gold)) { // gold
    const gmin = Math.max(0, intOr(truthy(cfg.whitelist_gold_min) ? cfg.whitelist_gold_min : 0, 0));
    out.push("# gold" + (gmin ? ` (stack >= ${gmin})` : ""), "Show", `    BaseType == "${filterGen.GOLD_BASETYPES[0]}"`);
    out.push(...(gmin ? [`    StackSize >= ${gmin}`] : []), ...style.G, "");
    count += 1;
  } else {
    out.push("# gold: the game's own look", "Show", `    BaseType == "${filterGen.GOLD_BASETYPES[0]}"`, "");
  }

  namesBlock("A");

  const gemTier = valid(cfg.whitelist_gem_tier) || "B";
  if (gemTier !== HIDE_TIER) {
    // the Gem sub tab's own look: the chosen tier's style, with what the player set for "Gem" on top
    const gemStyle = styleFor("Gem", cfg, { Gem: style[gemTier] }, soundNames);
    const uncut = Object.entries(orEmpty(cfg[`whitelist_gem_uncut_${game}`])).sort((a, b) => cmpStr(a[0], b[0]) || (a[1] as number) - (b[1] as number));
    for (const [base, lvlRaw] of uncut) {
      if (!keep([base], "uncut gem").length) continue;
      const lvl = Math.max(1, intOr(lvlRaw, 1));
      out.push(`# uncut gem: ${base} (GemLevel >= ${lvl})`, "Show", `    BaseType "${base}"`, // as NeverSink writes it (no ==)
        `    GemLevel >= ${lvl}`, ...gemStyle, "");
      count += 1;
    }
    const gemNames = keep((Array.isArray(cfg[`whitelist_gem_names_${game}`]) ? cfg[`whitelist_gem_names_${game}`] : []).filter((g: unknown) => truthy(g)), "gem");
    if (gemNames.length) {
      for (const bt of btGroups(sortedSet(gemNames), exactOk)) out.push("# gems", "Show", `    ${bt}`, ...gemStyle, "");
      count += new Set(gemNames).size;
    }
  }

  namesBlock("B");
  namesBlock("C");

  const hidden = keep(sortedStr([...tiers].filter(([, nt]) => nt === HIDE_TIER).map(([n]) => n)), "item");
  if (hidden.length) { // tier D names are hidden before a broader block (special classes) below can show it
    for (const bt of btGroups(hidden, exactOk)) out.push("# tier D (hidden before the class blocks below can show it)", "Hide", `    ${bt}`, "");
  }

  // typed names (contains)
  const byRar = new Map<string, { t: string; rar: string[]; nms: Set<string> }>();
  for (const entry of Array.isArray(cfg[`whitelist_custom_${game}`]) ? cfg[`whitelist_custom_${game}`] : []) {
    const norm = filterGen.normalizeCustom([entry]);
    const [nm, rar] = norm.length ? norm[0] : [null, null];
    const t = valid(isDict(entry) ? entry.tier : null) || "B";
    if (nm && t !== HIDE_TIER) {
      const k = `${t}|${rar!.join("|")}`;
      if (!byRar.has(k)) byRar.set(k, { t, rar: rar!, nms: new Set() });
      byRar.get(k)!.nms.add(nm);
    }
  }
  for (const { t, rar, nms } of sortedBy(byRar.values(), (v) => [RANK[v.t], ...v.rar])) {
    const tag = rar.length === 4 ? "any rarity" : rar.join("/");
    out.push(`# typed names (contains, ${tag}) - tier ${t}`, "Show", `    BaseType ${quote(sortedStr(nms))}`);
    if (rar.length !== 4) out.push(`    Rarity ${rar.join(" ")}`);
    out.push(...style[t], "");
    count += nms.size;
  }

  const gearT = gearTiers(game, cfg);
  const gearNames: Record<string, string> = {};
  for (const [gid, name] of GEAR_GROUPS[game] ?? []) gearNames[gid] = name;
  // NeverSink's blocks are copied as NeverSink wrote them (its own sounds: the NeverSink tab's numbered sounds are that tab's alone)
  const copyText = baseText;
  const rowsCfg = orEmpty(cfg[`wl_rarity_rows_${game}`]);
  for (const [rowId, rowLabel, classes] of rarityRows(game)) { // rarity first: it beats every block copied below
    const row = orEmpty(dget(rowsCfg, rowId));
    if (!truthy(row.custom)) continue;
    for (const rar of RARITY_CHOICES) {
      const t = valid(dget(orEmpty(row.tiers), rar)) || "B"; // a row set myself: every rarity has a tier
      const title = `# rarity: ${rowLabel} - ${rar} - tier ${t}`;
      if (t === HIDE_TIER) out.push(title, "Hide", `    Class == ${quote(classes)}`, `    Rarity ${rar}`, "");
      else {
        out.push(title, "Show", `    Class == ${quote(classes)}`, `    Rarity ${rar}`, ...style[t], "");
        count += 1;
      }
    }
  }
  const eqCfg = orEmpty(cfg[`wl_equip_rows_${game}`]);
  for (const [, , classes] of equipGroups(game)) { // equipment by class: ahead of NeverSink's gear blocks too
    for (const cls of classes) {
      const row = orEmpty(dget(eqCfg, cls));
      if (!truthy(row.custom)) continue;
      for (const rar of EQUIP_CHOICES) {
        const t = valid(dget(orEmpty(row.tiers), rar)) || "B"; // a row set myself: every rarity has a tier
        const title = `# equipment: ${cls} - ${rar} - tier ${t}`;
        if (t === HIDE_TIER) out.push(title, "Hide", `    Class == "${cls}"`, `    Rarity ${rar}`, "");
        else {
          out.push(title, "Show", `    Class == "${cls}"`, `    Rarity ${rar}`, ...style[t], "");
          count += 1;
        }
      }
    }
  }
  const seq = gearSequence(game, copyText);
  const gearItems = seq.filter((e): e is ["listed", GearListed] => e[0] === "listed").map((e) => e[1]);
  const blockT = gearBlockTiers(game, cfg, gearItems);
  for (const e of seq) {
    if (e[0] === "copy") { // NeverSink's block as it wrote it (Show / Hide)
      const [, reason, ty, tag, kind, body] = e;
      out.push(pyRstrip(`# neversink (${reason}): ${pyStr(ty)} ${tag || ""}`), kind, ...body, "");
      count += kind === "Show" ? 1 : 0;
      continue;
    }
    const [key, gid, ty, , cs] = e[1];
    const t = blockT[key];
    if (t === HIDE_TIER) { // a Hide copy keeps NeverSink's first-match order (the names above already matched)
      out.push(`# gear: ${gearNames[gid]} - tier D (${ty})`, "Hide", ...cs, "");
      continue;
    }
    out.push(`# gear: ${gearNames[gid]} - tier ${t} (${ty})`, "Show", ...cs, ...style[t], "");
    count += 1;
  }

  if (game === "poe1") { // NeverSink lists wombgifts by name only: a new one (Growing Wombgift) would reach the final Hide
    out.push("# wombgifts: the whole class (names above first), tier B", "Show", '    Class == "Wombgifts"', ...style.B, "");
    count += 1;
  }

  out.push("# hide everything else", "Hide", "");
  const skippedList = [...skipped].sort((a, b) => cmpTuple(a, b));
  const report: Record<string, number> = {};
  for (const t of ALL_TIERS) report[t] = [...allTiers.values()].filter((v) => v === t).length;
  report[TABLET_DEFAULT] = [...allTiers.values()].filter((v) => v === TABLET_DEFAULT).length;
  return {
    text: out.join("\n"), count, tiers: allTiers, categories: names, unique_conflicts: conflicts, report,
    skipped: skippedList, bad_names: [...bad].sort((a, b) => cmpTuple(a, b)), gear_tiers: gearT, block_tiers: blockT,
    stack_min: stackMin,
  };
}

/** `s.rstrip("\n")` */
function rstripNl(s: string): string {
  let end = s.length;
  while (end > 0 && s[end - 1] === "\n") end--;
  return s.slice(0, end);
}
