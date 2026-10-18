/**
 * The Checker's end-to-end tests compare the app with the ORIGINAL program (tools/parity/f5_expect.py). The original guesses stat ids, the
 * Checker no longer does, so for the original to be a fair oracle its stat id lookup is answered from this table: what the new matching
 * (the hub's rules + the aliases that ship with the program) gives for every mod line of every fixture item. Everything else the original
 * computes (tiers, summary, badges from those ids, the URL) stays the original's.
 *   RETIRE_WRITE=1 npx vitest run tests/parity/new_stat_ids.test.ts    rewrites the file; a normal run checks that it is up to date.
 */
import fs from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { ModDatabase } from "../../packages/core/src/mod_db.ts";
import { PROFILES } from "../../packages/core/src/profiles.ts";
import { parseItem } from "../../packages/core/src/item_parser.ts";

const HERE = import.meta.dirname;
const FIX = path.join(HERE, "fixtures");
const FILE = path.join(FIX, "new_stat_ids.json");
const RES = path.join(HERE, "..", "..", "apps", "checker", "resources");

function build(): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const game of ["poe1", "poe2"]) {
    const stats = JSON.parse(gunzipSync(fs.readFileSync(path.join(FIX, `gstats_${game}.json.gz`))).toString("utf-8"));
    const db = new ModDatabase(PROFILES[game], { fs: null as never, http: null as never, cacheDir: null, nowMs: () => 0 });
    db.buildIndex(stats);
    db.setAliases(JSON.parse(fs.readFileSync(path.join(RES, `rendering_aliases_${game}.json`), "utf-8")), "bundled");
    for (const f of fs.readdirSync(path.join(FIX, "items")).filter((x) => x.endsWith(".txt")).sort()) {
      const item = parseItem(fs.readFileSync(path.join(FIX, "items", f), "utf-8"), game);
      for (const m of item?.mods ?? []) {
        for (const type of [m.mod_type, null]) out[`${game}\u0001${type ?? ""}\u0001${m.text}`] = db.findStatId(m.text, type);
      }
    }
  }
  return out;
}

describe("the stat ids the end-to-end oracle uses", () => {
  it("are what the new matching gives", () => {
    const now = build();
    if (process.env.RETIRE_WRITE === "1") fs.writeFileSync(FILE, JSON.stringify(now, null, 0) + String.fromCharCode(10), "utf-8");
    expect(JSON.parse(fs.readFileSync(FILE, "utf-8"))).toEqual(now);
    expect(Object.values(now).filter((v) => v !== null).length).toBeGreaterThan(100);
  });
});
