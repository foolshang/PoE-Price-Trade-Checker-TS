/**
 * 27 real PoE2 item texts (tests/parity/fixtures/ee2_items, see its README for the source and the licence): nothing that is not a mod may become a
 * row of the F5 popup, and every mod either has a stat id or is one the table really does not list ("?"). Run with --silent=false for the table.
 */
import fs from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { isItemLabel } from "../../packages/core/src/item_labels.ts";
import { PROPERTY_LINE, isReminderLine, parseItem } from "../../packages/core/src/item_parser.ts";
import { ModDatabase } from "../../packages/core/src/mod_db.ts";
import { resolveRows } from "../../packages/core/src/mod_rows.ts";
import { PROFILES } from "../../packages/core/src/profiles.ts";

const FIX = path.join(import.meta.dirname, "fixtures");
const DIR = path.join(FIX, "ee2_items");
const RES = path.join(import.meta.dirname, "..", "..", "apps", "checker", "resources");

const warnings: string[] = [];
const db = new ModDatabase(PROFILES.poe2, { fs: null as never, http: null as never, cacheDir: null, nowMs: () => 0, warn: (m) => warnings.push(m) });
db.buildIndex(JSON.parse(gunzipSync(fs.readFileSync(path.join(FIX, "gstats_poe2.json.gz"))).toString("utf-8")));
db.setAliases(JSON.parse(fs.readFileSync(path.join(RES, "rendering_aliases_poe2.json"), "utf-8")), "bundled");

/** the mods the stat table (GGG, 2026-10-19) has no entry for: real mod lines, shown as "?" - never guessed */
const NO_ID: Record<string, string[]> = {
  "BowThreeAugments": ["Bow Attacks fire an additional Arrow"], // the table has "Bow Attacks fire # additional Arrows" (a value of 1 is written "an")
  "HighDamageRareItem": ["Loads 2 additional bolts"], // the table has "Loads an additional bolt" only
  "RareMap": ["+26(26-30)% to Monster Critical Damage Bonus"],
  "TwoLineOneImplicitItem": ["Adds a Mirror of Delirium to a Map", "17 uses remaining"],
};

const files = fs.readdirSync(DIR).filter((f) => f.endsWith(".txt")).sort();

describe("PoE2 item texts of Exiled-Exchange-2", () => {
  it("there are 27 of them", () => {
    expect(files.length).toBe(27);
  });

  const table: string[] = [];
  for (const f of files) {
    const name = f.replace(/\.txt$/, "");
    it(`${name}: only mods become rows; the ones without an id are the known gaps`, () => {
      const item = parseItem(fs.readFileSync(path.join(DIR, f), "utf-8"), "poe2");
      expect(item).not.toBeNull();
      const rows = resolveRows(item!.mods, db);
      for (const r of rows) {
        const t = r.mod.text;
        expect(PROPERTY_LINE.test(t), `property line as a mod: ${t}`).toBe(false);
        expect(isItemLabel(t) || isReminderLine(t) || t.startsWith("("), `label / reminder as a mod: ${t}`).toBe(false);
        expect(/^(Sockets|Grants Skill|Note|Requires|Spirit|Charm Slots|Waystone|Unidentified)\b.*:/.test(t), t).toBe(false);
      }
      const noId = rows.filter((r) => !r.statId).map((r) => r.mod.text.replace(/\n/g, " / "));
      expect(noId, `${name}: mods without an id`).toEqual(NO_ID[name] ?? []);
      // a gem or a currency item has no mods at all; a text without headers has none of the property lines
      if (["Gem", "Currency"].includes(item!.rarity)) expect(item!.mods).toEqual([]);
      table.push(`${name.padEnd(26)} ${item!.rarity.padEnd(9)} mods=${rows.length} without-id=${noId.length}${item!.influences.length ? " influences=" + item!.influences : ""}${item!.flags.length ? " flags=" + item!.flags : ""}`);
    });
  }

  it("the table (one line per item)", () => {
    console.log("\n" + table.join("\n"));
    expect(warnings.filter((w) => w.includes("without a stat id")).length).toBe(Object.values(NO_ID).flat().length);
  });
});
