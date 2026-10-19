/**
 * Mod text -> trade stat id. GGG's official stats endpoint (cached 7 days) is the table; a mod line is matched against it by the rules
 * of stat_match.ts - the hub's rules, no fuzzy matching: a line either follows a rule or has NO stat id (null), never a guess.
 * The original program (poe_price_trade/mod_db.py) guessed with difflib at 0.75 and was wrong for 92% of the lines it guessed
 * (measured against RePoE by the hub, 2026-10-19), so that part is gone on purpose.
 */
import { HEADERS, DbEnv } from "./base_db.ts";
import { HUB_BASE_URL, renderingAliasesPath } from "./hub_client.ts";
import { GameProfile } from "./profiles.ts";
import { Log, noopLog, pyStrip, truthy } from "./py.ts";
import { D, isoLocal, parseIso } from "./pyextra.ts";
import { ALIAS_SCHEMA_VERSION, AliasIndex } from "./rendering_aliases.ts";
import { StatMatch, StatMatcher } from "./stat_match.ts";

const CACHE_TTL_MS = 7 * 86400 * 1000;
const ALIAS_TTL_MS = 24 * 3600 * 1000; // the hub refreshes the aliases weekly; a day is plenty and a failed fetch keeps the file whatever its age
const MAX_LOGGED_UNMAPPED = 2000;
const VALUE_PLACEHOLDER = new RegExp(`#|${D}+(?:\\.${D}+)?(?:%)?`, "gu");

/**
 * Replace numeric values with '#' for a loose comparison. NOT used to find stat ids any more (stat_match.ts does that); only the
 * badge's tag lookup compares the hub's templates this way (mod_badge.ts).
 */
export function normalizeMod(text: string): string {
  return pyStrip(text.replace(VALUE_PLACEHOLDER, "#").toLowerCase());
}

interface Stat { id: string; text: string; type: string }

const NUM = "[+-]?\\d+(?:\\.\\d+)?";
/** "30(25-35)%" -> "30%": the roll range the game prints after each value of an item copied with Ctrl+Alt+C */
const RANGE_AFTER_VALUE = new RegExp(`(\\d)\\(${NUM}-${NUM}\\)`, "g");
/** the tag the game appends to a line: "(crafted)", "(implicit)", "(enchant)", "(augmented)" ... (the mod type is known from it already) */
const TRAILING_TAG = /\s*\((?:implicit|crafted|enchant|fractured|augmented|rune|desecrated|scourge|veiled|corrupted)\)\s*$/i;

/** the note the game adds to a value that nothing scales: "Minions are Aggressive — Unscalable Value" (PoE1 3.2x) */
const UNSCALABLE = /\s*[—–-]\s*Unscalable Value\s*$/i;

/**
 * A mod as the game writes it on the clipboard -> the wording GGG's table (and the hub's data) uses: no roll ranges, no trailing
 * tag, no " — Unscalable Value". Only these are removed; every other difference from the table is the matcher's business
 * (stat_match.ts). Several lines (one mod block) are cleaned line by line.
 */
export function cleanModText(text: string): string {
  return text.split("\n").map((line) => line.replace(RANGE_AFTER_VALUE, "$1").replace(UNSCALABLE, "").replace(TRAILING_TAG, "").replace(UNSCALABLE, "")).join("\n");
}

/** order of the groups tried when the mod type of the line is unknown */
const TYPE_PRIORITY: Record<string, number> = {
  explicit: 0, implicit: 1, fractured: 2, rune: 3, enchant: 4, scourge: 5, crafted: 6, veiled: 7, pseudo: 8,
};

export interface StatLookup extends StatMatch { kind: string }

export class ModDatabase {
  private matcher = new StatMatcher();
  private unmappedSeen = new Set<string>();
  /** where the rendering aliases came from: "hub" | "cache" | "bundled" | "none" (for the log and the tests) */
  aliasSource = "none";
  private aliasCheckedAt = -Infinity;
  /** the cache stamp the index was built from (load() runs on every F5: an unchanged table is not indexed again) */
  private builtFrom = "";

  constructor(private profile: GameProfile, private env: DbEnv) {}

  /** Load stats from GGG's trade API; the disk cache first. Throws when it cannot fetch (like the original). Then the hub's aliases (never throws). */
  async load(force = false): Promise<void> {
    if (!force) {
      const cached = await this.loadCache();
      if (cached && cached.stats.length) {
        if (this.builtFrom !== cached.stamp) {
          this.buildIndex(cached.stats);
          this.builtFrom = cached.stamp;
        }
        await this.loadAliases(force);
        return;
      }
    }
    const data = JSON.parse(await this.env.http.getText(this.profile.trade_stats_url, HEADERS));
    const stats = flattenStats(data);
    await this.saveCache(stats);
    this.buildIndex(stats);
    this.builtFrom = "";
    await this.loadAliases(force);
  }

  buildIndex(stats: Stat[]): void {
    this.matcher.build(stats);
    this.unmappedSeen = new Set();
    if (this.matcher.shared.length) {
      this.warn(`stat table: ${this.matcher.shared.length} texts are shared by several stat ids (the last one is used, like the hub)`, "info");
    }
  }

  /** the hub's rendering aliases (RePoE wordings), or none. Failure of any kind leaves the matching working without them. */
  async loadAliases(force = false): Promise<void> {
    // (checked at most once an hour: load() runs on every F5, and a hub without the file must not be asked every time)
    if (!force && this.env.nowMs() - this.aliasCheckedAt < 3600 * 1000) return;
    this.aliasCheckedAt = this.env.nowMs();
    const game = this.profile.game_version;
    const cache = this.aliasCachePath();
    let payload: unknown = null;
    let source = "none";
    let cached: { fetched_at?: string; payload?: unknown } | null = null;
    if (cache !== null) {
      try {
        if (await this.env.fs.exists(cache)) cached = JSON.parse(await this.env.fs.readText(cache));
      } catch {
        cached = null;
      }
    }
    const fresh = !force && cached !== null && AliasIndex.valid(cached.payload) && this.env.nowMs() - parseIso(String(cached.fetched_at)) < ALIAS_TTL_MS;
    if (fresh) {
      payload = cached!.payload;
      source = "cache";
    } else {
      try {
        const data = JSON.parse(await this.env.http.getText(`${HUB_BASE_URL}/${renderingAliasesPath(game)}`, HEADERS));
        if (AliasIndex.valid(data)) {
          payload = data;
          source = "hub";
          if (cache !== null) {
            try {
              await this.env.fs.mkdirp(this.env.cacheDir!);
              await this.env.fs.writeText(cache, JSON.stringify({ fetched_at: isoLocal(this.env.nowMs()), payload: data }));
            } catch (e) {
              this.warn(`alias cache write failed: ${(e as Error).message}`, "warn");
            }
          }
        } else {
          this.warn(`rendering aliases: schema_version ${JSON.stringify((data as any)?.schema_version)} (expected ${ALIAS_SCHEMA_VERSION}) - not used`, "warn");
        }
      } catch (e) {
        this.warn(`rendering aliases not fetched (${(e as Error).message}) - the last copy is used`, "info");
      }
      if (payload === null && cached !== null && AliasIndex.valid(cached.payload)) {
        payload = cached.payload;
        source = "cache";
      }
    }
    if (payload === null && this.env.bundledAliases) {
      try {
        const snap = await this.env.bundledAliases(game);
        if (AliasIndex.valid(snap)) {
          payload = snap;
          source = "bundled";
        }
      } catch {
        /* none */
      }
    }
    this.setAliases(payload, source);
  }

  /** use a payload (tests; the loader above) - null = no aliases */
  setAliases(payload: unknown, source = "given"): void {
    this.matcher.setAliases(AliasIndex.valid(payload) ? new AliasIndex(payload) : AliasIndex.empty());
    this.aliasSource = AliasIndex.valid(payload) ? source : "none";
  }

  aliasCount(): number {
    return this.matcher.aliasCount();
  }

  /**
   * The stat of a mod line: same group as the line's mod type; a line of unknown type is tried in every group in turn. null = the line has
   * no stat id (and nothing was guessed). The first time a line has none it is written to the log (once per text).
   */
  lookup(modText: string, modType: string | null | undefined = null, report = true): StatLookup | null {
    const text = cleanModText(modText.replace(/^\n+|\n+$/g, ""));
    let found: StatLookup | null = null;
    if (truthy(modType) && this.matcher.kinds.includes(modType!)) {
      const m = this.matcher.match(text, modType!);
      if (m) found = { ...m, kind: modType! };
    } else {
      const order = [...this.matcher.kinds].sort((a, b) => (TYPE_PRIORITY[a] ?? 99) - (TYPE_PRIORITY[b] ?? 99));
      for (const kind of order) {
        const m = this.matcher.match(text, kind);
        if (m) {
          found = { ...m, kind };
          break;
        }
      }
    }
    if (found === null && report) this.noteUnmapped(text, modType ?? "");
    return found;
  }

  /** the stat id for a mod line, or null when it has none */
  findStatId(modText: string, modType: string | null | undefined = null): string | null {
    return this.lookup(modText, modType)?.statId ?? null;
  }

  /** the same, but a miss is NOT logged: for a try that has another way after it (a block of lines is tried whole, then line by line) */
  probeStatId(modText: string, modType: string | null | undefined = null): string | null {
    return this.lookup(modText, modType, false)?.statId ?? null;
  }

  /** every stat id GGG lists with this exact template text in a group (the stat ids behind one text) */
  idsOfTemplate(kind: string, text: string): string[] {
    return this.matcher.idsOfTemplate(kind, text);
  }

  private noteUnmapped(text: string, type: string): void {
    if (!text.trim() || this.unmappedSeen.size >= MAX_LOGGED_UNMAPPED) return;
    const key = `${type}\u0001${text}`;
    if (this.unmappedSeen.has(key)) return;
    this.unmappedSeen.add(key);
    this.warn(`mod without a stat id [${type || "?"}]: ${text}`, "info");
  }

  private warn(msg: string, tag: string): void {
    (this.env.warn ?? noopLog)(msg, tag);
  }

  private cachePath(): string | null {
    return this.env.cacheDir === null ? null : this.env.fs.join(this.env.cacheDir, `stats_${this.profile.game_version}.json`);
  }

  private aliasCachePath(): string | null {
    return this.env.cacheDir === null ? null : this.env.fs.join(this.env.cacheDir, `rendering_aliases_${this.profile.game_version}.json`);
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

  private async loadCache(): Promise<{ stats: Stat[]; stamp: string } | null> {
    const path = this.cachePath();
    if (path === null || !(await this.env.fs.exists(path))) return null;
    try {
      const data = JSON.parse(await this.env.fs.readText(path));
      const at = parseIso(data.fetched_at);
      if (Number.isNaN(at)) throw new Error("bad fetched_at");
      if (this.env.nowMs() - at > CACHE_TTL_MS) return null;
      return { stats: data.stats, stamp: String(data.fetched_at) };
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

export type { Log };
