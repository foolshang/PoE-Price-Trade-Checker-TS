/** Data models of the item pipeline (F5). Port of poe_price_trade/models.py - only what F5 / F4 use (the price-mode models are not converted). */

export const GameVersion = { POE1: "poe1", POE2: "poe2" } as const;

export const Rarity = {
  NORMAL: "Normal",
  MAGIC: "Magic",
  RARE: "Rare",
  UNIQUE: "Unique",
  CURRENCY: "Currency",
  GEM: "Gem",
  DIVINATION: "Divination Card",
} as const;

export interface ModValue {
  stat_id: string;
  text: string;
  value: number | null;
  value_min: number | null;
  value_max: number | null;
  /** explicit / implicit / desecrated / enchant / rune / fractured */
  mod_type: string;
  /** every number of the line (the roll range (a-b) left out) */
  values: number[];
  /** Tier from the header { ... (Tier: N) } - 0 = unknown */
  tier: number;
  /** mods under one header block share a group (hybrid, several lines) */
  group: number;
  /** "prefix" / "suffix" / "" (implicit etc. have none) */
  affix: string;
}

export const newModValue = (o: Partial<ModValue> & { text: string }): ModValue => ({
  stat_id: "", value: null, value_min: null, value_max: null, mod_type: "explicit", values: [], tier: 0, group: -1, affix: "", ...o,
});

export interface ParsedItem {
  item_name: string;
  base_type: string;
  rarity: string;
  item_level: number;
  quality: number;
  mods: ModValue[];
  game_version: string;
  raw_text: string;
  item_class: string;
  corrupted: boolean;
  identified: boolean;
  /** number of prefix headers found (to count empty affix slots) */
  prefix_count: number;
  suffix_count: number;
  /** false = the clipboard has no { ... Modifier } header at all (some clients): prefix_count / suffix_count / affix / tier are unknown and MetaDB.inferAffixes fills them */
  mods_have_headers: boolean;
}
