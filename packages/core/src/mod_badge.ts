/**
 * Mod Badge: colour-code the rows of the F5 popup by how many real builds use the mod. Port of poe_price_trade/mod_badge.py.
 *
 * Source: the hub's {game}/meta/latest.json (SPEC 8.2). If it is missing for a game there are simply no badges this session.
 * Stat ids are resolved with the mod database (GGG's trade stats, the same id space as the hub); the hub's stat_dictionary is only
 * a fallback, and only when it gives exactly one candidate.
 */
import { getCloseMatches } from "./difflib.ts";
import { HubClient } from "./hub_client.ts";
import { MetaDB, WEAPON_CLASSES } from "./meta_db.ts";
import { ModDatabase, normalizeMod } from "./mod_db.ts";
import { FsPort } from "./ports.ts";
import { Log, noopLog, truthy } from "./py.ts";
import { pySum } from "./pyextra.ts";

const CACHE_TTL_MS = 8 * 3600 * 1000; // the hub publishes meta about once a day

/**
 * item_class (the clipboard "Item Class:" text) -> hub slot key. Singular and plural forms are both listed; a class that exists in one
 * game only (Focus / Charm = PoE2) simply never matches in the other.
 */
const SLOT_MAP: Record<string, string> = {
  "Helmet": "helmet", "Helmets": "helmet",
  "Body Armour": "body", "Body Armours": "body",
  "Glove": "gloves", "Gloves": "gloves",
  "Boot": "boots", "Boots": "boots",
  "Belt": "belt", "Belts": "belt",
  "Ring": "ring", "Rings": "ring",
  "Amulet": "amulet", "Amulets": "amulet",
  "Quiver": "quiver", "Quivers": "quiver",
  "Focus": "focus", "Foci": "focus",
  "Shield": "offhand", "Shields": "offhand",
  "Buckler": "offhand", "Bucklers": "offhand",
  "Charm": "charm", "Charms": "charm",
  "Life Flask": "flask", "Life Flasks": "flask",
  "Mana Flask": "flask", "Mana Flasks": "flask",
};
const JEWEL_CLASSES = new Set(["Jewel", "Jewels"]);
// the hub's own _slugify_jewel_base: a leading cluster size and the word "Jewel" go, the rest keeps a-z0-9 only
const CLUSTER_SIZE_PREFIX = /^(?:Small|Medium|Large)\s+/iu;
const TRAILING_JEWEL_WORD = /(?<![\p{L}\p{N}_])Jewel(?![\p{L}\p{N}_])/giu;
// _normalize_mod leaves a "+" before a number alone, build_mod_meta's norm_text does not: only the tag lookup strips it
const PLUS_BEFORE_HASH = /\+(?=#)/g;

interface Rules {
  red?: { max_rank?: number; min_usage_pct?: number };
  gold?: { max_rank?: number; min_usage_pct?: number };
  colors?: { red?: string; gold?: string; green?: string };
  roll_pct?: number;
  [k: string]: unknown;
}

export const DEFAULT_RULES: Rules = {
  red: { max_rank: 5, min_usage_pct: 50.0 },
  gold: { max_rank: 15, min_usage_pct: 15.0 },
  colors: { red: "#FF4444", gold: "#FFB800", green: "#4CAF50" },
  roll_pct: 0.25, // top / bottom X% of a mod roll range -> ▲ / ▼
};

/** (item_class, base_type) of a parsed clipboard item -> hub slot key, or null for classes the hub has no popularity meta for. */
export function slotForItem(itemClass: string, baseType: string): string | null {
  if (JEWEL_CLASSES.has(itemClass)) {
    let name = baseType.trim().replace(CLUSTER_SIZE_PREFIX, "");
    name = name.replace(TRAILING_JEWEL_WORD, "").trim();
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "");
    return slug ? `jewel:${slug}` : null;
  }
  if (WEAPON_CLASSES.has(itemClass)) return "weapon";
  return Object.prototype.hasOwnProperty.call(SLOT_MAP, itemClass) ? SLOT_MAP[itemClass] : null;
}

/** Max prefix (== max suffix) slots of the item class: 3/3 for gear in both games; jewels 1/1 in PoE2, 2/2 in PoE1. */
export function affixCap(itemClass: string, gameVersion = "poe2"): number {
  if (!JEWEL_CLASSES.has(itemClass)) return 3;
  return gameVersion === "poe2" ? 1 : 2;
}

function pctPosition(value: number, lo: number, hi: number): number | null {
  if (hi <= lo) return null;
  return (value - lo) / (hi - lo);
}

function arrow(pct: number, topBottomPct: number): string | null {
  if (pct >= 1 - topBottomPct) return "▲";
  if (pct <= topBottomPct) return "▼";
  return null;
}

/** RePoE-tier roll indicator: values / rng are paired index by index (a hybrid has several); the percentile positions are averaged. */
export function tierRollArrow(values: number[], rng: number[][] | null, topBottomPct = 0.25): string | null {
  if (!values.length || !rng || !rng.length) return null;
  const pcts: number[] = [];
  const n = Math.min(values.length, rng.length);
  for (let i = 0; i < n; i++) {
    const p = pctPosition(values[i], rng[i][0], rng[i][1]);
    if (p !== null) pcts.push(p);
  }
  if (!pcts.length) return null;
  return arrow(pySum(pcts) / pcts.length, topBottomPct);
}

/** normalized template -> [stat_id, ...] (list-valued both ways on purpose) */
export function buildTemplateIndex(statDictionary: any[]): Map<string, string[]> {
  const index = new Map<string, string[]>();
  for (const entry of statDictionary) {
    const tmpl = entry.template ?? "";
    const sid = entry.stat_id ?? "";
    if (!tmpl || !sid) continue;
    const key = normalizeMod(tmpl);
    let ids = index.get(key);
    if (!ids) index.set(key, (ids = []));
    if (!ids.includes(sid)) ids.push(sid);
  }
  return index;
}

interface Row { slot: string; archetype: string; stat_id: string; rank_in_slot?: number | null; usage_pct?: number | null; value_min?: number | null; value_max?: number | null }
const rowKey = (slot: string, archetype: string, sid: string): string => `${slot}\u0001${archetype}\u0001${sid}`;

export interface BadgePlaces {
  fs: FsPort;
  hub: HubClient;
  cacheDir: string | null;
  /** where mod_badge_rules.json (an override of the rules) may lie */
  configDir: string | null;
  nowMs: () => number;
  warn?: Log;
}

export class ModBadgeDB {
  private byKey = new Map<string, Row>();
  private templateIndex = new Map<string, string[]>();
  private statToTemplates = new Map<string, string[]>();
  private hotTagsCache = new Map<string, Set<string>>();
  private rules: Rules = DEFAULT_RULES;
  private rulesLoaded = false;

  constructor(private places: BadgePlaces) {}

  private async loadRules(): Promise<void> {
    if (this.rulesLoaded) return;
    this.rulesLoaded = true;
    const { fs, configDir } = this.places;
    if (configDir === null) return;
    const path = fs.join(configDir, "mod_badge_rules.json");
    if (!(await fs.exists(path))) return;
    try {
      this.rules = JSON.parse(await fs.readText(path));
    } catch (e) {
      (this.places.warn ?? noopLog)(`mod_badge_rules load fail: ${(e as Error).message}`, "warn");
    }
  }

  available(): boolean {
    return this.byKey.size > 0;
  }

  rule<T>(key: string, dflt: T): T {
    return Object.prototype.hasOwnProperty.call(this.rules, key) ? (this.rules[key] as T) : dflt;
  }

  /**
   * Fetch {game}/meta/latest.json (disk-cached per game; stale by the payload's own generated_at, ~8 h). Any failure degrades to
   * "no badges" and never throws: the F5 flow has to work either way. Re-indexing on each call makes switching game safe.
   */
  async load(game = "poe2", force = false): Promise<void> {
    await this.loadRules();
    if (!force) {
      const cached = await this.loadDiskCache(game);
      if (cached && truthy(cached) && !this.isStale(cached)) {
        this.index(cached);
        return;
      }
    }
    const data = await this.places.hub.getMeta(game);
    if (data === null) {
      const cached = await this.loadDiskCache(game); // the network failed: the disk even if stale
      if (cached && truthy(cached)) this.index(cached);
      return;
    }
    this.index(data);
    await this.saveDiskCache(game, data);
  }

  private isStale(data: any): boolean {
    const genRaw = data.generated_at;
    if (!genRaw) return true;
    const gen = Date.parse(String(genRaw).replace(/(\.\d{3})\d+/, "$1"));
    if (Number.isNaN(gen)) return true;
    return this.places.nowMs() - gen > CACHE_TTL_MS;
  }

  index(data: any): void {
    const byKey = new Map<string, Row>();
    for (const m of truthy(data.mods) ? data.mods : []) byKey.set(rowKey(m.slot ?? "", m.archetype ?? "", m.stat_id ?? ""), m);
    const templateIndex = buildTemplateIndex(truthy(data.stat_dictionary) ? data.stat_dictionary : []);
    const statToTemplates = new Map<string, string[]>();
    for (const [tmpl, ids] of templateIndex) {
      const tagTmpl = tmpl.replace(PLUS_BEFORE_HASH, "");
      for (const sid of ids) {
        const list = statToTemplates.get(sid);
        if (list) list.push(tagTmpl);
        else statToTemplates.set(sid, [tagTmpl]);
      }
    }
    this.byKey = byKey;
    this.templateIndex = templateIndex;
    this.statToTemplates = statToTemplates;
    this.hotTagsCache = new Map(); // stale after any re-index
  }

  // ------------------------------------------------------------------ public API

  /** The mod database first (GGG trade stats: the hub's id space); the hub's stat_dictionary only as a fallback and only when it gives exactly one candidate. */
  resolveStatId(modText: string, modType: string | null | undefined, modDb: ModDatabase): string | null {
    const sid = modDb.findStatId(modText, modType);
    if (sid) return sid;
    const norm = normalizeMod(modText);
    let candidates = this.templateIndex.get(norm) ?? [];
    if (!candidates.length) {
      const close = getCloseMatches(norm, this.templateIndex.keys(), 1, 0.85);
      if (close.length) candidates = this.templateIndex.get(close[0])!;
    }
    return candidates.length === 1 ? candidates[0] : null;
  }

  /** null = white / no badge */
  badgeColor(statId: string, slot: string, archetype: string): string | null {
    if (!statId || !slot) return null;
    const row = this.row(statId, slot, archetype);
    if (row === null) return null;
    const rank = row.rank_in_slot;
    const usage = row.usage_pct || 0.0;
    const colors = this.rules.colors ?? {};

    const red = this.rules.red ?? {};
    if ((rank !== null && rank !== undefined && rank <= (red.max_rank ?? 5)) || usage >= (red.min_usage_pct ?? 50.0)) return colors.red ?? "#FF4444";

    const gold = this.rules.gold ?? {};
    if ((rank !== null && rank !== undefined && rank <= (gold.max_rank ?? 15)) || usage >= (gold.min_usage_pct ?? 15.0)) return colors.gold ?? "#FFB800";

    return null;
  }

  private row(statId: string, slot: string, archetype: string): Row | null {
    let row = this.byKey.get(rowKey(slot, archetype, statId));
    if (row === undefined && archetype !== "all") row = this.byKey.get(rowKey(slot, "all", statId));
    return row === undefined ? null : row;
  }

  /** Roll arrow when the RePoE tier is unknown: the hub row's own value_min / value_max stand in for the range, `values` is averaged. */
  rollIndicatorFallback(statId: string, slot: string, archetype: string, values: number[], topBottomPct: number | null = null): string | null {
    if (!values.length) return null;
    const row = this.row(statId, slot, archetype);
    if (row === null) return null;
    const lo = row.value_min, hi = row.value_max;
    if (lo === null || lo === undefined || hi === null || hi === undefined) return null;
    const pct = pctPosition(pySum(values) / values.length, lo, hi);
    if (pct === null) return null;
    return arrow(pct, topBottomPct !== null ? topBottomPct : this.rule("roll_pct", 0.25));
  }

  /** red > gold > green > null. green = not popular itself, but it shares a RePoE implicit_tag with a mod that is red / gold for the slot. */
  tagColor(statId: string, slot: string, archetype: string, metaDb: MetaDB): string | null {
    const base = this.badgeColor(statId, slot, archetype);
    if (base) return base;
    const myTags = this.tagsForStat(statId, metaDb);
    if (!myTags.size) return null;
    const hot = this.hotTags(slot, archetype, metaDb);
    for (const t of myTags) if (hot.has(t)) return this.rules.colors?.green ?? "#4CAF50";
    return null;
  }

  private tagsForStat(statId: string, metaDb: MetaDB): Set<string> {
    const tags = new Set<string>();
    for (const tmpl of this.statToTemplates.get(statId) ?? []) for (const t of metaDb.tagsForTemplate(tmpl)) tags.add(t);
    return tags;
  }

  private hotTags(slot: string, archetype: string, metaDb: MetaDB): Set<string> {
    const key = `${slot}\u0001${archetype}`;
    const cached = this.hotTagsCache.get(key);
    if (cached !== undefined) return cached;
    const statIds = new Set<string>();
    for (const r of this.byKey.values()) {
      if ((r.slot ?? "") === slot && ((r.archetype ?? "") === archetype || (r.archetype ?? "") === "all")) statIds.add(r.stat_id ?? "");
    }
    const tags = new Set<string>();
    for (const sid of statIds) {
      if (this.badgeColor(sid, slot, archetype)) for (const t of this.tagsForStat(sid, metaDb)) tags.add(t); // red or gold only
    }
    this.hotTagsCache.set(key, tags);
    return tags;
  }

  // ------------------------------------------------------------------ disk cache (the raw hub payload)

  private cachePath(game: string): string | null {
    return this.places.cacheDir === null ? null : this.places.fs.join(this.places.cacheDir, `mod_badge_meta_${game}.json`);
  }

  private async saveDiskCache(game: string, data: unknown): Promise<void> {
    const path = this.cachePath(game);
    if (path === null) return;
    try {
      await this.places.fs.mkdirp(this.places.cacheDir!);
      await this.places.fs.writeText(path, JSON.stringify(data));
    } catch (e) {
      (this.places.warn ?? noopLog)(`mod badge cache write failed: ${(e as Error).message}`, "warn");
    }
  }

  private async loadDiskCache(game: string): Promise<any | null> {
    const path = this.cachePath(game);
    if (path === null || !(await this.places.fs.exists(path))) return null;
    try {
      return JSON.parse(await this.places.fs.readText(path));
    } catch (e) {
      (this.places.warn ?? noopLog)(`mod badge cache read failed: ${(e as Error).message}`, "warn");
      return null;
    }
  }
}
