/** filter_core - pure core shared by desktop and the web build (test_filter_core.py, test_bad_names.py, test_filter_vocabulary.py) */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { WlModel, filterCore, filterWhitelist as w, py } from "../src/index.ts";
import { neversinkFilename as _unused } from "../src/filter_core.ts";
import { data, everythingOn, fixture, lint, model } from "./helpers.ts";

void _unused;
const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src");

describe("filter_core purity", () => {
  it("the core imports no node:* / DOM-only module (it runs in the browser and in Node)", () => {
    for (const f of readdirSync(SRC).filter((n) => n.endsWith(".ts"))) {
      const text = readFileSync(path.join(SRC, f), "utf-8");
      const imports = [...text.matchAll(/^(?:import|export)[^;]*?from\s+"([^"]+)"/gms)].map((m) => m[1]);
      for (const spec of imports) expect(spec.startsWith("./") || spec === "pako", `${f} imports ${spec}`).toBe(true);
    }
  });

  it("the NeverSink URLs are what urllib would build", () => {
    for (const game of ["poe1", "poe2"]) {
      for (let strictness = 0; strictness < filterCore.NEVERSINK_LEVELS.length; strictness++) {
        const fn = filterCore.neversinkFilename(game, strictness);
        expect(filterCore.quote(fn)).toBe(encodeURIComponent(fn).replaceAll("%2F", "/").replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase()));
        expect(filterCore.neversinkFileUrl(game, "1.2.3", strictness)).toBe(
          `https://raw.githubusercontent.com/${filterCore.NEVERSINK_REPO[game]}/1.2.3/${filterCore.quote(fn)}`);
      }
      expect(filterCore.neversinkLatestApiUrl(game)).toBe(`https://api.github.com/repos/${filterCore.NEVERSINK_REPO[game]}/releases/latest`);
    }
    expect(filterCore.neversinkFilename("poe2", 0)).toBe("NeverSink's filter 2 - 0-SOFT.filter");
    expect(filterCore.neversinkFilename("poe1", 2)).toBe("NeverSink's filter - 2-SEMI-STRICT.filter");
  });
});

describe("compose / fetch plan", () => {
  it("composeFilterBody", () => {
    expect(filterCore.composeFilterBody("SEC", null)).toBe("SEC");
    expect(filterCore.composeFilterBody("SEC", "BASE")).toBe("SEC\n# ===== base filter below =====\nBASE");
    expect(filterCore.composeFilterBody("", "BASE")).toBe("\n# ===== base filter below =====\nBASE");
    expect(() => filterCore.composeFilterBody("  \n", null)).toThrow("nothing to write — no NeverSink base filter available");
  });

  it("planFetch", () => {
    expect(filterCore.planFetch({}, "poe2")).toEqual({ mode: "tier", hub: false, neversink: true });
    const wl = { whitelist_enabled: true };
    expect(filterCore.planFetch(wl, "poe2")).toEqual({ mode: "whitelist", hub: false, neversink: false });
    expect(filterCore.planFetch({ ...wl, whitelist_cats_poe2: ["Rune"] }, "poe2").hub).toBe(true);
    expect(filterCore.planFetch({ ...wl, whitelist_cats_poe2: ["Rune"] }, "poe1").hub).toBe(false);
  });
});

const hub = () => ({
  schema_version: 2, league: "L", generated_at: new Date(Date.now() - 3600_000).toISOString(),
  currency: [
    { category: "Currency", name: "Divine Orb", base: null, chaos_value: 200.0 },
    { category: "Rune", name: "Adept Rune", base: null, chaos_value: 0.5 },
    { category: "Rune", name: "Iron Rune", base: null, chaos_value: 0.2 }],
  items: [],
});
const BASE = 'Show # %D5 $type->currency $tier->t1\n\tBaseType == "Chaos Orb"\n\tSetFontSize 40\n\n' +
  'Show # %D1\n\tBaseType == "Divine Orb"\n\tSetFontSize 30\n';

describe("build_filter_text", () => {
  it("whitelist build with and without hub", async () => {
    const cfg = { whitelist_enabled: true, whitelist_cats_poe2: ["Rune"], whitelist_cat_exclude_poe2: { Rune: ["Iron Rune"] },
      whitelist_gold: true, whitelist_gold_min: 25 };
    const logs: string[] = [];
    let res = (await filterCore.buildFilterText(cfg, "poe2", { hubData: hub(), log: (m) => logs.push(m) }))!;
    expect(res.mode).toBe("whitelist");
    expect(res.base_text).toBeNull();
    expect(res.count).toBe(2);
    expect(res.generated_section).toContain('"Adept Rune"');
    expect(res.generated_section).not.toContain("Iron Rune");
    expect(res.generated_section).toContain("StackSize >= 25");
    expect(logs).toEqual([]);
    res = (await filterCore.buildFilterText(cfg, "poe2", { hubData: null }))!; // hub down: categories skipped
    expect(res.count).toBe(1);
    expect(res.generated_section).not.toContain("Adept Rune");
  });

  it("whitelist with nothing selected returns null and warns", async () => {
    const logs: [string, string][] = [];
    expect(await filterCore.buildFilterText({ whitelist_enabled: true }, "poe2", { log: (m, t = "info") => logs.push([t, m]) })).toBeNull();
    expect(logs.map(([t]) => t)).toEqual(["warn"]);
  });

  it("tier mode is NeverSink's base + header and never looks at prices", async () => {
    for (const h of [null, hub(), { ...hub(), generated_at: new Date(Date.now() - 500 * 3600_000).toISOString() }]) {
      const res = await filterCore.buildFilterText({}, "poe2", { hubData: h, baseText: BASE, baseTag: "t1" });
      expect(res).toEqual({ mode: "tier", generated_section: filterCore.TIER_HEADER, base_text: BASE, base_tag: "t1" });
    }
    expect(filterCore.composeFilterBody(filterCore.TIER_HEADER, BASE)).toBe(filterCore.TIER_HEADER + "\n# ===== base filter below =====\n" + BASE);
  });

  it("tier mode without a base filter has nothing to write", async () => {
    const res = (await filterCore.buildFilterText({}, "poe2", { hubData: hub(), baseText: null, baseTag: null }))!;
    expect(res.generated_section).toBe("");
    expect(res.base_text).toBeNull();
    expect(() => filterCore.composeFilterBody(res.generated_section, res.base_text)).toThrow();
  });

  it("tier mode adds custom sounds only through the copied names", async () => {
    const logs: [string, string][] = [], asked: any[] = [];
    const base = 'Show # $type->currency $tier->t1\n\tBaseType == "Divine Orb"\n\tPlayAlertSound 6 300\n\n' +
      'Show # $type->6l $tier->x\n\tLinkedSockets 6\n\tPlayAlertSound 6 300\n';
    const res = (await filterCore.buildFilterText({ sound_1: "My Ping.MP3" }, "poe2", {
      baseText: base, baseTag: "t", copySoundsFn: (m) => { asked.push(m); return { "1": "poe-checker-1.MP3" }; },
      log: (m, t = "info") => logs.push([t, m]) }))!;
    expect(asked).toEqual([{ "1": "My Ping.MP3", "2": null, "3": null, "4": null, "5": null, "6": null, Q: null }]);
    // every Show block of NeverSink's number 6 (the ladder block and the 6-link block alike)
    expect(res.base_text.split('CustomAlertSoundOptional "poe-checker-1.MP3" 300').length - 1).toBe(2);
    expect(res.base_text).not.toContain("My Ping");
    expect(logs.length).toBe(1);
    expect(logs[0][0]).toBe("ok");
    const none = (await filterCore.buildFilterText({}, "poe2", { baseText: base, baseTag: "t", copySoundsFn: () => ({}) }))!;
    expect(none.base_text).toBe(base);
  });

  it("real base files, no sounds: the output is header + base byte for byte", async () => {
    for (const [game, ref] of [["poe1", "fx:ns_poe1_base"], ["poe2", "fx:ns_poe2_base"]] as const) {
      const base = fixture(ref);
      const res = (await filterCore.buildFilterText({ ["strictness_" + game]: 2 }, game, { baseText: base, baseTag: "t" }))!;
      expect(filterCore.composeFilterBody(res.generated_section, res.base_text)).toBe(filterCore.TIER_HEADER + "\n# ===== base filter below =====\n" + base);
    }
  });
});

// ------------------------------------------------------------------------------------------------ test_bad_names.py

const BAD = ["[DNT] Not Shown To Players", "[DNT] Incursion Gemcutter's Prism (not visible to players)", "INCOMPLETE",
  "Prism (not visible to players)", "60634", "Blood Stasis ", " Leading", "NonEleBowRangerPhysNoble", "ChaosMinionWitchChaosHitNoble"];
const GOOD = ["Chaos Orb", "Orb of Alchemy", "Thaumaturgic Flux (Level 4)", "Thaumaturgic Flux (Level 20)", "Map (Tier 12)",
  "Map (Tier 14)", "Map (Tier 16)", "Waystone (Tier 15)", "Maelström Staff", "Mórrigan's Insight", "Ring", "Gold", "Leatherbound Hood",
  "Time-Lost Diamond", "Divine Orb", "Uncut Skill Gem", "Atziri's Splendour"];

describe("bad names", () => {
  it.each(BAD)("known bad name is caught: %s", (name) => expect(w.badName(name)).toBe(true));
  it.each(GOOD)("real-looking name is not caught: %s", (name) => expect(w.badName(name)).toBe(false));

  it.each(["poe1", "poe2"])("no real name of the program is caught (%s)", (game) => {
    const [hub, base] = data(game);
    const names = new Set<string>([...w.knownNames(base), ...w.universe(game, hub, base).keys(), ...w.uniqueEntries(hub).map(([, b]) => b)]);
    const hits = py.sortedStr([...names].filter((n) => w.badName(n)));
    expect(hits).toEqual([]);
    expect(names.size).toBeGreaterThan(1500);
  });

  it.each(["poe1", "poe2"])("bad names are left out, reported and change nothing else (%s)", (game) => {
    const [hub, base, extra] = data(game);
    const plain = model(game).build();
    const dirty = structuredClone(hub);
    dirty.items.push({ category: "Currency", name: "[DNT] Test Currency", base: "" }, { category: "Currency", name: "INCOMPLETE", base: "" },
      { category: "UniqueAccessory", name: "Bad Unique", base: "[DNT] Test Base" });
    const m = new WlModel(game);
    m.setData(dirty, base, new Set([...extra, "[DNT] Test Currency", "INCOMPLETE", "[DNT] Test Base", "60634"])); // even confirmed by the names list: still left out
    const res = m.build();
    expect(res.text).toBe(plain.text); // nothing real changed, nothing bad written
    const reported = new Set(res.bad_names.map(([n]) => n));
    expect(reported.has("[DNT] Test Currency") && reported.has("INCOMPLETE")).toBe(true);
    for (const bad of ["[DNT] Test Currency", "INCOMPLETE", "Bad Unique"]) expect(res.text).not.toContain(`"${bad}"`);
    expect(res.text).not.toContain('"[DNT] Test Base"');
  });

  it("the status says which names were left out", async () => {
    const [hub0, base, extra] = data("poe2");
    const hub = structuredClone(hub0);
    hub.items.push({ category: "Currency", name: "[DNT] Test Currency", base: "" });
    const logs: [string, string][] = [];
    const res = (await filterCore.buildFilterText({ whitelist_enabled: true, wl_v2: true }, "poe2", {
      hubData: hub, baseText: base, extraNames: new Set([...extra, "[DNT] Test Currency"]), log: (m, t = "info") => logs.push([t, m]) }))!;
    expect(res.bad_names).toEqual([["[DNT] Test Currency", "item"]]);
    expect(logs.some(([t, m]) => t === "warn" && m.includes("ชื่อที่รู้ว่าไม่ใช่ชื่อไอเท็ม") && m.includes("[DNT] Test Currency"))).toBe(true);
  });

  it("Map (Tier N) and Thaumaturgic Flux names are written like before", () => {
    const [hub0, base, extra] = data("poe1");
    const hub = structuredClone(hub0);
    hub.items.push({ category: "UniqueMap", name: "Cortex", base: "Map (Tier 14)" }, { category: "UniqueMap", name: "Hallowed Ground", base: "Map (Tier 16)" },
      { category: "UniqueMap", name: "Mao Kun", base: "Map (Tier 7)" }); // nobody confirms Tier 7
    const m = new WlModel("poe1");
    m.setData(hub, base, new Set([...extra, "Map (Tier 14)", "Map (Tier 16)"]));
    const res = m.build();
    expect(res.bad_names.length).toBe(0);
    expect(res.text).toContain('"Map (Tier 14)"');
    expect(res.text).toContain('"Map (Tier 16)"');
    expect(new Set(res.skipped.map(([n]) => n)).has("Map (Tier 7)")).toBe(true);
    expect(res.text).not.toContain('"Map (Tier 7)"');
    const p2 = model("poe2").build();
    expect(p2.bad_names.length).toBe(0);
    expect(p2.text.split("Thaumaturgic Flux (Level").length - 1).toBeGreaterThanOrEqual(20);
  });
});

// ------------------------------------------------------------------------------------------------ test_filter_vocabulary.py

describe("filter vocabulary lint", () => {
  it.each(["poe1", "poe2"])("every line is a known keyword and value (%s)", (game) => {
    const [base, text] = everythingOn(game);
    expect(lint(text, base)).toEqual([]);
  });

  it.each(["poe1", "poe2"])("the default whitelist has no unknown lines (%s)", (game) => {
    const [hub, base, names] = data(game);
    const res = w.buildWhitelistFilter(game, {}, base, hub, "", null, names);
    expect(lint(res.text, base)).toEqual([]);
  });

  it("the lint catches bad lines", () => {
    const base = fixture("fx:ns_poe1_s2");
    const bad = "Show\n    Colour 1 2 3\n    SetFontSize 99\n    MinimapIcon 3 Teal Blob\n    Rarity Epic\n    PlayAlertSound 17\n";
    expect(lint(bad, base).length).toBe(5);
  });
});
