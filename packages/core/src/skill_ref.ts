/**
 * Skill Mod Reference - the data behind F4. Port of poe_price_trade/skill_ref.py (the F4 of the new program is always this reference;
 * the original's price-scan mode is not converted).
 *
 * Mods of a skill live in a per-skill file the hub routes to with {game}/skills/index.json, keyed by (skill_type, skill) - the same
 * skill name can be "main" and "spirit". Passive popularity ({game}/passives/latest.json) joins on the same key. stat_id -> text comes
 * from {game}/skills/dictionary.json, the raw stat_id itself is the last resort. A schema_version the program does not know makes that
 * payload empty instead of misreading it.
 */
import { HubClient } from "./hub_client.ts";
import { Log, noopLog, truthy } from "./py.ts";

export const SKILLS_SCHEMA_VERSION = 1;
export const PASSIVES_SCHEMA_VERSION = 3;
export const DICTIONARY_SCHEMA_VERSION = 1;

const REMOVED_SKILL = "Removed Skill";

export interface Skill {
  skill_type: string;
  skill: string;
  slug: string;
  facet_count: number;
  /** {"75-90": 4, "90-100": 96} */
  populations: Record<string, number>;
  path: string;
  /** from the hub (joined from gems.json) - may be [] */
  tags: string[];
}

export interface SlotMod {
  slot: string;
  stat_id: string;
  mod_kind: string;
  text: string;
  usage_pct: number;
  population: number;
  value_min: number | null;
  value_max: number | null;
}

export interface Passive {
  keypassive: string;
  level_bracket: string;
  usage_pct: number;
  population: number;
}

/** "explicit.stat_2422708892|51749" -> "explicit.stat_2422708892" (the |N is an option index) */
const stripOptionSuffix = (statId: string): string => statId.split("|", 1)[0];

/** `int(x or 0)` / `float(x or 0.0)` of a JSON value */
const intOrZero = (v: unknown): number => (truthy(v) ? Math.trunc(Number(v)) : 0);
const floatOrZero = (v: unknown): number => (truthy(v) ? Number(v) : 0.0);

export class SkillRefDB {
  private skills: Skill[] = [];
  private skillIndex = new Map<string, Skill>();
  private dictionary = new Map<string, string>();
  private passivesByKey = new Map<string, any[]>();
  private skillFileCache = new Map<string, any>();
  private indexLoaded = false;

  constructor(private gameVersion: string, private hub: HubClient, private warn: Log = noopLog) {}

  private static key = (skillType: string, skill: string): string => `${skillType}\u0001${skill}`;

  /** skills/index.json + skills/dictionary.json + passives/latest.json eagerly; a skill file is read on first use and kept for the session */
  async load(): Promise<void> {
    const [index, dictionaryPayload, passivesPayload] = await Promise.all([
      this.hub.getSkillsIndex(this.gameVersion), this.hub.getSkillsDictionary(this.gameVersion), this.hub.getPassives(this.gameVersion),
    ]);

    this.dictionary = new Map();
    if (truthy(dictionaryPayload) && this.checkSchema(dictionaryPayload, DICTIONARY_SCHEMA_VERSION, "skills/dictionary.json")) {
      for (const row of Array.isArray(dictionaryPayload.stat_dictionary) ? dictionaryPayload.stat_dictionary : []) {
        if (truthy(row.stat_id) && truthy(row.template)) this.dictionary.set(row.stat_id, row.template);
      }
    }

    this.skills = [];
    this.skillIndex = new Map();
    this.indexLoaded = truthy(index) && this.checkSchema(index, SKILLS_SCHEMA_VERSION, "skills/index.json");
    if (this.indexLoaded) {
      for (const s of Array.isArray(index.skills) ? index.skills : []) {
        const name = s.skill;
        if (!truthy(name) || name === REMOVED_SKILL) continue;
        const skill: Skill = {
          skill_type: s.skill_type ?? "", skill: name, slug: s.slug ?? "", facet_count: intOrZero(s.facet_count),
          populations: truthy(s.populations) ? s.populations : {}, path: s.path ?? "",
          tags: (truthy(s.tags) ? s.tags : []).map((t: unknown) => String(t).toLowerCase()),
        };
        this.skills.push(skill);
        this.skillIndex.set(SkillRefDB.key(skill.skill_type, skill.skill), skill);
      }
      this.skills.sort((a, b) => b.facet_count - a.facet_count); // popular first (stable)
    }

    this.passivesByKey = new Map();
    if (truthy(passivesPayload) && this.checkSchema(passivesPayload, PASSIVES_SCHEMA_VERSION, "passives/latest.json")) {
      for (const p of Array.isArray(passivesPayload.passives) ? passivesPayload.passives : []) {
        const skill = p.skill ?? "";
        if (!skill) continue;
        const k = SkillRefDB.key(p.skill_type ?? "", skill);
        const list = this.passivesByKey.get(k);
        if (list) list.push(p);
        else this.passivesByKey.set(k, [p]);
      }
    }
    this.skillFileCache = new Map();
  }

  available(): boolean {
    return this.indexLoaded;
  }

  private checkSchema(data: any, expected: number, name: string): boolean {
    const got = data.schema_version;
    if (got !== expected) {
      this.warn(`skill_ref: ${name} schema_version=${JSON.stringify(got)} (expected ${expected}) - treating as empty`, "warn");
      return false;
    }
    return true;
  }

  // ------------------------------------------------------------------ public API

  /** Matches by name prefix (0) > name contains (1) > tag contains (2); popular skills first within a rank. */
  searchSkills(prefix: string): Skill[] {
    const p = prefix.trim().toLowerCase();
    if (!p) return [...this.skills];
    const ranked: [number, number, Skill][] = [];
    for (const s of this.skills) {
      const name = s.skill.toLowerCase();
      let rank: number;
      if (name.startsWith(p)) rank = 0;
      else if (name.includes(p)) rank = 1;
      else if (s.tags.some((t) => t.includes(p))) rank = 2;
      else continue;
      ranked.push([rank, -s.facet_count, s]);
    }
    ranked.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
    return ranked.map((r) => r[2]);
  }

  skillMeta(skillType: string, skill: string): Skill | null {
    return this.skillIndex.get(SkillRefDB.key(skillType, skill)) ?? null;
  }

  /** {bracket: {slot: [SlotMod]}} - the skill file is fetched on first use */
  async modsForSkill(skillType: string, skill: string): Promise<Record<string, Record<string, SlotMod[]>>> {
    const meta = this.skillMeta(skillType, skill);
    if (meta === null || !meta.path) return {};
    const data = await this.loadSkillFile(meta.path);
    if (!truthy(data)) return {};
    const result: Record<string, Record<string, SlotMod[]>> = {};
    for (const [bracket, slots] of Object.entries<any>(truthy(data.mods) ? data.mods : {})) {
      const bracketOut: Record<string, SlotMod[]> = {};
      for (const [slot, mods] of Object.entries<any>(slots)) {
        bracketOut[slot] = mods.map((m: any): SlotMod => {
          const statId = m.stat_id ?? "";
          return {
            slot, stat_id: statId, mod_kind: m.mod_kind ?? "", text: this.resolveText(statId), usage_pct: floatOrZero(m.usage_pct),
            population: intOrZero(m.population), value_min: m.value_min ?? null, value_max: m.value_max ?? null,
          };
        });
      }
      result[bracket] = bracketOut;
    }
    return result;
  }

  /** {bracket: [Passive]} best first */
  passivesForSkill(skillType: string, skill: string): Record<string, Passive[]> {
    const rows = this.passivesByKey.get(SkillRefDB.key(skillType, skill)) ?? [];
    const byBracket: Record<string, Passive[]> = {};
    for (const p of rows) {
      const bracket = p.level_bracket ?? "";
      (byBracket[bracket] ??= []).push({
        keypassive: p.keypassive ?? "", level_bracket: bracket, usage_pct: floatOrZero(p.usage_pct), population: intOrZero(p.population),
      });
    }
    for (const bucket of Object.values(byBracket)) bucket.sort((a, b) => b.usage_pct - a.usage_pct);
    return byBracket;
  }

  // ------------------------------------------------------------------

  /** The exact id first (a "|N" option id has its own text in the dictionary), then the bare id, then the id itself. */
  private resolveText(statId: string): string {
    const exact = this.dictionary.get(statId);
    if (exact !== undefined) return exact;
    return this.dictionary.get(stripOptionSuffix(statId)) ?? statId;
  }

  private async loadSkillFile(path: string): Promise<any> {
    if (this.skillFileCache.has(path)) return this.skillFileCache.get(path);
    let data = (await this.hub.getSkillFile(path)) ?? {};
    if (truthy(data) && !this.checkSchema(data, SKILLS_SCHEMA_VERSION, path)) data = {};
    this.skillFileCache.set(path, data);
    return data;
  }
}
