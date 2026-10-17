/** Tiers S / A / B / C / D (test_wl_tier_d.py) and the Flask / Charm rows (test_wl_rarity.py, the model/file part) */
import { describe, expect, it } from "vitest";
import { WlModel, filterGen, filterStyle, filterWhitelist as w, wlEmbed, wlSession } from "../src/index.ts";
import { FLASK_CATEGORY, HIDE, STYLE_LABELS, TIER_CHOICES, ALL_CHOICES } from "../src/wl_model.ts";
import { data, generate, lint, model, readText, tmpDir } from "./helpers.ts";
import * as sim from "./neversink_sim.ts";

const GAMES = ["poe1", "poe2"];
const shown = sim.shown;
const count = (t: string, s: string): number => t.split(s).length - 1;
const blockOf = (text: string, header: string): string => {
  const i = text.indexOf(header);
  expect(i, header).toBeGreaterThanOrEqual(0);
  const j = text.indexOf("\n\n", i);
  return text.slice(i, j > 0 ? j : text.length);
};

/** Names whose first plain block is the (type, tag) step of NeverSink's ladder: the starting tier is that step's. */
function namesOfStep(base: string, ty: string, tag: string): string[] {
  const [lines, blocks] = w.scan(base);
  const first = new Map<string, [string | null, string | null]>();
  for (const b of blocks) {
    const ns = w.exactNames(lines, b);
    const cs = w.conds(lines, b);
    if (!ns.length || w.SPECIAL_CONDITIONS.some((c) => cs.has(c)) || cs.has("Continue")) continue;
    const tg = filterGen.headerTags(lines, b);
    for (const n of ns) if (!first.has(n)) first.set(n, tg);
  }
  return [...first].filter(([, k]) => k[0] === ty && k[1] === tag).map(([n]) => n).sort();
}

const LADDER: [string, string, string, string][] = [
  ["poe1", "currency", "t1exalted", "S"], ["poe1", "currency", "t2divine", "S"], ["poe1", "currency", "t3annul", "A"],
  ["poe1", "currency", "t4chaos", "A"], ["poe1", "currency", "t5alchemy", "B"], ["poe1", "currency", "t6chrom", "B"],
  ["poe1", "currency", "t7chance", "C"], ["poe1", "currency", "t8trans", "C"],
  ["poe2", "currency", "s", "S"], ["poe2", "currency", "a", "S"], ["poe2", "currency", "b", "A"],
  ["poe2", "currency", "c", "A"], ["poe2", "currency", "d", "B"], ["poe2", "currency", "e", "B"],
];

describe("the starting tiers", () => {
  it.each(LADDER)("a ladder step starts at its new tier: %s %s %s", (game, ty, tag, tier) => {
    const base = data(game)[1];
    const names = namesOfStep(base, ty, tag);
    expect(names.length, `${game} ${ty} ${tag}`).toBeGreaterThan(0);
    const d = w.defaultTiers(base);
    expect(names.every((n) => d.get(n) === tier)).toBe(true);
    const m = model(game);
    expect(names.every((n) => m.defaultOf(n) === tier)).toBe(true);
  });

  it.each(GAMES)("a Hide block of NeverSink is tier D and there is no hidden C (%s)", (game) => {
    const base = data(game)[1];
    const d = w.defaultTiers(base);
    const [lines, blocks] = w.scan(base);
    const hideOnly = blocks.filter((b) => b.blockType === "Hide").flatMap((b) => (w.SPECIAL_CONDITIONS.some((c) => w.conds(lines, b).has(c)) ? [] : w.exactNames(lines, b)));
    expect(hideOnly.length).toBeGreaterThan(0);
    expect(hideOnly.every((n) => d.get(n) === "D" || d.get(n) === undefined || "SABC".includes(d.get(n)!))).toBe(true);
    expect([...d.values()]).toContain("D");
    expect([...new Set(d.values())].every((t) => w.ALL_TIERS.includes(t))).toBe(true);
    expect(w.HIDE_TIER).toBe("D");
    expect([...w.TIERS]).toEqual(["S", "A", "B", "C"]);
    expect([...w.ALL_TIERS]).toEqual(["S", "A", "B", "C", "D"]);
  });
});

describe("first match", () => {
  it.each(GAMES)("C shows with its own style between B and the hidden names, D hides (%s)", (game) => {
    const m = model(game);
    const cur = game === "poe1" ? "Divine Orb" : "Chaos Orb";
    m.setRow("Currency", cur, "C");
    const hid = game === "poe1" ? "Orb of Augmentation" : "Orb of Transmutation";
    m.setRow("Currency", hid, "D");
    const text = m.build().text;
    const cls = "Stackable Currency";
    expect(shown(text, cur, cls)).toBe(true);
    const tc = blockOf(text, "# tier C\n");
    expect(tc).toContain(`"${cur}"`);
    expect(tc).toContain("Show");
    for (const line of w.defaultTierLines(m.base_text).C) expect(tc, line).toContain(line.trim()); // the faded preset look of C
    if (text.includes("# tier B\n")) expect(text.indexOf("# tier C\n")).toBeGreaterThan(text.indexOf("# tier B\n"));
    expect(shown(text, hid, cls)).toBe(false);
    expect(text).toContain("# tier D (hidden");
    expect(text.indexOf("# tier C\n")).toBeLessThan(text.indexOf("# tier D (hidden"));
    expect(text).not.toContain("tier C (hidden");
    expect(lint(text, m.base_text)).toEqual([]);
  });

  it("the style and the sound of C are its own", () => {
    const [hub, base] = data("poe1");
    const cfg = { wl_item_tier_poe1: { "Chaos Orb": "C" }, wl_tier_format: 2,
      wl_tier_style: { C: { size: 30, text: [1, 2, 3, 255], sound: { kind: "file", file: "ping-c.mp3" } } } };
    expect(w.soundRequests(cfg).C).toBe("ping-c.mp3");
    const res = w.buildWhitelistFilter("poe1", cfg, base, hub, "", { C: "ping-c.mp3" }, null);
    const tc = blockOf(res.text, "# tier C\n");
    expect(tc).toContain("SetFontSize 30");
    expect(tc).toContain("SetTextColor 1 2 3 255");
    expect(tc).toContain('CustomAlertSoundOptional "ping-c.mp3" 300');
    // the NeverSink tab's numbered sounds are that tab's alone: nothing of them in the whitelist's own look
    const [out, done] = filterGen.applyNumberedSounds('Show # $type->currency $tier->t1\n\tBaseType == "Divine Orb"\n\tPlayAlertSound 6 300\n', { "2": "x.mp3" });
    expect(done).toEqual({});
    expect(out).not.toContain("CustomAlertSoundOptional");
  });

  it("C has its own stack minimum", () => {
    const m = model("poe1");
    m.setRow("Currency", "Chaos Orb", "C");
    m.setTierStack("C", 5);
    const text = m.build().text;
    expect(text).toContain("# tier C - stack >= 5");
    expect(text).toContain("# tier C - smaller stacks hidden");
    expect(m.tier_stack).toEqual({ C: 5 });
    expect(m.toConfig({}).wl_tier_stack).toEqual({ C: 5 });
  });

  it.each(GAMES)("a whole category, typed names and gems follow C and D (%s)", (game) => {
    const m = model(game);
    m.setCategory("Currency", "C");
    expect(m.rows("Currency").every((r) => r.tier === "C")).toBe(true);
    m.setCategory("Currency", "D");
    expect(m.rows("Currency").every((r) => r.tier === "D")).toBe(true);
    expect(m.categoryTier("Currency")).toBe("D");
    m.custom = [{ name: "Rakiata", rarities: ["Rare"], tier: "C" }, { name: "Hidden", rarities: ["Rare"], tier: "D" }];
    const text = m.build().text;
    const seg = blockOf(text, "# typed names");
    expect(text).toContain('BaseType "Rakiata"');
    expect(text).not.toContain('BaseType "Hidden"');
    expect(seg).toContain("tier C");
    m.gem_tier = "C";
    expect(m.cfg().whitelist_gem_tier).toBe("C");
  });

  it.each(GAMES)("equipment and flask rows: C shows and D hides (%s)", (game) => {
    const m = model(game);
    m.setFlaskRarity("Flask", "Magic", "C");
    m.setFlaskRarity("Flask", "Normal", "D");
    const cls = "Life Flasks";
    let text = m.build().text;
    expect(shown(text, "Some Flask", cls, "Magic")).toBe(true);
    expect(shown(text, "Some Flask", cls, "Normal")).toBe(false);
    expect(text).toContain("# rarity: Flask - Magic - tier C");
    expect(text).toContain("# rarity: Flask - Normal - tier D");
    m.setEquipRarity("Boots", "Rare", "C");
    m.setEquipRarity("Boots", "Magic", "D");
    text = m.build().text;
    expect(shown(text, "Some Boots", "Boots", "Rare")).toBe(true);
    expect(shown(text, "Some Boots", "Boots", "Magic")).toBe(false);
    expect(text).toContain("# equipment: Boots - Rare - tier C");
    expect(text).toContain("# equipment: Boots - Magic - tier D");
    expect(blockOf(text, "# equipment: Boots - Rare - tier C")).toContain(w.defaultTierLines(m.base_text).C[0].trim());
  });
});

// ---------------------------------------------------------------- old configs: C was the hidden tier

const OLD = {
  wl_item_tier_poe1: { "Chaos Orb": "C", "Divine Orb": "S" },
  wl_cat_tier_poe1: { Scarab: "C", Currency: "A" },
  wl_unique_tier_poe1: { Headhunter: "C", Mageblood: "B" },
  wl_block_tier_poe1: { "x|t1|1": "C" },
  wl_rarity_rows_poe1: { Flask: { custom: true, tiers: { Normal: "C", Magic: "A" } } },
  wl_equip_rows_poe1: { Boots: { custom: true, tiers: { Normal: "B", Magic: "C", Rare: "S" } } },
  whitelist_gem_tier: "C",
  whitelist_custom_poe1: [{ name: "Coral", rarities: ["Rare"], tier: "C" }, { name: "Ring", rarities: ["Rare"], tier: "A" }],
};

describe("old configs: C was the hidden tier", () => {
  it("an old config has its C turned into D once, with a count; S / A / B are kept", () => {
    const m = WlModel.fromConfig(structuredClone(OLD), "poe1");
    expect(m.item_tier).toEqual({ "Chaos Orb": "D", "Divine Orb": "S" });
    expect(m.cat_tier).toEqual({ Scarab: "D", Currency: "A" });
    expect(m.unique_tier).toEqual({ Headhunter: "D", Mageblood: "B" });
    expect(m.block_tier).toEqual({ "x|t1|1": "D" });
    expect(m.rarity_rows.Flask.tiers).toEqual({ Normal: "D", Magic: "A" });
    expect(m.equip_rows.Boots.tiers).toEqual({ Normal: "B", Magic: "D", Rare: "S" });
    expect(m.gem_tier).toBe("D");
    expect(m.custom.map((e) => [e.name, e.tier])).toEqual([["Coral", "D"], ["Ring", "A"]]);
    const notes = m.takeNotes();
    expect(notes.length).toBe(1);
    expect(notes[0]).toContain("8 ค่า");
    const saved = m.toConfig({});
    expect(saved.wl_tier_format).toBe(w.TIER_FORMAT);
    const again = WlModel.fromConfig(saved, "poe1"); // saved once: nothing is converted twice, no note
    expect(again.takeNotes()).toEqual([]);
    expect(again.item_tier).toEqual(m.item_tier);
    expect(again.gem_tier).toBe("D");
  });

  it("a config of the new format keeps its C", () => {
    const cfg = { wl_tier_format: 2, wl_item_tier_poe2: { "Chaos Orb": "C", "Divine Orb": "D" },
      wl_equip_rows_poe2: { Boots: { custom: true, tiers: { Normal: "B", Rare: "C", Magic: "D" } } }, whitelist_gem_tier: "C" };
    const m = WlModel.fromConfig(cfg, "poe2");
    expect(m.item_tier).toEqual({ "Chaos Orb": "C", "Divine Orb": "D" });
    expect(m.gem_tier).toBe("C");
    expect(m.equip_rows.Boots.tiers.Rare).toBe("C");
    expect(m.takeNotes()).toEqual([]);
    expect(m.toConfig({}).wl_item_tier_poe2).toEqual({ "Chaos Orb": "C", "Divine Orb": "D" });
  });

  it("an empty or S / A / B only old config says nothing", () => {
    for (const cfg of [{}, { wl_item_tier_poe1: { "Chaos Orb": "A" }, wl_cat_tier_poe1: { Currency: "S" } }]) {
      const m = WlModel.fromConfig(cfg, "poe1");
      expect(m.takeNotes()).toEqual([]);
      expect(m.toConfig({}).wl_tier_format).toBe(2);
    }
  });

  it("the hidden default of a legacy whitelist conversion is D", () => {
    const [upd, notes] = WlModel.convertLegacy({ whitelist_cats_poe1: ["Currency"], whitelist_unique_all: false }, "poe1");
    expect(upd.wl_tier_format).toBe(2);
    expect(notes.length).toBeGreaterThan(0);
    expect(new Set(Object.values(upd.wl_cat_tier_poe1))).toEqual(new Set(["D"]));
    expect(upd.wl_cat_tier_poe1.Unique).toBe("D");
  });

  it.each(GAMES)("an old embedded file opens converted and a new one keeps C (%s)", async (game) => {
    const t = tmpDir();
    const d = data(game);
    const cur = new WlModel(game);
    cur.setData(d[0], d[1], d[2]);
    // a file of the build before tier D: its settings have no wl_tier_format and C = hidden
    const old = model(game);
    old.setRow("Currency", "Chaos Orb", "D");
    const fg = old.toConfig({});
    delete fg.wl_tier_format;
    fg[`wl_item_tier_${game}`] = { "Chaos Orb": "C" };
    const oldPath = (await generate(fg, game, t, "old")).path;
    let res = wlSession.openText(readText(oldPath), "old.filter", game, cur, d);
    expect(res.ok).toBe(true);
    expect(res.model!.item_tier).toEqual({ "Chaos Orb": "D" });
    expect(res.messages.some(([, text]) => text.includes("ถูกแปลงเป็น D"))).toBe(true);
    // saved + generated again: the file records the new format and C stays C
    const newPath = (await generate({ ...res.model!.toConfig({}), [`wl_item_tier_${game}`]: { "Chaos Orb": "C" } }, game, t, "new")).path;
    const emb = wlEmbed.extract(readText(newPath))!;
    expect(emb.cfg.wl_tier_format).toBe(2);
    res = wlSession.openText(readText(newPath), "new.filter", game, cur, d);
    expect(res.ok).toBe(true);
    expect(res.model!.item_tier).toEqual({ "Chaos Orb": "C" });
    expect(res.messages.some(([, text]) => text.includes("ถูกแปลงเป็น D"))).toBe(false);
  });

  it("the style labels and tier buttons know C", () => {
    expect(STYLE_LABELS.slice(0, 4)).toEqual(["S", "A", "B", "C"]);
    expect([...TIER_CHOICES]).toEqual(["S", "A", "B", "C"]);
    expect(ALL_CHOICES.at(-1)).toBe("D");
    expect(HIDE).toBe("D");
    const m = model("poe1");
    expect(m.effectiveStyle("C").size).toBe(filterStyle.DEFAULT_STYLES.C.size);
    m.setStyle("C", { size: 31 });
    expect(m.cfg().wl_tier_style.C.size).toBe(31);
  });

  it("toggle unticks into D and ticks back into the active tier", () => {
    const m = model("poe1");
    const tier = () => m.rows("Currency").find((r) => r.key === "Chaos Orb")!.tier;
    m.toggleRow("Currency", "Chaos Orb", "C");
    expect(tier()).toBe("D");
    m.toggleRow("Currency", "Chaos Orb", "C");
    expect(tier()).toBe("C");
  });
});

// ------------------------------------------------------------------------------------------------ test_wl_rarity.py

const ROWS: [string, string, string][] = [["poe1", "Flask", "Life Flasks"], ["poe1", "Flask", "Utility Flasks"], ["poe1", "Tincture", "Tinctures"],
  ["poe2", "Flask", "Life Flasks"], ["poe2", "Flask", "Mana Flasks"], ["poe2", "Charm", "Charms"]];

describe("Flask / Charm / Tincture rows", () => {
  it("the classes used are the ones NeverSink s2 uses in both games", () => {
    for (const [game, rows] of Object.entries(w.RARITY_ROWS)) {
      const base = data(game)[1];
      const inFile = new Set([...base.split("\n").filter((l) => l.trim().startsWith("Class")).join("\n").matchAll(/"([^"]+)"/g)].map((m) => m[1]));
      for (const [, , classes] of rows) for (const c of classes) expect(inFile.has(c), `${game} ${c}`).toBe(true);
    }
    const classes = Object.fromEntries(Object.entries(w.RARITY_ROWS).map(([g, rows]) => [g, rows.map(([r, , c]) => [r, c])]));
    expect(classes.poe1).toEqual([["Flask", ["Life Flasks", "Mana Flasks", "Hybrid Flasks", "Utility Flasks"]], ["Tincture", ["Tinctures"]]]);
    expect(classes.poe2).toEqual([["Flask", ["Life Flasks", "Mana Flasks"]], ["Charm", ["Charms"]]]);
  });

  it.each([["poe1", ["Flask", "Tincture"]], ["poe2", ["Flask", "Charm"]]] as const)("one category with two rows and no block list (%s)", (game, expectIds) => {
    const m = model(game);
    expect(new Map(m.categories()).get(FLASK_CATEGORY)).toBe(game === "poe1" ? "Flask / Tincture" : "Flask / Charm");
    expect(m.flaskRows().map((r) => r.id)).toEqual(expectIds);
    expect(m.rows(FLASK_CATEGORY)).toEqual([]); // no ticking per NeverSink block
    expect(m.flaskRows().every((r) => !r.custom && new Set(Object.values(r.tiers)).size === 1 && Object.values(r.tiers)[0] === "B")).toBe(true);
  });

  it.each(ROWS)("default is NeverSink's blocks and the text has no rarity block (%s %s %s)", (game, row) => {
    const m = model(game);
    expect(m.build().text).not.toContain("# rarity:");
    m.setFlaskCustom(row, true); // "set myself": every rarity starts at B
    const rowD = m.flaskRows().find((r) => r.id === row)!;
    expect(rowD.custom).toBe(true);
    expect(rowD.tiers).toEqual({ Normal: "B", Magic: "B" });
    const text = m.build().text;
    expect(text).toContain(`# rarity: ${row} - Normal - tier B`);
    expect(text).toContain(`# rarity: ${row} - Magic - tier B`);
    expect(count(text, "# rarity:")).toBe(2);
    m.setFlaskCustom(row, false); // back to the default: nothing written
    expect(m.build().text).toBe(model(game).build().text);
  });

  it.each(ROWS)("a rarity set to D hides it and nothing else (%s %s %s)", (game, row, cls) => {
    const m = model(game);
    const plain = m.build().text;
    m.setFlaskCustom(row, true);
    m.setFlaskRarity(row, "Magic", "D");
    const text = m.build().text;
    expect(lint(text, data(game)[1])).toEqual([]);
    expect(sim.probe(text, cls, "Magic")[0]).toBe(false);
    for (const rar of ["Rare", "Unique"]) { // the rarities not in the row: the same block decides
      const [sa, ia] = sim.probe(plain, cls, rar), [sb, ib] = sim.probe(text, cls, rar);
      expect(sa).toBe(sb);
      if (ia >= 0) expect(sim.titles(plain)[ia]).toBe(sim.titles(text)[ib]);
    }
    const other = game === "poe1" ? "Rings" : "Amulets";
    expect(sim.probe(text, other, "Magic")[0]).toBe(sim.probe(plain, other, "Magic")[0]);
  });

  it.each(ROWS)("a rarity set to a tier uses that tier's style and wins over NeverSink's blocks (%s %s %s)", (game, row, cls) => {
    const m = model(game);
    m.setStyleFromEditor("B", { ...m.effectiveStyle("B"), size: 31 });
    m.setFlaskCustom(row, true);
    m.setFlaskRarity(row, "Normal", "B");
    const text = m.build().text;
    const [sh, i] = sim.probe(text, cls, "Normal");
    const ts = sim.titles(text);
    expect(sh).toBe(true);
    expect(ts[i].startsWith("# rarity:") && ts[i].includes("Normal - tier B")).toBe(true);
    const lines = text.split("\n");
    const blk = lines.slice(lines.indexOf(ts[i])).join("\n").split("\n\n")[0];
    expect(blk).toContain("SetFontSize 31");
    expect(blk).toContain("Class == ");
    expect(blk).toContain("Rarity Normal");
    const firstNs = Math.min(...ts.flatMap((t, k) => (t.startsWith("# neversink (") ? [k] : [])));
    expect(i).toBeLessThan(firstNs); // before every block NeverSink wrote
    expect(lint(text, data(game)[1])).toEqual([]);
  });

  it("a Normal charm at B and flasks stay NeverSink's; the rows are independent", () => {
    const m = model("poe2");
    m.setFlaskCustom("Charm", true);
    m.setFlaskRarity("Charm", "Normal", "B");
    const text = m.build().text, plain = model("poe2").build().text;
    const pc = sim.probe(text, "Charms", "Normal");
    expect(pc[0]).toBe(true);
    expect(sim.titles(text)[pc[1]]).toBe("# rarity: Charm - Normal - tier B");
    for (const rar of ["Normal", "Magic", "Rare"]) { // the Flask row was never set: its classes follow NeverSink exactly as before
      const a = sim.probe(plain, "Life Flasks", rar), b = sim.probe(text, "Life Flasks", rar);
      expect(a[0]).toBe(b[0]);
      expect(a[1] < 0 || sim.titles(plain)[a[1]] === sim.titles(text)[b[1]]).toBe(true);
    }
    expect(text).toContain('Class == "Charms"');
    expect(text.split("# neversink (")[0]).not.toContain('Class == "Life Flasks"');
  });

  it("unique flasks and jewels are not touched", () => {
    const m = model("poe1");
    m.setFlaskCustom("Flask", true);
    for (const rar of ["Normal", "Magic", "Rare"]) m.setFlaskRarity("Flask", rar, "D");
    const text = m.build().text;
    const flaskBase = m._entries.find(([, b]) => b.endsWith("Flask"))![1];
    const [sh, i] = sim.probe(text, "Utility Flasks", "Unique", flaskBase);
    expect(sh).toBe(true);
    expect(sim.titles(text)[i].startsWith("# uniques")).toBe(true); // unique flasks go by the Unique category
    expect(text.split("\n\n").filter((b) => b.startsWith("# rarity:")).every((b) => !b.includes("Rarity Unique"))).toBe(true);
    const plain = model("poe1").build().text; // jewels have no rarity setting any more: NeverSink's blocks decide
    for (const rar of ["Normal", "Magic", "Rare"]) {
      const a = sim.probe(plain, "Jewels", rar), b = sim.probe(text, "Jewels", rar);
      expect(a[0]).toBe(b[0]);
      expect(a[1] < 0 || sim.titles(plain)[a[1]] === sim.titles(text)[b[1]]).toBe(true);
    }
  });

  it("going back to the default keeps the values but does not write them", () => {
    const m = model("poe2");
    m.setFlaskCustom("Flask", true);
    m.setFlaskRarity("Flask", "Magic", "D");
    expect(m.build().text).toContain("# rarity:");
    m.setFlaskCustom("Flask", false);
    expect(m.build().text).not.toContain("# rarity:");
    expect(m.flaskRows()[0].tiers.Magic).toBe("D");
    expect(m.flaskRows()[0].custom).toBe(false); // remembered
    const cfg_ = m.toConfig({});
    expect(cfg_.wl_rarity_rows_poe2.Flask).toEqual({ custom: false, tiers: { Normal: "B", Magic: "D" } });
    const back = WlModel.fromConfig(cfg_, "poe2");
    const d = data("poe2");
    back.setData(d[0], d[1], d[2]);
    expect(back.flaskRows()[0].tiers.Magic).toBe("D");
    back.setFlaskCustom("Flask", true); // the way back: the value is there
    expect(back.build().text).toContain("tier D");
    expect(back.flaskRows()[0].tiers.Magic).toBe("D");
    back.setFlaskRarity("Flask", "Magic", null); // "NeverSink" is not a choice of a rarity any more
    expect(back.flaskRows()[0].tiers.Magic).toBe("D");
    back.setFlaskCustom("Flask", false);
    expect(back.build().text).not.toContain("# rarity:");
  });

  it("the Flask category buttons", () => {
    const m = model("poe1");
    m.setFlaskCustom("Flask", true);
    m.setFlaskRarity("Tincture", "Normal", "A"); // a rarity set = "set myself"
    expect(m.changedCount(FLASK_CATEGORY)).toBe(2);
    m.setCategory(FLASK_CATEGORY, "S"); // nothing to tier as a whole
    expect(m.changedCount(FLASK_CATEGORY)).toBe(2);
    m.resetCategory(FLASK_CATEGORY);
    expect(m.rarity_rows).toEqual({});
    expect(m.changedCount(FLASK_CATEGORY)).toBe(0);
  });

  it.each(GAMES)("old flask rarity becomes set-myself and jewel rarity is dropped, with notes (%s)", (game) => {
    const old = { [`wl_rarity_tier_${game}`]: { "gear:flask": { Magic: "D", Normal: "B" }, "gear:jewel": { Rare: "S" } },
      [`wl_cat_tier_${game}`]: { "gear:story": "D", "gear:flask": "A", "gear:jewel": "S", Currency: "S" },
      [`wl_block_tier_${game}`]: { [(game === "poe1" ? "endgameflasks" : "endgame->flasks") + "|t1|1"]: "D", "leveling->flasks|x|1": "A" },
      [`wl_class_tier_${game}`]: { "Vault Keys": "D" } };
    const m = WlModel.fromConfig(old, game);
    const d = data(game);
    m.setData(d[0], d[1], d[2]);
    const rows = m.flaskRows();
    expect(rows.every((r) => r.custom && r.tiers.Magic === "D" && r.tiers.Normal === "B" && Object.keys(r.tiers).length === 2)).toBe(true); // the old box covered every flask / charm class
    expect(m.cat_tier).toEqual({ Currency: "S" }); // the cut categories' tiers are gone
    const notes = m.takeNotes().join(" ");
    for (const s of ["Jewel (rarity)", "กุญแจ/ของพิเศษ", "เนื้อเรื่อง", "Flask / Charm (ทั้งหมวด)", 'แปลงเป็น "ตั้งค่าเอง"']) expect(notes).toContain(s);
    const cfg_ = m.toConfig({});
    expect(`wl_rarity_tier_${game}` in cfg_).toBe(false);
    expect(`wl_class_tier_${game}` in cfg_).toBe(false);
    expect(cfg_[`wl_block_tier_${game}`]).toEqual({});
    const again = WlModel.fromConfig(cfg_, game); // saved once: the notes do not come back
    again.setData(d[0], d[1], d[2]);
    expect(again.takeNotes()).toEqual([]);
  });

  it("a row that was never set stays the default and the new layout round-trips", async () => {
    const m = model("poe2");
    m.setFlaskCustom("Charm", true);
    m.setFlaskRarity("Charm", "Normal", "B");
    const fg = m.toConfig({});
    expect(fg.wl_rarity_rows_poe2).toEqual({ Charm: { custom: true, tiers: { Normal: "B", Magic: "B" } } });
    const junk = { ...fg, wl_rarity_rows_poe2: { Charm: { custom: true, tiers: { Unique: "D", Magic: "Z", Rare: "A" } }, Nope: { custom: true } } };
    const got = WlModel.fromConfig(junk, "poe2");
    expect(got.rarity_rows).toEqual({ Charm: { custom: true, tiers: { Normal: "B", Magic: "B" } } }); // Rare skipped, rest B
    const notes = got.takeNotes().join(" ");
    expect(notes).toContain("Rare");
    expect(notes).toContain("ตาม NeverSink");
    const p = (await generate(fg, "poe2", tmpDir(), "rows")).path;
    const text = readText(p);
    expect(wlEmbed.extract(text)!.cfg.wl_rarity_rows_poe2).toEqual(fg.wl_rarity_rows_poe2);
    const out = wlSession.openText(text, p.split(/[\\/]/).pop()!, "poe2", model("poe2"), data("poe2"));
    expect(out.ok).toBe(true);
    expect(out.model!.flaskRows()[1].custom).toBe(true);
    expect(out.model!.flaskRows()[0].custom).toBe(false);
  });

  // ---- no Rare box: flasks / charms / tinctures are never Rare
  it.each([["poe1", "Flask"], ["poe1", "Tincture"], ["poe2", "Flask"], ["poe2", "Charm"]])("no Rare choice and an old embedded Rare is skipped with a note (%s %s)", (game, row) => {
    const m = model(game);
    m.setFlaskCustom(row, true);
    m.setFlaskRarity(row, "Rare", "S"); // not offered any more: ignored
    expect(m.flaskRows().every((r) => Object.keys(r.tiers).length === 2 && "Normal" in r.tiers && "Magic" in r.tiers)).toBe(true);
    expect(m.build().text.split("# neversink (")[0]).not.toContain("Rarity Rare");
    const old = { [`wl_rarity_rows_${game}`]: { [row]: { custom: true, tiers: { Rare: "S", Magic: "D" } } } };
    const got = WlModel.fromConfig(old, game);
    const d = data(game);
    got.setData(d[0], d[1], d[2]);
    expect(got.rarity_rows).toEqual({ [row]: { custom: true, tiers: { Normal: "B", Magic: "D" } } });
    const notes = got.takeNotes().join(" ");
    expect(notes).toContain("Rare");
    expect(notes).toContain("ข้ามค่า");
    const text = got.build().text;
    expect(text.split("# neversink (")[0]).not.toContain("Rarity Rare");
    expect(text).toContain("Rarity Magic");
  });

  it("a clean file has no Rare note", () => {
    const got = WlModel.fromConfig({ wl_rarity_rows_poe2: { Flask: { custom: true, tiers: { Magic: "D", Normal: "A" } } } }, "poe2");
    const d = data("poe2");
    got.setData(d[0], d[1], d[2]);
    expect(got.takeNotes()).toEqual([]);
    expect(got.rarity_rows.Flask.tiers).toEqual({ Magic: "D", Normal: "A" });
  });

  it("an old set-myself row with a NeverSink rarity becomes B with a status note", () => {
    const old = { wl_rarity_rows_poe2: { Flask: { custom: true, tiers: { Magic: "D" } } },
      wl_equip_rows_poe2: { Boots: { custom: true, tiers: { Rare: "S" } }, Wands: { custom: false, tiers: { Rare: "A" } } } };
    const got = WlModel.fromConfig(old, "poe2");
    const d = data("poe2");
    got.setData(d[0], d[1], d[2]);
    expect(got.rarity_rows.Flask).toEqual({ custom: true, tiers: { Magic: "D", Normal: "B" } });
    expect(got.equip_rows.Boots).toEqual({ custom: true, tiers: { Rare: "S", Normal: "B", Magic: "B" } });
    expect(got.equip_rows.Wands).toEqual({ custom: false, tiers: { Rare: "A" } }); // a default row: nothing converted
    const notes = got.takeNotes();
    expect(notes.length).toBe(1);
    expect(notes[0]).toContain("ตาม NeverSink");
    expect(notes[0]).toContain("B");
    const again = WlModel.fromConfig(got.toConfig({}), "poe2"); // saved once: the note does not come back
    expect(again.takeNotes()).toEqual([]);
  });
});
