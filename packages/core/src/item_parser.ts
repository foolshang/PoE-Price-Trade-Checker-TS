/**
 * Parse PoE item text (from Ctrl+C in game) into a ParsedItem. Port of poe_price_trade/item_parser.py - PoE1 and PoE2
 * clipboard formats. Regexes follow Python's Unicode `str` semantics: `\d` = any decimal digit, `\s` = str.isspace(),
 * `\b` = Unicode word edge, IGNORECASE = case folding.
 */
import { GameVersion, ModValue, ParsedItem, Rarity, newModValue } from "./models.ts";
import { PY_S, pyRstrip, pyStrip, splitLines } from "./py.ts";
import { D, asciiDigits } from "./pyextra.ts";
import { influenceOfLabel, isItemLabel } from "./item_labels.ts";

const S = `[${PY_S}]`;
const W = "[\\p{L}\\p{N}_]"; // \w
const re = (src: string, flags = "iu"): RegExp => new RegExp(src, flags);

const SEPARATOR = /^-{3,}$/;
const ITEM_CLASS = re(`^Item Class:${S}*(.+)$`);
const RARITY = re(`^Rarity:${S}*(.+)$`);
const ITEM_LEVEL = re(`^Item Level:${S}*(${D}+)$`);
const QUALITY = re(`^Quality:${S}*\\+?(${D}+)%`);
const CORRUPTED = re("^Corrupted$");
const UNIDENTIFIED = re("^Unidentified$");
const NOTE = /^Note:/u;
const STACK_SIZE = re(`^Stack Size:${S}*(?:${D}|,)+/(?:${D}|,)+$`);

const VALUE_SRC = `[-+]?${D}+(?:\\.${D}+)?`;
const MOD_HEADER = re(`^\\{.*(?<!${W})Modifier(?!${W}).*\\}$`);
const HEADER_TIER = re(`\\(Tier:${S}*(${D}+)\\)`);
const ROLL_RANGE = re(`\\(${D}+(?:\\.${D}+)?-${D}+(?:\\.${D}+)?\\)`, "giu");
const RUNE_LINE = re(`^(.*)${S}\\(rune\\)$`);
const IMPLICIT_LINE = re(`^(.*)${S}\\(implicit\\)$`);

/**
 * A reminder text: the explanation the game prints (Ctrl+Alt+C) under a mod - "(Onslaught grants 20% increased Attack, Cast, and
 * Movement Speed)". The whole line is one pair of parentheses. A real mod can START with "(" ("(5-10)% increased ... (crafted)" - a roll
 * range) but then the first ")" is not the last character, so it is told apart by where the first "(" closes.
 */
export function isReminderLine(line: string): boolean {
  const t = line.trim();
  if (!t.startsWith("(") || !t.endsWith(")")) return false;
  let depth = 0;
  for (let i = 0; i < t.length; i++) {
    if (t[i] === "(") depth += 1;
    else if (t[i] === ")" && --depth === 0) return i === t.length - 1;
  }
  return false;
}

/**
 * How deep inside parentheses a line ends, when it STARTS a reminder that goes on in the next line(s): the line begins with "(" and that
 * "(" is not closed on the line. 0 = not such a line (a mod that begins with a roll range closes its "(" at once).
 */
export function reminderOpening(line: string): number {
  const t = line.trim();
  if (!t.startsWith("(")) return 0;
  let depth = 0, firstClosed = false;
  for (const ch of t) {
    if (ch === "(") depth += 1;
    else if (ch === ")" && depth > 0 && --depth === 0) firstClosed = true;
  }
  return !firstClosed && depth > 0 ? depth : 0;
}

/** the change in parenthesis depth over a line (a "(" counts +1, a ")" -1) */
const parenDelta = (line: string): number => [...line].reduce((d, ch) => d + (ch === "(" ? 1 : ch === ")" ? -1 : 0), 0);

/** `float(m.group())` of a matched number (Unicode digits allowed) */
const toFloat = (s: string): number => Number(asciiDigits(s));

export function extractModValue(text: string): number | null {
  const m = new RegExp(VALUE_SRC, "u").exec(text.replace(ROLL_RANGE, ""));
  return m ? toFloat(m[0]) : null;
}

export function extractModValues(text: string): number[] {
  return (text.replace(ROLL_RANGE, "").match(new RegExp(VALUE_SRC, "gu")) ?? []).map(toFloat);
}

const FALLBACK_SKIP_PREFIX = ["Requirements:", "Requires:", "Sockets:", "Level:", "Str:", "Dex:", "Int:"];
const STAT_LINE = /^(Armour|Evasion|Energy Shield|Ward|Block):/u;
const DAMAGE_LINE = re("^(Damage|APS|Critical|Attacks|Casts|DPS):");
const ELE_DAMAGE_LINE = re("^(Physical|Elemental|Chaos|Cold|Fire|Lightning) Damage:");
/**
 * "Name: value" lines of an item that are properties, not mods - read from real item texts of both games (PoE2 samples of the Exiled-Exchange-2
 * test items, tests/parity/fixtures/ee2_items; PoE1 items of the parity fixtures). Used by the no-header fallback only: a text with
 * `{ ... Modifier }` headers takes just the lines under a header, so none of these can become a mod there.
 */
const PROPERTY_NAMES = [
  "Requires", "Requirements", "Quality", "Sockets", "Level", "Armour", "Evasion Rating", "Energy Shield", "Block chance", "Spirit", "Charm Slots",
  "Physical Damage", "Elemental Damage", "Fire Damage", "Cold Damage", "Lightning Damage", "Chaos Damage", "Attacks per Second", "Critical Hit Chance",
  "Reload Time", "Note", "Grants Skill", "Stack Size", "Waystone Drop Chance", "Waystone Tier", "Map Tier", "Revives Available", "Rare Monsters",
  "Magic Monsters", "Pack Size", "Item Rarity", "Item Quantity", "Monster Rarity", "Monster Level", "Monster Effectiveness", "Reservation",
  "Mana Multiplier", "Cost", "Cooldown Time",
];
export const PROPERTY_LINE = new RegExp(`^(?:${PROPERTY_NAMES.join("|")}):`, "u");
/** a gem or a currency item has no mods (an uncut gem's description, a meta gem's properties are not mods) */
export const NO_MODS_RARITIES = new Set(["Gem", "Currency"]);
const QUALITY_PREFIXES = ["Superior ", "Anomalous ", "Divergent ", "Phantasmal "];

/** Parse clipboard item text. Returns null if the text does not look like a PoE item. */
export function parseItem(text: string, gameVersion: string = GameVersion.POE2): ParsedItem | null {
  if (!text || !text.includes("Rarity:")) return null;

  const lines = splitLines(text).map(pyRstrip);
  const sections: string[][] = [[]];
  for (const line of lines) {
    if (SEPARATOR.test(line)) sections.push([]);
    else sections[sections.length - 1].push(line);
  }

  // Section 0: Item Class + Rarity + Name
  const header = sections[0] ?? [];
  let item_class = "";
  let rarity = "";
  const name_lines: string[] = [];
  for (const line of header) {
    const cm = ITEM_CLASS.exec(line);
    if (cm) {
      item_class = pyStrip(cm[1]);
      continue;
    }
    const rm = RARITY.exec(line);
    if (rm) {
      rarity = pyStrip(rm[1]);
      continue;
    }
    if (line && !line.startsWith("Note:")) name_lines.push(line);
  }
  if (!rarity) return null;

  // 1- or 2-line names: rare / unique = name + base type; currency / gem = the name only
  const item_name = name_lines.length ? pyStrip(name_lines[0]) : "";
  let base_type = name_lines.length > 1 ? pyStrip(name_lines[1]) : item_name;

  let item_level = 0;
  let quality = 0;
  let corrupted = false;
  let identified = true;
  const mods: ModValue[] = [];
  const influences: string[] = [];
  const flags: string[] = [];

  // mods come from the { ... Modifier } headers (what the game's own search does): only the lines under a header; weapon stats are not mods.
  // No header anywhere -> the old heuristic below.
  const has_mod_headers = sections.slice(1).some((s) => s.some((ln) => MOD_HEADER.test(ln)));
  let pending: string | null = null;
  let pending_tier = 0;
  let pending_affix = "";
  let group_no = -1;
  let prefix_count = 0;
  let suffix_count = 0;

  const noteLabel = (line: string): void => {
    const inf = influenceOfLabel(line);
    if (inf) { if (!influences.includes(inf)) influences.push(inf); } else if (!flags.includes(line.trim())) flags.push(line.trim());
  };
  for (const section of sections.slice(1)) {
    pending = null; // a header block does not cross a separator
    pending_affix = "";
    const filled = section.filter((ln) => ln.trim());
    // a section of labels only ("Fractured Item", "Mirrored"): classified as a whole, never read as mods
    if (filled.length && filled.every(isItemLabel)) {
      for (const ln of filled) {
        if (CORRUPTED.test(ln)) corrupted = true;
        if (UNIDENTIFIED.test(ln)) identified = false;
        noteLabel(ln);
      }
      continue;
    }
    let reminderDepth = 0; // inside a reminder that runs over several lines
    for (const line of section) {
      if (!line) continue;
      if (reminderDepth > 0) { reminderDepth = Math.max(0, reminderDepth + parenDelta(line)); continue; }
      if (isReminderLine(line)) continue; // an explanation under a mod, not a mod
      if ((reminderDepth = reminderOpening(line)) > 0) continue; // ... that goes on in the next line(s)
      // rune mod: its own section before the header block, ends with (rune)
      const rn = RUNE_LINE.exec(line);
      if (rn) {
        group_no += 1;
        mods.push(newModValue({
          text: pyStrip(rn[1]), value: extractModValue(line), values: extractModValues(line), mod_type: "rune", group: group_no,
        }));
        pending = null;
        continue;
      }
      // metadata
      if (CORRUPTED.test(line)) { corrupted = true; pending = null; continue; }
      if (UNIDENTIFIED.test(line)) { identified = false; pending = null; continue; }
      let m: RegExpExecArray | null;
      if ((m = ITEM_LEVEL.exec(line))) { item_level = parseInt(asciiDigits(m[1]), 10); pending = null; continue; }
      if ((m = QUALITY.exec(line))) { quality = parseInt(asciiDigits(m[1]), 10); pending = null; continue; }
      if (isItemLabel(line)) { noteLabel(line); continue; } // a label glued to the mods (no separator): not a mod, nor a line of the block before it

      // header { ... Modifier ... } -> the type of the mod on the next lines
      if (MOD_HEADER.test(line)) {
        const low = line.toLowerCase();
        if (low.includes("implicit")) pending = "implicit";
        else if (low.includes("desecrated")) pending = "desecrated";
        else if (low.includes("enchant")) pending = "enchant";
        else if (low.includes("fractured")) pending = "fractured";
        else if (low.includes("rune")) pending = "rune";
        else pending = "explicit"; // prefix / suffix
        if (low.includes("prefix")) {
          prefix_count += 1;
          pending_affix = "prefix";
        } else if (low.includes("suffix")) {
          suffix_count += 1;
          pending_affix = "suffix";
        } else pending_affix = "";
        const tm = HEADER_TIER.exec(line);
        pending_tier = tm ? parseInt(asciiDigits(tm[1]), 10) : 0;
        group_no += 1;
        continue;
      }

      // a mod line under a header -> kept with its type (desecrated too)
      if (pending !== null) {
        mods.push(newModValue({
          text: pyStrip(line), value: extractModValue(line), values: extractModValues(line), mod_type: pending, tier: pending_tier,
          group: group_no, affix: pending_affix,
        }));
        // pending is not reset: a hybrid mod has several lines under one header; the block ends at a new header / separator / end of section
        continue;
      }

      // fallback: no { } headers in the clipboard (plain copy) -> the old heuristic
      if (has_mod_headers) continue; // this item is header-driven: no fallback
      if (NO_MODS_RARITIES.has(rarity) || PROPERTY_LINE.test(line)) continue; // a description of a gem / currency, or a property line
      if (NOTE.test(line) || STACK_SIZE.test(line)) continue;
      // an implicit still ends with "(implicit)" without a header - split it off first, else it counts as explicit
      const im = IMPLICIT_LINE.exec(line);
      if (im) {
        group_no += 1;
        mods.push(newModValue({
          text: pyStrip(im[1]), value: extractModValue(line), values: extractModValues(line), mod_type: "implicit", group: group_no,
        }));
        continue;
      }
      if (!FALLBACK_SKIP_PREFIX.some((p) => line.startsWith(p)) && !STAT_LINE.test(line) && !DAMAGE_LINE.test(line) &&
          !ELE_DAMAGE_LINE.test(line) && new RegExp(VALUE_SRC, "u").test(line)) {
        // no header says which lines belong together: one line = one mod (right mostly; a genuine 2-line hybrid cannot be told without a header)
        group_no += 1;
        mods.push(newModValue({ text: pyStrip(line), value: extractModValue(line), values: extractModValues(line), group: group_no }));
      }
    }
  }

  // A rare / unique with a 1-line name (no special name) and no mods is unidentified; with mods it is identified
  const real_mods = mods.filter((x) => x.mod_type !== "rune");
  if ((rarity === Rarity.RARE || rarity === Rarity.UNIQUE) && name_lines.length <= 1 && !real_mods.length) identified = false;

  // strip a quality prefix only when it really starts with one (a rare with quality has none: "Knightly Mitts" + Quality 20%)
  for (const qp of QUALITY_PREFIXES) {
    if (base_type.startsWith(qp)) {
      base_type = pyStrip(base_type.slice(qp.length));
      break;
    }
  }

  if (!item_name) return null;

  return {
    item_name, base_type, rarity, item_level, quality, mods, game_version: gameVersion, raw_text: text, item_class, corrupted, identified,
    prefix_count, suffix_count, mods_have_headers: has_mod_headers, influences, flags,
  };
}
