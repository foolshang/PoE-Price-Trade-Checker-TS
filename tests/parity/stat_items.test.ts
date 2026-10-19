/**
 * What F5 saw in the game (rc.4, Winai's log) that was not a stat-matching problem:
 *  1. a reminder text "(Attributes are Strength, ...)" under a mod is not a mod;
 *  2. " — Unscalable Value" at the end of a line is not part of the wording;
 *  3. the lines under one { Modifier } header are matched as one block first, then line by line (the hub's order).
 * The real item text is tests/parity/fixtures/stat_items/poe1_wand_hybrid_reminder.txt (copied from the game with Ctrl+Alt+C).
 * Every mod line of every item here must get a stat id, or be dropped on purpose (reminders) - and a wrong id is never acceptable.
 */
import fs from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { isReminderLine, parseItem, reminderOpening } from "../../packages/core/src/item_parser.ts";
import { ITEM_LABELS, influenceOfLabel } from "../../packages/core/src/item_labels.ts";
import { ModDatabase, cleanModText } from "../../packages/core/src/mod_db.ts";
import { resolveRows } from "../../packages/core/src/mod_rows.ts";
import { PROFILES } from "../../packages/core/src/profiles.ts";

const HERE = import.meta.dirname;
const FIX = path.join(HERE, "fixtures");
const RES = path.join(HERE, "..", "..", "apps", "checker", "resources");

function dbOf(game: string, warn?: (m: string) => void): ModDatabase {
  const stats = JSON.parse(gunzipSync(fs.readFileSync(path.join(FIX, `gstats_${game}.json.gz`))).toString("utf-8"));
  const db = new ModDatabase(PROFILES[game], { fs: null as never, http: null as never, cacheDir: null, nowMs: () => 0, warn });
  db.buildIndex(stats);
  db.setAliases(JSON.parse(fs.readFileSync(path.join(RES, `rendering_aliases_${game}.json`), "utf-8")), "bundled");
  return db;
}

const REMINDERS = [
  "(Attributes are Strength, Dexterity, and Intelligence)",
  "(Onslaught grants 20% increased Attack, Cast, and Movement Speed)",
  "(40% of Damage from Suppressed Hits and Ailments they inflict is prevented)",
  "(Aggressive minions have their targeting range raised to a minimum value)",
];

describe("reminder text is not a mod", () => {
  it("whole-line parentheses are reminders; a real mod that starts with a roll range or ends with a tag is not", () => {
    for (const r of REMINDERS) expect(isReminderLine(r)).toBe(true);
    expect(isReminderLine("  (Nested (deep) text)  ")).toBe(true);
    expect(isReminderLine("(5-10)% increased Attack Speed (crafted)")).toBe(false);
    expect(isReminderLine("(25-35) to (40-50) Added Fire Damage (implicit)")).toBe(false);
    expect(isReminderLine("+47(42-49) to maximum Life")).toBe(false);
    expect(isReminderLine("Adds 5 to 12 Fire Damage (rune)")).toBe(false);
    expect(isReminderLine("(unbalanced")).toBe(false);
    expect(isReminderLine("")).toBe(false);
  });

  for (const game of ["poe1", "poe2"]) {
    it(`${game}: reminders under the mods of an item are dropped, the mods around them stay`, () => {
      const item = parseItem([
        "Item Class: Amulets", "Rarity: Rare", "Test Charm", "Jade Amulet", "--------", "Item Level: 84", "--------",
        '{ Prefix Modifier "Healthy" (Tier: 1) — Life }', "+95(90-99) to maximum Life",
        '{ Suffix Modifier "of the Whale" (Tier: 1) — Attribute }', "+12(10-12) to all Attributes", REMINDERS[0],
        '{ Suffix Modifier "of Haste" — Speed }', "Gain Onslaught for 4 seconds on Kill", REMINDERS[1],
        "", REMINDERS[2], REMINDERS[3],
      ].join("\n"), game)!;
      expect(item.mods.map((m) => m.text)).toEqual(["+95(90-99) to maximum Life", "+12(10-12) to all Attributes", "Gain Onslaught for 4 seconds on Kill"]);
      expect(item.mods.some((m) => m.text.startsWith("("))).toBe(false);
    });
  }
});

describe("' — Unscalable Value'", () => {
  it("is cut at the end of a line, with or without a tag, line by line in a block", () => {
    expect(cleanModText("Minions are Aggressive — Unscalable Value")).toBe("Minions are Aggressive");
    expect(cleanModText("+20% to Maximum Quality — Unscalable Value")).toBe("+20% to Maximum Quality");
    expect(cleanModText("Minions are Aggressive — Unscalable Value (crafted)")).toBe("Minions are Aggressive");
    expect(cleanModText("Minions are Aggressive (crafted) — Unscalable Value")).toBe("Minions are Aggressive");
    expect(cleanModText("A — Unscalable Value\nB (crafted)")).toBe("A\nB");
    expect(cleanModText("Unscalable Value is a thing")).toBe("Unscalable Value is a thing");
  });

  it("the lines of the report get an id (the games whose table lists them), and nothing is guessed for the others", () => {
    const p1 = dbOf("poe1"), p2 = dbOf("poe2");
    expect(p1.findStatId("Minions are Aggressive — Unscalable Value", "explicit")).toBe("explicit.stat_128585622");
    expect(p1.findStatId("+20% to Maximum Quality — Unscalable Value", "explicit")).toBe("explicit.stat_2039822488");
    expect(p2.findStatId("+20% to Maximum Quality — Unscalable Value", "explicit")).toBe("explicit.stat_2039822488");
    expect(p2.findStatId("60% increased effect of Socketed Augment Items — Unscalable Value", "explicit")).toBe("explicit.stat_2081918629");
    expect(p2.findStatId("27% increased Explicit Resistance Modifier magnitudes — Unscalable Value", "explicit")).toBe("explicit.stat_1972391381");
    // PoE1's table has no such stat: no id, not a guess
    expect(p1.findStatId("60% increased effect of Socketed Augment Items — Unscalable Value", "explicit")).toBeNull();
    expect(p1.findStatId("27% increased Explicit Resistance Modifier magnitudes — Unscalable Value", "explicit")).toBeNull();
  });
});

describe("a block of lines under one header", () => {
  const TRIGGER = "Trigger a Socketed Spell when you Use a Skill, with a 8 second Cooldown";
  const COST = "Spells Triggered this way have 150% more Cost";

  it("matched as a whole first (GGG lists it as one entry); the lines alone have no id", () => {
    const db = dbOf("poe1");
    expect(db.findStatId(`${TRIGGER}\n${COST}`, "explicit")).toBe("explicit.stat_3079007202");
    expect(db.findStatId(TRIGGER, "explicit")).toBeNull();
    expect(db.findStatId(COST, "explicit")).toBeNull();
  });

  it("the real item from the game (Gloom Spire): one row for the block, every mod has an id, nothing else is a mod", () => {
    const db = dbOf("poe1");
    const item = parseItem(fs.readFileSync(path.join(FIX, "stat_items", "poe1_wand_hybrid_reminder.txt"), "utf-8"), "poe1")!;
    expect(item.mods.some((m) => m.text.startsWith("("))).toBe(false); // the reminder is gone
    const rows = resolveRows(item.mods, db);
    const view = rows.map((r) => [r.mod.mod_type, r.mod.text.replace(/\n/g, " / "), r.statId]);
    expect(view.filter((v) => v[2] === null)).toEqual([]); // every mod has an id
    expect(rows.length).toBe(item.mods.length - 1); // the two trigger lines became one row
    const block = rows.find((r) => r.mod.text.includes("\n"))!;
    expect(block.mod.text).toBe(`${TRIGGER}\n${COST}`);
    expect(block.statId).toBe("explicit.stat_3079007202");
    expect(block.mod.values).toEqual([8, 150]);
    expect(block.mod.value).toBe(8);
    expect(rows.find((r) => r.mod.text.startsWith("Minions are Aggressive"))!.statId).toBe("explicit.stat_128585622");
  });

  it("a block that GGG does not list as one entry falls back to its lines, each looked up alone (the hub's order)", () => {
    const db = dbOf("poe1");
    const item = parseItem([
      "Item Class: Rings", "Rarity: Rare", "Test Loop", "Coral Ring", "--------", "Item Level: 84", "--------",
      '{ Prefix Modifier "Healthy" (Tier: 1) — Life }', "+95(90-99) to maximum Life", "+12(10-12) to Strength",
    ].join("\n"), "poe1")!;
    const rows = resolveRows(item.mods, db);
    expect(rows.map((r) => r.mod.text)).toEqual(["+95(90-99) to maximum Life", "+12(10-12) to Strength"]);
    expect(rows.every((r) => r.statId)).toBe(true);
  });

  it("lines of different headers, or of different types, are never merged", () => {
    const db = dbOf("poe1");
    const item = parseItem([
      "Item Class: Wands", "Rarity: Rare", "Test Wand", "Convoking Wand", "--------", "Item Level: 84", "--------",
      '{ Suffix Modifier "of the Underground" — Minion }', "Minions are Aggressive — Unscalable Value",
      '{ Master Crafted Suffix Modifier "of Craft" — Caster, Gem }', TRIGGER, COST,
    ].join("\n"), "poe1")!;
    const rows = resolveRows(item.mods, db);
    expect(rows.map((r) => r.statId)).toEqual(["explicit.stat_128585622", "explicit.stat_3079007202"]);
  });
});

describe("labels of the item (Searing Exarch Item, Fractured Item ...)", () => {
  const filters = JSON.parse(fs.readFileSync(path.join(FIX, "stat_items", "trade_misc_filters.json"), "utf-8")).filters as Record<string, { id: string; text: string }[]>;

  it("every item-state label GGG's trade site names ('... Item', Corrupted, Mirrored, Split ...) is known, for both games", () => {
    for (const game of ["poe1", "poe2"]) {
      for (const f of filters[game]) {
        if (/ Item$/.test(f.text) || ["Corrupted", "Twice Corrupted", "Mirrored", "Split", "Sanctified"].includes(f.text)) {
          expect(ITEM_LABELS.has(f.text), `${game}: ${f.text}`).toBe(true);
        }
      }
    }
    const stats = JSON.parse(gunzipSync(fs.readFileSync(path.join(FIX, "gstats_poe1.json.gz"))).toString("utf-8")) as { id: string; text: string }[];
    for (const s of stats.filter((x) => /^pseudo\.pseudo_has_\w+_influence$/.test(x.id))) {
      const name = /^Has (.+) Influence$/.exec(s.text)![1];
      expect(influenceOfLabel(`${name} Item`), s.text).toBe(name);
    }
    expect(influenceOfLabel("Searing Exarch Item")).toBe("Searing Exarch");
    expect(influenceOfLabel("Fractured Item")).toBeNull();
    expect(influenceOfLabel("+25 to Strength and Dexterity")).toBeNull();
  });

  it("the real item (Eagle Touch): labels glued to the mods are not mods, 9 of 9 resolved, nothing in the log, the influences are kept", () => {
    const warnings: string[] = [];
    const db = dbOf("poe1", (m) => warnings.push(m));
    const item = parseItem(fs.readFileSync(path.join(FIX, "stat_items", "poe1_gloves_labels_with_mods.txt"), "utf-8"), "poe1")!;
    const rows = resolveRows(item.mods, db);
    expect(rows.map((r) => r.mod.text).some((t) => /Exarch Item|Eater of Worlds Item|Fractured Item/.test(t))).toBe(false);
    expect(item.mods.some((m) => m.text.startsWith("("))).toBe(false); // the reminders
    expect(rows.length).toBe(9);
    expect(rows.filter((r) => r.statId === null)).toEqual([]);
    expect(rows.find((r) => r.mod.text.startsWith("+25(21-25) to Strength"))!.statId).toBeTruthy();
    expect(warnings.filter((w) => w.includes("without a stat id"))).toEqual([]);
    expect(item.influences).toEqual(["Searing Exarch", "Eater of Worlds"]);
    expect(item.flags).toEqual(["Fractured Item"]);
  });

  it("a section of labels only is never read as mods; its label still counts (Corrupted, Unidentified)", () => {
    const item = parseItem([
      "Item Class: Rings", "Rarity: Rare", "Test Loop", "Coral Ring", "--------", "Item Level: 84", "--------",
      '{ Prefix Modifier "Healthy" (Tier: 1) — Life }', "+95(90-99) to maximum Life", "--------", "Shaper Item", "Elder Item", "--------", "Corrupted", "--------", "Mirrored",
    ].join("\n"), "poe1")!;
    expect(item.mods.map((m) => m.text)).toEqual(["+95(90-99) to maximum Life"]);
    expect(item.influences).toEqual(["Shaper", "Elder"]);
    expect(item.corrupted).toBe(true);
    expect(item.flags).toEqual(["Corrupted", "Mirrored"]);
  });
});

describe("a reminder that runs over several lines", () => {
  it("opens with '(' and closes with ')' lines later: everything between is skipped; a mod that begins with a roll range is not an opening", () => {
    expect(reminderOpening("(Spells cast by this item")).toBeGreaterThan(0);
    expect(reminderOpening("(5-10)% increased Attack Speed")).toBe(0);
    expect(reminderOpening("(Complete one line)")).toBe(0);
    expect(reminderOpening("+5 to Life")).toBe(0);
    const item = parseItem([
      "Item Class: Rings", "Rarity: Rare", "Test Loop", "Coral Ring", "--------", "Item Level: 84", "--------",
      '{ Prefix Modifier "Healthy" (Tier: 1) — Life }', "+95(90-99) to maximum Life",
      "(A long explanation that the game wraps", "over a second line and a (nested) third", "and ends here)",
      '{ Suffix Modifier "of the Whale" (Tier: 1) }', "+12(10-12) to all Attributes",
    ].join("\n"), "poe1")!;
    expect(item.mods.map((m) => m.text)).toEqual(["+95(90-99) to maximum Life", "+12(10-12) to all Attributes"]);
  });
});

describe("the log line 'mod without a stat id' is for rows that stay without one", () => {
  it("a block tried whole and then line by line writes nothing for the block; a line that really has no id is written once", () => {
    const warnings: string[] = [];
    const db = dbOf("poe1", (m) => warnings.push(m));
    const item = parseItem([
      "Item Class: Rings", "Rarity: Rare", "Test Loop", "Coral Ring", "--------", "Item Level: 84", "--------",
      '{ Prefix Modifier "Healthy" (Tier: 1) — Life }', "+95(90-99) to maximum Life", "+12(10-12) to Strength",
      '{ Suffix Modifier "of Nothing" }', "Nobody lists this mod at all",
    ].join("\n"), "poe1")!;
    const rows = resolveRows(item.mods, db);
    expect(rows.map((r) => !!r.statId)).toEqual([true, true, false]);
    expect(warnings.filter((w) => w.includes("without a stat id"))).toEqual(["mod without a stat id [explicit]: Nobody lists this mod at all"]);
    resolveRows(item.mods, db); // (F5 again: still once)
    expect(warnings.filter((w) => w.includes("without a stat id")).length).toBe(1);
  });
});
