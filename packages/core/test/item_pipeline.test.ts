/**
 * The unit tests of the original for the item pipeline (test_item_parser, test_poe2_parser, test_poe2_magic, test_meta_db,
 * test_mod_badge) converted. The parity suite (tests/parity, item-* groups) checks the same modules byte for byte against the original.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { MetaDB } from "../src/meta_db.ts";
import { ModBadgeDB, affixCap, buildTemplateIndex, slotForItem, tierRollArrow } from "../src/mod_badge.ts";
import { Rarity, newModValue, ParsedItem } from "../src/models.ts";
import { parseItem } from "../src/item_parser.ts";
import { FsPort } from "../src/ports.ts";

const ITEMS = path.resolve(import.meta.dirname, "..", "..", "..", "tests", "parity", "fixtures", "items");
const text = (name: string): string => readFileSync(path.join(ITEMS, name + ".txt"), "utf-8");

const memFs = (files: Record<string, string> = {}): FsPort & { files: Record<string, string> } => ({
  files,
  join: (...p: string[]) => p.join("/"), basename: (p: string) => p.split("/").pop()!,
  exists: async (p: string) => p in files, isFile: async (p: string) => p in files, isDir: async () => false,
  readText: async (p: string) => files[p], writeText: async (p: string, t: string) => { files[p] = t; }, mkdirp: async () => {},
  listDir: async () => [], mtimeSec: async () => 0, sha256: async () => "", copyFile: async () => {},
});

// ---------------------------------------------------------------------------------------------- item parser (test_item_parser)
describe("item_parser", () => {
  const RARE = text("poe1_rare_body"), CURRENCY = text("poe1_currency_old"), UNIQUE = text("poe1_unique_old");

  it("parses a rare", () => {
    const item = parseItem(RARE, "poe1")!;
    expect(item.rarity).toBe(Rarity.RARE);
    expect(item.base_type.includes("Astral Plate") || item.item_name.includes("Dire Carapace")).toBe(true);
    expect(item.item_level).toBe(85);
    expect(item.mods.length).toBeGreaterThan(0);
    expect(item.mods.some((m) => m.text.includes("Resistance"))).toBe(true);
    expect(item.mods.some((m) => m.value !== null)).toBe(true);
  });
  it("parses currency and a unique", () => {
    const c = parseItem(CURRENCY, "poe1")!;
    expect(c.rarity).toBe(Rarity.CURRENCY);
    expect(c.item_name).toContain("Chaos Orb");
    const u = parseItem(UNIQUE, "poe1")!;
    expect(u.rarity).toBe(Rarity.UNIQUE);
    expect(u.item_name).toContain("Dying Sun");
  });
  it("returns null for an empty text and for a non-item", () => {
    expect(parseItem("", "poe1")).toBeNull();
    expect(parseItem("Hello world, this is not an item", "poe1")).toBeNull();
  });
  it("records the game version", () => {
    expect(parseItem(RARE, "poe2")!.game_version).toBe("poe2");
  });

  describe("a clipboard without any { Modifier } header", () => {
    const item = parseItem(text("poe1_rare_noheader"), "poe1")!;
    it("is flagged, and the counts stay 0 (not a guessed value)", () => {
      expect(item.mods_have_headers).toBe(false);
      expect(item.prefix_count).toBe(0);
      expect(item.suffix_count).toBe(0);
      expect(item.mods.filter((m) => m.mod_type === "explicit").every((m) => m.affix === "")).toBe(true);
    });
    it("tags the (implicit) lines and strips the suffix from their text", () => {
      const imp = item.mods.filter((m) => m.mod_type === "implicit");
      expect(imp.length).toBe(2);
      expect(imp.every((m) => !m.text.endsWith("(implicit)"))).toBe(true);
      expect(imp.some((m) => m.text.includes("Leeched as Life"))).toBe(true);
    });
    it("does not take influence labels for mods; every explicit gets its own group", () => {
      expect(item.mods.some((m) => m.text.includes("Searing Exarch Item") || m.text.includes("Eater of Worlds Item"))).toBe(false);
      const groups = item.mods.filter((m) => m.mod_type === "explicit").map((m) => m.group);
      expect(new Set(groups).size).toBe(groups.length);
    });
  });

  it("a header-driven item is unaffected", () => {
    const item = parseItem(text("poe1_header_driven"), "poe1")!;
    expect(item.mods_have_headers).toBe(true);
    expect(item.prefix_count).toBe(1);
    expect(item.suffix_count).toBe(1);
  });
});

// ---------------------------------------------------------------------------------------------- PoE2 clipboard (test_poe2_parser)
describe("poe2 parser", () => {
  const it2 = parseItem(text("poe2_rare_gloves"), "poe2")!;
  const explicit = it2.mods.filter((m) => m.mod_type === "explicit");

  it("does not eat the base with the quality", () => expect(it2.base_type).toBe("Knightly Mitts"));
  it("keeps both lines of a hybrid in one group", () => {
    expect(explicit.length).toBe(7);
    const g0 = explicit.filter((m) => m.group === explicit[0].group);
    expect(g0.length).toBe(2);
    expect(g0.some((m) => m.text.includes("maximum Life"))).toBe(true);
  });
  it("reads the tier from the header", () => {
    const tiers = explicit.map((m) => m.tier);
    expect(tiers.slice(0, 2)).toEqual([1, 1]);
    expect(tiers).toContain(6);
  });
  it("strips the roll range from the values", () => {
    const m = it2.mods.find((x) => x.text.includes("maximum Mana"))!;
    expect(m.values).toEqual([82]);
    expect(m.value).toBe(82);
  });
  it("captures the rune mods (no affix), counts and per-mod affixes", () => {
    const runes = it2.mods.filter((m) => m.mod_type === "rune");
    expect(runes.length).toBe(2);
    expect(runes.every((m) => m.affix === "")).toBe(true);
    expect(it2.prefix_count).toBe(3);
    expect(it2.suffix_count).toBe(3);
    expect(explicit.map((m) => m.affix)).toEqual(["prefix", "prefix", "prefix", "prefix", "suffix", "suffix", "suffix"]);
  });
  it("identified and corrupted", () => {
    expect(it2.identified).toBe(true);
    expect(it2.corrupted).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------- magic item (test_poe2_magic)
describe("magic item with the affix names in its name", () => {
  it("is parsed with the full name; MetaDB resolves the base", async () => {
    const item = parseItem(text("poe2_magic_boots"), "poe2")!;
    expect(item.rarity).toBe("Magic");
    expect(item.identified).toBe(true);
    expect(item.base_type).toBe("Legend's Fortress Sabatons of Grounding");
    const ex = item.mods.filter((m) => m.mod_type === "explicit");
    expect(ex.length).toBe(2);
    expect(ex[0].tier).toBe(1);
    expect(ex[1].tier).toBe(1);

    const fs = memFs({ "/d/mod_meta_poe2.json": JSON.stringify({
      bases: { "Fortress Sabatons": { class: "Boots", drop_level: 75, ts: 0 }, "Sabatons": { class: "Boots", drop_level: 10, ts: 0 } }, tagsets: {},
    }) });
    const db = new MetaDB("poe2", { fs, appDir: "/d" });
    await db.load();
    expect(db.resolveBase("Legend's Fortress Sabatons of Grounding")).toBe("Fortress Sabatons");
    expect(db.resolveBase("Fortress Sabatons")).toBe("Fortress Sabatons");
    expect(db.resolveBase("Boots of Nothing")).toBeNull();
  });
  it("without a meta file nothing is resolved", async () => {
    const db = new MetaDB("poe2", { fs: memFs(), appDir: "/d" });
    await db.load();
    expect(db.resolveBase("Legend's Fortress Sabatons of Grounding")).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------- MetaDB (test_meta_db)
const FIXTURE = {
  bases: { "Knightly Mitts": { class: "Gloves", drop_level: 65, ts: 1 }, "Ruby": { class: "Jewel", drop_level: 20, ts: 2 } },
  tagsets: {
    "1": [
      { gen: "prefix", text: "# to maximum life", stats: ["base_maximum_life"],
        tiers: [{ lvl: 60, rng: [[120, 149]] }, { lvl: 54, rng: [[100, 119]] }, { lvl: 1, rng: [[10, 19]] }], tags: ["life", "resource"] },
      { gen: "suffix", text: "#% to fire resistance", stats: ["fire_resistance"],
        tiers: [{ lvl: 40, rng: [[36, 40]] }, { lvl: 1, rng: [[10, 15]] }], tags: ["elemental", "elemental_resistance", "fire", "fire_resistance", "resistance"] },
    ],
    "2": [{ gen: "prefix", text: "#% increased spell damage", stats: ["spell_damage_+%"], tiers: [{ lvl: 1, rng: [[10, 20]] }], tags: ["caster", "caster_damage", "damage"] }],
  },
};
const metaDb = async (game = "poe2", data: unknown = FIXTURE): Promise<MetaDB> => {
  const db = new MetaDB(game, { fs: memFs({ [`/d/mod_meta_${game}.json`]: JSON.stringify(data) }), appDir: "/d" });
  await db.load();
  return db;
};
const rareItem = (mods: ReturnType<typeof newModValue>[], base_type = "Knightly Mitts"): ParsedItem => ({
  item_name: "Test Item", base_type, rarity: "Rare", item_level: 80, quality: 0, mods, game_version: "poe1", raw_text: "", item_class: "",
  corrupted: false, identified: true, prefix_count: 0, suffix_count: 0, mods_have_headers: false, influences: [], flags: [],
});

describe("MetaDB", () => {
  it("tier_range", async () => {
    const db = await metaDb();
    expect(db.tierRange("Knightly Mitts", "+47 to maximum Life", 3)).toEqual([[10, 19]]);
    expect(db.tierRange("Knightly Mitts", "+47 to maximum Life", 1)).toEqual([[120, 149]]);
    expect(db.tierRange("Nonexistent Base", "+47 to maximum Life", 1)).toBeNull();
    expect(db.tierRange("Knightly Mitts", "+47 to maximum Life", 0)).toBeNull();
    expect(db.tierRange("Knightly Mitts", "+47 to maximum Life", 99)).toBeNull();
  });
  it("tags_for_template works across tagsets", async () => {
    const db = await metaDb();
    expect(db.tagsForTemplate("# to maximum life")).toEqual(new Set(["life", "resource"]));
    expect(db.tagsForTemplate("#% to fire resistance").has("fire")).toBe(true);
    expect(db.tagsForTemplate("#% totally unknown mod")).toEqual(new Set());
    expect(db.tagsForTemplate("#% increased spell damage").has("caster")).toBe(true);
  });
  it("summary with the caps", () => {
    const fake = { rarity: "Rare", item_level: 78, prefix_count: 2, suffix_count: 1 } as ParsedItem;
    const s = MetaDB.summary(fake, {}, 3, 3);
    expect(s).toContain("Prefix 2/3");
    expect(s).toContain("Suffix 1/3");
    const j = MetaDB.summary({ rarity: "Rare", item_level: 20, prefix_count: 1, suffix_count: 0 } as ParsedItem, {}, 1, 1);
    expect(j).toContain("Prefix 1/1");
    expect(j).toContain("Suffix 0/1");
  });
  it("uses a separate file per game", async () => {
    const files = { "/d/mod_meta_poe1.json": JSON.stringify({
      bases: { "Cobalt Jewel": { class: "Jewel", drop_level: 20, ts: 0 } },
      tagsets: { "0": [{ gen: "prefix", text: "# to maximum life", stats: ["base_maximum_life"], tiers: [{ lvl: 1, rng: [[3, 9]] }], tags: ["life"] }] },
    }) };
    const poe1 = new MetaDB("poe1", { fs: memFs(files), appDir: "/d" });
    const poe2 = new MetaDB("poe2", { fs: memFs(files), appDir: "/d" });
    await poe1.load();
    await poe2.load();
    expect(poe1.tierRange("Cobalt Jewel", "+9 to maximum Life", 1)).toEqual([[3, 9]]);
    expect(poe2.available()).toBe(false);
    expect(poe2.tierRange("Cobalt Jewel", "+9 to maximum Life", 1)).toBeNull();
  });
  it("a bundled meta is used when the app folder has none", async () => {
    const fs = memFs({ "/bundle/mod_meta_poe2.json": JSON.stringify(FIXTURE) });
    const db = new MetaDB("poe2", { fs, appDir: "/app", bundledDir: "/bundle" });
    await db.load();
    expect(db.available()).toBe(true);
  });

  describe("infer_affixes", () => {
    const mod = (text: string, v: number, type = "explicit", affix = "") => newModValue({ text, value: v, values: [v], mod_type: type, affix });
    it("classifies from the RePoE gen", async () => {
      const db = await metaDb();
      const item = rareItem([mod("+130 to maximum Life", 130), mod("+38% to Fire Resistance", 38)]);
      db.inferAffixes(item);
      expect(item.mods[0].affix).toBe("prefix");
      expect(item.mods[1].affix).toBe("suffix");
      expect([item.prefix_count, item.suffix_count]).toEqual([1, 1]);
    });
    it("does not overwrite an affix, ignores implicits, misses gracefully", async () => {
      const db = await metaDb();
      const a = rareItem([mod("+130 to maximum Life", 130, "explicit", "suffix")]);
      db.inferAffixes(a);
      expect(a.mods[0].affix).toBe("suffix");
      expect([a.prefix_count, a.suffix_count]).toEqual([0, 1]);
      const b = rareItem([mod("+130 to maximum Life", 130, "implicit")]);
      db.inferAffixes(b);
      expect(b.mods[0].affix).toBe("");
      const c = rareItem([newModValue({ text: "Adds 2 to 22 Lightning Damage to Attacks", value: 2, values: [2, 22] })]);
      db.inferAffixes(c);
      expect(c.mods[0].affix).toBe("");
      const d = rareItem([mod("+130 to maximum Life", 130)], "Nonexistent Base");
      db.inferAffixes(d);
      expect(d.mods[0].affix).toBe("");
    });
  });
});

// ---------------------------------------------------------------------------------------------- mod badge (test_mod_badge)
const nowIso = (): string => new Date().toISOString().replace(/\.\d+Z$/, "Z");
const metaPayload = (o: { generated_at?: string; mods?: any[]; stat_dictionary?: any[] } = {}) => ({
  schema_version: 2, generated_at: o.generated_at ?? nowIso(), league: "Runes of Aldur", mods: o.mods ?? [], stat_dictionary: o.stat_dictionary ?? [],
});
const SAMPLE_MODS = [
  { slot: "helmet", archetype: "all", stat_id: "s.red_rank", rank_in_slot: 1, usage_pct: 20.0 },
  { slot: "helmet", archetype: "all", stat_id: "s.red_usage", rank_in_slot: 40, usage_pct: 55.0 },
  { slot: "helmet", archetype: "all", stat_id: "s.gold_rank", rank_in_slot: 10, usage_pct: 8.0 },
  { slot: "helmet", archetype: "all", stat_id: "s.white", rank_in_slot: 50, usage_pct: 1.0 },
  { slot: "helmet", archetype: "attack-melee", stat_id: "s.melee_only", rank_in_slot: 2, usage_pct: 60.0 },
];
const newBadge = (o: { files?: Record<string, string>; hub?: any; cacheDir?: string | null; configDir?: string | null } = {}) =>
  new ModBadgeDB({ fs: memFs(o.files), hub: o.hub ?? { getMeta: async () => null }, cacheDir: o.cacheDir ?? null, configDir: o.configDir ?? null, nowMs: () => Date.now() });
const withSample = (): ModBadgeDB => {
  const db = newBadge();
  db.index(metaPayload({ mods: SAMPLE_MODS }));
  return db;
};

describe("mod badge: slots and caps", () => {
  it("slot_for_item", () => {
    expect(slotForItem("Gloves", "Knightly Mitts")).toBe("gloves");
    expect(slotForItem("Boots", "Slink Boots")).toBe("boots");
    expect(slotForItem("Amulets", "Jade Amulet")).toBe("amulet");
    expect(slotForItem("Bows", "Composite Bow")).toBe("weapon");
    expect(slotForItem("Two Hand Swords", "Longsword")).toBe("weapon");
    expect(slotForItem("Jewel", "Emerald")).toBe("jewel:emerald");
    expect(slotForItem("Jewels", "Ruby")).toBe("jewel:ruby");
    expect(slotForItem("Jewel", "Time-Lost Sapphire")).toBe("jewel:timelostsapphire");
    expect(slotForItem("Jewel", "Timeless Jewel")).toBe("jewel:timeless");
    for (const [b, s] of [["Cobalt Jewel", "cobalt"], ["Crimson Jewel", "crimson"], ["Viridian Jewel", "viridian"], ["Prismatic Jewel", "prismatic"],
      ["Small Cluster Jewel", "cluster"], ["Medium Cluster Jewel", "cluster"], ["Large Cluster Jewel", "cluster"],
      ["Murderous Eye Jewel", "murderouseye"], ["Searching Eye Jewel", "searchingeye"], ["Hypnotic Eye Jewel", "hypnoticeye"], ["Ghastly Eye Jewel", "ghastlyeye"]]) {
      expect(slotForItem("Jewel", b)).toBe(`jewel:${s}`);
    }
    expect(slotForItem("Stackable Currency", "Chaos Orb")).toBeNull();
    expect(slotForItem("Maps", "Crypt Map")).toBeNull();
  });
  it("affix_cap", () => {
    expect([affixCap("Gloves"), affixCap("Amulets"), affixCap("Gloves", "poe1")]).toEqual([3, 3, 3]);
    expect([affixCap("Jewel"), affixCap("Jewels"), affixCap("Jewel", "poe2")]).toEqual([1, 1, 1]);
    expect([affixCap("Jewel", "poe1"), affixCap("Jewels", "poe1")]).toEqual([2, 2]);
  });
});

describe("mod badge: template index and stat id resolution", () => {
  it("groups several templates per stat id and keeps a shared template ambiguous", () => {
    const idx = buildTemplateIndex([
      { stat_id: "explicit.stat_1", template: "#% increased Armour" }, { stat_id: "explicit.stat_1", template: "#% reduced Armour" },
      { stat_id: "explicit.stat_2", template: "# to maximum Life" },
    ]);
    expect(idx.get("#% increased armour")).toEqual(["explicit.stat_1"]);
    expect(idx.get("#% reduced armour")).toEqual(["explicit.stat_1"]);
    expect(idx.get("# to maximum life")).toEqual(["explicit.stat_2"]);
    const amb = buildTemplateIndex([{ stat_id: "explicit.stat_a", template: "#% to Fire Resistance" }, { stat_id: "explicit.stat_b", template: "#% to Fire Resistance" }]);
    expect(new Set(amb.get("#% to fire resistance"))).toEqual(new Set(["explicit.stat_a", "explicit.stat_b"]));
  });
  it("resolve_stat_id: the mod database only - no id there means no id (the hub's dictionary is not used to guess)", () => {
    const db = newBadge();
    db.index(metaPayload({ stat_dictionary: [{ stat_id: "explicit.stat_fallback", template: "# to maximum Life" }] }));
    expect(db.resolveStatId("+47 to maximum Life", "explicit", { findStatId: () => "explicit.stat_3299347043" } as any)).toBe("explicit.stat_3299347043");
    expect(db.resolveStatId("+47 to maximum Life", "explicit", { findStatId: () => null } as any)).toBeNull();
  });
});

describe("mod badge: colours", () => {
  it("red / gold / white by rank or usage, archetype rows with a fallback to all", () => {
    const db = withSample();
    expect(db.badgeColor("s.red_rank", "helmet", "all")).toBe("#FF4444");
    expect(db.badgeColor("s.red_usage", "helmet", "all")).toBe("#FF4444");
    expect(db.badgeColor("s.gold_rank", "helmet", "all")).toBe("#FFB800");
    expect(db.badgeColor("s.white", "helmet", "all")).toBeNull();
    expect(db.badgeColor("s.does_not_exist", "helmet", "all")).toBeNull();
    expect(db.badgeColor("s.melee_only", "helmet", "attack-melee")).toBe("#FF4444");
    expect(db.badgeColor("s.red_rank", "helmet", "attack-melee")).toBe("#FF4444");
  });
  it("custom rules override", () => {
    const db = withSample();
    (db as any).rules = { red: { max_rank: 1, min_usage_pct: 99.0 }, gold: { max_rank: 2, min_usage_pct: 90.0 }, colors: { red: "#111111", gold: "#222222" } };
    expect(db.badgeColor("s.gold_rank", "helmet", "all")).toBeNull();
    expect(db.badgeColor("s.red_rank", "helmet", "all")).toBe("#111111");
  });
  it("mod_badge_rules.json in the config folder overrides the rules", async () => {
    const db = newBadge({ files: { "/cfg/mod_badge_rules.json": JSON.stringify({ red: { max_rank: 1, min_usage_pct: 99.0 }, gold: { max_rank: 2, min_usage_pct: 90.0 }, colors: { red: "#ABCDEF", gold: "#FEDCBA" } }) }, configDir: "/cfg" });
    await db.load("poe2"); // (loads the rules; the hub has nothing)
    db.index(metaPayload({ mods: SAMPLE_MODS }));
    expect(db.badgeColor("s.red_rank", "helmet", "all")).toBe("#ABCDEF");
    expect(db.badgeColor("s.gold_rank", "helmet", "all")).toBeNull();
  });

  describe("green (a tag shared with a red / gold mod)", () => {
    const fakeMeta = (map: Record<string, string[]>) => ({ tagsForTemplate: (t: string) => new Set(map[t] ?? []) }) as any;
    const two = (red: string, white: string, tmplRed = "# to maximum life", tmplWhite = "# to maximum mana") => {
      const db = newBadge();
      db.index(metaPayload({
        mods: [{ slot: "helmet", archetype: "all", stat_id: "s.red_life", rank_in_slot: 1, usage_pct: 60.0 },
          { slot: "helmet", archetype: "all", stat_id: white, rank_in_slot: 50, usage_pct: 1.0 }],
        stat_dictionary: [{ stat_id: "s.red_life", template: tmplRed }, { stat_id: white, template: tmplWhite }],
      }));
      return db;
    };
    it("green when a tag is shared", () => {
      const db = two("", "s.white_mana");
      expect(db.tagColor("s.white_mana", "helmet", "all", fakeMeta({ "# to maximum life": ["life", "resource"], "# to maximum mana": ["mana", "resource"] }))).toBe("#4CAF50");
    });
    it("none without a shared tag", () => {
      const db = two("", "s.white_evasion", "# to maximum life", "# to evasion rating");
      expect(db.tagColor("s.white_evasion", "helmet", "all", fakeMeta({ "# to maximum life": ["life", "resource"], "# to evasion rating": ["evasion", "defences"] }))).toBeNull();
    });
    it("a red mod stays red; no tag data at all gives none", () => {
      const db = withSample();
      expect(db.tagColor("s.red_rank", "helmet", "all", fakeMeta({}))).toBe("#FF4444");
      const db2 = newBadge();
      db2.index(metaPayload({ mods: SAMPLE_MODS, stat_dictionary: [{ stat_id: "s.white", template: "# to something" }] }));
      expect(db2.tagColor("s.white", "helmet", "all", fakeMeta({}))).toBeNull();
    });
    it("matches a hub template with a leading +", () => {
      const db = two("", "s.white_mana", "+# to maximum Life", "+# to maximum Mana");
      expect(db.tagColor("s.white_mana", "helmet", "all", fakeMeta({ "# to maximum life": ["life", "resource"], "# to maximum mana": ["mana", "resource"] }))).toBe("#4CAF50");
    });
  });
});

describe("mod badge: load", () => {
  const hours = (h: number): string => new Date(Date.now() - h * 3600e3).toISOString().replace(/\.\d+Z$/, "Z");
  it("a fresh disk cache is used without asking the hub", async () => {
    const getMeta = vi.fn(async () => { throw new Error("should not hit the network"); });
    const db = newBadge({ files: { "/c/mod_badge_meta_poe2.json": JSON.stringify(metaPayload({ mods: SAMPLE_MODS })) }, cacheDir: "/c", hub: { getMeta } });
    await db.load();
    expect(db.available()).toBe(true);
    expect(db.badgeColor("s.red_rank", "helmet", "all")).toBe("#FF4444");
    expect(getMeta).not.toHaveBeenCalled();
  });
  it("a stale cache is refetched; if the hub is down the stale one is used; with neither it degrades silently", async () => {
    const stale = JSON.stringify(metaPayload({ generated_at: hours(20), mods: [] }));
    const getMeta = vi.fn(async () => metaPayload({ mods: SAMPLE_MODS }));
    const db = newBadge({ files: { "/c/mod_badge_meta_poe2.json": stale }, cacheDir: "/c", hub: { getMeta } });
    await db.load();
    expect(getMeta).toHaveBeenCalledWith("poe2");
    expect(db.badgeColor("s.red_rank", "helmet", "all")).toBe("#FF4444");

    const old = JSON.stringify(metaPayload({ generated_at: hours(20), mods: SAMPLE_MODS }));
    const down = newBadge({ files: { "/c/mod_badge_meta_poe2.json": old }, cacheDir: "/c", hub: { getMeta: async () => null } });
    await down.load();
    expect(down.available()).toBe(true);

    const none = newBadge({ cacheDir: "/c", hub: { getMeta: async () => null } });
    await none.load();
    expect(none.available()).toBe(false);
    expect(none.badgeColor("s.anything", "helmet", "all")).toBeNull();
  });
  it("each game has its own cache file; one instance re-indexes when the game changes", async () => {
    const files: Record<string, string> = {};
    const poe1Mods = [{ slot: "helmet", archetype: "all", stat_id: "s.poe1_only", rank_in_slot: 1, usage_pct: 60.0 }];
    let payload = metaPayload({ mods: poe1Mods });
    const getMeta = vi.fn(async () => payload);
    const db = newBadge({ files, cacheDir: "/c", hub: { getMeta } });
    await db.load("poe1");
    expect(getMeta).toHaveBeenCalledWith("poe1");
    expect(Object.keys(files)).toEqual(["/c/mod_badge_meta_poe1.json"]);
    expect(db.badgeColor("s.poe1_only", "helmet", "all")).toBe("#FF4444");
    payload = metaPayload({ mods: SAMPLE_MODS });
    await db.load("poe2");
    expect(db.badgeColor("s.red_rank", "helmet", "all")).toBe("#FF4444");
    expect(db.badgeColor("s.poe1_only", "helmet", "all")).toBeNull();
  });
});

describe("mod badge: roll arrows", () => {
  it("tier_roll_arrow", () => {
    expect(tierRollArrow([39.0], [[10.0, 40.0]])).toBe("▲");
    expect(tierRollArrow([11.0], [[10.0, 40.0]])).toBe("▼");
    expect(tierRollArrow([25.0], [[10.0, 40.0]])).toBeNull();
    expect(tierRollArrow([39.0, 11.0], [[10.0, 40.0], [10.0, 40.0]])).toBeNull();
    expect(tierRollArrow([25.0], null)).toBeNull();
    expect(tierRollArrow([], [[10.0, 40.0]])).toBeNull();
    expect(tierRollArrow([30.4], [[10.0, 40.0]], 0.25)).toBeNull();
    expect(tierRollArrow([30.4], [[10.0, 40.0]], 0.40)).toBe("▲");
  });
  it("roll_indicator_fallback uses the hub range", () => {
    const db = newBadge();
    db.index(metaPayload({ mods: [{ slot: "helmet", archetype: "all", stat_id: "s.x", rank_in_slot: 50, usage_pct: 1.0, value_min: 10.0, value_max: 40.0 }] }));
    expect(db.rollIndicatorFallback("s.x", "helmet", "all", [39.0])).toBe("▲");
    expect(db.rollIndicatorFallback("s.x", "helmet", "all", [11.0])).toBe("▼");
    expect(db.rollIndicatorFallback("s.x", "helmet", "all", [25.0])).toBeNull();
    const s = withSample();
    expect(s.rollIndicatorFallback("s.does_not_exist", "helmet", "all", [25.0])).toBeNull();
    expect(s.rollIndicatorFallback("s.red_rank", "helmet", "all", [])).toBeNull();
  });
});
