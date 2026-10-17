/** Whitelist phase 3b (test_wl_phase3b.py): categories by NeverSink type, stack minimums, style round trips (model level),
 *  settings embedded in the file, comparison with NeverSink s2. The Tk editor / window tests are replaced by the UI tests of phase 2/3. */
import { describe, expect, it } from "vitest";
import { WlModel, filterCore, filterStyle, filterWhitelist as w, wlEmbed } from "../src/index.ts";
import { block, data, generate, lint, model, readText, tmpDir } from "./helpers.ts";
import * as sim from "./neversink_sim.ts";

const count = (t: string, s: string): number => t.split(s).length - 1;
const quoted = (s: string): string[] => [...s.matchAll(/"([^"]*)"/g)].map((m) => m[1]);

describe("A1: categories by NeverSink's type", () => {
  it("names only NeverSink tiers join the category of their type", () => {
    const m2 = model("poe2");
    const cat: Record<string, string> = {};
    for (const [c] of m2.categories()) if (!c.startsWith("gear:")) for (const r of m2.rows(c)) cat[r.key] = c;
    expect(cat["Lesser Charging Rune"]).toBe("Rune");
    expect(cat["Alchemy Shard"]).toBe("Currency");
    expect(m2.rows("Rune").find((r) => r.key === "Lesser Charging Rune")!.tier).toBe("B"); // no tier of NeverSink's: B
    expect(m2.rows("Currency").find((r) => r.key === "Alchemy Shard")!.default).toBe("B"); // shown as "supply", not a ladder step
    const m1 = model("poe1");
    const cat1: Record<string, string> = {};
    for (const [c] of m1.categories()) if (!c.startsWith("gear:")) for (const r of m1.rows(c)) cat1[r.key] = c;
    expect(cat1["Alteration Shard"]).toBe("Currency");
    expect(cat1["Essence of Desolation"]).toBe("Essence");
    const other = new Set(m1.rows(w.OTHER_CATEGORY).map((r) => r.key));
    expect(other.has("Alteration Shard")).toBe(false);
    expect([...other].some((n) => n.includes("Tattoo"))).toBe(true); // types no category matches stay in "อื่นๆ"
  });

  it("a category tier reaches the names filed into it", () => {
    const m = model("poe2");
    m.setCategory("Currency", "S");
    expect(m.rows("Currency").find((r) => r.key === "Alchemy Shard")!.tier).toBe("S");
    expect(block(m.build().text, "# tier S\n")).toContain('"Alchemy Shard"');
  });
});

// ---------------------------------------------------------------------------- A2: stack-size minimums

/** first Show/Hide block of `text` an item `base` with `stack` would match (BaseType == and StackSize >=) */
function stackEval(text: string, base: string, stack: number): string[] | null {
  const chunks: string[][] = [];
  let cur: string[] | null = null;
  for (const line of text.split("\n")) {
    if (line === "Show" || line === "Hide") {
      cur = [line];
      chunks.push(cur);
    } else if (cur !== null && line.trim() && !line.startsWith("#")) cur.push(line.trim());
  }
  for (const chunk of chunks) {
    let ok = true;
    for (const cond of chunk.slice(1)) {
      const kw = cond.split(/\s+/)[0];
      if (cond.startsWith("BaseType ==")) ok = ok && quoted(cond).includes(base);
      else if (cond.startsWith("StackSize >=")) ok = ok && stack >= parseInt(cond.split(/\s+/).at(-1)!, 10);
      else if (["Class", "Rarity", "AreaLevel", "ItemLevel", "LinkedSockets"].includes(kw)) ok = ["Class", "AreaLevel"].includes(kw) ? false : ok;
      else if (["BaseType", "Quality", "GemLevel", "WaystoneTier", "MapTier"].includes(kw)) ok = false;
    }
    if (ok) return chunk;
  }
  return null;
}

describe("A2: stack-size minimums", () => {
  it("NeverSink's stack rules are the starting minimum and tier", () => {
    const [, base] = data("poe1");
    const [defaults, stackable] = w.stackInfo(base);
    for (const [n, want] of [["Orb of Augmentation", [3, "A"]], ["Portal Scroll", [3, "A"]], ["Scroll of Wisdom", [3, "A"]]] as const) expect(defaults.get(n)).toEqual(want);
    // a whole-class rule ("Divination Cards" with StackSize >= 3) gates every card NeverSink hides alone
    expect(defaults.get("Audacity")).toEqual([3, "B"]);
    expect([...defaults.values()].filter((v) => v[0] === 3 && v[1] === "B").length).toBe(93);
    expect(defaults.size).toBe(96);
    expect(w.stackInfo(data("poe2")[1])[0].size).toBe(0);
    expect(stackable.has("Chaos Orb") && !defaults.has("Chaos Orb") && !stackable.has("Vaal Regalia")).toBe(true);
    const m = model("poe1");
    const row = m.rows("Currency").find((r) => r.key === "Scroll of Wisdom")!;
    expect([row.tier, row.stack, row.stackable, row.stack_set]).toEqual(["A", 3, true, false]);
    const text = m.build().text;
    const shows = block(text, "# tier A - stack >= 3");
    expect(shows).toContain("BaseType == ");
    expect(shows).toContain('"Scroll of Wisdom"');
    expect(shows).toContain("StackSize >= 3");
    const hide = block(text, "# tier A - smaller stacks hidden");
    expect(hide.split("\n")[1]).toBe("Hide");
    expect(hide).toContain('"Scroll of Wisdom"');
    expect(stackEval(text, "Scroll of Wisdom", 1)![0]).toBe("Hide"); // first match: one scroll is hidden
    const hit = stackEval(text, "Scroll of Wisdom", 3)!; // a stack of 3 shows with the A look
    expect(hit[0]).toBe("Show");
    expect(hit.some((l) => l.startsWith("SetFontSize"))).toBe(true);
    expect(stackEval(text, "Chaos Orb", 1)![0]).toBe("Show"); // a name without a rule shows every one
  });

  it("tier minimum, item minimum, the larger wins, and unstackable names are skipped", () => {
    const m = model("poe1");
    m.setRow("Currency", "Chaos Orb", "B");
    m.setTierStack("B", 5);
    const stackOf = (n: string): number => m.rows("Currency").find((r) => r.key === n)!.stack;
    expect(stackOf("Chaos Orb")).toBe(5);
    m.setStack(["Chaos Orb"], 10);
    expect(stackOf("Chaos Orb")).toBe(10); // the larger one
    m.setStack(["Chaos Orb"], 1);
    expect(stackOf("Chaos Orb")).toBe(5); // 1 = every one, the tier still counts
    const text = m.build().text;
    expect(stackEval(text, "Chaos Orb", 4)![0]).toBe("Hide");
    expect(stackEval(text, "Chaos Orb", 5)![0]).toBe("Show");
    // Scroll of Wisdom: NeverSink says 3, the player says 1 -> every one is shown (B tier minimum is 5 though)
    m.setRow("Currency", "Scroll of Wisdom", "B");
    m.setStack(["Scroll of Wisdom"], 1);
    expect(stackOf("Scroll of Wisdom")).toBe(5);
    m.setTierStack("B", 1);
    expect(stackOf("Scroll of Wisdom")).toBe(1);
    expect(stackEval(m.build().text, "Scroll of Wisdom", 1)![0]).toBe("Show");
    // unstackable names never get a StackSize line (a unique base / a Tablet / a lineage gem)
    const m2 = model("poe2");
    m2.setTierStack("B", 9);
    m2.setTierStack("S", 9);
    const t = m2.build().text;
    expect(t).toContain("StackSize >= 9");
    const stackable = w.stackInfo(data("poe2")[1])[1];
    let gated = 0;
    for (const seg of t.split("\n\n")) {
      if (seg.includes("StackSize >= 9") && seg.split("\n")[1] === "Show") {
        const names = quoted(seg.split("\n").find((l) => l.trim().startsWith("BaseType =="))!);
        gated += names.length;
        expect(names.length > 0 && names.every((n) => stackable.has(n) && !n.endsWith(" Tablet"))).toBe(true);
      }
    }
    expect(gated).toBeGreaterThan(20);
    const rows2 = m2.rows("LineageGem");
    expect(rows2.length > 0 && rows2.every((r) => !r.stackable && r.stack === 1)).toBe(true);
  });

  it("names with different minimums get their own blocks, in order", () => {
    const m = model("poe1");
    m.setTierStack("B", 2);
    m.setStack(["Orb of Alchemy"], 7);
    const text = m.build().text;
    expect(text).toContain("# tier B - stack >= 2");
    expect(text).toContain("# tier B - stack >= 7");
    const seg7 = block(text, "# tier B - stack >= 7");
    expect(seg7).toContain('"Orb of Alchemy"');
    expect(count(seg7, "StackSize >= 7")).toBe(1);
    expect(block(text, "# tier B - smaller stacks hidden").split("\n")[1]).toBe("Hide");
    expect(stackEval(text, "Orb of Alchemy", 6)![0]).toBe("Hide");
    expect(stackEval(text, "Orb of Alchemy", 7)![0]).toBe("Show");
    // the stack config survives a round trip and the file passes the keyword / operator lint
    const again = WlModel.fromConfig(JSON.parse(JSON.stringify(m.toConfig({}))), "poe1");
    const d = data("poe1");
    again.setData(d[0], d[1], d[2]);
    expect(again.build().text).toBe(text);
    expect(lint(text, d[1])).toEqual([]);
  });

  it("reset row and category clear the name's own minimum", () => {
    const m = model("poe1");
    m.setStack(["Chaos Orb"], 4);
    m.resetRow("Currency", "Chaos Orb");
    expect("Chaos Orb" in m.item_stack).toBe(false);
    m.setStack(["Chaos Orb"], 4);
    m.resetCategory("Currency");
    expect(m.item_stack).toEqual({});
  });
});

// ---------------------------------------------------------------------------- D2: nothing the player unticks comes back (model level)

const fullStyle = () => ({ text: [10, 20, 30, 40], border: [50, 60, 70, 255], bg: [1, 2, 3, 0], size: 33,
  icon: { size: 2, color: "Cyan", shape: "Moon" }, effect: { color: "Pink", temp: true }, sound: { kind: "game", id: 7, volume: 120 } });

describe("D2: unticked parts stay off", () => {
  it("unticked parts of a tier stay off and leave the file", () => {
    const m = model("poe1");
    const base = m.baseStyle("S");
    for (const k of ["text", "border", "bg", "size", "icon", "effect"]) expect(base[k], k).toBeTruthy();
    m.setStyleFromEditor("S", { ...m.effectiveStyle("S"), text: null, border: null, icon: null, effect: null });
    expect([...m.tier_style.S.off].sort()).toEqual(["border", "effect", "icon", "text"]);
    const got = m.effectiveStyle("S");
    expect([got.text, got.border, got.icon, got.effect]).toEqual([null, null, null, null]);
    expect(got.bg).toEqual(base.bg);
    expect(got.size).toBe(base.size);
    const text = m.build().text;
    const seg = block(text, "# tier S\n");
    for (const s of ["SetTextColor", "SetBorderColor", "MinimapIcon", "PlayEffect"]) expect(seg).not.toContain(s);
    for (const s of ["SetBackgroundColor", "SetFontSize", "PlayAlertSound"]) expect(seg).toContain(s); // the rest + NeverSink's sound
    const m2 = WlModel.fromConfig(JSON.parse(JSON.stringify(m.toConfig({}))), "poe1"); // save -> new window -> reopen
    const d = data("poe1");
    m2.setData(d[0], d[1], d[2]);
    expect(m2.effectiveStyle("S")).toEqual(m.effectiveStyle("S"));
    expect(m2.build().text).toBe(text);
    m.setStyleFromEditor("S", { ...m.effectiveStyle("S"), text: [9, 9, 9, 255] }); // ticking one back on: the value is stored, the off mark goes
    expect((m.tier_style.S.off ?? []).includes("text")).toBe(false);
    expect(block(m.build().text, "# tier S\n")).toContain("SetTextColor 9 9 9 255");
  });

  it.each(["poe1", "poe2"])("every style field of every whitelist style round-trips through the model (%s)", (game) => {
    for (const label of ["S", "A", "B", "C", "G", "Tablet", "Map", "Gem"]) {
      if (label === "Tablet" && game === "poe1") continue; // no tablets in poe1
      const m = model(game);
      m.gold = true;
      m.map_on = true;
      if (label === "Gem") {
        m.gem_tier = "A";
        if (m_uncut(game).length) m.gem_uncut = { [m_uncut(game)[0]]: 3 };
        else m.gem_names = ["Fireball"];
      }
      const head = ({ S: "# tier S\n", A: "# tier A\n", B: "# tier B\n", C: "# tier C\n", G: "# gold", Tablet: "# tablets\n", Map: game === "poe1" ? "# maps" : "# waystones",
        Gem: m_uncut(game).length ? "# uncut gem" : "# gems" } as Record<string, string>)[label];
      const keys = ["SetTextColor", "SetBorderColor", "SetBackgroundColor", "SetFontSize", "MinimapIcon", "PlayEffect", "PlayAlertSound"];
      const assertMatchesFile = (style: any): void => {
        const text = m.build().text;
        if (["S", "A", "B", "C"].includes(label) && !text.includes(head)) return; // nothing of this tier in the file: nothing to compare
        const seg = block(text, head);
        const lines = Object.fromEntries(seg.split("\n").filter((l) => l.startsWith("    ") && keys.includes(l.trim().split(/\s+/)[0])).map((l) => [l.trim().split(/\s+/)[0], l.trim()]));
        const want = Object.fromEntries(filterStyle.styleLines(style, null, "").filter((l) => l.split(/\s+/)[0] !== "CustomAlertSoundOptional").map((l) => [l.split(/\s+/)[0], l.trim()]));
        expect(lines, `${label}`).toEqual(want);
      };
      // 1) set every field to a value of our own (the sound included: every style has its own)
      m.setStyleFromEditor(label, fullStyle());
      const expectStyle = m.effectiveStyle(label);
      expect(expectStyle.size).toBe(33);
      assertMatchesFile(m.effectiveStyle(label));
      // 2) untick every part one by one: each stays off, and is gone from the file
      for (const part of ["text", "border", "bg", "size", "icon", "effect"]) {
        const saved = { ...m.effectiveStyle(label), [part]: null };
        m.setStyleFromEditor(label, saved);
        const reopened = m.effectiveStyle(label);
        expect(reopened[part], `${label} ${part}`).toBeNull();
        for (const k of ["text", "border", "bg", "size", "icon", "effect"]) expect(reopened[k], `${label} ${part} ${k}`).toEqual(saved[k]);
        assertMatchesFile(m.effectiveStyle(label));
      }
      // 3) everything off, the sound off too
      m.setStyleFromEditor(label, { ...m.effectiveStyle(label), text: null, border: null, bg: null, size: null, icon: null, effect: null, sound: { kind: "none" } });
      const got = m.effectiveStyle(label);
      for (const k of ["text", "border", "bg", "size", "icon", "effect"]) expect(got[k]).toBeNull();
      expect(got.sound.kind).toBe("none");
      // 4) the whole thing survives the config file
      const m2 = WlModel.fromConfig(JSON.parse(JSON.stringify(m.toConfig({}))), game);
      const d = data(game);
      m2.setData(d[0], d[1], d[2]);
      expect(m2.effectiveStyle(label)).toEqual(m.effectiveStyle(label));
    }
  });

  it("a sound switched off on G / Tablet / Map stays off", () => {
    const m = model("poe2");
    m.setStyleFromEditor("G", { ...m.baseStyle("G"), sound: { kind: "game", id: 4, file: "", volume: 100 } });
    expect(m.effectiveStyle("G").sound.kind).toBe("game");
    m.setStyleFromEditor("G", { ...m.effectiveStyle("G"), sound: { kind: "none" } });
    expect(m.tier_style.G?.sound?.kind ?? "none").toBe("none");
    expect(m.effectiveStyle("G").sound.kind).toBe("none");
    m.gold = true;
    expect(block(m.build().text, "# gold")).not.toContain("PlayAlertSound");
  });

  it("the reset button gives NeverSink's values back", () => {
    const m = model("poe1");
    m.setStyleFromEditor("A", { ...m.effectiveStyle("A"), text: null, size: null });
    expect(m.tier_style.A.off.length).toBeGreaterThan(0);
    m.setStyle("A", null);
    expect("A" in m.tier_style).toBe(false);
    expect(m.effectiveStyle("A")).toEqual(filterStyle.mergeStyles(m.baseStyle("A"), null));
    m.setStyleFromEditor("G", { ...m.effectiveStyle("G"), size: null }); // the Gold / Map / Tablet / Gem editors have their own reset
    m.setStyle("G", null);
    expect("G" in m.tier_style).toBe(false);
  });

  it("every Q field reaches the tier file when set", () => {
    const st = { ...fullStyle(), sound: { kind: "game", id: 7, volume: 120 } };
    const section = filterCore.buildQuestBlocks("poe1", st);
    for (const part of ["SetFontSize 33", "SetTextColor 10 20 30 40", "SetBorderColor 50 60 70 255", "SetBackgroundColor 1 2 3 0", "PlayAlertSound 7 120", "PlayEffect Pink Temp", "MinimapIcon 2 Cyan Moon"]) {
      expect(section).toContain(part);
    }
    expect(filterCore.buildQuestBlocks("poe1", filterStyle.normalizeStyle({}))).toBe("");
  });
});

const m_uncut = (game: string): string[] => ({ poe2: ["Uncut Skill Gem", "Uncut Spirit Gem", "Uncut Support Gem"], poe1: [] } as Record<string, string[]>)[game];

// ---------------------------------------------------------------------------- C: settings embedded in the file

describe("C: settings embedded in the file", () => {
  it("embedded settings round trip and stay valid filter comments", async () => {
    const m = model("poe2");
    m.setRow("Currency", "Chaos Orb", "S");
    m.setFlaskCustom("Charm", true);
    m.setFlaskRarity("Charm", "Magic", "C");
    m.setTierStack("B", 4);
    m.setStyleFromEditor("A", { ...m.effectiveStyle("A"), text: null });
    m.gold = true;
    m.gold_min = 12;
    m.custom = [{ name: "ไทย", rarities: ["Rare"], tier: "A" }]; // non-ASCII must survive as ASCII
    const tmp = tmpDir();
    const res = await generate(m.toConfig({}), "poe2", tmp);
    const text = readText(res.path);
    const marks = text.split("\n").filter((l) => l.startsWith(wlEmbed.MARK));
    expect(marks.length).toBeGreaterThan(0);
    expect(marks.every((l) => /^[\x00-\x7f]*$/.test(l) && l.length < 200)).toBe(true);
    expect(text.split("\n").filter((l) => l.includes("poe-checker-config")).every((l) => l.startsWith("#"))).toBe(true);
    const emb = wlEmbed.extract(text)!;
    expect(emb.game).toBe("poe2");
    expect(emb.cfg.wl_tier_stack).toEqual({ B: 4 });
    const back = WlModel.fromConfig(emb.cfg, "poe2");
    expect(back.toConfig({})).toEqual(m.toConfig({}));
    expect(wlEmbed.classify(text)).toBe("ok");
    expect(lint(text, data("poe2")[1])).toEqual([]); // comment lines pass the lint too
    // regenerating from the embedded settings gives the same file
    const d = data("poe2");
    back.setData(d[0], d[1], d[2]);
    const res2 = await generate(back.toConfig({}), "poe2", tmp, "wl-test2");
    const strip = (t: string): string => t.split(/\r?\n/).filter((l) => !l.startsWith(wlEmbed.MARK)).join("\n");
    expect(strip(readText(res2.path))).toBe(strip(text));
  });

  it("classify tells the kinds of file apart", async () => {
    const ok = readText((await generate({}, "poe1", tmpDir())).path);
    expect(wlEmbed.classify(ok)).toBe("ok");
    const old = ok.split(/\r?\n/).filter((l) => !l.startsWith(wlEmbed.MARK)).join("\n");
    expect(wlEmbed.classify(old)).toBe("no_config"); // a v0.10.0 file: header, no settings
    expect(wlEmbed.classify(filterCore.TIER_HEADER + "Show\n")).toBe("tier");
    expect(wlEmbed.classify('Show\n    Class "Gems"\n')).toBe("foreign");
    const broken = old + "\n" + wlEmbed.MARK + " !!!notbase64!!!\n";
    expect(wlEmbed.extract(broken)).toBeNull();
    expect(wlEmbed.classify(broken)).toBe("no_config");
  });
});

// ---------------------------------------------------------------------------- compared with NeverSink strictness 2

describe("compared with NeverSink strictness 2", () => {
  it.each(["poe1", "poe2"])("the untouched whitelist answers like NeverSink s2 for every name and stack (%s)", (game) => {
    const res = sim.compare(game, [1, 2, 3, 5, 20, 100]);
    expect(res.total).toBeGreaterThan(1500);
    expect(res.same).toBe(res.total);
  });
});
