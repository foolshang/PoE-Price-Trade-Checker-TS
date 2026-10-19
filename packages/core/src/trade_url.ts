/**
 * The URL of PoE's trade page for an item (the app opens it in the browser; no API call, no POESESSID).
 * Port of poe_price_trade/trade_url.py (build_trade_url; open_trade is the app's shell.openExternal).
 */
import { BaseDB } from "./base_db.ts";
import { ModDatabase } from "./mod_db.ts";
import { resolveRows } from "./mod_rows.ts";
import { ParsedItem, Rarity } from "./models.ts";
import { GameProfile } from "./profiles.ts";
import { PyFloat, dumps, pyStrip, truthy } from "./py.ts";
import { pyQuote, pyRound } from "./pyextra.ts";

/** the third dropdown of the trade page. "available" = Instant Buyout and In Person, "online" = In Person only (from a real payload) */
export const STATUS_OPTION = "available";

const RARITY_OPTION: Record<string, string> = {
  [Rarity.NORMAL]: "normal",
  [Rarity.MAGIC]: "magic",
  [Rarity.RARE]: "rare",
  [Rarity.UNIQUE]: "unique",
};

/** One stat filter of the search; `value` numbers are Python floats in the URL (40.0) */
export interface StatFilter {
  id?: string;
  disabled?: boolean;
  value?: { min?: number | PyFloat; max?: number | PyFloat };
}

const asFloat = (v: number | PyFloat): PyFloat => (v instanceof PyFloat ? v : new PyFloat(v));

export function buildTradeUrl(item: ParsedItem, modDb: Pick<ModDatabase, "findStatId" | "probeStatId">, league: string, profile: GameProfile, minPct = 0.8,
  customStats: StatFilter[] | null = null, baseDb: Pick<BaseDB, "resolveType" | "resolveName"> | null = null): string {
  const query: Record<string, any> = { status: { option: STATUS_OPTION } };
  const filters: Record<string, any> = {};

  // base / div / gem / currency -> canonical (a quality prefix or an odd name does not make the search find nothing)
  const base = (): string => (baseDb ? baseDb.resolveType(item.base_type) : item.base_type);
  // unique name -> canonical
  const name = (): string => (baseDb ? baseDb.resolveName(item.item_name) : item.item_name);

  if (!item.identified) {
    // anything unidentified: base + rarity + identified=no (there is no mod / unique name to search before it is identified)
    if (item.base_type) query.type = base();
    const rarityOpt = Object.prototype.hasOwnProperty.call(RARITY_OPTION, item.rarity) ? RARITY_OPTION[item.rarity] : undefined;
    if (rarityOpt) filters.type_filters = { filters: { rarity: { option: rarityOpt } } };
    filters.misc_filters = { filters: { identified: { option: false } } };
  } else if (item.rarity === Rarity.UNIQUE) {
    // an identified unique: name + base
    query.name = name();
    if (item.base_type && item.base_type !== item.item_name) query.type = base();
  } else {
    // identified rare / magic -> by mods
    let statFilters: StatFilter[];
    if (customStats !== null) {
      // the popup sends the filters the player ticked: used exactly as they are
      statFilters = customStats.filter((f) => truthy(f.id)).map((f) => {
        if (!f.value) return f;
        const v: { min?: PyFloat; max?: PyFloat } = {};
        if (f.value.min !== undefined) v.min = asFloat(f.value.min);
        if (f.value.max !== undefined) v.max = asFloat(f.value.max);
        return { ...f, value: v };
      });
    } else {
      statFilters = [];
      for (const { mod, statId: sid } of resolveRows(item.mods, modDb)) {
        if (!sid) continue;
        const f: StatFilter = { id: sid, disabled: false };
        if (mod.value !== null) f.value = { min: new PyFloat(pyRound(mod.value * minPct, 2)) };
        statFilters.push(f);
      }
    }

    // with stats and a category for the class: a wide category search (EE2 "relaxed"), not tied to the base
    const catMap = profile.item_class_category ?? {};
    const key = pyStrip(item.item_class).toLowerCase();
    const catId = Object.prototype.hasOwnProperty.call(catMap, key) ? catMap[key] : undefined;
    if (statFilters.length && catId) {
      filters.type_filters = { filters: { category: { option: catId }, rarity: { option: "nonunique" } } };
      query.stats = [{ type: "and", filters: statFilters }];
    } else {
      // fallback: base + nonunique (+ stats when there are some)
      if (item.base_type) query.type = base();
      filters.type_filters = { filters: { rarity: { option: "nonunique" } } };
      if (statFilters.length) query.stats = [{ type: "and", filters: statFilters }];
    }
  }

  if (Object.keys(filters).length) query.filters = filters; // only when there are some (no empty {})

  const payload = { query, sort: { price: "asc" } };
  const prefix = profile.trade_web_url.replace("{league}", pyQuote(league, ""));
  return `${prefix}?q=` + pyQuote(dumps(payload, { separators: [",", ":"] }));
}
