/** Equipment by class and the `==` rule (test_wl_equip.py, the model / file part) */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { WlModel, filterGen, filterWhitelist as w, wlEmbed, wlSession } from "../src/index.ts";
import { EQUIP_CATEGORY } from "../src/wl_model.ts";
import { data, generate, lint, model, readText, tmpDir } from "./helpers.ts";
import * as sim from "./neversink_sim.ts";

const GAMES = ["poe1", "poe2"];
const META = JSON.parse(readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data", "mod_meta.json"), "utf-8")).bases;
const META_CLASS: Record<string, string> = { Boots: "Boots", Gloves: "Gloves", Helmets: "Helmet", Rings: "Ring", Wands: "Wand", Quivers: "Quiver" };
const eqItem = (base: string, cls: string, rarity: string, ilvl = 86, area = 70, quality = 0) => sim.item({ base, cls, rarity, ilvl, area, quality, drop: ilvl });

/** Real bases of the class: the names NeverSink lists with it, plus the RePoE bases (mod_meta.json) of that class. */
function classNames(game: string, cls: string): string[] {
  const out = new Set<string>([...sim.nameClasses(data(game)[1])].filter(([, c]) => c === cls).map(([n]) => n));
  for (const [n, v] of Object.entries<any>(META)) if (v.class === META_CLASS[cls]) out.add(n);
  return [...out].sort();
}

function visibleSet(text: string, game: string, cls: string, rarity: string, o: { ilvl?: number; area?: number } = {}): Set<string> {
  const blocks = sim.parseBlocks(text);
  return new Set([...classNames(game, cls), "Zzz Unknown Base"].filter((n) => sim.visible(blocks, eqItem(n, cls, rarity, o.ilvl, o.area))[0]));
}

function sameDecision(a: string, b: string, cls: string, rarity: string, base = "Zzz Unknown Base"): boolean {
  const x = sim.probe(a, cls, rarity, base), y = sim.probe(b, cls, rarity, base);
  return x[0] === y[0] && (x[1] < 0 || sim.titles(a)[x[1]] === sim.titles(b)[y[1]]);
}
const count = (t: string, s: string): number => t.split(s).length - 1;
const groupsOf = (game: string): Record<string, string[]> => Object.fromEntries(w.equipGroups(game).map(([g, , cs]) => [g, cs]));

describe("structure", () => {
  it("groups are weapon, armour, jewellery, other and quivers are weapons", () => {
    for (const game of GAMES) {
      const g = groupsOf(game);
      expect(Object.keys(g)).toEqual(["weapon", "armour", "jewellery", "other"]);
      expect(g.weapon).toContain("Quivers");
      expect(g.armour).not.toContain("Quivers");
      expect(new Set(g.jewellery)).toEqual(new Set(["Amulets", "Rings", "Belts"]));
      for (const cs of Object.values(g)) expect(cs.some((c) => ["Life Flasks", "Charms", "Tinctures", "Skill Gems"].includes(c))).toBe(false);
    }
    expect(groupsOf("poe2").armour).toContain("Bucklers");
    expect(groupsOf("poe2").armour).toContain("Foci");
    expect(groupsOf("poe1").weapon).toContain("Warstaves");
  });

  it("every class is one NeverSink names in its gear blocks", () => {
    for (const game of GAMES) {
      const text = data(game)[1];
      const named = new Set([...text.split("\n").filter((l) => /^\s*Class\b/.test(l)).join(" ").matchAll(/"([^"]*)"/g)].map((m) => m[1]));
      for (const c of w.equipClasses(game)) expect(named.has(c), `${game} ${c}`).toBe(true);
    }
  });

  it.each(GAMES)("category and group rows (%s)", (game) => {
    const m = model(game);
    expect(m.categories()).toContainEqual([EQUIP_CATEGORY, w.EQUIP_LABEL]);
    const groups = m.equipGroups();
    expect(groups.map((g) => g.id)).toEqual(["weapon", "armour", "jewellery", "other"]);
    // no "NeverSink" value: a row is the default or set myself with S / A / B / C per rarity (B until chosen)
    expect(groups.every((g) => g.classes.every((c) => !c.custom && JSON.stringify(c.tiers) === JSON.stringify({ Normal: "B", Magic: "B", Rare: "B" })))).toBe(true);
    expect(m.rows(EQUIP_CATEGORY)).toEqual([]);
  });
});

describe("the file", () => {
  it.each(GAMES)("untouched or default rows write nothing and set-myself starts at B (%s)", (game) => {
    const plain = model(game).build().text;
    expect(plain).not.toContain("# equipment:");
    const m = model(game);
    const cls = w.equipClasses(game)[0];
    m.setEquipCustom(cls, true); // set myself: every rarity starts at B
    expect(m.equip_rows[cls]).toEqual({ custom: true, tiers: { Normal: "B", Magic: "B", Rare: "B" } });
    const text = m.build().text;
    for (const rar of ["Normal", "Magic", "Rare"]) expect(text).toContain(`# equipment: ${cls} - ${rar} - tier B`);
    expect(count(text, "# equipment:")).toBe(3);
    m.setEquipRarity(cls, "Rare", "D");
    m.setEquipCustom(cls, false); // back to the default: nothing written, values kept
    expect(m.build().text).toBe(plain);
    expect(m.equip_rows[cls].tiers.Rare).toBe("D");
    m.setEquipRarity(cls, "Magic", null); // "NeverSink" is not a choice of a rarity
    expect(m.equip_rows[cls].tiers.Magic).toBe("B");
  });

  it.each(GAMES)("Rare boots at D hides every Rare boots, the good ones included (%s)", (game) => {
    const plain = model(game).build().text;
    expect(visibleSet(plain, game, "Boots", "Rare").size).toBeGreaterThan(0); // NeverSink shows some (exotic / ilvl ...)
    const m = model(game);
    m.setEquipCustom("Boots", true);
    m.setEquipRarity("Boots", "Rare", "D");
    const text = m.build().text;
    for (const ilvl of [1, 30, 68, 82, 86]) {
      expect(visibleSet(text, game, "Boots", "Rare", { ilvl, area: ilvl }).size).toBe(0);
      // the other two rarities of the row are B now (set myself starts at B): every one shown, whatever it is
      for (const rar of ["Normal", "Magic"]) expect(visibleSet(text, game, "Boots", rar, { ilvl, area: ilvl }).has("Zzz Unknown Base")).toBe(true);
    }
    for (const [cls, rar] of [["Gloves", "Rare"], ["Rings", "Rare"], ["Helmets", "Normal"]]) { // other classes: exactly what NeverSink did
      expect(visibleSet(text, game, cls, rar)).toEqual(visibleSet(plain, game, cls, rar));
      expect(sameDecision(plain, text, cls, rar)).toBe(true);
    }
    expect(lint(text, data(game)[1])).toEqual([]);
  });

  it.each(GAMES)("a Magic wand at B uses the B style and Normal helmets stay NeverSink's (%s)", (game) => {
    const m = model(game);
    m.setStyleFromEditor("B", { ...m.effectiveStyle("B"), size: 33 });
    m.setEquipCustom("Wands", true);
    m.setEquipRarity("Wands", "Magic", "B");
    const text = m.build().text;
    const [shown, i] = sim.probe(text, "Wands", "Magic", "Zzz Unknown Base");
    const ts = sim.titles(text);
    expect(shown).toBe(true);
    expect(ts[i]).toBe("# equipment: Wands - Magic - tier B");
    const lines = text.split("\n");
    const blk = lines.slice(lines.indexOf(ts[i])).join("\n").split("\n\n")[0];
    expect(blk).toContain("SetFontSize 33");
    expect(blk).toContain('Class == "Wands"');
    expect(blk).toContain("Rarity Magic");
    const plain = model(game).build().text;
    expect(sameDecision(plain, text, "Helmets", "Normal") && sameDecision(plain, text, "Helmets", "Rare")).toBe(true);
  });

  it.each(GAMES)("Unique is not touched and not offered (%s)", (game) => {
    const m = model(game);
    m.setEquipCustom("Boots", true);
    for (const r of ["Normal", "Magic", "Rare"]) m.setEquipRarity("Boots", r, "D");
    const text = m.build().text;
    expect(text.split("\n\n").filter((b) => b.startsWith("# equipment:")).every((b) => !b.includes("Rarity Unique"))).toBe(true);
    expect(sameDecision(model(game).build().text, text, "Boots", "Unique", "Zzz Unique Base")).toBe(true);
    m.setEquipRarity("Boots", "Unique", "S"); // not offered: ignored
    expect("Unique" in m.equip_rows.Boots.tiers).toBe(false);
  });

  it.each(GAMES)("position: after names, uniques, tablets, maps, gold, typed names, before every NeverSink block (%s)", (game) => {
    const m = model(game);
    m.gold = true;
    m.map_on = true;
    m.custom = [{ name: "Heavy Belt", rarities: ["Rare"], tier: "A" }];
    for (const c of ["Boots", "Rings"]) {
      m.setEquipCustom(c, true);
      m.setEquipRarity(c, "Rare", "S");
    }
    const ts = sim.titles(m.build().text);
    const idx = (f: (t: string) => boolean): number[] => ts.flatMap((t, i) => (f(t) ? [i] : []));
    const eq = idx((t) => t.startsWith("# equipment:"));
    const ns = idx((t) => t.startsWith("# neversink ("));
    expect(eq.length).toBe(6);
    expect(ns.length).toBeGreaterThan(0);
    expect(Math.max(...eq)).toBeLessThan(Math.min(...ns));
    const before = idx((t) => ["# quest", "# tier S", "# tier A", "# tier B", "# uniques", "# tablets", "# typed names", "# gold", "# maps", "# waystones"].some((p) => t.startsWith(p)));
    expect(before.length).toBeGreaterThan(0);
    expect(Math.max(...before)).toBeLessThan(Math.min(...eq));
    expect(ts.at(-1)).toBe("# hide everything else");
    expect(Math.max(...eq)).toBeLessThan(ts.length - 1);
  });

  it.each(GAMES)("the group setter makes every row set-myself with that tier and has a default choice (%s)", (game) => {
    const m = model(game);
    const armour = groupsOf(game).armour;
    m.setEquipGroup("armour", "Rare", "D");
    expect(armour.every((c) => JSON.stringify(m.equip_rows[c]) === JSON.stringify({ custom: true, tiers: { Rare: "D", Normal: "B", Magic: "B" } }) ||
      JSON.stringify(m.equip_rows[c].tiers.Rare) === '"D"')).toBe(true);
    for (const c of armour) expect(m.equip_rows[c]).toEqual({ custom: true, tiers: { Rare: "D", Normal: "B", Magic: "B" } });
    const cfg_ = m.toConfig({});
    expect(new Set(Object.keys(cfg_[`wl_equip_rows_${game}`]))).toEqual(new Set(armour)); // written into each row, no group value
    expect(Object.keys(cfg_).some((k) => k.includes("group"))).toBe(false);
    m.setEquipRarity("Boots", "Rare", "S"); // one row can differ afterwards
    m.setEquipGroup("armour", "Magic", "A");
    expect(m.equip_rows.Boots.tiers).toEqual({ Rare: "S", Normal: "B", Magic: "A" });
    expect(count(m.build().text, "# equipment:")).toBe(3 * armour.length);
    m.setEquipGroup("armour", "Rare", null); // "ค่าเริ่มต้น": every row of the group default
    expect(armour.every((c) => !m.equip_rows[c].custom)).toBe(true);
    expect(m.equip_rows.Boots.tiers.Magic).toBe("A"); // values kept for the way back
    expect(m.build().text).not.toContain("# equipment:");
    expect(m.equipGroups().filter((g) => g.id === "armour").some((g) => g.classes.some((c) => c.custom))).toBe(false);
  });

  it("group default leaves the other groups alone", () => {
    const m = model("poe2");
    m.setEquipGroup("armour", "Rare", "D");
    m.setEquipGroup("weapon", "Magic", "S");
    m.setEquipGroup("armour", "Normal", null);
    expect(["Boots", "Gloves"].some((c) => m.equip_rows[c].custom)).toBe(false);
    expect(m.equip_rows.Wands.custom).toBe(true);
    expect(m.equip_rows.Wands.tiers.Magic).toBe("S");
  });

  it("a poe2 quiver is in weapons and set with the weapon group", () => {
    const m = model("poe2");
    m.setEquipGroup("weapon", "Rare", "D");
    expect(m.equip_rows.Quivers.tiers.Rare).toBe("D");
    expect("Boots" in m.equip_rows).toBe(false);
    expect(visibleSet(m.build().text, "poe2", "Quivers", "Rare").size).toBe(0);
  });
});

describe("settings: embedded, reopened, junk", () => {
  it.each(GAMES)("embedded and reopened (%s)", async (game) => {
    const m = model(game);
    m.setEquipCustom("Boots", true);
    m.setEquipRarity("Boots", "Rare", "D");
    m.setEquipRarity("Boots", "Magic", "A");
    const fg = m.toConfig({});
    expect(fg[`wl_equip_rows_${game}`]).toEqual({ Boots: { custom: true, tiers: { Normal: "B", Magic: "A", Rare: "D" } } });
    expect(wlEmbed.configKeys(game)).toContain(`wl_equip_rows_${game}`);
    const p = (await generate(fg, game, tmpDir(), "equip")).path;
    const text = readText(p);
    expect(wlEmbed.extract(text)!.cfg[`wl_equip_rows_${game}`]).toEqual(fg[`wl_equip_rows_${game}`]);
    const out = wlSession.openText(text, p.split(/[\\/]/).pop()!, game, model(game), data(game));
    expect(out.ok).toBe(true);
    expect(out.model!.equip_rows).toEqual(m.equip_rows);
    expect(out.model!.build().text).toBe(m.build().text);
    const junk = { ...fg, [`wl_equip_rows_${game}`]: { Boots: { custom: true, tiers: { Unique: "D", Rare: "Z", Magic: "A" } }, Flasks: { custom: true }, Wands: "x" } };
    expect(WlModel.fromConfig(junk, game).equip_rows).toEqual({ Boots: { custom: true, tiers: { Magic: "A", Normal: "B", Rare: "B" } } });
  });

  it("a file without the key opens with nothing set", () => {
    const got = WlModel.fromConfig({ wl_v2: true }, "poe2");
    expect(got.equip_rows).toEqual({});
    expect(got.toConfig({}).wl_equip_rows_poe2).toEqual({});
  });
});

describe("`==` only for names NeverSink writes with `==`", () => {
  afterEach(() => { w._testHooks.btGroups = null; });

  it.each(GAMES)("a bare BaseType only for names NeverSink never writes with equals (%s)", (game) => {
    const base = data(game)[1];
    const ok = new Set([...w.knownNames(base), ...filterGen.GOLD_BASETYPES]);
    const m = model(game);
    if (game === "poe2") m.gem_uncut = { "Uncut Skill Gem": 17 };
    m.gold = true;
    const head = m.build().text.split("# neversink (")[0];
    let bare = 0;
    for (const blk of head.split("\n\n")) {
      if (blk.startsWith("# typed names") || blk.startsWith("# uncut gem")) continue;
      for (const l of blk.split("\n")) {
        const mm = /^\s*BaseType\s*(==)?\s*((?:"[^"]*"\s*)+)$/.exec(l);
        if (!mm) continue;
        const names = [...mm[2].matchAll(/"([^"]*)"/g)].map((x) => x[1]);
        if (mm[1]) expect(names.filter((n) => !ok.has(n)).slice(0, 5)).toEqual([]);
        else {
          bare += names.length;
          expect(names.filter((n) => ok.has(n)).slice(0, 5)).toEqual([]);
        }
      }
    }
    expect(bare).toBeGreaterThan(0); // the names NeverSink does not write exist
  });

  it("the poe2 tablet class is written as NeverSink does", () => {
    const text = model("poe2").build().text;
    expect(text).toContain('    Class "Tablet"');
    expect(text.split("# neversink (")[0]).not.toContain('Class == "Tablet"');
  });

  it.each(GAMES)("first match is the same as with every name written with equals (%s)", (game) => {
    const [, base, trade] = data(game);
    const nw = model(game).build().text;
    w._testHooks.btGroups = (names) => (names.length ? [`BaseType == ${names.map((n) => `"${n}"`).join(" ")}`] : []);
    const old = model(game).build().text;
    w._testHooks.btGroups = null;
    const nb = sim.parseBlocks(nw), ob = sim.parseBlocks(old);
    const nt = sim.titles(nw), ot = sim.titles(old);
    const cls = sim.nameClasses(base);
    const universe = new Set([...trade, ...w.knownNames(base)]);
    for (const n of [...universe].sort()) {
      for (const rar of ["Normal", "Rare"]) {
        const it = eqItem(n, cls.get(n) ?? "Stackable Currency", rar, 80);
        const a = sim.visible(ob, it), b = sim.visible(nb, it);
        expect(a[0], `${n} ${rar}`).toBe(b[0]);
        expect(a[1] >= 0 ? ot[a[1]] : "", `${n} ${rar}`).toBe(b[1] >= 0 ? nt[b[1]] : "");
      }
    }
  });
});
