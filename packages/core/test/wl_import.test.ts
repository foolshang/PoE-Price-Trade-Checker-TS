/** Opening old whitelist filters (test_wl_import.py) and what the window says when a file is opened (test_wl_session_golden.py) */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { WlModel, filterCore, filterStyle, filterWhitelist as w, wlEmbed, wlImport, wlSession } from "../src/index.ts";
import type { FolderLike } from "../src/wl_import.ts";
import { FIX } from "../../../tests/parity/runner.ts";
import { data, fixture, generate, lint, model, readText, tmpDir } from "./helpers.ts";

const V2: [string, string][] = [["v2_poe1_wl_sample", "poe1"], ["v2_poe2_checker_whitelist", "poe2"], ["v2_poe2_bus", "poe2"], ["v2_poe2_wl_sample", "poe2"]];
const oldText = (name: string): string => fixture(`fx:old_${name}`);
const J = (x: unknown): string => JSON.stringify(x);
const look = (lines: string[] | undefined) => filterStyle.linesToStyle(lines ?? []);

/** What the old file (a) says that the regenerated one (b) does not - the report of the mismatches. */
function differences(a: wlImport.Summary, b: wlImport.Summary, fresh: Set<string> = new Set(), skipBases: Set<string> = new Set()): string[] {
  const out: string[] = [];
  for (const f of ["shown", "unique_bases", "tablet_own"] as const) {
    const x = a[f] as Map<string, unknown>, y = b[f] as Map<string, unknown>;
    for (const k of [...new Set([...x.keys(), ...y.keys()])].sort()) {
      if (J(x.get(k)) === J(y.get(k))) continue;
      if (f === "shown" && !x.has(k) && fresh.has(k)) continue;
      if (f === "unique_bases" && skipBases.has(k)) continue;
      if (w.badName(k)) continue; // an old file may carry names that are never written any more
      out.push(`${f}: ${k} ${J(x.get(k))} -> ${J(y.get(k))}`);
    }
  }
  const val = (s: wlImport.Summary, f: string): string => {
    const v: any = (s as any)[f];
    return J(v instanceof Map ? Object.fromEntries(v) : v);
  };
  for (const f of ["gold_on", "gold_min", "map_on", "map_tier", "map_rarity", "gem_uncut", "gem_names", "custom"]) {
    if (val(a, f) !== val(b, f)) out.push(`${f}: ${val(a, f)} -> ${val(b, f)}`);
  }
  for (const t of ["S", "A", "B"]) if (a.tier_lines.has(t) && J(look(a.tier_lines.get(t))) !== J(look(b.tier_lines.get(t)))) out.push(`look of tier ${t}`);
  for (const f of ["gold_block", "tablet_block", "map_block"] as const) {
    const x = a[f], y = b[f];
    if (x !== null && (y === null || J(look(x.style)) !== J(look(y.style)))) out.push(`look of ${f}`);
  }
  return out; // (gear blocks and special classes are NeverSink's own blocks now: nothing of an old file is carried over)
}

const freshNames = (m: WlModel, game: string): Set<string> => {
  const cats = new Set((w.NAMED_CATEGORIES[game] ?? []).map(([c]) => c));
  return new Set([...m._names].filter(([, c]) => cats.has(c)).map(([n]) => n));
};

function reopen(name: string, game: string) {
  const [hub, base, extra] = data(game);
  const cur = new WlModel(game);
  cur.setData(hub, base, extra);
  const res = wlImport.read(oldText(name), game, cur)!;
  return { res, text: res.model.build().text };
}

describe("old whitelist files", () => {
  it.each(V2)("a v2 file reads back and generates the same tiers and looks (%s)", (name, game) => {
    const { res, text } = reopen(name, game);
    expect(res.version).toBe("v2");
    expect(differences(res.summary, wlImport.summarize(text)!, freshNames(res.model, game), res.unique_mismatch)).toEqual([]);
    expect(res.unique_mismatch.size).toBeLessThanOrEqual(20); // a name on two bases: only a handful, and named in the notes
    expect(res.unique_mismatch.size === 0 || res.notes.some((n) => n.includes("ไม่ตรงไฟล์เดิม"))).toBe(true);
    expect(lint(text, data(game)[1])).toEqual([]);
    expect(wlEmbed.classify(wlEmbed.embed(text, res.model.cfg(), game))).toBe("ok"); // generate -> embedded settings
  });

  it.each(V2)("a v2 file reopened twice is stable (%s)", (name, game) => {
    const { res, text } = reopen(name, game);
    const again = WlModel.fromConfig(wlEmbed.extract(wlEmbed.embed(text, res.model.cfg(), game))!.cfg, game);
    const d = data(game);
    again.setData(d[0], d[1], d[2]);
    expect(again.build().text).toBe(text);
  });

  it("lists newer than the file open with NeverSink's defaults and the status says so", () => {
    const { res, text } = reopen("v2_poe1_wl_sample", "poe1");
    const notes = res.notes.join(" ");
    expect(notes).toContain("ใช้ค่าเริ่มต้นของ NeverSink");
    for (const c of ["Runegraft", "Vial", "Corpse", "Wombgift", "Relic"]) expect(notes).toContain(c);
    expect(notes).toContain("ใช้ block ของ NeverSink แทนค่าในไฟล์เก่า"); // the cut categories of the old file are named
    const m = res.model;
    const named = new Set(w.NAMED_CATEGORIES.poe1.map(([x]) => x));
    const fresh = [...m._names].filter(([, c]) => named.has(c)).map(([n]) => n);
    expect(fresh.length).toBeGreaterThan(0);
    expect(fresh.some((n) => n in m.item_tier)).toBe(false); // untouched = NeverSink's own tier
    for (const c of ["Runegraft", "Vial", "Corpse"]) {
      const rows = m.rows(c);
      expect(rows.length > 0 && rows.every((r) => !r.user_set)).toBe(true);
    }
    const shown = wlImport.summarize(text)!.shown;
    expect(shown.get("Runegraft of Gemcraft")![0]).toBe("S");
    expect(text.split("\n").some((l) => l.startsWith("# neversink (gems): gems->"))).toBe(true); // the generic gems: NeverSink's own blocks
    expect(text).toContain("# neversink (");
    expect([...m._names].some(([n, c]) => c === "Currency" && !shown.has(n))).toBe(true); // names of a list the file does have stay C when it does not list them
  });

  it("a v1 file keeps exactly the names it showed", () => {
    const { res, text } = reopen("v1_poe1_checker_whitelist", "poe1");
    expect(res.version).toBe("v1");
    const sm = res.summary;
    const shownNew = new Set(wlImport.summarize(text)!.shown.keys());
    const universe = new Set(res.model._names.keys());
    expect(sm.names_v1.size).toBeGreaterThan(0);
    expect([...sm.names_v1].filter((n) => universe.has(n)).every((n) => shownNew.has(n))).toBe(true);
    const fresh = freshNames(res.model, "poe1");
    expect([...shownNew].filter((n) => !sm.names_v1.has(n) && !fresh.has(n))).toEqual([]); // nothing the old file hid is shown now (new lists aside)
    expect(res.model.gold).toBe(true);
    expect(res.model.gold_min).toBe(10);
    const notes = res.notes.join(" ");
    expect(notes).toContain("v1");
    expect(notes).toContain("สไตล์ tier S");
    expect(notes).toContain("map");
    expect(lint(text, data("poe1")[1])).toEqual([]);
  });

  it("unreadable parts keep the remembered values", () => {
    const [hub, base, extra] = data("poe1");
    const cur = new WlModel("poe1");
    cur.setData(hub, base, extra);
    cur.setStyleFromEditor("S", { ...cur.effectiveStyle("S"), size: 33 });
    const res = wlImport.read(oldText("v1_poe1_checker_whitelist"), "poe1", cur)!;
    expect(res.model.tier_style.S.size).toBe(33); // no tier block in a v1 file: kept
    expect(res.notes.join(" ")).toContain("สไตล์ tier S");
    cur.gold = false;
    cur.gold_min = 0; // what the file says wins over what was remembered
    expect(wlImport.read(oldText("v1_poe1_checker_whitelist"), "poe1", cur)!.model.gold_min).toBe(10);
  });

  it("a file that is not a whitelist file of ours is not read", () => {
    const cur = model("poe1");
    expect(wlImport.read('Show\n    Class "Gems"\n', "poe1", cur)).toBeNull();
    expect(wlImport.read("# Generated by PoE Price & Trade Checker\nShow\n", "poe1", cur)).toBeNull();
    expect(wlImport.guessGame(oldText("v2_poe2_bus"))).toBe("poe2");
  });

  it("stackable names the old file showed stay shown at every stack", () => {
    const [hub, base, extra] = data("poe1");
    const cur = new WlModel("poe1");
    cur.setData(hub, base, extra);
    const card = [...cur._stackDefaults.keys()].sort()[0];
    const text = oldText("v2_poe1_wl_sample").replace("# tier B\nShow\n    BaseType == ", `# tier B\nShow\n    BaseType == "${card}" `);
    const res = wlImport.read(text, "poe1", cur)!;
    expect(res.model.item_stack[card]).toBe(1);
    expect(res.notes.join(" ")).toContain("StackSize");
    expect(res.model.build().text.split("# tier B")[1].split("\n\n")[0]).toContain(`"${card}"`);
  });
});

// ---------------------------------------------------------------- lists newer than the settings (v0.10.3 report)

const NEW_LISTS: Record<string, string[]> = { poe1: ["Runegraft", "Vial", "Corpse", "Wombgift", "Relic"], poe2: ["Relic"] };

function filledWithD(game: string): [WlModel, Record<string, any>] {
  const m = model(game);
  for (const c of NEW_LISTS[game]) for (const n of m._names.keys()) if (m._names.get(n) === c) m.item_tier[n] = "D";
  m.setStyleFromEditor("A", { ...m.effectiveStyle("A"), size: 36 }); // something the player really set
  m.setRow("Currency", "Chaos Orb", "S");
  const fg = m.toConfig({});
  delete fg[`wl_lists_${game}`]; // v0.10.0 - v0.10.2 did not record it
  return [m, fg];
}

/** the headless twin of FilterGenWindow.open_filter: read the file, hand it to wl_session, adopt the model */
function headlessWindow(game: string, prep?: (m: WlModel) => void) {
  const model0 = WlModel.fromConfig({}, game);
  const d = data(game);
  model0.setData(d[0], d[1], d[2]);
  const win = { game, model: model0, wlData: d as any, log: [] as string[], name: "poe-checker-whitelist", opened: null as string | null };
  for (const [, msg] of wlSession.dataLoadedMessages(model0, d[1])) win.log.push(msg);
  prep?.(model0);
  return {
    win,
    open(file: string): boolean {
      const text = readFileSync(file, "utf-8");
      const folder = path.dirname(file);
      const fl: FolderLike = { path: (n) => path.join(folder, n), isFile: (n) => { try { return readFileSync(path.join(folder, n)) !== null; } catch { return false; } } };
      const out = wlSession.openText(text, path.basename(file), game, win.model, win.wlData, {
        folder: fl, soundFile: (name) => (fl.isFile(name) ? fl.path(name) : null) });
      for (const [, msg] of out.messages) win.log.push(msg);
      if (!out.ok) return false;
      win.model = out.model!;
      if (win.wlData !== null && !win.model.loaded) win.model.setData(win.wlData[0], win.wlData[1], win.wlData[2]);
      win.name = path.basename(file).replace(/\.[^.]*$/, "");
      win.opened = path.basename(file);
      return true;
    },
  };
}

describe("lists newer than the settings", () => {
  it.each(["poe1", "poe2"])("a file from 0.10.2 with every new list at D gets NeverSink's defaults (%s)", async (game) => {
    const [, fg] = filledWithD(game);
    const p = (await generate(fg, game, tmpDir(), "from-0102")).path;
    expect(wlEmbed.extract(readText(p))!.cfg[`wl_lists_${game}`]).toBeUndefined();
    const h = headlessWindow(game);
    expect(h.open(p)).toBe(true);
    const opened = h.win.model;
    const fresh = model(game); // nothing changed: NeverSink's own values
    for (const c of NEW_LISTS[game]) {
      expect(opened.rows(c).map((r) => [r.key, r.tier])).toEqual(fresh.rows(c).map((r) => [r.key, r.tier]));
      expect(opened.rows(c).some((r) => r.user_set)).toBe(false);
    }
    const log = h.win.log.join("\n");
    expect(log).toContain("ใช้ค่าเริ่มต้นของ NeverSink");
    expect(log).toContain("Relic");
    expect(opened.item_tier["Chaos Orb"]).toBe("S");
    expect(opened.tier_style.A.size).toBe(36); // the player's own values stay
    const again = opened.toConfig({}); // saved again: the lists are recorded
    expect(again[`wl_lists_${game}`]).toBeTruthy();
    expect(again[`wl_lists_${game}`]).toContain("Relic");
    expect(opened._names).toBeTruthy();
  });

  it.each(["poe1", "poe2"])("a list the player sets to D in the new version stays D (%s)", async (game) => {
    const m = model(game);
    for (const c of NEW_LISTS[game]) m.setCategory(c, "D");
    const p = (await generate(m.toConfig({}), game, tmpDir(), "player-c")).path;
    expect(wlEmbed.extract(readText(p))!.cfg[`wl_lists_${game}`]).toBeTruthy(); // recorded
    const h = headlessWindow(game);
    expect(h.open(p)).toBe(true);
    for (const c of NEW_LISTS[game]) expect(h.win.model.rows(c).every((r) => r.tier === "D"), c).toBe(true);
    expect(h.win.log.join("\n")).not.toContain("ใช้ค่าเริ่มต้นของ NeverSink");
  });

  it("a list partly set in an unrecorded config is the player's own", () => {
    const m = model("poe2");
    m.item_tier["Coffer Relic"] = "D"; // one relic only: the player's choice
    const fg = m.toConfig({});
    delete fg.wl_lists_poe2;
    const back = WlModel.fromConfig(fg, "poe2");
    const d = data("poe2");
    back.setData(d[0], d[1], d[2]);
    expect(back.item_tier).toEqual({ "Coffer Relic": "D" });
    expect(back.takeNotes()).toEqual([]);
  });

  it("saved settings are repaired too and unknown lists are not written", () => {
    const [, fg] = filledWithD("poe2");
    const m = WlModel.fromConfig(structuredClone(fg), "poe2"); // starts from the saved settings
    const d = data("poe2");
    m.setData(d[0], d[1], d[2]);
    expect(m.rows("Relic").every((r) => r.tier !== "D")).toBe(true);
    expect(m.toConfig({}).wl_lists_poe2).toContain("Relic");
    const never = WlModel.fromConfig(fg, "poe2"); // data never loaded: nothing to say about lists
    expect("wl_lists_poe2" in never.toConfig({})).toBe(false);
  });

  it("a new list in a file that recorded its lists gets defaults", () => {
    const m = model("poe1");
    const fg = m.toConfig({});
    fg.wl_lists_poe1 = fg.wl_lists_poe1.filter((x: string) => x !== "Vial");
    fg.wl_item_tier_poe1["Vial of Fate"] = "D";
    const back = WlModel.fromConfig(fg, "poe1");
    const d = data("poe1");
    back.setData(d[0], d[1], d[2]);
    expect("Vial of Fate" in back.item_tier).toBe(false);
    expect(back.takeNotes().join(" ")).toContain("Vial");
  });
});

describe("the program version is recorded in the settings", () => {
  it("embedded settings record the version every time", async () => {
    for (const game of ["poe1", "poe2"]) {
      const emb = wlEmbed.extract(readText((await generate({}, game, tmpDir(), `ver-${game}`)).path))!;
      expect(emb.app).toBe("t"); // the test service passes appVersion "t"
      expect(emb.game).toBe(game);
    }
    const [hub, base, extra] = data("poe2");
    const fg = { ...model("poe2").toConfig({}), whitelist_enabled: true };
    const kw = { hubData: hub, baseText: base, extraNames: extra };
    expect(wlEmbed.extract((await filterCore.buildFilterText(fg, "poe2", { ...kw, appVersion: "web" }))!.generated_section)!.app).toBe("web");
    expect(wlEmbed.extract((await filterCore.buildFilterText(fg, "poe2", kw))!.generated_section)!.app).toBe(""); // a caller that gives none
  });
});

// ---------------------------------------------------------------- the window's messages (golden_open_messages.json)

const GOLDEN = JSON.parse(readFileSync(path.join(FIX, "golden_open_messages.json"), "utf-8"));

function drop(root: string, name: string, game: string, sounds: string[] = []): string {
  const folder = path.join(root, "old", game);
  mkdirSync(folder, { recursive: true });
  const f = path.join(folder, `${name}.filter`);
  writeFileSync(f, oldText(name), "utf-8");
  for (const s of sounds) writeFileSync(path.join(folder, s), "x");
  return f;
}

function snapshot(h: ReturnType<typeof headlessWindow>, ret: boolean) {
  const m = h.win.model;
  const sounds = Object.fromEntries(["S", "A", "B"].map((k) => [k, path.basename(m.tier_style[k]?.sound?.file ?? "")]));
  return { ret, log: h.win.log.filter((l) => l.trim()), name: h.win.name, sounds, opened: h.win.opened, cfg: JSON.parse(JSON.stringify(m.cfg())) };
}

async function scenarios(tmp: string): Promise<Record<string, any>> {
  const out: Record<string, any> = {};
  // an embedded file (the program's own) - normal open
  const m = model("poe1");
  m.setRow("Currency", "Chaos Orb", "S");
  m.gold = true;
  m.gold_min = 21;
  const emb = (await generate(m.toConfig({}), "poe1", tmp, "embedded")).path;
  let h = headlessWindow("poe1");
  out.embedded_ok = snapshot(h, h.open(emb));
  // an embedded file of v0.10.2 (new lists filled with C, no record of the lists)
  const m2 = model("poe2");
  for (const n of m2._names.keys()) if (m2._names.get(n) === "Relic") m2.item_tier[n] = "C";
  const fg = m2.toConfig({});
  delete fg.wl_lists_poe2;
  delete fg.wl_tier_format; // v0.10.2 had no tier D: its C is the hidden tier
  const legacy = (await generate(fg, "poe2", tmp, "legacy-c")).path;
  h = headlessWindow("poe2");
  out.embedded_legacy_relic_c = snapshot(h, h.open(legacy));
  // old files (no settings)
  for (const [key, name, game, sounds] of [["old_v2_poe2", "v2_poe2_checker_whitelist", "poe2", ["sound-S.mp3", "sound-A.mp3"]], ["old_v2_poe2_no_sounds", "v2_poe2_bus", "poe2", []],
    ["old_v1_poe1", "v1_poe1_checker_whitelist", "poe1", []], ["old_v2_poe1", "v2_poe1_wl_sample", "poe1", []]] as [string, string, string, string[]][]) {
    const f = drop(path.join(tmp, key), name, game, sounds);
    h = headlessWindow(game);
    out[key] = snapshot(h, h.open(f));
  }
  // refusals
  const wrong = drop(path.join(tmp, "wrong"), "v2_poe2_bus", "poe2");
  h = headlessWindow("poe1");
  out.old_wrong_game = snapshot(h, h.open(wrong));
  h = headlessWindow("poe1");
  out.embedded_wrong_game = snapshot(h, h.open((await generate({}, "poe2", tmp, "p2")).path));
  for (const [key, body] of [["foreign", 'Show\n    Class "Gems"\n'], ["tier_file", filterCore.TIER_HEADER + "Show\n"]]) {
    const f = path.join(tmp, `${key}.filter`);
    writeFileSync(f, body, "utf-8");
    h = headlessWindow("poe1");
    out[key] = snapshot(h, h.open(f));
  }
  // the item lists are not loaded yet
  const f2 = drop(path.join(tmp, "nodata"), "v2_poe2_bus", "poe2");
  h = headlessWindow("poe2");
  h.win.wlData = null;
  out.old_no_data = snapshot(h, h.open(f2));
  // sound already set to the same file: not told again
  const f3 = drop(path.join(tmp, "samesound"), "v2_poe2_checker_whitelist", "poe2", ["sound-S.mp3", "sound-A.mp3"]);
  h = headlessWindow("poe2");
  h.win.model.tier_style.S = { sound: { kind: "file", id: 1, file: path.join(path.dirname(f3), "sound-S.mp3"), volume: 300 } };
  out.old_sound_already_set = snapshot(h, h.open(f3));
  return out;
}

/** Paths that depend on the temporary folder, and the program version, do not matter. */
function normalise(d: unknown, tmp: string): any {
  const text = JSON.stringify(d).replaceAll(JSON.stringify(tmp).slice(1, -1), "TMP");
  return JSON.parse(text.replace(/ค่าฝังจากรุ่น [^)]+\)/g, "ค่าฝังจากรุ่น VER)"));
}

describe("opening files says and does what it did before the messages moved to Python", () => {
  it("matches golden_open_messages.json", async () => {
    const tmp = tmpDir();
    const got = normalise(await scenarios(tmp), tmp);
    const want = JSON.parse(JSON.stringify(GOLDEN).replace(/ค่าฝังจากรุ่น [^)]+\)/g, "ค่าฝังจากรุ่น VER)"));
    expect(new Set(Object.keys(got))).toEqual(new Set(Object.keys(want)));
    for (const k of Object.keys(want)) {
      const g = JSON.parse(JSON.stringify(got[k]).replaceAll("\\\\", "/")), x = JSON.parse(JSON.stringify(want[k]).replaceAll("\\\\", "/"));
      expect(g, k).toEqual(x);
    }
  });
});
