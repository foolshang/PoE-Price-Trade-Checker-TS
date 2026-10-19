/**
 * The hub's alias-contract cases (Poe_Hub tests/fixtures/alias_contract, SPEC.md 8.12): 49 real mod texts of both games -> the stat id and values
 * the hub's chain gives, or EXPECTED unmapped (8 must-not-map cases). `subset_<game>.json` carries the GGG table entries and the public alias
 * file entries the cases depend on, so this runs offline. Every case must come out exactly as the hub says; a text the hub leaves unmapped
 * must stay without an id here (no guessing).
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ModDatabase } from "../../packages/core/src/mod_db.ts";
import { PROFILES } from "../../packages/core/src/profiles.ts";

const DIR = path.join(import.meta.dirname, "fixtures", "alias_contract");
const read = (f: string): any => JSON.parse(fs.readFileSync(path.join(DIR, f), "utf-8"));
const cases = read("cases.json").cases as {
  id: string; game: string; kind: string; text: string; category: string;
  expect: { status: "mapped" | "unmapped"; stat_id?: string; values?: number[]; stability?: string };
}[];

const dbs: Record<string, ModDatabase> = {};
for (const game of ["poe1", "poe2"]) {
  const subset = read(`subset_${game}.json`);
  const stats = Object.entries(subset.table as Record<string, Record<string, string>>).flatMap(([type, m]) => Object.entries(m).map(([id, text]) => ({ id, text, type })));
  const db = new ModDatabase(PROFILES[game], { fs: null as never, http: null as never, cacheDir: null, nowMs: () => 0 });
  db.buildIndex(stats);
  db.setAliases(subset.public, "bundled");
  dbs[game] = db;
}

describe("the hub's alias contract cases", () => {
  it("49 cases: 41 mapped, 8 unmapped on purpose", () => {
    expect(cases.length).toBe(49);
    expect(cases.filter((c) => c.expect.status === "unmapped").length).toBe(8);
  });

  for (const c of cases) {
    it(`${c.id} [${c.category}] ${c.text}`, () => {
      const got = dbs[c.game].lookup(c.text, c.kind);
      if (c.expect.status === "unmapped") {
        expect(got, `${c.expect.stability}: must stay without an id`).toBeNull();
        return;
      }
      expect(got?.statId).toBe(c.expect.stat_id);
      expect(got?.values.map(Number)).toEqual(c.expect.values);
    });
  }

  it("the energy shield case: '+45 to maximum Energy Shield' is the global stat, never the (Local) twin", () => {
    const got = dbs.poe1.lookup("+45 to maximum Energy Shield", "explicit");
    expect(got?.statId).toBe("explicit.stat_3489782002");
    expect(got?.template).toBe("+# to maximum Energy Shield");
  });
});
