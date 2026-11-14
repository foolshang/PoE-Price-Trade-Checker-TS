/** GGG's item names as the 4th source of the whitelist's universe (packages/core/src/ggg_names.ts, docs/GGG_CATEGORY_MAP.md). */
import { describe, expect, it } from "vitest";
import { WlModel, filterCore, filterGen, filterWhitelist as w, gggNames as g, tradeNames } from "../src/index.ts";
import type { FsPort, HttpPort } from "../src/index.ts";
import { appGenerate, readLf } from "./app_path.ts";
import { data, model, tmpDir } from "./helpers.ts";
import path from "node:path";

/** the `# tier X` header of the block that lists `"name"` (the names of a tier are split over several blocks) */
const tierOf = (text: string, name: string): string | null => {
  const b = text.split("\n\n").find((x) => x.includes(`"${name}"`));
  return b ? b.split("\n")[0] : null;
};

const payload = (groups: Record<string, any[]>): any => ({ result: Object.entries(groups).map(([id, entries]) => ({ id, label: id, entries })) });
const t = (...names: string[]): any[] => names.map((type) => ({ type }));

describe("payload, snapshot", () => {
  it("groups keep GGG's strings per group; their union = namesFromPayload (name, type, text)", () => {
    const p = payload({ currency: [{ type: "Chaos Orb" }, { name: "Foo", type: "Bar" }, { text: "Baz" }], card: t("The Doctor") });
    const groups = g.groupsFromPayload(p);
    expect(groups).toEqual({ currency: ["Bar", "Baz", "Chaos Orb", "Foo"], card: ["The Doctor"] });
    expect(g.namesOfGroups(groups)).toEqual(tradeNames.namesFromPayload(p));
    expect(g.groupsFromPayload(null)).toEqual({});
  });

  it("both forms are read: the old list gives names only, format 2 gives groups and assigned; garbage gives null", () => {
    const old = g.parseSnapshot(["A", "B", "A"]);
    expect([...old!.names].sort()).toEqual(["A", "B"]);
    expect(old!.snapshot).toBeNull();
    const text = g.snapshotJson({ currency: ["B", "A"] }, { Z: "Currency", A: "Fragment" });
    expect(text.indexOf('"A"')).toBeLessThan(text.indexOf('"Z"')); // assigned sorted: a refresh diff stays small
    const now = g.parseSnapshot(JSON.parse(text));
    expect([...now!.names].sort()).toEqual(["A", "B"]);
    expect(now!.snapshot!.assigned).toEqual({ A: "Fragment", Z: "Currency" });
    for (const bad of [null, 5, "x", {}, [], { format: 2 }, { format: 3, groups: { a: ["x"] } }, { format: 2, groups: { a: [] } }]) expect(g.parseSnapshot(bad)).toBeNull();
  });
});

describe("rules: group + name -> category", () => {
  it.each([
    ["poe1", "card", "The Doctor", "DivinationCard"],
    ["poe1", "currency", "Abyssal Delirium Orb", "DeliriumOrb"], ["poe1", "currency", "Delirium Orb", "DeliriumOrb"],
    ["poe1", "currency", "Clear Oil", "Oil"], ["poe1", "currency", "Jagged Fossil", "Fossil"],
    ["poe1", "currency", "Primitive Alchemical Resonator", "Resonator"],
    ["poe1", "currency", "Screaming Essence of Greed", "Essence"], ["poe1", "currency", "Remnant of Corruption", "Essence"],
    ["poe1", "currency", "Lesser Black Scythe Artifact", "Artifact"],
    ["poe1", "currency", "Splinter of Xoph", "Fragment"], ["poe1", "currency", "Timeless Karui Splinter", "Fragment"],
    ["poe1", "map", "Rusted Abyss Scarab", "Scarab"], ["poe1", "map", "Scarab of Wisps", "Scarab"], ["poe1", "currency", "Veiled Scarab", "Scarab"],
    ["poe1", "map", "Xoph's Breachstone", "Fragment"], ["poe1", "map", "Ancient Reliquary Key", "Fragment"], ["poe1", "map", "Eber's Key", "Fragment"],
    ["poe1", "map", "Unrelenting Timeless Vaal Emblem", "Fragment"], ["poe1", "map", "Sacrifice at Dusk", "Fragment"],
    ["poe2", "currency", "Omen of Recombination", "Omen"], ["poe2", "currency", "Soul Core of Vizoma", "SoulCore"],
    ["poe2", "currency", "Desert Rune", "Rune"], ["poe2", "currency", "Greater Essence of Abrasion", "Essence"],
    ["poe2", "currency", "Sun Artifact", "Artifact"], ["poe2", "map", "Primary Calamity Fragment", "Fragment"],
    ["poe2", "currency", "Zarokh's Reliquary Key: Temporalis", "Fragment"],
  ])("%s %s %s -> %s", (game, group, name, cat) => {
    expect(g.categoryByRule(game, group, name)).toBe(cat);
  });

  it.each([
    ["poe1", "currency", "Blessing of Chayula"], ["poe1", "currency", "Simple Rope Net"], ["poe1", "currency", "Exalted Shard"],
    ["poe1", "map", "Shaper Guardian Map"], ["poe1", "map", "Blighted Map (Strand)"], ["poe1", "armour", "Clear Oil"],
    ["poe2", "map", "Waystone (Tier 3)"], ["poe2", "map", "Test of Will Barya"], ["poe2", "currency", "Legacy of Ashrend"],
    ["poe2", "gem", "Soul Core of Vizoma"], ["poe1", "currency", "Omen of Revenge"], // poe1 has no Omen category
  ])("no rule: %s %s %s", (game, group, name) => {
    expect(g.categoryByRule(game, group, name)).toBeNull();
  });

  it("a bad name ([DNT], INCOMPLETE ...) is never classified, by rule or as a new name", () => {
    expect(g.categoryByRule("poe2", "currency", "[DNT] Omen of Testing")).toBeNull();
    const added = g.addedNames("poe2", { currency: ["[DNT] Omen of Testing", "[DNT] Foo", "Omen of Real"] }, { groups: { currency: ["Omen of Old"] }, assigned: {} });
    expect([...added]).toEqual([["Omen of Real", "Omen"]]);
  });
});

describe("old / new names no rule fits", () => {
  const base: g.Snapshot = { groups: { currency: ["Old Thing", "Chaos Orb"], map: ["Old Map Piece"] }, assigned: { "Kept Thing": "Currency" } };
  const live = { currency: ["Old Thing", "Chaos Orb", "New Thing", "Kept Thing", "NewCamelId"], map: ["Old Map Piece", "New Key Piece", "New Map", "Waystone (Tier 99)", "New Tablet"], card: ["A Card"] };

  it("an OLD name is not added; a NEW one goes to the main category of its group; a recorded one keeps its category", () => {
    const added = g.addedNames("poe1", live, base);
    expect(added.get("Old Thing")).toBeUndefined();
    expect(added.get("Old Map Piece")).toBeUndefined();
    expect(added.get("New Thing")).toBe("Currency");
    expect(added.get("New Key Piece")).toBe("Fragment"); // the map group's main category
    expect(added.get("Kept Thing")).toBe("Currency");
    expect(added.get("A Card")).toBe("DivinationCard"); // by rule, and it is new too
  });

  it("maps, waystones, tablets and internal ids are never a new item", () => {
    const added = g.addedNames("poe1", live, base);
    for (const n of ["New Map", "Waystone (Tier 99)", "New Tablet", "NewCamelId"]) expect(added.has(n)).toBe(false);
  });

  it("without a baseline only the rules apply (nothing is 'new')", () => {
    const added = g.addedNames("poe1", live, null);
    expect([...added.keys()].sort()).toEqual(["A Card"]);
  });

  it("a group of no whitelist item is not looked at; a category the game has no list for is not added", () => {
    expect(g.addedNames("poe1", { armour: ["Clear Oil", "Brand New Boots"] }, base).size).toBe(0);
    expect(g.addedNames("poe1", { currency: ["Omen of Revenge"] }, { groups: { currency: ["x"] }, assigned: {} }).get("Omen of Revenge")).toBe("Currency"); // new, no rule: Currency
    expect(g.addedNames("poe2", { map: ["Barya of X"] }, { groups: { map: ["y"] }, assigned: {} }).get("Barya of X")).toBe("Fragment");
  });

  it("the next snapshot remembers what was added as new; it survives the refresh that includes it", () => {
    const prev = g.parseSnapshot(JSON.parse(g.snapshotJson(base.groups, base.assigned)))!;
    const assigned1 = g.nextAssigned("poe1", live, prev);
    expect(assigned1).toEqual({ "Kept Thing": "Currency", "New Thing": "Currency", "New Key Piece": "Fragment" }); // rule names (A Card) need no record
    const snap1 = g.parseSnapshot(JSON.parse(g.snapshotJson(live, assigned1)))!;
    // a later refresh: "New Thing" is old now, but it is still added; one that left GGG's data is forgotten
    const live2 = { ...live, currency: live.currency.filter((n) => n !== "Kept Thing").concat("Newer Thing") };
    const assigned2 = g.nextAssigned("poe1", live2, snap1);
    expect(assigned2).toEqual({ "New Thing": "Currency", "New Key Piece": "Fragment", "Newer Thing": "Currency" });
    const added = g.addedNames("poe1", live2, g.parseSnapshot(JSON.parse(g.snapshotJson(live2, assigned2)))!.snapshot);
    expect(added.get("New Thing")).toBe("Currency");
    expect(added.get("Newer Thing")).toBe("Currency"); // it is in the snapshot now, recorded
    expect(added.get("Old Thing")).toBeUndefined(); // an old name stays out
  });

  it("the first refresh from the old form (names only) records only what that list lacked", () => {
    const prev = g.parseSnapshot(["Old Thing", "Chaos Orb"])!;
    expect(g.nextAssigned("poe1", { currency: ["Old Thing", "Chaos Orb", "Fresh"] }, prev)).toEqual({ Fresh: "Currency" });
    expect(g.nextAssigned("poe1", { currency: ["Fresh"] }, null)).toEqual({}); // no previous snapshot: nothing is known to be new
  });
});

describe("universe: the 4th source", () => {
  const [hub, base] = data("poe1");

  it("adds only names none of hub / NeverSink has, last, with GGG's own string; the others keep their category", () => {
    const plain = w.universe("poe1", hub, base);
    const exist = [...plain.keys()][0];
    const ggg = new Map([[exist, "Fragment"], ["Brand New Divination Card", "DivinationCard"], ["Not A List Item", "Gear"], ["[DNT] Hidden", "Currency"]]);
    const { names, gggOnly } = w.universeWithSources("poe1", hub, base, ggg);
    expect(names.get(exist)).toBe(plain.get(exist));
    expect(names.get("Brand New Divination Card")).toBe("DivinationCard");
    expect([...gggOnly]).toEqual(["Brand New Divination Card"]); // not-a-category and bad names stay out
    expect(names.size).toBe(plain.size + 1);
    expect([...names.keys()].slice(0, plain.size)).toEqual([...plain.keys()]); // the first three sources keep their order
    expect(w.universe("poe1", hub, base, null)).toEqual(plain);
  });
});

describe("tier and the filter text", () => {
  const added = new Map([["Zzz Test Card", "DivinationCard"], ["Zzz Test Scarab", "Scarab"], ["Zzz Test Currency", "Currency"]]);
  const build = (cfg: Record<string, any>, a: ReadonlyMap<string, string> | null = added) => {
    const [hub, base] = data("poe1");
    return w.buildWhitelistFilter("poe1", cfg, base, hub, "", {}, null, a);
  };

  it("no tier is set: the names are listed (shown as D) but not written, and the result says so", () => {
    const res = build({});
    expect(res.text).not.toContain("Zzz Test");
    expect(res.ggg).toEqual({ added: 3, unset: 3, written: {} });
    expect(res.skipped.some(([n]) => n.startsWith("Zzz"))).toBe(false);
  });

  it("a category tier writes every name of the category, per category counted; an item tier writes that item", () => {
    const res = build({ wl_cat_tier_poe1: { DivinationCard: "A" }, wl_item_tier_poe1: { "Zzz Test Scarab": "S" } });
    expect(tierOf(res.text, "Zzz Test Card")).toBe("# tier A");
    expect(tierOf(res.text, "Zzz Test Scarab")).toBe("# tier S");
    expect(res.text).not.toContain("Zzz Test Currency");
    expect(res.ggg).toEqual({ added: 3, unset: 1, written: { DivinationCard: 1, Scarab: 1 } });
  });

  it("an item set to D by the player is written as hidden (D is a choice, not the unset default)", () => {
    const res = build({ wl_item_tier_poe1: { "Zzz Test Currency": "D" } });
    expect(res.text).toContain('"Zzz Test Currency"');
    expect(res.ggg!.written).toEqual({ Currency: 1 });
  });

  it("every added name passes the real-name check (nothing skipped) once it is written", () => {
    const cats = Object.fromEntries(["DivinationCard", "Scarab", "Currency"].map((c) => [c, "B"]));
    const res = build({ wl_cat_tier_poe1: cats });
    for (const n of added.keys()) expect(res.text).toContain(`"${n}"`);
    expect(res.skipped.filter(([n]) => added.has(n))).toEqual([]);
  });

  it("without GGG's names the result has no `ggg` and the text equals the old output", () => {
    const [hub, base, names] = data("poe1");
    const old = w.buildWhitelistFilter("poe1", {}, base, hub, "", {}, names);
    const same = w.buildWhitelistFilter("poe1", {}, base, hub, "", {}, names, null);
    expect(same.text).toBe(old.text);
    expect("ggg" in same).toBe(false);
  });

  it("buildFilterText logs how many GGG names were written, per category", async () => {
    const [hub, base, names] = data("poe1");
    const logs: string[] = [];
    const cfg = { whitelist_enabled: true, wl_v2: true, wl_cat_tier_poe1: { DivinationCard: "A" } };
    await filterCore.buildFilterText(cfg, "poe1", { hubData: hub, baseText: base, extraNames: names, gggAdded: added, log: (m) => void logs.push(m) });
    expect(logs.find((l) => l.includes("GGG"))).toBe("ℹ ชื่อจาก GGG ที่เติมในรายการ 3 ชื่อ · เขียนลง filter 1 ชื่อ (DivinationCard 1) · 2 ชื่อยังไม่ได้ตั้ง tier (ไม่เขียน)");
    const quiet: string[] = [];
    await filterCore.buildFilterText(cfg, "poe1", { hubData: hub, baseText: base, extraNames: names, log: (m) => void quiet.push(m) });
    expect(quiet.some((l) => l.includes("GGG"))).toBe(false);
  });

  it("the path the programs take (api.generate, a file in the game folder): the log line and the names in the file; a golden-like run has neither", async () => {
    const [hub, base, names] = data("poe1");
    const run = async (extra: Record<string, any>) => {
      const lines: string[] = [];
      const res = await appGenerate({ fg: { wl_v2: true, wl_cat_tier_poe1: { DivinationCard: "S" }, filter_name_whitelist: "g" }, game: "poe1", mode: "whitelist",
        gameDir: path.join(tmpDir(), "game"), base: [base, "t"], hub, names, log: (m) => void lines.push(m), ...extra });
      return { res, lines };
    };
    const withGgg = await run({ added: Object.fromEntries(added) });
    expect(withGgg.res.status).toBe("ok");
    expect(readLf(withGgg.res.path!)).toContain('"Zzz Test Card"');
    expect(withGgg.lines.some((l) => l.includes("เขียนลง filter 1 ชื่อ (DivinationCard 1)"))).toBe(true);
    const plain = await run({});
    expect(readLf(plain.res.path!)).not.toContain("Zzz Test");
    expect(plain.lines.some((l) => l.includes("GGG"))).toBe(false);
  });

  it("the Whitelist tab lists the names with default D, a category tier moves them, an item row can be reset", () => {
    const [hub, base, names] = data("poe1");
    const m = WlModel.fromConfig({}, "poe1");
    m.setData(hub, base, names, added);
    const row = (n: string) => m.rows("DivinationCard").find((r) => r.key === n)!;
    expect(row("Zzz Test Card").tier).toBe("D");
    expect(row("Zzz Test Card").default).toBe("D");
    m.setCategory("DivinationCard", "A");
    expect(row("Zzz Test Card").tier).toBe("A");
    expect(tierOf(m.build().text, "Zzz Test Card")).toBe("# tier A");
  });
});

// ------------------------------------------------------------------------------------------------ the cache of the desktop

const mem = (files: Record<string, { text: string; mtime: number }>): FsPort => ({
  join: (...p: string[]) => p.join("/"), basename: (p: string) => p.split("/").pop()!,
  exists: async (p: string) => p in files, isFile: async (p: string) => p in files, isDir: async () => true,
  readText: async (p: string) => files[p].text, writeText: async (p: string, text: string) => { files[p] = { text, mtime: NOW }; },
  mkdirp: async () => {}, listDir: async () => [], mtimeSec: async (p: string) => files[p].mtime,
} as unknown as FsPort);
const NOW = 2_000_000_000;
const http = (body: string | Error, calls: string[] = []): HttpPort => ({
  getText: async (url: string) => { calls.push(url); if (body instanceof Error) throw body; return body; },
});
const env = (fs: FsPort, h: HttpPort) => ({ fs, http: h, now: () => NOW });
const PATH = "cache/trade_items_poe1.json";
const DAY = 86400;

describe("tradeNames.getItems (the 7-day cache of the desktop)", () => {
  const fresh = JSON.stringify(payload({ currency: t("Chaos Orb"), card: t("The Doctor") }));

  it("fetches GGG, returns names + groups, writes the cache in format 2", async () => {
    const files: Record<string, any> = {};
    const r = await tradeNames.getItems("poe1", "cache", env(mem(files), http(fresh)));
    expect([...r.names].sort()).toEqual(["Chaos Orb", "The Doctor"]);
    expect(r.groups).toEqual({ currency: ["Chaos Orb"], card: ["The Doctor"] });
    expect(JSON.parse(files[PATH].text)).toEqual({ format: 2, groups: r.groups, assigned: {} });
  });

  it("a cache under 7 days old is used without asking GGG (format 2: groups too)", async () => {
    const files = { [PATH]: { text: g.snapshotJson({ currency: ["A"] }, {}), mtime: NOW - 6 * DAY } };
    const calls: string[] = [];
    const r = await tradeNames.getItems("poe1", "cache", env(mem(files), http(fresh, calls)));
    expect(calls).toEqual([]);
    expect([...r.names]).toEqual(["A"]);
    expect(r.groups).toEqual({ currency: ["A"] });
  });

  it("the OLD cache (names only) still gives the names for the check, no groups, until it is due; then it is replaced", async () => {
    const files: Record<string, any> = { [PATH]: { text: JSON.stringify(["Old A", "Old B"]), mtime: NOW - 2 * DAY } };
    const calls: string[] = [];
    const r = await tradeNames.getItems("poe1", "cache", env(mem(files), http(fresh, calls)));
    expect(calls).toEqual([]);
    expect([...r.names].sort()).toEqual(["Old A", "Old B"]);
    expect(r.groups).toBeNull();
    files[PATH].mtime = NOW - 8 * DAY;
    const r2 = await tradeNames.getItems("poe1", "cache", env(mem(files), http(fresh, calls)));
    expect(calls.length).toBe(1);
    expect(r2.groups).not.toBeNull();
    expect(JSON.parse(files[PATH].text).format).toBe(2);
  });

  it("GGG cannot be reached: a due cache (either form) is still used for the check and is not deleted", async () => {
    for (const text of [JSON.stringify(["Old A"]), g.snapshotJson({ currency: ["Old A"] }, {})]) {
      const files: Record<string, any> = { [PATH]: { text, mtime: NOW - 30 * DAY } };
      const r = await tradeNames.getItems("poe1", "cache", env(mem(files), http(new Error("down"))));
      expect([...r.names]).toEqual(["Old A"]);
      expect(files[PATH].text).toBe(text);
    }
    const none = await tradeNames.getItems("poe1", "cache", env(mem({}), http(new Error("down"))));
    expect(none.names.size).toBe(0);
  });

  it("an unreadable cache is ignored (no crash), an empty payload does not overwrite it", async () => {
    const files: Record<string, any> = { [PATH]: { text: "{not json", mtime: NOW - 30 * DAY } };
    const r = await tradeNames.getItems("poe1", "cache", env(mem(files), http(JSON.stringify({ result: [] }))));
    expect(r.names.size).toBe(0);
    expect(files[PATH].text).toBe("{not json");
  });
});

describe("the data a game really has", () => {
  it.each(["poe1", "poe2"])("every category a rule gives is a whitelist category of %s", (game) => {
    const wanted = new Set(filterGen.WHITELIST_CATEGORIES[game]);
    for (const cat of Object.values(g.GROUP_MAIN[game])) expect(wanted.has(cat)).toBe(true);
    const groups = g.groupsFromPayload(payload({ currency: t("Clear Oil", "Omen of X", "Sun Artifact"), card: t("The Doctor"), map: t("Foo Scarab") }));
    for (const cat of g.addedNames(game, groups, null).values()) expect(wanted.has(cat)).toBe(true);
  });

  it("the shipped model with GGG names: a golden-like run (no GGG) is unchanged", () => {
    const m = model("poe1");
    expect(m.ggg_added).toBeNull();
  });
});
