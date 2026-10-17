/**
 * Golden regression for filterService.generateFilter and the sound slots end to end (test_filter_service_golden.py,
 * test_filter_sounds_e2e.py). The golden file is the one the ORIGINAL wrote (tests/parity/fixtures/filter_service_golden.json):
 * every log line, event, return value, spied I/O call and the sha256 of the written file must be the same.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { NodeFs } from "../../node/src/nodefs.ts";
import { filterGen, filterOutput, filterService } from "../src/index.ts";
import { FIX } from "../../../tests/parity/runner.ts";
import { fixture } from "./helpers.ts";
import { soundBlockCounts } from "./sound_counts.ts";

const sha = (s: string): string => createHash("sha256").update(Buffer.from(s, "utf-8")).digest("hex");
const cp = (s: string): number => [...s].length;
const fsx = new NodeFs({ eol: "lf" });
const BASE: Record<string, string> = { poe2: fixture("fx:ns_poe2_base"), poe1: fixture("fx:ns_poe1_base") };
const GOLDEN = JSON.parse(readFileSync(path.join(FIX, "filter_service_golden.json"), "utf-8"));

const hub = (fresh = true) => ({
  schema_version: 2, generated_at: new Date(Date.now() - (fresh ? 1 : 100) * 3600_000).toISOString(), league: "L",
  currency: [
    { category: "Currency", name: "Divine Orb", base: null, chaos_value: 200.0 },
    { category: "Currency", name: "Exalted Orb", base: null, chaos_value: 30.0 },
    { category: "Currency", name: "Chaos Orb", base: null, chaos_value: 1.0 },
    { category: "Fragment", name: "Sacrifice Fragment", base: null, chaos_value: 25.0 },
    { category: "Rune", name: "Adept Rune", base: null, chaos_value: 0.5 },
    { category: "Rune", name: "Iron Rune", base: null, chaos_value: 0.2 },
    { category: "Essence", name: "Deafening Essence of Greed", base: null, chaos_value: 0.1 }],
  items: [
    { category: "UniqueWeapon", name: "Widowmaker", base: "Royal Axe", chaos_value: 300.0 },
    { category: "UniqueArmour", name: "Kaom's Heart", base: "Glorious Plate", chaos_value: 80.0 }],
});

type Extra = { write?: Error; sound?: boolean; force?: boolean; league?: string };
const oserr = (errno: number, text: string): Error => Object.assign(new Error(`[Errno ${errno}] ${text}`), { code: ({ 9: "EBADF", 13: "EACCES" } as Record<number, string>)[errno] });

const S: Record<string, [Record<string, any>, string, string, string, Extra]> = {
  wl_empty: [{ whitelist_enabled: true }, "poe2", "ok", "ok", {}],
  wl_gold: [{ whitelist_enabled: true, whitelist_gold: true }, "poe2", "ok", "ok", {}],
  wl_gold25: [{ whitelist_enabled: true, whitelist_gold: true, whitelist_gold_min: 25 }, "poe2", "ok", "ok", {}],
  wl_gold_bad: [{ whitelist_enabled: true, whitelist_gold: true, whitelist_gold_min: "x" }, "poe2", "ok", "ok", {}],
  wl_unique: [{ whitelist_enabled: true, whitelist_unique_all: true }, "poe2", "boom", "ok", {}],
  wl_cats_excl: [{ whitelist_enabled: true, whitelist_cats_poe2: ["Rune", "Currency"], whitelist_cat_exclude_poe2: { Rune: ["Iron Rune"] } }, "poe2", "ok", "ok", {}],
  wl_cats_hubfail: [{ whitelist_enabled: true, whitelist_cats_poe2: ["Rune"], whitelist_gold: true }, "poe2", "boom", "ok", {}],
  wl_cats_hubfail_only: [{ whitelist_enabled: true, whitelist_cats_poe2: ["Rune"] }, "poe2", "boom", "ok", {}],
  wl_gem_poe2: [{ whitelist_enabled: true, whitelist_gem_uncut_poe2: { "Uncut Skill Gem": 15, "Uncut Spirit Gem": 20 },
    whitelist_custom_poe2: [{ name: "Heavy Belt", rarities: ["Normal", "Magic"] }, "Sapphire"], whitelist_gold: true, whitelist_gold_min: 10, whitelist_unique_all: true }, "poe2", "ok", "ok", {}],
  wl_gem_poe1: [{ whitelist_enabled: true, whitelist_gem_names_poe1: ["Fireball", "Vaal Grace"], whitelist_cats_poe1: ["Currency"] }, "poe1", "ok", "ok", {}],
  wl_write_oserr: [{ whitelist_enabled: true, whitelist_gold: true }, "poe2", "ok", "ok", { write: oserr(9, "boom") }],
  wl_write_exc: [{ whitelist_enabled: true, whitelist_gold: true }, "poe2", "ok", "ok", { write: new Error("x") }],
  tier_poe2: [{}, "poe2", "ok", "ok", {}],
  tier_poe2_sounds: [{ sound_s: "SOUND", sound_a: "SOUND", strictness_poe2: 0 }, "poe2", "ok", "ok", { sound: true }],
  tier_poe2_force: [{}, "poe2", "ok", "ok", { force: true, league: "LeagueX" }],
  tier_poe1: [{}, "poe1", "ok", "ok", {}],
  tier_hubfail: [{}, "poe2", "boom", "ok", {}],
  tier_nobase_hubok: [{}, "poe2", "ok", "none", {}],
  tier_nobase_hubfail: [{}, "poe2", "boom", "none", {}],
  tier_poe1_sounds: [{ sound_s: "SOUND", sound_a: "SOUND", sound_b: "SOUND" }, "poe1", "ok", "ok", { sound: true }],
  tier_poe2_hub_would_fail: [{}, "poe2", "boom", "ok", {}], // tier mode must not even ask the hub
  tier_write_oserr: [{}, "poe2", "ok", "ok", { write: oserr(13, "denied") }],
  tier_write_valueerr: [{}, "poe2", "ok", "ok", { write: Object.assign(new Error("nothing"), { pyKind: "ValueError" }) }],
};

async function run(name: string, tmp: string): Promise<any> {
  const [fgIn, gv, hubmode, basemode, extra] = S[name];
  const fg: Record<string, any> = structuredClone(fgIn);
  const app = path.join(tmp, "app"), game = path.join(tmp, "game");
  mkdirSync(app, { recursive: true });
  fg["game_dir_" + gv] = game;
  if (extra.sound) {
    const snd = path.join(tmp, "snd.mp3");
    writeFileSync(snd, "ID3x");
    for (const k of ["sound_s", "sound_a", "sound_b"]) if (k in fg) fg[k] = snd;
  }
  const config = { get: (k: string, d?: any) => (k === "filter_gen" ? fg : d), set: () => {}, save: () => {}, appDir: () => app };
  const calls: any[] = [], logs: [string, string][] = [], events: string[] = [];
  const rel = (p: string): string => path.relative(tmp, p).replaceAll("\\", "/");
  const norm = (m: string): string => m.replaceAll(tmp, "<T>").replaceAll("\\", "/");
  const deps = {
    getPrices: async (p: string) => {
      calls.push(["get_prices", p]);
      if (hubmode === "boom") throw new Error("hub down");
      return hub(hubmode !== "stale");
    },
    fetchBaseFilter: async (g: string, s: number, cacheDir: string, force: boolean): Promise<[string | null, string | null]> => {
      calls.push(["fetch_base_filter", g, s, rel(cacheDir), force]);
      return basemode === "none" ? [null, null] : [BASE[g], "tagX"];
    },
    getNames: async () => new Set<string>(),
    copySounds: async (d: string, m: Record<string, string | null>, decide: any, notify: (t: string) => void) => {
      calls.push(["copy_sounds", rel(d), Object.fromEntries(Object.entries(m).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => [k, !!v]))]);
      return filterOutput.copySounds(fsx, d, m, decide, notify);
    },
    writeFilter: async (d: string, sec: string, base: string | null, nm: string) => {
      calls.push(["write_filter", rel(d), sha(sec).slice(0, 12), base === null ? null : sha(base).slice(0, 12)]);
      if (extra.write) {
        const e: any = extra.write;
        if (e.pyKind === "ValueError") throw new (await import("../src/py.ts")).PyError("ValueError", e.message);
        throw e;
      }
      return filterOutput.writeFilter(fsx, d, sec, base, nm);
    },
  };
  const env = { fs: fsx, http: { getText: async (): Promise<string> => { throw new Error("no net"); } }, documentsDir: tmp, nowMs: () => Date.now(), appVersion: "0.13.5",
    exeName: "โปรแกรมนี้", debugEvent: (m: string) => events.push(m.replaceAll(tmp, "<T>")), deps };
  const res = await filterService.generateFilter(config, gv, `${gv}/prices/latest.json`, env,
    { forceBase: !!extra.force, league: extra.league ?? "", log: (m, t = "info") => logs.push([t, m.replaceAll(tmp, "<T>")]) });
  let out: string | null = null;
  const filters = existsSync(game) ? readdirSync(game).filter((n) => n.endsWith(".filter")).sort() : [];
  const f = filters.length ? path.join(game, filters[0]) : path.join(game, "poe-checker.filter");
  if (existsSync(f)) out = await fsx.readText(f);
  const sounds = existsSync(game) ? readdirSync(game).filter((n) => !n.endsWith(".filter")).sort() : [];
  const nrm = (v: any): any => (v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, nrm(x)])) : Array.isArray(v) ? v.map(nrm) : typeof v === "string" ? norm(v) : v);
  return JSON.parse(JSON.stringify({
    return: nrm(res), logs: logs.map(([t, m]) => [t, m.replaceAll("\\", "/")]), events: events.map((e) => e.replaceAll("\\", "/")), calls,
    file_len: out === null ? null : cp(out), file_sha256: out === null ? null : sha(out), file: out !== null && cp(out) < 5000 ? out : null, sounds,
  }));
}

describe("filterService.generateFilter against the golden of the original", () => {
  it("the scenarios are the golden's", () => expect(Object.keys(S).sort()).toEqual(Object.keys(GOLDEN).sort()));
  it.each(Object.keys(S))("%s", async (name) => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), "poe-ts-"));
    const got = await run(name, tmp);
    const want = GOLDEN[name];
    // the golden holds small files in full (and "" where the original did not keep them): compare the hash always
    expect(got.file_sha256).toBe(want.file_sha256);
    expect(got).toEqual(want);
  });
});

// ------------------------------------------------------------------------------------------------ test_filter_sounds_e2e.py

const NS_SLOTS = ["1", "2", "3", "4", "5", "6"];
const WL_SLOTS = ["S", "A", "B", "C", "G", "Tablet", "Map", "Gem"];
const refs = (text: string): string[] => [...text.matchAll(/^\s*CustomAlertSoundOptional "([^"]+)"/gm)].map((m) => m[1]);

async function runE2E(tmp: string, game: string, v2: boolean, nsSlots = NS_SLOTS) {
  const src = path.join(tmp, "src");
  mkdirSync(src);
  const files: Record<string, string> = {};
  for (const s of [...nsSlots, ...WL_SLOTS, "Q"]) {
    files[s] = path.join(src, `snd_${s}.mp3`);
    writeFileSync(files[s], s.repeat(10)); // different content per slot
  }
  const style = (k: string) => ({ sound: { kind: "file", file: files[k], volume: 300 } });
  const fg: Record<string, any> = Object.fromEntries(nsSlots.map((n) => [`sound_${n}`, files[n]]));
  Object.assign(fg, { style_q: { text: [1, 2, 3, 255], ...style("Q") }, wl_tier_style: Object.fromEntries(WL_SLOTS.map((k) => [k, style(k)])),
    whitelist_gold: true, whitelist_gold_min: 10, wl_map_on: true, wl_map_tier_min: 5,
    [`whitelist_custom_${game}`]: ["Divine Orb", { name: "Chaos Orb", rarities: ["Normal"], tier: "C" }], whitelist_gem_tier: "A", wl_v2: v2, sound_format: 2 });
  if (game === "poe2") fg.whitelist_gem_uncut_poe2 = { "Uncut Skill Gem": 3 };
  else fg.whitelist_gem_names_poe1 = ["Fireball"];
  const gameDir = path.join(tmp, "game");
  const config = { get: (k: string, d?: any) => (k === "filter_gen" ? { ...fg, [`game_dir_${game}`]: gameDir } : d), set: () => {}, save: () => {}, appDir: () => path.join(tmp, "app") };
  const base: string = fixture(`fx:ns_${game}_s2`);
  const hubd = fixture(`fx:hub_${game}`);
  const env = { fs: fsx, http: { getText: async (): Promise<string> => "" }, documentsDir: tmp, nowMs: () => Date.now(), appVersion: "t",
    deps: { fetchBaseFilter: async (): Promise<[string | null, string | null]> => [base, "t"], getPrices: async () => hubd, getNames: async () => new Set<string>() } };
  const tier = (await filterService.generateFilter(config, game, "p", env, { mode: "tier" }))!;
  const wl = (await filterService.generateFilter(config, game, "p", env, { mode: "whitelist" }))!;
  return [readFileSync(tier.path, "utf-8"), readFileSync(wl.path, "utf-8"), readdirSync(gameDir).filter((n) => n.endsWith(".mp3")).sort(), base] as const;
}

describe("every sound slot, both tabs, both games, through the service", () => {
  it.each(["poe1", "poe2"])("the six numbered sounds land on every block of their number (%s)", async (game) => {
    const [tier, , , base] = await runE2E(mkdtempSync(path.join(os.tmpdir(), "poe-ts-")), game, true);
    const counts = soundBlockCounts(base);
    expect(Object.keys(counts).every((k) => "123456".includes(k))).toBe(true);
    const lines = tier.split("\n");
    const got: Record<string, number> = Object.fromEntries(NS_SLOTS.map((n) => [n, 0]));
    for (const b of filterGen.parseBlocks(lines)) {
      const body = lines.slice(b.start + 1, b.end);
      const have = refs(body.join("\n"));
      const num = filterGen.soundIdOf(body);
      if (b.blockType === "Show" && num !== null && num in filterGen.SOUND_SLOT_OF_ID) {
        const slot = filterGen.SOUND_SLOT_OF_ID[num];
        expect(have, num).toEqual([`snd_${slot}.mp3`]); // the right slot, once
        got[slot]++;
      } else if (!have.join("").includes("snd_Q")) expect(have).toEqual([]);
    }
    for (const [num, slot] of Object.entries(filterGen.SOUND_SLOT_OF_ID)) expect(got[slot], `${num}->${slot}`).toBe(counts[num] ?? 0);
    const total = Object.values(got).reduce((a, b) => a + b, 0);
    expect(total).toBe(Object.values(counts).reduce((a, b) => a + b, 0));
    expect(total).toBeGreaterThan(100);
  });

  it.each([["poe1", false], ["poe1", true], ["poe2", false], ["poe2", true]] as const)("every sound reaches its own file and nothing is shared but Q (%s, wl_v2=%s)", async (game, v2) => {
    const [tier, wl, folder] = await runE2E(mkdtempSync(path.join(os.tmpdir(), "poe-ts-")), game, v2);
    const rt = new Set(refs(tier)), rw = new Set(refs(wl));
    const name = (s: string): string => `snd_${s}.mp3`;
    for (const s of [...NS_SLOTS, "Q"]) expect(rt.has(name(s)), s).toBe(true);
    for (const s of WL_SLOTS) expect(rt.has(name(s))).toBe(false);
    if (v2) {
      for (const s of ["S", "A", "B", "C", "Q", "G", "Map", "Gem", ...(game === "poe2" ? ["Tablet"] : [])]) expect(rw.has(name(s)), s).toBe(true);
      for (const s of NS_SLOTS) expect(rw.has(name(s))).toBe(false); // the tabs share no sound but Q
    } else {
      expect(rw.has(name("1"))).toBe(true);
      expect(rw.has(name("Q"))).toBe(true);
    }
    expect([...folder, ...rt, ...rw].join("")).not.toContain("-2");
    const all = new Set([...rt, ...rw]);
    for (const f of all) expect(folder).toContain(f); // every file that is referenced is in the folder
    expect(new Set(folder).size).toBe(folder.length);
    const allowed = new Set([...all, ...WL_SLOTS.filter((s) => s !== "Tablet" || game === "poe2").map(name)]);
    for (const f of folder) expect(allowed.has(f)).toBe(true);
  });

  it("an empty slot writes nothing and leaves NeverSink's own sound", async () => {
    const [tier, , , base] = await runE2E(mkdtempSync(path.join(os.tmpdir(), "poe-ts-")), "poe2", true, ["2", "5"]);
    expect(new Set(refs(tier))).toEqual(new Set(["snd_2.mp3", "snd_5.mp3", "snd_Q.mp3"]));
    const counts = soundBlockCounts(base);
    const n = (t: string, s: string): number => t.split(s).length - 1;
    expect(n(tier, 'CustomAlertSoundOptional "snd_2.mp3"')).toBe(counts["1"]); // slot 2 <- id 1
    expect(n(tier, 'CustomAlertSoundOptional "snd_5.mp3"')).toBe(counts["4"]); // slot 5 <- id 4
    expect(n(tier, "PlayAlertSound")).toBe(n(base, "PlayAlertSound")); // NeverSink's own sounds all stay
  });
});
