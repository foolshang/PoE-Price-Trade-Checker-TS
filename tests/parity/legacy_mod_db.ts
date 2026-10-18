/* eslint-disable */
// @ts-nocheck
/** The ORIGINAL program's find_stat_id (exact, then difflib at 0.75), kept only to explain which parity cases changed on purpose. */
/**
 * Mod text -> trade stat id. Port of poe_price_trade/mod_db.py: fetches GGG's official stats endpoint, caches it 7 days, and
 * matches a mod line (numbers -> "#") exactly or fuzzily (difflib, cutoff 0.75), preferring the same mod type.
 */
import { getCloseMatches } from "../../packages/core/src/difflib.ts";
import { HEADERS, DbEnv } from "../../packages/core/src/base_db.ts";
import { GameProfile } from "../../packages/core/src/profiles.ts";
import { noopLog, pyStrip, truthy } from "../../packages/core/src/py.ts";
import { D, isoLocal, parseIso } from "../../packages/core/src/pyextra.ts";

const CACHE_TTL_MS = 7 * 86400 * 1000;
const VALUE_PLACEHOLDER = new RegExp(`#|${D}+(?:\\.${D}+)?(?:%)?`, "gu");

/** Replace numeric values with '#' for comparison. */
export function legacyNormalizeMod(text: string): string {
  return pyStrip(text.replace(VALUE_PLACEHOLDER, "#").toLowerCase());
}

interface Stat { id: string; text: string; type: string }

/** order of preference when the mod type is unknown (flat index) */
const TYPE_PRIORITY: Record<string, number> = {
  explicit: 0, implicit: 1, fractured: 2, rune: 3, enchant: 4, scourge: 5, crafted: 6, veiled: 7, pseudo: 8,
};
const typedKey = (norm: string, typ: string): string => `${norm}\u0001${typ}`;

export class LegacyModDatabase {
  private index = new Map<string, string>(); // flat (prioritized): used when the type is unknown
  private typed = new Map<string, string>(); // (normalized, type) -> id
  private typedKeysByType = new Map<string, string[]>(); // type -> normalized texts, in insertion order

  constructor(private profile: GameProfile, private env: DbEnv) {}

  /** Load stats from GGG's trade API; the disk cache first. Throws when it cannot fetch (like the original). */
  async load(force = false): Promise<void> {
    if (!force) {
      const cached = await this.loadCache();
      if (cached && cached.length) {
        this.buildIndex(cached);
        return;
      }
    }
    const data = JSON.parse(await this.env.http.getText(this.profile.trade_stats_url, HEADERS));
    const stats = flattenStats(data);
    await this.saveCache(stats);
    this.buildIndex(stats);
  }

  buildIndex(stats: Stat[]): void {
    this.index = new Map();
    this.typed = new Map();
    this.typedKeysByType = new Map();
    const chosen = new Map<string, number>();
    for (const stat of stats) {
      const { id: sid, text, type: typ } = stat;
      if (!(truthy(sid) && truthy(text))) continue;
      const normalized = legacyNormalizeMod(text);
      const key = typedKey(normalized, typ);
      if (!this.typed.has(key)) {
        const list = this.typedKeysByType.get(typ);
        if (list) list.push(normalized);
        else this.typedKeysByType.set(typ, [normalized]);
      }
      this.typed.set(key, sid);
      const pri = Object.prototype.hasOwnProperty.call(TYPE_PRIORITY, typ) ? TYPE_PRIORITY[typ] : 99;
      if (!this.index.has(normalized) || pri < chosen.get(normalized)!) {
        this.index.set(normalized, sid);
        chosen.set(normalized, pri);
      }
    }
  }

  /** steps 1 and 2 only: the lenient exact lookup (lowercase, numbers collapsed), no fuzzy */
  findExact(modText, modType = null) {
    const norm = legacyNormalizeMod(modText);
    if (truthy(modType) && this.typed.has(typedKey(norm, modType))) return this.typed.get(typedKey(norm, modType));
    return this.index.has(norm) ? this.index.get(norm) : null;
  }

  /** the stat id for a mod line - the same type first, with fallbacks */
  findStatId(modText: string, modType: string | null | undefined = null, threshold = 0.75): string | null {
    const norm = legacyNormalizeMod(modText);
    // 1 exact within the same type
    if (truthy(modType) && this.typed.has(typedKey(norm, modType!))) return this.typed.get(typedKey(norm, modType!))!;
    // 2 exact, prioritized (type unknown or no such type)
    if (this.index.has(norm)) return this.index.get(norm)!;
    // 3 fuzzy within the same type
    if (truthy(modType)) {
      const m = getCloseMatches(norm, this.typedKeysByType.get(modType!) ?? [], 1, threshold);
      if (m.length) return this.typed.get(typedKey(m[0], modType!))!;
    }
    // 4 fuzzy, prioritized
    const m = getCloseMatches(norm, this.index.keys(), 1, threshold);
    return m.length ? this.index.get(m[0])! : null;
  }

  private cachePath(): string | null {
    return this.env.cacheDir === null ? null : this.env.fs.join(this.env.cacheDir, `stats_${this.profile.game_version}.json`);
  }

  private async saveCache(stats: Stat[]): Promise<void> {
    const path = this.cachePath();
    if (path === null) return;
    try {
      await this.env.fs.mkdirp(this.env.cacheDir!);
      await this.env.fs.writeText(path, JSON.stringify({ fetched_at: isoLocal(this.env.nowMs()), stats }));
    } catch (e) {
      (this.env.warn ?? noopLog)(`Mod DB cache write failed: ${(e as Error).message}`, "warn");
    }
  }

  private async loadCache(): Promise<Stat[] | null> {
    const path = this.cachePath();
    if (path === null || !(await this.env.fs.exists(path))) return null;
    try {
      const data = JSON.parse(await this.env.fs.readText(path));
      const at = parseIso(data.fetched_at);
      if (Number.isNaN(at)) throw new Error("bad fetched_at");
      if (this.env.nowMs() - at > CACHE_TTL_MS) return null;
      return data.stats;
    } catch (e) {
      (this.env.warn ?? noopLog)(`Mod DB cache read failed: ${(e as Error).message}`, "warn");
      return null;
    }
  }
}

/** GGG: {"result":[{"id":"explicit","entries":[{"id","text"}]}]} -> a flat list */
export function flattenStats(data: any): Stat[] {
  const flat: Stat[] = [];
  for (const group of truthy(data.result) ? data.result : []) {
    for (const entry of truthy(group.entries) ? group.entries : []) {
      flat.push({ id: entry.id ?? "", text: entry.text ?? "", type: group.id ?? "" });
    }
  }
  return flat;
}
