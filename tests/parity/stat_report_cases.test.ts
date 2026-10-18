/**
 * The cases in the hub's report of 2026-10-19 (the old fuzzy match was wrong for 92% of its guesses): on GGG's real table, with the hub's
 * aliases, each wording gets the right stat id (or none) - and the trade URL of an item carrying them searches exactly those stats.
 */
import fs from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { buildTradeUrl } from "../../packages/core/src/trade_url.ts";
import { ModDatabase, flattenStats } from "../../packages/core/src/mod_db.ts";
import { PROFILES } from "../../packages/core/src/profiles.ts";
import { parseItem } from "../../packages/core/src/item_parser.ts";

const FIX = path.resolve(import.meta.dirname, "fixtures", "stat_match");
const gz = (n: string): any => JSON.parse(gunzipSync(fs.readFileSync(path.join(FIX, n))).toString("utf-8"));

function dbFor(game: "poe1" | "poe2"): ModDatabase {
  const db = new ModDatabase(PROFILES[game], { fs: null as never, http: null as never, cacheDir: null, nowMs: () => 0 });
  db.buildIndex(flattenStats(gz(`stats_${game}.json.gz`)));
  db.setAliases(gz(`aliases_${game}.json.gz`), "test");
  return db;
}

describe("the wordings of the report", () => {
  const poe1 = dbFor("poe1");
  const poe2 = dbFor("poe2");

  it("'reduced Duration' is the generic Duration, not Spark Duration", () => {
    expect(poe1.findStatId("20% reduced Duration", "explicit")).toBe("explicit.stat_1256719186"); // "#% increased Duration"
    expect(poe1.idsOfTemplate("explicit", "#% increased Spark Duration")).not.toContain("explicit.stat_1256719186");
  });

  it("'increased Energy Shield' of armour is the (Local) energy shield, not 'increased maximum Energy Shield'", () => {
    expect(poe1.findStatId("30% increased Energy Shield", "explicit")).toBe("explicit.stat_4015621042");
    expect(poe1.findStatId("30% increased maximum Energy Shield", "explicit")).toBe("explicit.stat_2482852589");
    expect(poe2.findStatId("30% increased Energy Shield", "explicit")).toBe("explicit.stat_4015621042");
  });

  it("'less Duration' is 'more Duration' with a negative roll (poe1); the stat that does not exist in poe2 has no id", () => {
    expect(poe1.findStatId("20% less Duration", "explicit")).toBe("explicit.stat_1506355899");
    expect(poe2.findStatId("20% less Duration", "explicit")).toBeNull();
  });

  it("'reduced Poison Duration on you' is the Poison-on-you stat, never 'less Poison Duration'", () => {
    expect(poe1.findStatId("20% reduced Poison Duration on you", "explicit")).toBe("explicit.stat_3301100256");
    expect(poe1.findStatId("20% less Poison Duration", "explicit")).toBe("explicit.stat_1237693206");
    expect(poe2.findStatId("20% reduced Poison Duration on you", "explicit")).toBe("explicit.stat_3301100256");
  });
});

describe("the trade URL of an item with these mods", () => {
  it("searches the right stats and leaves out the line that has none", () => {
    const poe1 = dbFor("poe1");
    const text = [
      "Item Class: Helmets", "Rarity: Rare", "Doom Crest", "Iron Hat", "--------", "Item Level: 80", "--------",
      "+58 to maximum Life", "20% reduced Duration", "30% increased Energy Shield", "20% reduced Poison Duration on you", "12% increased Nothing Anybody Lists",
    ].join(String.fromCharCode(10));
    const item = parseItem(text, "poe1")!;
    const url = buildTradeUrl(item, poe1, "Mirage", PROFILES.poe1);
    const q = JSON.parse(decodeURIComponent(url.split("?q=")[1]));
    const ids = q.query.stats[0].filters.map((f: { id: string }) => f.id);
    expect(ids).toEqual(["explicit.stat_3299347043", "explicit.stat_1256719186", "explicit.stat_4015621042", "explicit.stat_3301100256"]);
  });
});
