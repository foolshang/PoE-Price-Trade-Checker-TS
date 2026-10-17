/** Whitelist engine (filter_whitelist): defaults from NeverSink strictness 2, tier resolution, block order (test_filter_whitelist.py) */
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { NodeFs } from "../../node/src/nodefs.ts";
import { HttpPort, filterCore, filterService, filterStyle, filterWhitelist as w } from "../src/index.ts";
import { EXACT_LINE } from "../src/filter_whitelist.ts";
import { fixture } from "./helpers.ts";
import { gunzipSync } from "node:zlib";
import { FIX } from "../../../tests/parity/runner.ts";

const POE1: string = fixture("fx:ns_poe1_s2");
const POE2: string = fixture("fx:ns_poe2_s2");

const MINI = `Show # $type->currency $tier->t1
\tBaseType == "Divine Orb" "Mirror of Kalandra"
\tSetFontSize 45
\tSetTextColor 255 0 0 255
\tPlayAlertSound 6 300

Show # $type->currency $tier->t2
\tBaseType == "Chaos Orb" "Divine Orb"
\tSetFontSize 40

Show # $type->currency $tier->t4
\tBaseType == "Orb of Alchemy"
\tSetFontSize 36

Show # $type->currency $tier->t1
\tStackSize >= 20
\tBaseType == "Scroll of Wisdom"
\tSetFontSize 45

Hide # $type->currency $tier->t6
\tBaseType == "Scroll of Wisdom" "Orb of Transmutation"

Show # $type->uniques $tier->t1
\tRarity Unique
\tBaseType == "Vaal Regalia"

Show # $type->uniques $tier->t3
\tRarity Unique
\tBaseType == "Vaal Regalia" "Sapphire Ring"
`;

const hub = (...entries: [string, string, string | null][]) => ({
  currency: [], items: entries.map(([name, category, base]) => ({ name, category, ...(base ? { base } : {}) })),
});
const HUB = hub(["Divine Orb", "Currency", null], ["Chaos Orb", "Currency", null], ["Orb of Alchemy", "Currency", null],
  ["Scroll of Wisdom", "Currency", null], ["Brand New Orb", "Currency", null], ["Essence of Hatred", "Essence", null],
  ["Kaom's Heart", "UniqueArmour", "Vaal Regalia"], ["Other Regalia", "UniqueArmour", "Vaal Regalia"], ["Ring X", "UniqueAccessory", "Sapphire Ring"]);
const EXTRA = new Set(["Brand New Orb", "Essence of Hatred"]); // real names the MINI base does not list (trade data)

const count = (t: string, s: string): number => t.split(s).length - 1;
const seg = (text: string, header: string): string => {
  const i = text.indexOf(header);
  expect(i, header).toBeGreaterThanOrEqual(0);
  const j = text.indexOf("\n\n", i);
  return text.slice(i, j < 0 ? text.length : j);
};
const quoted = (s: string): string[] => [...s.matchAll(/"([^"]*)"/g)].map((m) => m[1]);

function build(game = "poe1", cfg: Record<string, any> | null = null, o: { base?: string; hubd?: any; quest?: string; sounds?: any; extra?: Set<string> | null } = {}) {
  const { base = MINI, hubd = HUB, quest = "", sounds = null, extra = EXTRA } = o;
  return w.buildWhitelistFilter(game, cfg ?? {}, base, hubd, quest, sounds, extra);
}

describe("tiers", () => {
  it.each([["t1", "S"], ["t2", "S"], ["t3", "A"], ["t4", "A"], ["t5", "B"], ["t6", "B"], ["t7", "C"], ["t8", "C"], ["t9", null],
    ["t4chaos", "A"], ["t7chance", "C"], ["s", "S"], ["a", "S"], ["b", "A"], ["c", "A"], ["d", "B"], ["e", "B"], ["exhide", null], [null, null]])(
    "tier_of_step %s", (tag, tier) => expect(w.tierOfStep(tag)).toBe(tier));

  it("default tiers: the first match wins and special blocks are skipped", () => {
    const d = w.defaultTiers(MINI);
    expect(d.get("Divine Orb")).toBe("S"); // t1 comes before the t2 that also lists it
    expect(d.get("Chaos Orb")).toBe("S"); // t2 = S now (t1-t2)
    expect(d.get("Orb of Alchemy")).toBe("A"); // t4 = A now (t3-t4)
    expect(d.get("Orb of Transmutation")).toBe("D"); // Hide block
    expect(d.get("Scroll of Wisdom")).toBe("D"); // the StackSize t1 block is skipped, Hide wins
  });

  it("a hub-only name defaults to B", () => {
    const names = w.universe("poe1", HUB, MINI);
    const tiers = w.resolveTiers("poe1", {}, names, w.defaultTiers(MINI));
    expect(tiers.get("Brand New Orb")).toBe("B");
    expect(tiers.get("Divine Orb")).toBe("S");
  });

  it("precedence: item over category over default", () => {
    const names = w.universe("poe1", HUB, MINI);
    const t = w.resolveTiers("poe1", { wl_cat_tier_poe1: { Currency: "D" }, wl_item_tier_poe1: { "Chaos Orb": "A" } }, names, w.defaultTiers(MINI));
    expect([t.get("Chaos Orb"), t.get("Divine Orb"), t.get("Essence of Hatred")]).toEqual(["A", "D", "B"]);
  });

  it("the unique base default is the highest and a conflict is reported", () => {
    const bd = w.uniqueBaseDefaults(MINI);
    expect(Object.fromEntries(bd)).toEqual({ "Vaal Regalia": "S", "Sapphire Ring": "A" });
    const ents = w.uniqueEntries(HUB);
    let [bt, conf] = w.resolveUniqueTiers("poe1", {}, ents, bd);
    expect(Object.fromEntries(bt)).toEqual({ "Vaal Regalia": "S", "Sapphire Ring": "A" });
    expect(conf).toEqual([]);
    [bt, conf] = w.resolveUniqueTiers("poe1", { wl_unique_tier_poe1: { "Other Regalia": "B" } }, ents, bd);
    expect(bt.get("Vaal Regalia")).toBe("S"); // higher tier wins on the shared base
    expect(conf).toEqual([["Vaal Regalia", { "Kaom's Heart": "S", "Other Regalia": "B" }]]);
    [bt] = w.resolveUniqueTiers("poe1", { wl_unique_tier_poe1: { "Kaom's Heart": "B", "Other Regalia": "A" } }, ents, bd);
    expect(bt.get("Vaal Regalia")).toBe("A");
  });
});

interface Blk { type: string; lines: string[] }
function blocksOf(text: string): Blk[] {
  const out: Blk[] = [];
  let cur: Blk | null = null;
  for (const line of text.split("\n")) {
    if (line === "Show" || line === "Hide") {
      cur = { type: line, lines: [] };
      out.push(cur);
    } else if (cur !== null && line.trim()) cur.lines.push(line.trim());
  }
  return out;
}

describe("the generated file", () => {
  it("ends with Hide and shows only the selection", () => {
    const blocks = blocksOf(build().text);
    expect(blocks.at(-1)).toEqual({ type: "Hide", lines: [] });
    const shown = new Set<string>();
    for (const b of blocks.slice(0, -1)) {
      if (b.type === "Hide") continue;
      for (const l of b.lines) if (l.startsWith("BaseType")) quoted(l).forEach((n) => shown.add(n));
    }
    expect(shown.has("Orb of Transmutation")).toBe(false);
    for (const n of ["Divine Orb", "Chaos Orb", "Orb of Alchemy", "Brand New Orb", "Essence of Hatred"]) expect(shown.has(n)).toBe(true);
    const allowed = new Set(["Divine Orb", "Chaos Orb", "Orb of Alchemy", "Brand New Orb", "Essence of Hatred", "Mirror of Kalandra", "Vaal Regalia", "Sapphire Ring", "Gold", "Scroll of Wisdom"]);
    for (const n of shown) expect(allowed.has(n), n).toBe(true);
    const wisdom = blocks.filter((b) => b.type === "Show" && b.lines.some((l) => l.includes('"Scroll of Wisdom"')));
    expect(wisdom.length).toBe(1);
    expect(wisdom[0].lines).toContain("StackSize >= 20");
  });

  it("one block per tier, in order", () => {
    const text = build().text;
    expect(text.indexOf("# tier S")).toBeLessThan(text.indexOf("# uniques - tier S"));
    expect(text.indexOf("# uniques - tier S")).toBeLessThan(text.indexOf("# tier A"));
    expect(text.indexOf("# tier A")).toBeLessThan(text.indexOf("# tier B"));
    expect(count(text, "\n# tier S\n")).toBe(1);
  });

  it("the quest block comes first and is never hidden", () => {
    const q = filterCore.buildQuestBlocks("poe1", { text: [1, 2, 3, 255] });
    const text = build("poe1", null, { quest: q }).text;
    expect(text.indexOf("quest items")).toBeLessThan(text.indexOf("# uniques"));
    expect(text).toContain('Class == "Quest Items"');
  });

  it("the unique block is before the tablet block and the tablet excludes uniques", () => {
    const text = build("poe2").text;
    expect(text.indexOf("# uniques")).toBeLessThan(text.indexOf("# tablets"));
    const s = seg(text, "# tablets");
    expect(s).toContain('Class "Tablet"');
    expect(s).toContain("Rarity < Unique");
    expect(build("poe1").text).not.toContain("tablets");
  });

  it("the unique block uses base and rarity", () => {
    const text = build().text;
    const s = seg(text, "# uniques - tier S");
    expect(s).toContain("Rarity Unique");
    expect(s).toContain('BaseType == "Vaal Regalia"');
    expect(text).not.toContain("Kaom's Heart"); // a filter cannot match unique names
  });

  it("gold both ways", () => {
    const g = seg(build("poe1", {}).text, "# gold");
    expect(g).toContain('BaseType == "Gold"');
    expect(g).not.toContain("SetFontSize");
    expect(g).not.toContain("StackSize");
    const g2 = seg(build("poe1", { whitelist_gold: true, whitelist_gold_min: 500 }).text, "# gold");
    expect(g2).toContain("StackSize >= 500");
    expect(g2).toContain("SetFontSize");
  });

  it("waystone and map: on / off, the special maps, unticked", () => {
    const off = seg(build("poe2").text, "# waystones");
    expect(off).not.toContain("WaystoneTier");
    expect(off).not.toContain("SetFontSize");
    const on = seg(build("poe2", { wl_map_on: true, wl_map_tier_min: 8, wl_map_rarity_min: "Rare" }).text, "# waystones");
    expect(on).toContain("WaystoneTier >= 8");
    expect(on).toContain("Rarity >= Rare");
    expect(on).toContain("SetFontSize"); // both required
    const p1 = build("poe1", { wl_map_on: true, wl_map_tier_min: 12, wl_map_rarity_min: "Magic" }, { base: POE1 }).text;
    expect(p1).toContain("MapTier >= 12");
    expect(p1).toContain("Rarity >= Magic");
    for (const special of ["Rarity Unique", "BlightedMap True", "HasInfluence", 'BaseType == "Valdo Map"']) expect(p1).toContain(special);
    expect(count(p1, 'Class == "Maps"')).toBeGreaterThanOrEqual(6); // each special block carries the map style
  });

  it("the map tier is clamped", () => expect(build("poe1", { wl_map_on: true, wl_map_tier_min: 99 }).text).toContain("MapTier >= 16"));

  it("gems and typed names", () => {
    const cfg = { whitelist_gem_uncut_poe2: { "Uncut Skill Gem": 18 }, whitelist_gem_tier: "A",
      whitelist_custom_poe2: [{ name: "Rakiata", rarities: ["Magic"], tier: "S" }, { name: "Hidden", rarities: ["Rare"], tier: "D" }] };
    const text = build("poe2", cfg).text;
    expect(text).toContain('BaseType "Uncut Skill Gem"');
    expect(text).toContain("GemLevel >= 18");
    const s = seg(text, "# typed names");
    expect(s).toContain('BaseType "Rakiata"');
    expect(s).toContain("Rarity Magic");
    expect(s.split("BaseType")[1].split("\n")[0]).not.toContain("==");
    expect(text).not.toContain("Hidden");
  });

  it("sound per tier: game and file", () => {
    const cfg = { wl_tier_style: { S: { sound: { kind: "file", file: "a.mp3", volume: 200 } }, A: { sound: { kind: "game", id: 5, volume: 100 } },
      G: { sound: { kind: "file", file: "g.ogg" } } } };
    expect(w.soundRequests(cfg)).toEqual({ S: "a.mp3", A: null, B: null, C: null, G: "g.ogg", Tablet: null, Map: null, Gem: null });
    const text = build("poe1", cfg, { sounds: { S: "a.mp3" } }).text;
    expect(seg(text, "# tier S\n")).toContain('CustomAlertSoundOptional "a.mp3" 200');
    expect(seg(text, "# tier A\n")).toContain("PlayAlertSound 5 100");
  });

  it("the tier default look copies NeverSink's steps", () => {
    const lines = w.defaultTierLines(MINI);
    expect(lines.S).toContain("    PlayAlertSound 6 300");
    expect(lines.A).toContain("    SetFontSize 40");
  });

  it.each([["poe1", POE1], ["poe2", POE2]] as const)("real base filters (%s)", (game, base) => {
    const d = w.defaultTiers(base);
    const vals = new Set(d.values());
    for (const t of ["S", "A", "B", "D"]) expect(vals.has(t)).toBe(true); // D = a Hide block
    if (game === "poe1") expect(vals.has("C")).toBe(true); // t7 / t8 of the numbered ladder (poe2's letter ladders have none)
    const res = build(game, null, { base, hubd: hub(["Divine Orb", "Currency", null]), extra: null });
    expect(res.tiers.get("Divine Orb")).toBe("S");
    expect(res.text.trimEnd().endsWith("Hide")).toBe(true);
  });

  it("core wiring (wl_v2)", async () => {
    const cfg = { whitelist_enabled: true, wl_v2: true };
    expect(filterCore.planFetch(cfg, "poe1")).toEqual({ mode: "whitelist", hub: true, neversink: true });
    expect(await filterCore.buildFilterText(cfg, "poe1", { hubData: HUB, baseText: null })).toBeNull();
    const res = (await filterCore.buildFilterText(cfg, "poe1", { hubData: HUB, baseText: MINI }))!;
    expect(res.mode).toBe("whitelist");
    expect(res.base_text).toBeNull();
    expect(res.count).toBeGreaterThan(0);
    expect(filterCore.planFetch({ whitelist_enabled: true }, "poe1").neversink).toBe(false); // legacy config keeps the old engine
  });

  it("the default sound is kept when the user style has no sound", () => {
    const s = seg(build("poe1", { wl_tier_style: { S: { text: [1, 2, 3, 255] } } }).text, "# tier S\n");
    expect(s).toContain("SetTextColor 1 2 3 255");
    expect(s).toContain("PlayAlertSound 6 300");
    expect(s).toContain("SetFontSize 45");
  });

  it("a user file sound goes next to the default fallback and a game sound replaces it", () => {
    const cfg = { wl_tier_style: { S: { sound: { kind: "file", file: "a.mp3", volume: 200 } }, A: { sound: { kind: "game", id: 9, volume: 100 } } } };
    const text = build("poe1", cfg, { sounds: { S: "a.mp3" } }).text;
    const s = seg(text, "# tier S\n");
    expect(s).toContain("PlayAlertSound 6 300");
    expect(s).toContain('CustomAlertSoundOptional "a.mp3" 200');
    const a = seg(text, "# tier A\n");
    expect(a).toContain("PlayAlertSound 9 100");
    expect(a).not.toContain("PlayAlertSound 1");
  });

  it("substring BaseType lines are not names", () => {
    const base = MINI + `
Show # $type->currency $tier->t3
\tBaseType "Ducat"
\tSetFontSize 40
`;
    expect(w.defaultTiers(base).has("Ducat")).toBe(false);
    expect(w.knownNames(base).has("Ducat")).toBe(false);
    expect(build("poe1", null, { base }).text).not.toContain("Ducat");
  });

  it("unknown names are skipped and reported", () => {
    const h = hub(["Divine Orb", "Currency", null], ["Fake Orb", "Currency", null], ["Ring Z", "UniqueAccessory", "Fake Ring"]);
    const cfg = { whitelist_gem_names_poe1: ["Fake Gem"], whitelist_gem_uncut_poe2: {} };
    let res = build("poe1", cfg, { hubd: h, extra: null });
    expect(res.text).not.toContain("Fake");
    expect(new Set(res.skipped.map(([n]) => n))).toEqual(new Set(["Fake Orb", "Fake Ring", "Fake Gem"]));
    res = build("poe1", cfg, { hubd: h, extra: new Set(["Fake Orb"]) });
    expect(res.text).toContain("Fake Orb");
    expect(new Set(res.skipped.map(([n]) => n))).toEqual(new Set(["Fake Ring", "Fake Gem"]));
  });
});

const snapshot = (name: string): any => JSON.parse(gunzipSync(readFileSync(path.join(FIX, name))).toString("utf-8"));

const writtenNames = (text: string): Set<string> => {
  const out = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    const m = EXACT_LINE.exec(line);
    if (m) quoted(m[1]).forEach((n) => out.add(n));
  }
  return out;
};

describe("real data", () => {
  it.each([["poe1", POE1], ["poe2", POE2]] as const)("everything on with the real hub writes only real names (%s)", (game, base) => {
    const hubd = { currency: [], items: snapshot(`hub_${game}.json.gz`).items };
    const trade = new Set<string>(snapshot(`trade_names_${game}.json.gz`));
    const cfg: Record<string, any> = { whitelist_gold: true, whitelist_gold_min: 100, wl_map_on: true, wl_map_tier_min: 10, wl_map_rarity_min: "Magic",
      [`whitelist_custom_${game}`]: [{ name: "x", rarities: ["Rare"], tier: "B" }] };
    if (game === "poe2") cfg.whitelist_gem_uncut_poe2 = { "Uncut Skill Gem": 10, "Uncut Spirit Gem": 5, "Uncut Support Gem": 3 };
    const res = w.buildWhitelistFilter(game, cfg, base, hubd, "", null, trade);
    const valid = new Set([...w.knownNames(base), ...trade, "Gold", ...filterGen_UNCUT(game)]);
    const written = writtenNames(res.text);
    expect(written.size).toBeGreaterThan(0);
    expect([...written].filter((n) => !valid.has(n)).slice(0, 10)).toEqual([]);
    expect(written.has("Ducat") || written.has("Catalyst")).toBe(false);
    // the only hub "bases" that are not names: poe1 unique maps ("Map (Tier 10)")
    expect(res.skipped.every(([n]) => n.startsWith("Map (Tier"))).toBe(true);
    // without GGG's list only NeverSink-backed names are written, and the rest is reported, not written
    const res2 = w.buildWhitelistFilter(game, cfg, base, hubd, "", null, null);
    const ok2 = new Set([...w.knownNames(base), "Gold", ...filterGen_UNCUT(game)]);
    expect([...writtenNames(res2.text)].filter((n) => !ok2.has(n))).toEqual([]);
  });

  it("the tabs have their own sounds and only Q is shared", async () => {
    const cfg = { sound_3: "ragnarok.mp3", style_q: null, wl_tier_style: { S: { sound: { kind: "file", file: "own.mp3", volume: 300 } } } };
    const copy = (sm: Record<string, string>) => Object.fromEntries(Object.entries(sm).filter(([, v]) => v).map(([k, v]) => [k, `copied-${v}`]));
    const asked: any[] = [];
    const tier = (await filterCore.buildFilterText({ ...cfg, whitelist_enabled: false }, "poe1", { baseText: POE1, baseTag: "t", copySoundsFn: (sm) => { asked.push(sm); return copy(sm); } }))!;
    const wl = (await filterCore.buildFilterText({ ...cfg, whitelist_enabled: true, wl_v2: true }, "poe1", { hubData: HUB, baseText: POE1, copySoundsFn: (sm) => { asked.push(sm); return copy(sm); }, extraNames: EXTRA }))!;
    expect(asked[0]["3"]).toBe("ragnarok.mp3"); // the NeverSink tab asks for its numbered sounds
    expect("S" in asked[0]).toBe(false);
    expect(asked[1].S).toBe("own.mp3"); // the Whitelist tab for its tier sounds
    expect("3" in asked[1]).toBe(false);
    expect(tier.base_text).toContain('CustomAlertSoundOptional "copied-ragnarok.mp3"');
    expect(tier.base_text).not.toContain("own.mp3");
    const sec: string = wl.generated_section;
    expect(sec).not.toContain("ragnarok"); // not even in NeverSink's copied blocks
    const s = seg(sec, "# tier S\n");
    expect(s).toContain('CustomAlertSoundOptional "copied-own.mp3"');
    expect(s).toContain("PlayAlertSound 6");
  });
});

function filterGen_UNCUT(game: string): string[] {
  return w_UNCUT[game] ?? [];
}
const w_UNCUT: Record<string, string[]> = { poe2: ["Uncut Skill Gem", "Uncut Spirit Gem", "Uncut Support Gem"], poe1: [] };

// ------------------------------------------------------------------------------------------------ through filter_service

const stubHttp = (hubPayload: any, baseText: string): HttpPort => ({
  async getText(url: string): Promise<string> {
    if (url.includes("api.github.com")) return JSON.stringify({ tag_name: "t" });
    if (url.includes("raw.githubusercontent.com")) return baseText;
    if (url.includes("storage.googleapis.com")) return JSON.stringify(hubPayload);
    if (url.includes("/data/items")) return JSON.stringify({ result: [] });
    throw new Error(`unexpected url ${url}`);
  },
});

describe("filter service", () => {
  it.each([false, true])("one sound file in both tabs is copied once (wl_v2=%s)", async (v2) => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), "poe-ts-"));
    const src = path.join(tmp, "src", "ragnarok.mp3");
    mkdirSync(path.dirname(src));
    writeFileSync(src, "sound");
    const fg = { sound_3: src, whitelist_custom_poe2: ["Divine Orb"], whitelist_gold: true, wl_v2: v2,
      wl_tier_style: { S: { sound: { kind: "file", file: src, volume: 300 } } }, game_dir_poe2: path.join(tmp, "game") };
    const config = { get: (k: string, d?: any) => (k === "filter_gen" ? { ...fg } : d), set: () => {}, save: () => {}, appDir: () => path.join(tmp, "app") };
    const env = { fs: new NodeFs({ eol: "lf" }), http: stubHttp(hub(["Divine Orb", "Currency", null]), POE2), documentsDir: tmp, nowMs: () => Date.now(), appVersion: "t" };
    const tier = (await filterService.generateFilter(config, "poe2", "p", env, { mode: "tier" }))!;
    const wl = (await filterService.generateFilter(config, "poe2", "p", env, { mode: "whitelist" }))!;
    const tText = readFileSync(tier.path, "utf-8"), wText = readFileSync(wl.path, "utf-8");
    const line = 'CustomAlertSoundOptional "ragnarok.mp3" 300';
    expect(tText).toContain(line);
    if (v2) expect(readdirSync(path.join(tmp, "game")).filter((n) => n.endsWith(".mp3"))).toEqual(["ragnarok.mp3"]);
    if (v2) { // Divine Orb (S) is first matched by the tier S block, which has the sound
      const s = seg(wText, "# tier S\n");
      expect(s).toContain(line);
      expect(s).toContain('"Divine Orb"');
    } else { // the old whitelist reads the NeverSink tab's numbered sounds
      expect(wText).not.toContain("ragnarok-2");
      expect(wText).toContain(line);
    }
  });
});

// ------------------------------------------------------------------------------------------------ equipment category

interface Item { base: string; cls?: string; rarity: string; area?: number }

/** The first Show/Hide block of the generated filter that an item would match - a small evaluator for the conditions the engine writes */
function blocksMatching(text: string, item: Item): string[] | null {
  const chunks: string[][] = [];
  let cur: string[] | null = null;
  for (const line of text.split(/\r?\n/)) {
    if (line === "Show" || line === "Hide") {
      cur = [line];
      chunks.push(cur);
    } else if (cur !== null && line.trim() && !line.startsWith("#")) cur.push(line.trim());
  }
  const order = ["Normal", "Magic", "Rare", "Unique"];
  for (const chunk of chunks) {
    let ok = true;
    for (const cond of chunk.slice(1)) {
      const i = cond.indexOf(" ");
      const kw = i < 0 ? cond : cond.slice(0, i), rest = i < 0 ? "" : cond.slice(i + 1);
      const names = quoted(rest);
      if (kw === "Class") ok = ok && names.includes(item.cls as string);
      else if (kw === "BaseType") {
        const exact = rest.startsWith("==");
        ok = ok && names.some((n) => (exact ? item.base === n : item.base.toLowerCase().includes(n.toLowerCase())));
      } else if (kw === "Rarity") {
        const ops = rest.split(/\s+/);
        if (ops.length && [">=", "<=", "<", ">"].includes(ops[0])) {
          const a = order.indexOf(item.rarity), b = order.indexOf(ops[1]);
          ok = ok && ({ ">=": a >= b, "<=": a <= b, "<": a < b, ">": a > b } as Record<string, boolean>)[ops[0]];
        } else ok = ok && ops.includes(item.rarity);
      } else if (kw === "AreaLevel") {
        const [op, val] = rest.split(/\s+/);
        const a = item.area ?? 70, b = parseInt(val, 10);
        ok = ok && ({ ">=": a >= b, "<=": a <= b, "<": a < b, ">": a > b, "==": a === b } as Record<string, boolean>)[op];
      }
    }
    if (ok) return chunk;
  }
  return null;
}

const styleLines = (key: string): string[] => filterStyle.styleLines(filterStyle.DEFAULT_STYLES[key]).map((l) => l.trim());

describe("equipment, special classes and tablets", () => {
  it("currency keeps its tier style in low-level zones and typed names beat gear", () => {
    const base = MINI + `
Show # $type->leveling->firstlevels $tier->any
\tRarity Normal
\tAreaLevel <= 4
\tSetFontSize 31

Show # $type->rareid $tier->any
\tRarity Rare
\tClass == "Rings"
\tSetFontSize 35
`;
    const cfg = { whitelist_custom_poe1: [{ name: "Coral", rarities: ["Rare"], tier: "S" }] };
    const text = build("poe1", cfg, { base }).text;
    // Divine Orb is S: a Normal item in an act-1 zone must still land on the S block, not the early-level gear block
    let hit = blocksMatching(text, { base: "Divine Orb", cls: "Stackable Currency", rarity: "Normal", area: 2 })!;
    expect(hit && hit[0] === "Show" && hit.slice(1).join(" ").includes('"Divine Orb"')).toBe(true);
    expect(hit).toContain(w.defaultTierLines(base).S[0].trim());
    expect(hit.join(" ")).not.toContain("SetFontSize 31");
    // a name typed by the player beats a gear block that would also take the item
    hit = blocksMatching(text, { base: "Coral Ring", cls: "Rings", rarity: "Rare", area: 70 })!;
    expect(hit).toContain('BaseType "Coral"');
    expect(hit.join(" ")).not.toContain("SetFontSize 35");
    // without a typed name that Rare ring is the gear block's
    hit = blocksMatching(build("poe1", null, { base }).text, { base: "Coral Ring", cls: "Rings", rarity: "Rare", area: 70 })!;
    expect(hit[0]).toBe("Show");
    expect(hit).toContain('Class == "Rings"');
    // unselected Normal item early on: the early-level gear block does take it (B), never the S block
    hit = blocksMatching(text, { base: "Iron Sword", cls: "One Hand Swords", rarity: "Normal", area: 2 })!;
    expect(hit).toContain("Rarity Normal");
  });

  it.each([["poe1", POE1], ["poe2", POE2]] as const)("real filters: tier names are not gear base types (%s)", (game, base) => {
    const hubd = { currency: [], items: snapshot(`hub_${game}.json.gz`).items };
    const res = w.buildWhitelistFilter(game, {}, base, hubd, "", null, new Set<string>(snapshot(`trade_names_${game}.json.gz`)));
    const shown = new Set([...res.tiers].filter(([, t]) => "SAB".includes(t)).map(([n]) => n));
    const gear = new Set<string>();
    for (const [, , conds] of w.gearBlocks(game, base)) for (const c of conds) if (c.trim().startsWith("BaseType")) quoted(c).forEach((n) => gear.add(n));
    const overlap = [...shown].filter((n) => gear.has(n));
    expect(overlap.filter((n) => /(Orb|Scrap|Whetstone)$/.test(n))).toEqual([]);
  });

  it("a D name stays hidden before special classes and tablets keep the tablet style", () => {
    const hubd = hub(["Essence of Hatred", "Essence", null], ["Ritual Tablet", "Fragment", null], ["Tablet Unique X", "UniqueTablet", "Ritual Tablet"]);
    const cfg = { wl_cat_tier_poe2: { Essence: "D", Fragment: "A" } };
    const text = build("poe2", cfg, { base: MINI, hubd, extra: new Set(["Essence of Hatred", "Ritual Tablet"]) }).text;
    // a D name that also sits in a special class is hidden, the class block never gets it
    let hit = blocksMatching(text, { base: "Essence of Hatred", cls: "Vault Keys", rarity: "Normal" })!;
    expect(hit[0]).toBe("Hide");
    // a tablet named in tier A: Normal-Rare ones take the Tablet block (before the A names), Unique ones the unique block
    hit = blocksMatching(text, { base: "Ritual Tablet", cls: "Tablet", rarity: "Rare" })!;
    expect(hit).toContain('Class "Tablet"');
    hit = blocksMatching(text, { base: "Ritual Tablet", cls: "Tablet", rarity: "Unique" })!;
    expect(hit).toContain("Rarity Unique");
    expect(hit).toContain('BaseType "Ritual Tablet"'); // the fixture's base filter has no such name: bare
  });

  const TABLETS = ["Ritual Tablet", "Expedition Tablet", "Abyss Tablet", "Breach Tablet", "Delirium Tablet"];
  const tabletText = () => {
    const hubd = hub(...TABLETS.map((n): [string, string, string | null] => [n, "Fragment", null]), ["Ritual Unique", "UniqueTablet", "Ritual Tablet"]);
    const cfg = { wl_item_tier_poe2: { "Ritual Tablet": "S", "Expedition Tablet": "A", "Abyss Tablet": "B", "Breach Tablet": "D" } };
    return build("poe2", cfg, { base: MINI, hubd, extra: new Set(TABLETS) });
  };

  it("the tablet default is the Tablet block and only its own tier moves it", () => {
    const names = new Map(TABLETS.map((n) => [n, "Fragment"]));
    let tiers = w.resolveTiers("poe2", { wl_cat_tier_poe2: { Fragment: "D" } }, names, new Map(TABLETS.map((n) => [n, "S"])));
    expect(new Set(tiers.values())).toEqual(new Set([w.TABLET_DEFAULT])); // neither the category tier nor NeverSink's ladder moves them
    tiers = w.resolveTiers("poe2", { wl_item_tier_poe2: { "Abyss Tablet": "A" } }, names, new Map());
    expect(tiers.get("Abyss Tablet")).toBe("A");
    expect(tiers.get("Ritual Tablet")).toBe(w.TABLET_DEFAULT);
    expect(w.resolveTiers("poe1", {}, new Map([["Abyss Tablet", "Fragment"]]), new Map()).get("Abyss Tablet")).toBe("B"); // poe2 only
  });

  it("a tablet set to S / A / B / D follows the tier and the rest keep the tablet style", () => {
    const res = tabletText();
    const text = res.text;
    const ev = (base: string, rarity = "Rare") => blocksMatching(text, { base, cls: "Tablet", rarity })!;
    for (const [name, tier] of [["Ritual Tablet", "S"], ["Expedition Tablet", "A"], ["Abyss Tablet", "B"]] as const) {
      const hit = ev(name);
      expect(hit[0]).toBe("Show");
      expect(hit).not.toContain('Class == "Tablet"'); // its own block, not the Tablet block
      for (const line of w.defaultTierLines(MINI)[tier]) expect(hit, `${tier} ${line}`).toContain(line.trim());
    }
    expect(ev("Breach Tablet")).toEqual(["Hide", 'BaseType "Breach Tablet"']); // hidden by the player
    const rest = ev("Delirium Tablet");
    expect(rest[0]).toBe("Show");
    expect(rest).toContain('Class "Tablet"');
    expect(rest).toContain("Rarity < Unique");
    for (const line of styleLines("Tablet")) expect(rest).toContain(line);
    expect(ev("Brand New Tablet")).toEqual(rest); // a tablet nobody listed at all (new in the game) is shown the same way
    const u = ev("Ritual Tablet", "Unique"); // a unique tablet still goes to the Unique block
    expect(u[0]).toBe("Show");
    expect(u).toContain("Rarity Unique");
    expect(res.report[w.TABLET_DEFAULT]).toBe(1); // Delirium (default)
    expect(count(text, '"Abyss Tablet"')).toBe(1); // each tablet is written once
    expect(count(text, '"Expedition Tablet"')).toBe(1);
  });
});
