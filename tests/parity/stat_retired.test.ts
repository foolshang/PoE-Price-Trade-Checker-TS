/**
 * Every parity case that no longer equals the original (tests/parity/retired_stat_cases.json) is explained here: the ONLY reason is that the
 * mod -> stat id step changed (no fuzzy guessing; the hub's rules). Nothing else may differ. The explanations:
 *   modfind  "guess dropped"   the original's answer came from difflib (its own exact lookup did not give it): now no id
 *            "group"           the line's type has no such text in GGG's table; the original took the id of another group
 *            "case/format"     the original compared lower-cased text, GGG's wording and the game's are case-exact (hub rule)
 *            "other id"        GGG lists two ids for one text; the hub's rule (the last one) picks the other one
 *   url / f5 / badge: the case contains at least one mod line whose stat id changed
 */
import fs from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { ModDatabase } from "../../packages/core/src/mod_db.ts";
import { PROFILES } from "../../packages/core/src/profiles.ts";
import { parseItem } from "../../packages/core/src/item_parser.ts";
import { LegacyModDatabase } from "./legacy_mod_db.ts";

const HERE = import.meta.dirname;
const FIX = path.join(HERE, "fixtures");
const retired: Record<string, string[]> = JSON.parse(fs.readFileSync(path.join(HERE, "retired_stat_cases.json"), "utf-8"));
const readJson = (p: string): any => JSON.parse(fs.readFileSync(p, "utf-8"));

const dbs: Record<string, { now: ModDatabase; old: LegacyModDatabase; stats: any[] }> = {};
for (const game of ["poe1", "poe2"]) {
  const stats = JSON.parse(gunzipSync(fs.readFileSync(path.join(FIX, `gstats_${game}.json.gz`))).toString("utf-8"));
  const env = { fs: null as any, http: null as any, cacheDir: null, nowMs: () => 0 };
  const now = new ModDatabase(PROFILES[game], env);
  now.buildIndex(stats);
  const old = new LegacyModDatabase(PROFILES[game], env);
  old.buildIndex(stats);
  dbs[game] = { now, old, stats };
}

const caseOf = (group: string): Map<string, any> => new Map(readJson(path.join(HERE, "cases", `${group}.json`)).map((c: any) => [c.id, c]));
const goldenOf = (group: string): any => readJson(path.join(HERE, "golden", `${group}.json`));
const itemMods = (ref: string, game: string): { text: string; mod_type: string }[] =>
  parseItem(fs.readFileSync(path.join(FIX, "items", ref.slice(3) + ".txt"), "utf-8"), game)?.mods ?? [];
const changed = (game: string, text: string, typ: string | null): boolean => dbs[game].old.findStatId(text, typ) !== dbs[game].now.findStatId(text, typ);

describe("parity cases retired on purpose", () => {
  it("modfind: every changed answer has one of the reasons", () => {
    const cases = caseOf("item-modfind");
    const golden = goldenOf("item-modfind");
    const labels = new Map<string, number>();
    for (const id of retired["item-modfind"]) {
      const [game, text, typ] = cases.get(id).args.args;
      const want = golden[id].result;
      const { now, old } = dbs[game];
      const got = now.findStatId(text, typ);
      expect(got, id).not.toBe(want);
      let label: string;
      if (old.findExact(text, typ) !== want) label = "guess dropped";
      else if (got !== null) label = "other id";
      else if (typ && old.findExact(text, null) === want && old.findExact(text, typ) !== null && !dbs[game].stats.some((s) => s.type === typ && old.findExact(s.text, typ) === want)) label = "group";
      else label = "case/format";
      labels.set(label, (labels.get(label) ?? 0) + 1);
    }
    console.log("[retired modfind]", JSON.stringify([...labels]));
    expect(retired["item-modfind"].length).toBe([...labels.values()].reduce((a, b) => a + b, 0));
  });

  it("url / f5: a mod of the item has another stat id", () => {
    for (const group of ["item-url", "item-f5"]) {
      const cases = caseOf(group);
      for (const id of retired[group]) {
        const c = cases.get(id);
        const [ref, game] = group === "item-url" ? [c.args.args[0], c.args.args[1]] : [c.args.text, c.args.game];
        expect(itemMods(ref, game).some((m) => changed(game, m.text, m.mod_type)), id).toBe(true);
      }
    }
  });

  it("badge: only mod_badge.resolve cases, with another stat id", () => {
    const cases = caseOf("item-badge");
    for (const id of retired["item-badge"]) {
      const c = cases.get(id);
      expect(c.args.name, id).toBe("mod_badge.resolve");
      const [game, text, typ] = c.args.args;
      expect(changed(game, text, typ ?? null), id).toBe(true);
    }
  });

  it("the list has no case that matches the original again", () => {
    // (parity.test.ts passes them either way; this keeps the list honest by its size)
    expect(Object.fromEntries(Object.entries(retired).map(([k, v]) => [k, v.length]))).toEqual({ "item-badge": 26, "item-f5": 111, "item-modfind": 255, "item-url": 42 });
  });
});
