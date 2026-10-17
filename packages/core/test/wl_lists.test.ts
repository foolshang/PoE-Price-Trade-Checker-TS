/** Whitelist: named lists / stack defaults / uncut gems (test_wl_a3.py), quest blocks (test_wl_quest.py), NeverSink's own blocks (test_wl_neversink_blocks.py) */
import { describe, expect, it } from "vitest";
import { WlModel, filterCore, filterGen, filterStyle, filterWhitelist as w, wlEmbed } from "../src/index.ts";
import { block, data, generate, lint, model, readText, tmpDir } from "./helpers.ts";
import * as sim from "./neversink_sim.ts";

const NAMED = ["Runegraft", "Vial", "Corpse", "Wombgift", "Relic"];
const shown = sim.shown;
const cats = (m: WlModel): Set<string> => new Set(m.categories().map(([c]) => c));
const count = (t: string, s: string): number => t.split(s).length - 1;
const blk = (text: string, header: string): string => {
  const i = text.indexOf(header);
  return text.slice(i, text.indexOf("\n\n", i));
};

describe("named categories and stack defaults (test_wl_a3)", () => {
  it("named categories and starting tiers", () => {
    const m = model("poe1");
    for (const c of NAMED) expect(cats(m).has(c)).toBe(true);
    const tier: Record<string, string> = {};
    for (const c of NAMED) for (const r of m.rows(c)) tier[r.key] = r.tier;
    expect([tier["Runegraft of Gemcraft"], tier["Runegraft of Bellows"]]).toEqual(["S", "S"]); // t1 / t2 = S
    expect([tier["Vial of Sacrifice"], tier["Vial of Summoning"]]).toEqual(["S", "S"]);
    expect([tier["Perfect Warlord"], tier["Perfect Hydra"]]).toEqual(["S", "S"]);
    expect(tier["Imperfect Blasphemer"]).toBe("A"); // t4 = A
    expect([tier["Ancient Wombgift"], tier["Lavish Wombgift"]]).toEqual(["A", "A"]); // t3 / t4
    expect(tier["Candlestick Relic"]).toBe("B");
    expect(cats(model("poe2")).has("Relic")).toBe(true);
  });

  it.each([
    ["poe1", "Runegraft of Gemcraft", "Stackable Currency", "Runegraft"], ["poe1", "Vial of Sacrifice", "Stackable Currency", "Vial"],
    ["poe1", "Perfect Warlord", "Corpses", "Corpse"], ["poe1", "Ancient Wombgift", "Wombgifts", "Wombgift"],
    ["poe1", "Candlestick Relic", "Relics", "Relic"], ["poe2", "Coffer Relic", "Relics", "Relic"],
  ])("a named item follows its tier: %s %s", (game, name, cls, cat) => {
    const m = model(game);
    expect(shown(m.build().text, name, cls)).toBe(true);
    m.setRow(cat, name, "D");
    const hidden = m.build().text;
    expect(shown(hidden, name, cls)).toBe(false);
    expect(lint(hidden, data(game)[1])).toEqual([]);
    m.setRow(cat, name, "S");
    expect(block(m.build().text, "# tier S")).toContain(`"${name}"`);
  });

  it.each(["poe1", "poe2"])("an untouched tab equals NeverSink with the new lists (%s)", (game) => {
    const res = sim.compare(game, [1, 2, 3, 6, 20, 40]);
    expect(res.same).toBe(res.total);
  });

  it.each([["poe1", 96], ["poe2", 0]] as const)("stack defaults are the names hidden alone but shown as a stack (%s)", (game, expected) => {
    const [, base] = data(game);
    const ns = sim.parseBlocks(base);
    const cls = sim.nameClasses(base);
    const found = new Set<string>();
    for (const [n, c] of cls) {
      const probe = (st: number) => sim.visible(ns, sim.item({ base: n, cls: c, stack: st }))[0];
      if (!probe(1) && [2, 3, 4, 5, 6, 8, 10, 12, 15, 20, 30, 40, 50, 100].some(probe)) found.add(n);
    }
    expect(new Set(w.stackInfo(base)[0].keys())).toEqual(found);
    expect(found.size).toBe(expected);
  });

  it("NeverSink's fallback blocks still show unlisted names of the lists", () => {
    const m = model("poe1");
    const text = m.build().text;
    expect(shown(text, "Zzz Not Yet Listed", "Corpses")).toBe(true);
    expect(shown(text, "Vial of Zzz Not Yet Listed", "Stackable Currency")).toBe(true);
    expect(shown(text, "Runegraft of Zzz Not Yet Listed", "Stackable Currency")).toBe(true);
    m.setCategory("Runegraft", "D");
    const off = m.build().text;
    expect(shown(off, "Runegraft of Gemcraft", "Stackable Currency")).toBe(false); // a name of the list: hidden first
    expect(shown(off, "Runegraft of Zzz Not Yet Listed", "Stackable Currency")).toBe(true); // a new one: NeverSink's fallback
  });

  it("A3 survives the embedded settings", () => {
    const m = model("poe1");
    m.setRow("Vial", "Vial of Fate", "D");
    m.setCategory("Runegraft", "A");
    const text = wlEmbed.embed(m.build().text, m.cfg(), "poe1");
    const again = WlModel.fromConfig(wlEmbed.extract(text)!.cfg, "poe1");
    const [hub, base, names] = data("poe1");
    again.setData(hub, base, names);
    expect(again.build().text).toBe(m.build().text);
  });

  it("the poe1 class-wide Wombgift show comes after the name blocks and before the final Hide", () => {
    const m = model("poe1");
    const text = m.build().text;
    expect(shown(text, "Growing Wombgift", "Wombgifts")).toBe(true); // a name no list has: the class rule shows it
    expect(shown(text, "Ancient Wombgift", "Wombgifts")).toBe(true);
    const blocks = text.split("\n\n");
    const i = blocks.findIndex((b) => b.startsWith("# wombgifts"));
    const j = blocks.findIndex((b) => b.startsWith("# hide everything else"));
    const named = blocks.flatMap((b, k) => (b.includes('"Ancient Wombgift"') && b.split("\n")[0] !== "# wombgifts" ? [k] : []));
    expect(named.length).toBeGreaterThan(0);
    expect(Math.max(...named)).toBeLessThan(i);
    expect(i).toBeLessThan(j); // after every block that lists names
    expect(blocks[i]).toContain("SetFontSize");
    expect(blocks[i]).toContain('Class == "Wombgifts"');
    expect(blocks[i]).not.toContain("BaseType");
    m.setRow("Wombgift", "Ancient Wombgift", "D"); // a named wombgift set to D stays hidden
    expect(shown(m.build().text, "Ancient Wombgift", "Wombgifts")).toBe(false);
    m.setRow("Wombgift", "Ancient Wombgift", "S");
    expect(block(m.build().text, "# tier S")).toContain('"Ancient Wombgift"'); // a named one keeps its own (name) block
  });

  it("poe2 has no Wombgift rule", () => expect(model("poe2").build().text).not.toContain("# wombgifts"));

  const UNCUT = ["Uncut Skill Gem", "Uncut Spirit Gem", "Uncut Support Gem"];
  const uncut = (text: string, base: string, level: number) => sim.visible(sim.parseBlocks(text), sim.item({ base, cls: "Uncut Gems", area: 80, gem: level }));

  it.each([1, 5, 17, 18, 20])("an uncut gem shows from %i up, first match, for all three types", (n) => {
    const text = model("poe2", { whitelist_gem_uncut_poe2: Object.fromEntries(UNCUT.map((b) => [b, n])) }).build().text;
    for (const base of UNCUT) {
      for (const lv of [...new Set([Math.max(1, n - 1), n, Math.min(20, n + 1), 20])].sort((a, b) => a - b)) {
        const [shown_, i] = uncut(text, base, lv);
        if (lv >= n) {
          expect(shown_ && i >= 0, `${base} ${lv} ${n}`).toBe(true);
          expect(sim.parseBlocks(text)[i][1].some((c) => c[0] === "GemLevel")).toBe(true); // our uncut block, nothing earlier
        } else expect(shown_, `${base} ${lv} ${n}`).toBe(false);
      }
    }
  });

  it("uncut levels 16 to 20 per type with the player's 17 / 17 / 5", () => {
    const text = model("poe2", { whitelist_gem_uncut_poe2: { "Uncut Skill Gem": 17, "Uncut Spirit Gem": 17, "Uncut Support Gem": 5 } }).build().text;
    UNCUT.forEach((base, k) => {
      const need = [17, 17, 5][k];
      for (let lv = 16; lv <= 20; lv++) expect(uncut(text, base, lv)[0], `${base} ${lv}`).toBe(lv >= need);
    });
    expect(text).toContain('    BaseType "Uncut Skill Gem"');
    expect(text).not.toContain('BaseType == "Uncut');
    const heads = text.split("\n").filter((l) => l.startsWith("# uncut gem:"));
    expect(heads.map((h) => h.split(":")[1].split(" (")[0].trim())).toEqual(UNCUT); // Skill, Spirit, Support
  });

  it("uncut gems reopen from the new block form", () => {
    const cfg = { whitelist_gem_uncut_poe2: { "Uncut Skill Gem": 17, "Uncut Spirit Gem": 17, "Uncut Support Gem": 5 } };
    const m = model("poe2", cfg);
    expect(count(m.build().text, "# uncut gem:")).toBe(3);
    expect(WlModel.fromConfig(m.toConfig({}), "poe2").gem_uncut).toEqual(cfg.whitelist_gem_uncut_poe2);
  });
});

// ------------------------------------------------------------------------------------------------ test_wl_quest.py

const QUEST_ITEMS: Record<string, [string, string][]> = {
  poe1: [["Quest Items", "Quest Item"], ["Cursed Ducat", "Cursed Ducat"], ["Pantheon Souls", "Soul of Arakaali"], ["Labyrinth Items", "Golden Key"], ["Labyrinth Trinkets", "Aureate Trinket"]],
  poe2: [["Quest Items", "Quest Item"], ["Instance Local Items", "Local Thing"], ["Keys", "Bronze Key"], ["Keys", "Silver Key"], ["Keys", "Gold Key"]],
};
const STYLE_TOKENS = new Set(["SetFontSize", "SetTextColor", "SetBorderColor", "SetBackgroundColor", "PlayAlertSound", "PlayEffect", "MinimapIcon"]);

function questLines(text: string): string[] {
  const lines = text.split("\n");
  const i = lines.indexOf("# quest items (poe-checker)");
  const blockLines = lines.slice(i + 1).join("\n").split("\n\n")[0].split("\n");
  return blockLines.filter((l) => STYLE_TOKENS.has(l.trim().split(/\s+/)[0]));
}

function neversinkQuest(game: string): string[] {
  const base = data(game)[1];
  const [lines, blocks] = w.scan(base);
  const b = blocks.find((x) => filterGen.headerTags(lines, x)[1] === "questitems")!;
  return lines.slice(b.start + 1, b.end).filter((l) => l.trim() && STYLE_TOKENS.has(l.trim().split(/\s+/)[0])).map((l) => "    " + l.trim());
}

describe("quest blocks of the whitelist", () => {
  it.each(["poe1", "poe2"])("without a Q style every quest class goes to the Q block with NeverSink's look (%s)", async (game) => {
    const text = readText((await generate({}, game, tmpDir())).path);
    expect(questLines(text)).toEqual(neversinkQuest(game));
    expect(lint(text, data(game)[1])).toEqual([]);
    const ts = sim.titles(text);
    for (const [cls, base] of QUEST_ITEMS[game]) {
      const [sh, i] = sim.probe(text, cls, "Normal", base);
      expect(sh, `${cls} ${base}`).toBe(true);
      expect(i < ts.length - 1 && (ts[i] === "# quest items (poe-checker)" || ts[i] === ""), `${cls} ${base} ${ts[i]}`).toBe(true); // not the final Hide
      expect(i).toBeLessThanOrEqual(1); // the first two blocks of the file
    }
  });

  it("every quest class of the program is in the block", async () => {
    for (const game of ["poe1", "poe2"]) {
      const text = readText((await generate({}, game, tmpDir())).path);
      const first = text.slice(text.indexOf("# quest items")).split("\n\n")[0];
      for (const cls of filterCore.QUEST_CLASSES[game]) expect(first).toContain(`"${cls}"`);
      if (filterCore.QUEST_BASETYPES[game].length) {
        const second = text.slice(text.indexOf("# quest items")).split("\n\n")[1];
        for (const b of filterCore.QUEST_BASETYPES[game]) expect(second).toContain(`"${b}"`);
      }
    }
  });

  it.each(["poe1", "poe2"])("a Q style the player set is used (%s)", async (game) => {
    const style = { ...filterStyle.defaultQuestStyle(), size: 33 };
    const text = readText((await generate({ style_q: style }, game, tmpDir())).path);
    expect(questLines(text)).toContain("    SetFontSize 33");
    expect(questLines(text)).not.toEqual(neversinkQuest(game));
    for (const [cls, base] of QUEST_ITEMS[game]) expect(sim.probe(text, cls, "Normal", base)[0]).toBe(true);
  });

  it.each(["poe1", "poe2"])("an emptied Q style counts as not set (%s)", async (game) => {
    const text = readText((await generate({ style_q: filterStyle.normalizeStyle({}) }, game, tmpDir())).path);
    expect(questLines(text)).toEqual(neversinkQuest(game));
  });

  it("the NeverSink tab file is unchanged when Q is not set", () => {
    expect(filterCore.buildQuestBlocks("poe1", filterStyle.normalizeStyle({}))).toBe("");
    expect(filterCore.buildQuestBlocks("poe1", {}, null, ["    SetFontSize 45"])).toContain("# quest items");
  });
});

// ------------------------------------------------------------------------------------------------ test_wl_neversink_blocks.py

const COMMENT = /^\s*#/;
const bodyLines = (lines: string[]): string[] => lines.filter((l) => l.trim() && !COMMENT.test(l)).map((l) => l.trim());

/** [(header comment, kind, [keyword lines])] of the blocks the file took over from NeverSink, in file order */
function writtenCopies(text: string): [string, string, string[]][] {
  const out: [string, string, string[]][] = [];
  for (const chunk of text.split("\n\n")) {
    const lines = chunk.split("\n");
    while (lines.length && !lines[0].trim()) lines.shift();
    if (lines.length && lines[0].startsWith("# neversink (")) out.push([lines[0], lines[1].trim(), bodyLines(lines.slice(2))]);
  }
  return out;
}

describe("NeverSink's own blocks inside the whitelist file", () => {
  it.each(["poe1", "poe2"])("every block of the cut categories is NeverSink's, line for line (%s)", (game) => {
    const [, base] = data(game);
    const text = model(game).build().text;
    const want = w.gearSequence(game, base);
    const got = writtenCopies(text);
    expect(got.length).toBe(want.length);
    expect(got.length).toBeGreaterThan(200); // nothing left out, nothing added
    got.forEach(([header, kind, body], k) => {
      const [reason, ty, tag, nkind, nbody] = want[k];
      expect(header).toBe(`# neversink (${reason}): ${ty} ${tag || ""}`.trimEnd());
      expect(kind).toBe(nkind);
      expect(body).toEqual(bodyLines(nbody)); // conditions, look, sound: every line
    });
    expect(lint(text, base)).toEqual([]);
  });

  it.each(["poe1", "poe2"])("the copies keep NeverSink's relative order (%s)", (game) => {
    const base = data(game)[1];
    const seq = w.gearSequence(game, base);
    const [lines, blocks] = w.scan(base);
    const headers = blocks.map((b) => filterGen.headerTags(lines, b));
    const positions = seq.map((e) => headers.findIndex((h) => h[0] === e[1] && h[1] === e[2]));
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it.each(["poe1", "poe2"])("special classes are all covered by a NeverSink block (%s)", (game) => {
    const covered = new Set<string>();
    for (const [, , body] of writtenCopies(model(game).build().text)) for (const l of body) if (l.startsWith("Class")) [...l.matchAll(/"([^"]*)"/g)].forEach((m) => covered.add(m[1]));
    expect(w.SPECIAL_CLASSES[game].filter((c) => !covered.has(c))).toEqual([]);
  });

  it("the name-fragment fallbacks of NeverSink are copied too", () => {
    const text = model("poe1").build().text;
    expect(text).toContain('BaseType "Runegraft"');
    expect(text).toContain('BaseType "Vial of"');
  });

  it.each(["poe1", "poe2"])("the copies keep NeverSink's own sounds whatever sounds the tab holds (%s)", (game) => {
    const [hub, base, extra] = data(game);
    const m = new WlModel(game);
    m.setData(hub, base, extra);
    const res = w.buildWhitelistFilter(game, m.cfg(), base, hub, "", { S: "s.mp3", A: "a.mp3", B: "b.mp3" }, extra);
    const want = w.gearSequence(game, base);
    const got = writtenCopies(res.text);
    expect(got.length).toBe(want.length);
    got.forEach(([, kind, body], k) => {
      expect(kind).toBe(want[k][3]);
      expect(body).toEqual(bodyLines(want[k][4])); // exactly NeverSink's blocks, no custom sound
    });
    expect(lint(res.text, base)).toEqual([]);
  });

  it.each(["poe1", "poe2"])("the categories the tab still offers (%s)", (game) => {
    const m = model(game);
    const labels = m.categories().map(([, l]) => l);
    for (const x of ["เนื้อเรื่อง/เลเวลลิ่ง", "6-link / 5-link", "Heist (cloak/brooch/gear/tool)", "Influenced", "Gem ทั่วไป", "กุญแจ/ของพิเศษ (class)", "Jewel", "Memory Strand / Gear พิเศษ"]) {
      expect(labels).not.toContain(x);
    }
    expect(m.categories().some(([c]) => c.startsWith("gear:") || c === "Special")).toBe(false);
    const names = m.categories().map(([c]) => c);
    expect(names).toContain("Currency");
    expect(names).toContain("Unique");
    expect(names.includes("Tablet")).toBe(game === "poe2");
    expect(names.slice(-2)).toEqual(["flaskcharm", "equipclass"]);
    expect(labels).toContain("อื่นๆ (NeverSink จัด tier ให้)");
  });

  it("a name list still wins over NeverSink's class blocks that follow", () => {
    const m = model("poe1");
    m.setRow("Corpse", "Perfect Warlord", "D");
    const text = m.build().text;
    expect(shown(text, "Perfect Warlord", "Corpses")).toBe(false);
    expect(shown(text, "Perfect Hydra", "Corpses")).toBe(true);
  });

  it.each(["poe1", "poe2"])("a CRLF base filter gives the same file without stray carriage returns (%s)", (game) => {
    const [hub, base, extra] = data(game);
    const crlf = base.replaceAll("\n", "\r\n");
    const a = new WlModel(game); a.setData(hub, base, extra);
    const b = new WlModel(game); b.setData(hub, crlf, extra);
    const ta = a.build().text, tb = b.build().text;
    expect(writtenCopies(tb).map(([, , body]) => body.join("")).join("")).not.toContain("\r");
    expect(writtenCopies(ta)).toEqual(writtenCopies(tb));
  });
});

void blk;
