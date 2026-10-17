/** filter_gen: whitelist builders and the tier-mode custom sounds (test_filter_gen.py) */
import { describe, expect, it } from "vitest";
import { filterGen } from "../src/index.ts";
import { fixture } from "./helpers.ts";
import { soundBlockCounts } from "./sound_counts.ts";

const lastLine = (t: string): string => t.trimEnd().split(/\r?\n/).pop()!;
const count = (t: string, s: string): number => t.split(s).length - 1;
const build = filterGen.buildWhitelistSection;

describe("whitelist section", () => {
  it("contains the selected names and a trailing Hide", () => {
    const out = build(["Divine Orb", "Mirror of Kalandra"]);
    expect(out.startsWith("# ")).toBe(true);
    expect(out).toContain("Show");
    expect(out).toContain('"Divine Orb"');
    expect(out).toContain('"Mirror of Kalandra"');
    expect(lastLine(out)).toBe("Hide");
  });

  it("an empty selection returns empty", () => expect(build([])).toBe(""));
  it("GOLD_BASETYPES", () => expect(filterGen.GOLD_BASETYPES).toEqual(["Gold"]));

  it("two blocks when unique bases are given", () => {
    const out = build(["Divine Orb"], ["Shortsword"]);
    expect(count(out, "Show")).toBe(2);
    expect(out).toContain("Rarity Unique");
    expect(out).toContain('"Shortsword"');
    expect(lastLine(out)).toBe("Hide");
    expect(build([], [])).toBe("");
  });

  it("names in categories ignore price and case", () => {
    const hub = { currency: [{ category: "Rune", name: "Adept Rune", divine_value: 0.0 }, { category: "Omen", name: "Omen of Chance" }] };
    expect(filterGen.namesInCategories(hub, ["rune"])).toEqual(["Adept Rune"]);
  });

  it("three blocks with typed contains", () => {
    const out = build(["Divine Orb"], ["Shortsword"], ["Heavy Belt"]);
    expect(count(out, "Show")).toBe(3);
    expect(out).toContain('    BaseType "Heavy Belt"'); // no == -> substring match
    expect(out).toContain('    BaseType == "Divine Orb"');
    expect(lastLine(out)).toBe("Hide");
    expect(build([], [], ["x"])).not.toBe("");
  });

  it("expand_categories applies the exclude per category", () => {
    const hub = { currency: [{ category: "Rune", name: "Adept Rune" }, { category: "Rune", name: "Lesser Rune" }, { category: "Omen", name: "Omen of Chance" }] };
    expect(filterGen.expandCategories(hub, ["Rune", "Omen"], { Rune: ["Adept Rune"] }).sort()).toEqual(["Lesser Rune", "Omen of Chance"]);
  });

  it("expand_categories without exclude shows the whole category", () => {
    const hub = { currency: [{ category: "Rune", name: "Adept Rune" }, { category: "Rune", name: "Lesser Rune" }] };
    expect(filterGen.expandCategories(hub, ["Rune"]).sort()).toEqual(["Adept Rune", "Lesser Rune"]);
    expect(filterGen.expandCategories(hub, ["Rune"], {}).sort()).toEqual(["Adept Rune", "Lesser Rune"]);
  });

  it("typed names given as plain strings have no rarity line", () => {
    const out = build([], null, ["Heavy Belt", "Sapphire"]);
    expect(count(out, "Show")).toBe(1);
    expect(out).toContain('    BaseType "Heavy Belt" "Sapphire"');
    expect(out).not.toContain("Rarity");
  });

  it("typed names split blocks by rarity set", () => {
    const out = build([], null, [{ name: "Heavy Belt", rarities: ["Normal"] }, { name: "Vaal Regalia", rarities: ["Unique", "Rare"] }]);
    expect(count(out, "Show")).toBe(2);
    expect(out).toContain("    Rarity Normal");
    expect(out).toContain("    Rarity Rare Unique");
    expect(out.indexOf('"Heavy Belt"')).toBeLessThan(out.indexOf('"Vaal Regalia"'));
    expect(lastLine(out)).toBe("Hide");
  });

  it("typed names with empty rarities fall back to any", () => {
    const out = build([], null, [{ name: "Heavy Belt", rarities: [] }]);
    expect(out).not.toContain("Rarity");
    expect(out).toContain('"Heavy Belt"');
  });

  it("an uncut gem block has BaseType and GemLevel", () => {
    const out = build([], null, null, { gemUncut: [["Uncut Spirit Gem", 20]] });
    expect(out).toContain('    BaseType "Uncut Spirit Gem"');
    expect(out).toContain("    GemLevel >= 20");
    expect(count(out, "Show")).toBe(1);
    expect(lastLine(out)).toBe("Hide");
  });

  it("an uncut gem alone is not empty, all empty is", () => {
    expect(build([], null, null, { gemUncut: [] })).toBe("");
    expect(build([], null, null, { gemUncut: [["Uncut Skill Gem", 1]] })).not.toBe("");
  });

  it("uncut gem constants: poe2 three types, poe1 none", () => {
    expect(filterGen.WHITELIST_GEM_UNCUT.poe2).toEqual(["Uncut Skill Gem", "Uncut Spirit Gem", "Uncut Support Gem"]);
    expect(filterGen.WHITELIST_GEM_UNCUT.poe1).toEqual([]);
  });

  it("the gold block without a minimum has no StackSize", () => {
    const out = build([], null, null, { gold: true });
    expect(out).toContain('BaseType == "Gold"');
    expect(out).not.toContain("StackSize");
    expect(lastLine(out)).toBe("Hide");
  });

  it("the gold minimum StackSize is only in the gold block", () => {
    const out = build(["Divine Orb"], null, null, { gold: true, goldMin: 25 });
    expect(count(out, "StackSize >= 25")).toBe(1);
    const goldBlock = out.split("# gold")[1].split("\n\n")[0];
    expect(goldBlock).toContain("StackSize >= 25");
    expect(goldBlock).not.toContain("Divine Orb");
    expect(count(out, "Show")).toBe(2);
  });

  it("gold alone is not empty", () => {
    expect(build([], null, null, { gold: true, goldMin: 0 })).not.toBe("");
    expect(build([], null, null, { gold: false, goldMin: 25 })).toBe("");
  });

  it("the all-uniques block is before Hide and off by default", () => {
    const out = build([], null, null, { uniqueAll: true });
    expect(out).toContain("    Rarity Unique");
    expect(out).not.toContain("BaseType");
    expect(out.indexOf("Rarity Unique")).toBeLessThan(out.lastIndexOf("Hide"));
    const off = build(["Divine Orb"]);
    expect(off).toBe(build(["Divine Orb"], null, null, { uniqueAll: false }));
    expect(off).not.toContain("Rarity Unique");
    expect(build([], null, null, { uniqueAll: false })).toBe("");
  });

  it("Unique is not a hub category", () => {
    for (const cats of Object.values(filterGen.WHITELIST_CATEGORIES)) expect(cats).not.toContain("Unique");
  });
});

// ---------------------------------------------------------------------------
// Custom sounds follow NeverSink's own value ladders (6 -> S, 1 -> A, 2 -> B)
// ---------------------------------------------------------------------------

const SOUND_BASE = `Show # $type->currency $tier->t1exalted
\tClass == "Stackable Currency"
\tBaseType == "Divine Orb"
\tSetFontSize 45
\tPlayAlertSound 6 300
\tMinimapIcon 0 Red Star

Show # %D9 $type->currency->stackedsix $tier->t1
\tClass == "Stackable Currency"
\tStackSize >= 6
\tBaseType == "Fertile Catalyst"
\tPlayAlertSound 6 300

Show # $type->currency $tier->t2divine
\tClass == "Stackable Currency"
\tBaseType == "Exalted Orb"
\tPlayAlertSound 1 300

Show # $type->currency $tier->t4chaos
\tClass == "Stackable Currency"
\tBaseType == "Chaos Orb"
\tPlayAlertSound 2 300

Show # $type->currency $tier->t7chance
\tClass == "Stackable Currency"
\tBaseType == "Orb of Chance"

Hide # $type->currency $tier->t9junk
\tClass == "Stackable Currency"
\tBaseType == "Scroll of Wisdom"

Show # $type->fragments->scarabs $tier->t1
\tClass == "Map Fragments"
\tBaseType == "Top Scarab"
\tPlayAlertSound 6 300

Show # $type->sockets->general $tier->s
\tClass == "Augment"
\tBaseType == "Top Rune"
\tPlayAlertSound 6 300

Show # $type->6l $tier->hightier
\tLinkedSockets 6
\tPlayAlertSound 1 300

Show # $type->exoticbases $tier->kalandrabases
\tBaseType == "Fancy Base"
\tPlayAlertSound 6 300

Show # $type->currency->leveling $tier->rare
\tClass == "Stackable Currency"
\tAreaLevel <= 64
\tBaseType == "Lesser Thing"
\tPlayAlertSound 2 300

Show # $type->uniques $tier->t1
\tRarity Unique
\tBaseType == "Glorious Plate"
\tPlayAlertSound 6 300

Show # $type->uniques $tier->exkaom
\tRarity Unique
\tBaseType == "Strapped Mitts"
\tPlayAlertSound 6 300

Show # $type->uniques $tier->t3
\tRarity Unique
\tBaseType == "Plain Base"
\tPlayAlertSound 3 300
`;

function blockOf(text: string, name: string): string | null {
  const lines = text.split("\n");
  for (const b of filterGen.parseBlocks(lines)) if (b.basetypeNames.includes(name)) return lines.slice(b.start, b.end).join("\n");
  return null;
}

describe("custom sounds by NeverSink's numbers", () => {
  it("no sounds means the text is returned untouched", () => {
    const sms: (Record<string, string | null> | null)[] = [null, {}, { "1": null, "2": "", "3": null }, { S: "s.mp3" }, { "7": "x.mp3" }];
    for (const sm of sms) {
      expect(filterGen.applyNumberedSounds(SOUND_BASE, sm)).toEqual([SOUND_BASE, {}]);
    }
  });

  it("every Show block with the id gets the slot, not only the ladders", () => {
    const [out, done] = filterGen.applyNumberedSounds(SOUND_BASE, { "1": "poe-checker-1.mp3" });
    const want = 'CustomAlertSoundOptional "poe-checker-1.mp3" 300';
    const six = ["Divine Orb", "Fertile Catalyst", "Top Scarab", "Top Rune", "Glorious Plate", "Fancy Base", "Strapped Mitts"];
    for (const name of six) {
      const blk = blockOf(out, name)!;
      expect(blk.trimEnd().endsWith(want), name).toBe(true); // appended after the block's own lines
      expect(blk).toContain("PlayAlertSound 6 300"); // NeverSink's sound stays as the fallback
    }
    expect(done).toEqual({ "1": six.length });
    for (const name of ["Exalted Orb", "Chaos Orb", "Orb of Chance", "Scroll of Wisdom", "Lesser Thing", "Plain Base"]) {
      expect(blockOf(out, name)!, name).not.toContain("CustomAlertSound"); // sound 1 / 2 / 3 / none / Hide
    }
  });

  it("each slot follows its NeverSink number", () => {
    const sm = { "1": "s1.mp3", "2": "s2.wav", "3": "s3.ogg", "4": "s4.mp3", "5": "s5.mp3", "6": "s6.mp3" };
    const [out, done] = filterGen.applyNumberedSounds(SOUND_BASE, sm);
    expect(blockOf(out, "Exalted Orb")).toContain('CustomAlertSoundOptional "s2.wav" 300'); // id 1 -> slot 2
    expect(blockOf(out, "Chaos Orb")).toContain('CustomAlertSoundOptional "s3.ogg" 300'); // id 2 -> slot 3
    expect(blockOf(out, "Divine Orb")).toContain('CustomAlertSoundOptional "s1.mp3" 300'); // id 6 -> slot 1
    expect(blockOf(out, "Lesser Thing")).toContain('CustomAlertSoundOptional "s3.ogg" 300'); // the leveling block: id 2 too
    expect(blockOf(out, "Plain Base")).toContain('CustomAlertSoundOptional "s4.mp3" 300'); // id 3 -> slot 4
    expect(blockOf(out, "Orb of Chance")).not.toContain("CustomAlertSound");
    expect(blockOf(out, "Scroll of Wisdom")).not.toContain("CustomAlertSound");
    expect(filterGen.SOUND_SLOT_OF_ID).toEqual({ "6": "1", "1": "2", "2": "3", "3": "4", "4": "5", "5": "6" });
    const counts = soundBlockCounts(SOUND_BASE);
    expect(Object.values(done).reduce((a, b) => a + b, 0)).toBe([..."612345"].reduce((a, i) => a + (counts[i] ?? 0), 0));
  });

  it("block order and everything else stay byte identical", () => {
    const [out] = filterGen.applyNumberedSounds(SOUND_BASE, { "1": "s.mp3", "2": "a.wav", "3": "b.ogg", "4": "c.mp3" });
    expect(out.split("\n").filter((l) => !l.includes("CustomAlertSoundOptional")).join("\n")).toBe(SOUND_BASE); // only added lines
    const h = (t: string): string[] => t.split("\n").filter((l) => l.startsWith("Show") || l.startsWith("Hide"));
    expect(h(out)).toEqual(h(SOUND_BASE));
  });

  it("an existing custom sound line is replaced, not duplicated", () => {
    const base = SOUND_BASE.replace('\tBaseType == "Exalted Orb"\n', '\tBaseType == "Exalted Orb"\n\tCustomAlertSound "old.mp3" 200\n');
    const [out] = filterGen.applyNumberedSounds(base, { "2": "a.wav" });
    const blk = blockOf(out, "Exalted Orb")!;
    expect(blk).not.toContain("old.mp3");
    expect(count(blk, "CustomAlertSound")).toBe(1);
  });

  it("on the real base files every slot lands on exactly the blocks of its number", () => {
    for (const [game, ref] of [["poe1", "fx:ns_poe1_base"], ["poe2", "fx:ns_poe2_base"]] as const) {
      void game;
      const base: string = fixture(ref);
      const counts = soundBlockCounts(base);
      expect(Object.keys(counts).every((k) => "123456".includes(k))).toBe(true); // NeverSink uses no other number
      const sm = Object.fromEntries(filterGen.SOUND_SLOTS.map((s) => [s, `snd${s}.mp3`]));
      const [out, done] = filterGen.applyNumberedSounds(base, sm);
      expect(done).toEqual(Object.fromEntries(Object.entries(counts).map(([i, n]) => [filterGen.SOUND_SLOT_OF_ID[i], n])));
      const lines = out.split("\n");
      for (const b of filterGen.parseBlocks(lines)) {
        const body = lines.slice(b.start + 1, b.end);
        const have = body.filter((l) => l.trim().startsWith("CustomAlertSoundOptional"));
        const i = filterGen.soundIdOf(body);
        if (b.blockType === "Show" && i !== null && i in filterGen.SOUND_SLOT_OF_ID) {
          expect(have.length).toBe(1);
          expect(have[0]).toContain(`snd${filterGen.SOUND_SLOT_OF_ID[i]}.mp3`);
        } else expect(have.length).toBe(0);
      }
      expect(lines.filter((l) => !l.includes("CustomAlertSoundOptional")).join("\n")).toBe(base); // nothing but added lines
      const [one, only] = filterGen.applyNumberedSounds(base, { "4": "four.mp3" }); // an empty slot writes nothing
      expect(only).toEqual({ "4": counts["3"] ?? 0 });
      expect(count(one, "CustomAlertSoundOptional")).toBe(counts["3"] ?? 0);
    }
  });

  it("the helper keeps PlayAlertSound, replaces old custom lines and uses the indent", () => {
    const style = ["    SetBorderColor 0 0 0 255", "    PlayAlertSound 6 300", "    PlayEffect Red"];
    const out = filterGen.customSoundLines(style, "poe-checker-1.mp3");
    expect(out.slice(0, 3)).toEqual(style);
    expect(out[3]).toBe('    CustomAlertSoundOptional "poe-checker-1.mp3" 300');
    expect(out.length).toBe(4);
    const old = ['    CustomAlertSound "old.mp3" 100', '    CustomAlertSoundOptional "older.mp3"', "    PlayAlertSound 1 100"];
    expect(filterGen.customSoundLines(old, "new.mp3")).toEqual(["    PlayAlertSound 1 100", '    CustomAlertSoundOptional "new.mp3" 300']);
    expect(filterGen.customSoundLines(["\tPlayAlertSound 6 300"], "s.mp3", "\t").at(-1)).toBe('\tCustomAlertSoundOptional "s.mp3" 300');
  });
});
