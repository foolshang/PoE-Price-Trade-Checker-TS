/** GameProfile: the per-game differences the trade code needs. Port of poe_price_trade/profiles.py (the unused price-API urls are not converted). */

export interface GameProfile {
  game_version: string;
  /** GGG trade stats endpoint (mod_db: stat ids) */
  trade_stats_url: string;
  /** last-resort league names before the hub can be reached */
  default_leagues: string[];
  /** web trade page the browser opens (F5) */
  trade_web_url: string;
  /** GGG trade items endpoint (base_db: canonical names) */
  trade_items_url: string;
  display_name: string;
  /** {normalized item class: trade category id} */
  item_class_category: Record<string, string>;
}

export const POE1_PROFILE: GameProfile = {
  game_version: "poe1",
  display_name: "Path of Exile 1",
  trade_stats_url: "https://www.pathofexile.com/api/trade/data/stats",
  default_leagues: ["Mirage", "Hardcore Mirage"],
  trade_web_url: "https://www.pathofexile.com/trade/search/{league}",
  trade_items_url: "https://www.pathofexile.com/api/trade/data/items",
  item_class_category: {
    "wands": "weapon.wand", "sceptres": "weapon.sceptre",
    "staves": "weapon.staff", "bows": "weapon.bow",
    "daggers": "weapon.dagger", "claws": "weapon.claw",
    "one hand swords": "weapon.onesword", "two hand swords": "weapon.twosword",
    "one hand axes": "weapon.oneaxe", "two hand axes": "weapon.twoaxe",
    "one hand maces": "weapon.onemace", "two hand maces": "weapon.twomace",
    "body armours": "armour.chest", "gloves": "armour.gloves",
    "boots": "armour.boots", "helmets": "armour.helmet",
    "shields": "armour.shield", "quivers": "armour.quiver",
    "rings": "accessory.ring", "amulets": "accessory.amulet",
    "belts": "accessory.belt", "jewels": "jewel",
  },
};

export const POE2_PROFILE: GameProfile = {
  game_version: "poe2",
  display_name: "Path of Exile 2",
  trade_stats_url: "https://www.pathofexile.com/api/trade2/data/stats",
  default_leagues: ["Runes of Aldur", "HC Runes of Aldur"],
  trade_web_url: "https://www.pathofexile.com/trade2/search/{league}",
  trade_items_url: "https://www.pathofexile.com/api/trade2/data/items",
  item_class_category: {
    "wands": "weapon.wand", "sceptres": "weapon.sceptre",
    "staves": "weapon.staff", "quarterstaves": "weapon.warstaff",
    "crossbows": "weapon.crossbow", "bows": "weapon.bow",
    "spears": "weapon.spear", "flails": "weapon.flail",
    "daggers": "weapon.dagger", "claws": "weapon.claw",
    "one hand swords": "weapon.onesword", "two hand swords": "weapon.twosword",
    "one hand axes": "weapon.oneaxe", "two hand axes": "weapon.twoaxe",
    "one hand maces": "weapon.onemace", "two hand maces": "weapon.twomace",
    "body armours": "armour.chest", "gloves": "armour.gloves",
    "boots": "armour.boots", "helmets": "armour.helmet",
    "shields": "armour.shield", "bucklers": "armour.buckler",
    "foci": "armour.focus", "quivers": "armour.quiver",
    "rings": "accessory.ring", "amulets": "accessory.amulet",
    "belts": "accessory.belt", "jewels": "jewel",
    "charms": "flask.charm", "waystones": "map.waystone",
  },
};

export const PROFILES: Record<string, GameProfile> = { poe1: POE1_PROFILE, poe2: POE2_PROFILE };

/** `PROFILES.get(gv, PROFILES["poe2"])` */
export const profileFor = (gv: string): GameProfile => (Object.prototype.hasOwnProperty.call(PROFILES, gv) ? PROFILES[gv] : POE2_PROFILE);
