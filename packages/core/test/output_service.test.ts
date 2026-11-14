/** filter_output / filter_service / sound split (test_filter_output.py, test_filter_service.py, test_sound_split.py) */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { NodeFs } from "../../node/src/nodefs.ts";
import { WlModel, filterCore, filterGen, filterOutput, filterService, filterStyle } from "../src/index.ts";
import { appGenerate, readLf } from "./app_path.ts";
import { data } from "./helpers.ts";

const fsx = new NodeFs({ eol: "lf" });
const tmp = (): string => mkdtempSync(path.join(os.tmpdir(), "poe-ts-"));

// ------------------------------------------------------------------------------------------------ filter_output

describe("filter_output", () => {
  it("game_filter_dir uses the override when set", () => {
    const t = tmp();
    expect(filterOutput.gameFilterDir(fsx, "D:/Docs", "poe2", path.join(t, "custom"))).toBe(path.join(t, "custom"));
  });

  it("game_filter_dir falls back to Documents/My Games", () => {
    expect(filterOutput.gameFilterDir(fsx, "D:/Docs", "poe1", "")).toBe(path.join("D:/Docs", "My Games", "Path of Exile"));
    expect(filterOutput.gameFilterDir(fsx, "D:/Docs", "poe2", "")).toBe(path.join("D:/Docs", "My Games", "Path of Exile 2"));
  });
});

// ------------------------------------------------------------------------------------------------ the filter the programs write (was filter_service.generate_filter)

const BASE = ["Show", "  BaseType X", ""].join("\n");

/** the Generate of one tab, made the way the programs make it (app_path.ts) */
const gen = (t: string, fg: Record<string, any>, mode: "tier" | "whitelist", o: { hub?: any; log?: (m: string, tag?: string) => void } = {}) =>
  appGenerate({ fg, game: "poe2", mode, gameDir: path.join(t, "game"), base: [BASE, "tag1"], hub: o.hub ?? null, names: [], log: o.log });
const HUB = { schema_version: 2, league: "L", currency: [{ category: "Rune", name: "Adept Rune", base: null, chaos_value: 0.5 }], items: [] };

describe("the filter the programs write, per mode", () => {
  it("a whitelist writes the file and returns the result", async () => {
    const t = tmp();
    const res = await gen(t, { whitelist_custom_poe2: ["Divine Orb"], whitelist_gold: true }, "whitelist");
    expect(res.mode).toBe("whitelist");
    expect(res.count).toBe(2);
    const text = readLf(path.join(t, "game", "poe-checker-whitelist.filter"));
    expect(text).toContain('"Divine Orb"');
    expect(text).toContain('"Gold"');
    expect(text.trimEnd().endsWith("Hide")).toBe(true);
    expect(res.path).toBe(path.join(t, "game", "poe-checker-whitelist.filter"));
  });

  it("a whitelist with nothing selected hands nothing over and writes nothing", async () => {
    const t = tmp(), logs: [string, string][] = [];
    const res = await gen(t, {}, "whitelist", { log: (m, tg = "info") => logs.push([tg, m]) });
    expect(res.status).toBe("none");
    expect(existsSync(path.join(t, "game"))).toBe(false);
    const warns = logs.filter(([tg]) => tg === "warn"); // (besides the line that names the league)
    expect(warns).toHaveLength(1);
    expect(logs.filter(([tg]) => tg !== "warn").map(([, m]) => m)).toEqual(["ℹ ลีกที่ใช้กับรายการของ hub: -"]);
  });

  it("a whitelist category needs the hub and degrades when it is down", async () => {
    const res = await gen(tmp(), { whitelist_custom_poe2: ["Divine Orb"], whitelist_cats_poe2: ["Rune"] }, "whitelist");
    expect(res.mode).toBe("whitelist");
    expect(res.count).toBe(1); // the static part is still generated (the page says "hub unavailable" when it loads the lists)
    const withHub = await gen(tmp(), { whitelist_custom_poe2: ["Divine Orb"], whitelist_cats_poe2: ["Rune"] }, "whitelist", { hub: HUB });
    expect(withHub.count).toBeGreaterThan(1); // the hub's runes are in
  });

  it("tier mode is base + header", async () => {
    const t = tmp();
    const res = await gen(t, {}, "tier");
    expect(res.mode).toBe("tier");
    expect(res.base_tag).toBe("tag1");
    expect(readLf(res.path!)).toBe(filterCore.composeFilterBody(filterCore.TIER_HEADER, BASE));
  });

  it("tier mode without a base filter: nothing is written, the old file stays, and the Status says both (the original's text)", async () => {
    const t = tmp();
    const dir = path.join(t, "game");
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "poe-checker.filter"), "OLD FILE");
    const lines: [string, string][] = [];
    const res = await appGenerate({ fg: { filter_name_tier: "poe-checker" }, game: "poe2", mode: "tier", gameDir: dir, base: [null, null], log: (m, tag = "info") => lines.push([m, tag]) });
    expect(res.status).toBe("aborted");
    expect(readFileSync(path.join(dir, "poe-checker.filter"), "utf-8")).toBe("OLD FILE");
    expect(lines).toEqual([
      ["⚠ ไม่มี NeverSink base filter ให้ใช้ (GitHub ล่ม + ไม่มี cache)", "warn"],
      ["✗ nothing to write — no NeverSink base filter available — ไฟล์เดิมไม่ถูกแตะ", "err"],
    ]);
  });

  const osErr = (code: string): Error => Object.assign(new Error("boom"), { code });

  it("the write-failure message names Controlled Folder Access for blocked errors", () => {
    for (const code of ["EBADF", "EACCES", "ENOENT", "EPERM"]) {
      const msg = filterService.writeFailMsg(osErr(code), "D:/out");
      expect(msg).toContain("Controlled Folder Access");
      expect(msg).toContain("D:/out");
      expect(msg).toContain("boom");
      expect(msg).toContain("Game folder override");
    }
  });

  it("the write-failure message does not blame CFA for unrelated errors", () => {
    const msg = filterService.writeFailMsg(osErr("ENOSPC"), "D:/out");
    expect(msg).not.toContain("Controlled Folder Access");
    expect(msg).toContain("boom");
  });

  it("a failed write hands nothing over", async () => {
    const t = tmp(), logs: [string, string][] = [];
    const res = await appGenerate({ fg: { whitelist_gold: true }, game: "poe2", mode: "whitelist", gameDir: path.join(t, "game"), base: [BASE, "t"], failWrite: osErr("EBADF"),
      log: (m, tg = "info") => logs.push([tg, m]) });
    expect(res.status).toBe("write-failed");
    expect(existsSync(path.join(t, "game"))).toBe(false);
    expect(logs.at(-1)![0]).toBe("err");
  });

  it("the gold minimum reaches the filter and an old config defaults to all stacks", async () => {
    const t = tmp();
    let res = await gen(t, { whitelist_gold: true, whitelist_gold_min: 25 }, "whitelist");
    expect(res.count).toBe(1);
    expect(readLf(res.path!)).toContain("StackSize >= 25");
    res = await gen(t, { whitelist_gold: true }, "whitelist");
    expect(readLf(res.path!)).not.toContain("StackSize");
  });

  it("unique only generates", async () => {
    const t = tmp();
    const res = await gen(t, { whitelist_unique_all: true }, "whitelist");
    expect(res.count).toBe(1);
    expect(readLf(res.path!)).toContain("Rarity Unique");
  });
});

// ------------------------------------------------------------------------------------------------ test_sound_split.py

const OLD = { sound_s: "C:/snd/top.mp3", sound_a: "C:/snd/second.wav", sound_b: "", sound_c: "C:/snd/faint.ogg" };

describe("sounds are split per tab", () => {
  it("an old config gives its files to sounds 1-3 and to the tier sounds, once", () => {
    const [out, notes] = filterCore.migrateSounds({ ...OLD });
    expect([out.sound_1, out.sound_2, out.sound_3 ?? ""]).toEqual(["C:/snd/top.mp3", "C:/snd/second.wav", ""]);
    expect([..."456"].some((n) => out[`sound_${n}`])).toBe(false);
    expect(["sound_s", "sound_a", "sound_b", "sound_c"].some((k) => k in out)).toBe(false);
    expect(out.sound_format).toBe(2);
    const st = out.wl_tier_style;
    expect(st.S.sound.file).toBe("C:/snd/top.mp3");
    expect(st.A.sound.file).toBe("C:/snd/second.wav");
    expect(st.C.sound.file).toBe("C:/snd/faint.ogg");
    expect("B" in st).toBe(false);
    expect(notes.length).toBe(1);
    expect(notes[0]).toContain("เสียง 1 / 2 / 3");
    expect(notes[0]).toContain("top.mp3");
    const [again, notes2] = filterCore.migrateSounds(out); // a converted config: nothing again
    expect(again).toEqual(out);
    expect(notes2).toEqual([]);
  });

  it("a tier that already has its own sound keeps it; nothing to convert says nothing", () => {
    const fg = { sound_s: "C:/snd/top.mp3", wl_tier_style: { S: { sound: { kind: "file", file: "own.mp3", volume: 100 } } } };
    let [out] = filterCore.migrateSounds(fg);
    expect(out.wl_tier_style.S.sound.file).toBe("own.mp3");
    expect(out.sound_1).toBe("C:/snd/top.mp3");
    const [out2, notes] = filterCore.migrateSounds({});
    out = out2;
    expect(notes).toEqual([]);
    expect(out.sound_format).toBe(2);
    expect("wl_tier_style" in out).toBe(false);
  });

  it("the model reads the old files as tier sounds and saves without the old keys", () => {
    const m = WlModel.fromConfig({ ...OLD }, "poe2");
    const [hub, base, names] = data("poe2");
    m.setData(hub, base, names);
    expect(m.tier_style.S.sound).toEqual({ kind: "file", id: 1, file: "C:/snd/top.mp3", volume: 300 });
    expect(m.takeNotes().some((n) => n.includes("เสียงเดิม"))).toBe(true);
    const fg = m.toConfig({ ...OLD });
    expect(["sound_s", "sound_a", "sound_b", "sound_c"].some((k) => k in fg)).toBe(false);
    expect(fg.sound_format).toBe(2);
    expect(fg.wl_tier_style.S.sound.file).toBe("C:/snd/top.mp3");
    const back = WlModel.fromConfig(JSON.parse(JSON.stringify(fg)), "poe2"); // opened again: no second conversion, no note
    expect(back.takeNotes()).toEqual([]);
    expect(back.tier_style.S).toEqual(m.tier_style.S);
  });

  it("the labels of the numbered sounds are the slot numbers", () => {
    expect(filterGen.SOUND_SLOTS).toEqual(["1", "2", "3", "4", "5", "6"]);
    expect(new Set(Object.keys(filterCore.tierSoundRequests({ sound_4: "d.mp3" })))).toEqual(new Set([..."123456", "Q"]));
    expect(filterCore.tierSoundRequests({ sound_4: "d.mp3" })["4"]).toBe("d.mp3");
    expect(filterStyle.usesSoundFile({ sound: { kind: "file", file: "q.mp3" } })).toBe("q.mp3");
  });
});
