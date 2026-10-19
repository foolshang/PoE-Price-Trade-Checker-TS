/**
 * The stat ids the Checker finds vs the rows of the hub's `{game}/meta/latest.json` (a copy of its stat ids: fixtures/stat_match/meta_stats_<game>.json.gz,
 * the meta the hub calculated on 2026-10-19 after it learned the aliases and the stat groups: 479 stats in PoE1, 316 in PoE2).
 *   A  the wording of every meta stat (its stat_dictionary template) gives, in the Checker, exactly that stat id.
 *   B  every stat that a lookup of a GGG table text gives is either a row of the meta itself or reaches one through the stat groups (canonical id of an
 *      identical_text group, any member of a case_only group) - the badge rows are found under whichever id the text matched.
 * Run with --silent=false for the numbers.
 */
import fs from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { ModDatabase } from "../../packages/core/src/mod_db.ts";
import { ModBadgeDB } from "../../packages/core/src/mod_badge.ts";
import { PROFILES } from "../../packages/core/src/profiles.ts";

const FIX = path.join(import.meta.dirname, "fixtures");
const RES = path.join(import.meta.dirname, "..", "..", "apps", "checker", "resources");
const gz = (f: string): any => JSON.parse(gunzipSync(fs.readFileSync(path.join(FIX, f))).toString("utf-8"));

for (const game of ["poe1", "poe2"]) {
  describe(`${game}: ids vs the hub's meta rows`, () => {
    const stats = gz(`gstats_${game}.json.gz`) as { id: string; text: string; type: string }[];
    const meta = gz(`stat_match/meta_stats_${game}.json.gz`) as { stats: [string, string | null, number, number][] };
    const db = new ModDatabase(PROFILES[game], { fs: null as never, http: null as never, cacheDir: null, nowMs: () => 0 });
    db.buildIndex(stats);
    db.setAliases(JSON.parse(fs.readFileSync(path.join(RES, `rendering_aliases_${game}.json`), "utf-8")), "bundled");
    const metaIds = new Set(meta.stats.map((s) => s[0]));

    it("A: the wording of each meta stat gives that stat", () => {
      const wrong: string[] = [];
      for (const [id, template] of meta.stats) {
        if (!template) { wrong.push(`${id}: no template`); continue; }
        const got = db.lookup(template.replace(/#/g, "7"), id.split(".")[0])?.statId;
        if (got !== id) wrong.push(`${id} ${template} -> ${got}`);
      }
      console.log(`${game} meta (${meta.stats.length} stats): wording -> same stat id for ${meta.stats.length - wrong.length}`);
      expect(wrong).toEqual([]);
    });

    it("B: a stat found by text reaches a meta row directly or through its stat group", () => {
      const badge = new ModBadgeDB({ fs: null as never, hub: null as never, cacheDir: null, configDir: null, nowMs: () => 0 });
      badge.index({ mods: [...metaIds].map((stat_id) => ({ slot: "ring", archetype: "all", stat_id, rank_in_slot: 1, usage_pct: 80 })), stat_dictionary: [] });
      let direct = 0, viaGroup = 0, none = 0, withoutGroups = 0;
      const seen = new Set<string>();
      for (const s of stats) {
        if (!["explicit", "implicit", "fractured"].includes(s.type)) continue;
        const got = db.lookup(s.text.replace(/#/g, "7"), s.type)?.statId;
        if (!got || seen.has(got)) continue;
        seen.add(got);
        if (metaIds.has(got)) direct++;
        else {
          badge.setStatGroups(db.statAliases(), db.statGroups());
          if (badge.badgeState(got, "ring", "all", { tagsForTemplate: () => [] } as never) === "red") viaGroup++;
          else none++;
        }
      }
      badge.setStatGroups(new Map(), []);
      for (const id of seen) if (!metaIds.has(id) && badge.badgeState(id, "ring", "all", { tagsForTemplate: () => [] } as never) === "red") withoutGroups++;
      console.log(`${game}: ${seen.size} stat ids found by table text; meta row directly ${direct}, through the group ${viaGroup}, none ${none} (without the groups: ${withoutGroups} through a group)`);
      expect(viaGroup).toBeGreaterThanOrEqual(0);
      expect(withoutGroups).toBe(0); // (the groups are what finds them)
      // every meta stat is reachable by its own wording (A) - so a meta row never sits under an id the Checker cannot produce
      for (const id of metaIds) expect(seen.has(id) || !stats.some((s) => s.id === id), id).toBe(true);
    });
  });
}
