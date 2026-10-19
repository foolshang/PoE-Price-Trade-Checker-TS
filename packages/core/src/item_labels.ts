/**
 * Lines the game prints on an item that are a LABEL, not a mod: "Searing Exarch Item", "Shaper Item", "Fractured Item", "Mirrored" ...
 * A label section ("--------" on both sides) is not handed to the mod reader at all; and on a real item they also come glued to the mods
 * with no separator ("+25 to Strength and Dexterity" / "Searing Exarch Item" / "Eater of Worlds Item" - Eagle Touch, a PoE1 rare), so a
 * line is checked as well.
 * Where the names come from (not guessed):
 *  - the item-state filters of GGG's own trade site (api/trade/data/filters and api/trade2/data/filters, misc_filters): "Fractured Item",
 *    "Synthesised Item", "Searing Exarch Item", "Eater of Worlds Item", "Crucible Item", and the plain states "Corrupted", "Mirrored", "Split",
 *    "Sanctified", "Twice Corrupted" (tests/parity/fixtures/stat_items/trade_misc_filters.json is the copy the test checks this list against);
 *  - the six influences GGG's stats table names ("Has Shaper Influence" ... pseudo stats): "<Name> Item" - the form seen on real items
 *    (Shaper Item in the parity fixtures, Searing Exarch / Eater of Worlds / Fractured on the tester's items).
 */
const INFLUENCE_NAMES = ["Shaper", "Elder", "Crusader", "Redeemer", "Hunter", "Warlord", "Searing Exarch", "Eater of Worlds"];

const INFLUENCE_OF = new Map<string, string>(INFLUENCE_NAMES.map((n) => [`${n} Item`, n]));

/** the other labels: item states */
const STATE_LABELS = ["Synthesised Item", "Fractured Item", "Crucible Item", "Corrupted", "Twice Corrupted", "Mirrored", "Split", "Sanctified", "Unidentified"];

export const ITEM_LABELS: ReadonlySet<string> = new Set([...INFLUENCE_OF.keys(), ...STATE_LABELS]);

export const isItemLabel = (line: string): boolean => ITEM_LABELS.has(line.trim());

/** "Searing Exarch Item" -> "Searing Exarch"; null for every other line (also for a state label) */
export const influenceOfLabel = (line: string): string | null => INFLUENCE_OF.get(line.trim()) ?? null;
