/**
 * What F5 does with the text the game put on the clipboard, up to the point where the app has to show a window or open the
 * browser. Port of the logic of App._on_f5_trade / _compute_mod_extras in poe_price_trade/app.py (the clipboard, the key press
 * and the windows belong to the app).
 */
import { BaseDB } from "./base_db.ts";
import { parseItem } from "./item_parser.ts";
import { MetaDB } from "./meta_db.ts";
import { ModBadgeDB, affixCap, slotForItem, tierRollArrow } from "./mod_badge.ts";
import { ModDatabase } from "./mod_db.ts";
import { ModValue, ParsedItem, Rarity } from "./models.ts";
import { GameProfile } from "./profiles.ts";
import { Log, noopLog, truthy } from "./py.ts";
import { buildTradeUrl } from "./trade_url.ts";

export interface F5Env {
  game: string;
  league: string;
  profile: GameProfile;
  modDb: ModDatabase;
  baseDb: BaseDB;
  modBadge: ModBadgeDB;
  metaDb: MetaDB;
  /** f5_mod_picker (default true), mod_badge_archetype (default "all") */
  cfg: Record<string, any>;
  /** developer events (debug.event in Python) */
  debug?: (msg: string) => void;
  log?: Log;
}

export interface PickerRow {
  mod: ModValue;
  /** null = the line has no stat id (not searchable) */
  statId: string | null;
}

export type F5Result =
  | { kind: "unparsed" }
  | { kind: "url"; item: ParsedItem; url: string }
  | {
    kind: "picker"; item: ParsedItem; rows: PickerRow[]; annos: ReturnType<MetaDB["annotate"]>; summary: string;
    badge_colors: (string | null)[]; roll_arrows: (string | null)[]; affixes: string[];
  };

/**
 * (badge_colors, roll_arrows), index-aligned with `rows`, all null out of scope (only rares). badge: red > gold > green > null.
 * roll arrow: "▲" / "▼" / null - T1 (maxed) never gets one; below T1 the roll is compared with the RePoE tier range when the tier is
 * known, or with the hub meta's observed value_min / value_max when it is not. Never touches the trade-query stat ids.
 */
export function computeModExtras(item: ParsedItem, rows: PickerRow[], annos: ReturnType<MetaDB["annotate"]>, env: F5Env): [(string | null)[], (string | null)[]] {
  const n = rows.length;
  const badgeColors: (string | null)[] = new Array(n).fill(null);
  const rollArrows: (string | null)[] = new Array(n).fill(null);
  if (item.rarity !== Rarity.RARE) return [badgeColors, rollArrows];

  const slot = slotForItem(item.item_class, item.base_type);
  const archetype = truthy(env.cfg.mod_badge_archetype) ? env.cfg.mod_badge_archetype : "all";
  const badgeReady = !!slot && env.modBadge.available();

  rows.forEach(({ mod: m }, i) => {
    const values = m.values.length ? m.values : m.value !== null ? [m.value] : [];
    const bsid = badgeReady ? env.modBadge.resolveStatId(m.text, m.mod_type, env.modDb) : null;
    if (bsid) badgeColors[i] = env.modBadge.tagColor(bsid, slot!, archetype, env.metaDb);

    const anno = annos[m.group];
    const tier = anno ? anno.tier : 0;
    if (tier === 1 || !values.length) return; // maxed already, or no roll number to compare
    if (tier) {
      const rng = env.metaDb.tierRange(item.base_type, m.text, tier);
      rollArrows[i] = tierRollArrow(values, rng, env.modBadge.rule("roll_pct", 0.25));
    } else if (bsid) {
      rollArrows[i] = env.modBadge.rollIndicatorFallback(bsid, slot!, archetype, values);
    }
  });
  return [badgeColors, rollArrows];
}

/** The clipboard text -> what the app shows next. Throws when the stats database cannot be loaded (the app logs "✗ F5: ..."). */
export async function prepareF5(text: string, env: F5Env): Promise<F5Result> {
  const debug = env.debug ?? (() => {});
  const warn = env.log ?? noopLog;
  const item = parseItem(text, env.game);
  if (!item) return { kind: "unparsed" };
  await env.metaDb.load();

  // an identified magic item: one line with the affix names in it ("Legend's ... of Grounding") -> the real base from the meta, else no type (it would make "search invalid")
  if (item.rarity === Rarity.MAGIC && item.identified) {
    const fixed = env.metaDb.resolveBase(item.base_type);
    if (fixed) {
      if (fixed !== item.base_type) debug(`F5 magic base: '${item.base_type}' → '${fixed}'`);
      item.base_type = fixed;
    } else {
      debug(`F5 magic base unresolved: '${item.base_type}' → ไม่ใส่ type`);
      item.base_type = "";
    }
  }
  if (!item.mods_have_headers) {
    // no { ... Modifier } header at all (some PoE1 clients): prefix / suffix come from the RePoE family data
    env.metaDb.inferAffixes(item);
    debug(`F5 no mod headers — inferred P=${item.prefix_count} S=${item.suffix_count}`);
  }
  await env.modDb.load();
  await env.baseDb.load();
  await env.modBadge.load(env.profile.game_version);

  const usePicker = (env.cfg.f5_mod_picker === undefined ? true : truthy(env.cfg.f5_mod_picker)) && item.identified &&
    (item.rarity === Rarity.RARE || item.rarity === Rarity.MAGIC) && item.mods.length > 0;
  if (usePicker) {
    const rows: PickerRow[] = item.mods.map((m) => ({ mod: m, statId: env.modDb.findStatId(m.text, m.mod_type) }));
    let annos: ReturnType<MetaDB["annotate"]> = {};
    let summary = "";
    try {
      annos = env.metaDb.annotate(item);
      const cap = affixCap(item.item_class, env.profile.game_version);
      summary = MetaDB.summary(item, annos, cap, cap);
    } catch (e) {
      warn(`meta annotate error: ${(e as Error).message}`, "warn");
    }
    const [badgeColors, rollArrows] = computeModExtras(item, rows, annos, env);
    return { kind: "picker", item, rows, annos, summary, badge_colors: badgeColors, roll_arrows: rollArrows, affixes: rows.map((r) => r.mod.affix) };
  }
  const url = buildTradeUrl(item, env.modDb, env.league, env.profile, 0.8, null, env.baseDb);
  return { kind: "url", item, url };
}
