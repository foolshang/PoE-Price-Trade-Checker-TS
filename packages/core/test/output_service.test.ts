/** filter_output / filter_service / sound split (test_filter_output.py, test_filter_service.py, test_sound_split.py) */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { NodeFs } from "../../node/src/nodefs.ts";
import { FsPort, HttpPort, WlModel, filterCore, filterGen, filterOutput, filterService, filterStyle } from "../src/index.ts";
import { data } from "./helpers.ts";

const fsx = new NodeFs({ eol: "lf" });
const tmp = (): string => mkdtempSync(path.join(os.tmpdir(), "poe-ts-"));
const read = (p: string): string => readFileSync(p, "utf-8");

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

  it("write_filter writes generated and base", async () => {
    const t = tmp();
    const text = read(await filterOutput.writeFilter(fsx, t, "GENERATED", "BASE"));
    expect(text).toContain("GENERATED");
    expect(text).toContain("BASE");
    expect(text.indexOf("GENERATED")).toBeLessThan(text.indexOf("BASE"));
  });

  it("write_filter writes generated only when base is null", async () => {
    expect(read(await filterOutput.writeFilter(fsx, tmp(), "GENERATED", null)).trim()).toBe("GENERATED");
  });

  it("write_filter raises when both sources are empty", async () => {
    await expect(filterOutput.writeFilter(fsx, tmp(), "", null)).rejects.toThrow();
  });

  it("write_filter overwrites an existing file", async () => {
    const t = tmp();
    await filterOutput.writeFilter(fsx, t, "FIRST", null);
    expect(read(await filterOutput.writeFilter(fsx, t, "SECOND", null)).trim()).toBe("SECOND");
  });

  it("write_filter uses the given name and rejects bad ones", async () => {
    const t = tmp();
    const p = await filterOutput.writeFilter(fsx, t, "G", "B", "my filter");
    expect(path.basename(p)).toBe("my filter.filter");
    expect(read(p).endsWith("B")).toBe(true);
    expect(path.basename(await filterOutput.writeFilter(fsx, t, "G", null))).toBe("poe-checker.filter");
    for (const bad of ["a/b", "CON", "x.", "", "q?"]) await expect(filterOutput.writeFilter(fsx, t, "G", "B", bad)).rejects.toThrow();
  });

  it("write_filter on Windows line ends never doubles a CR", async () => {
    const t = tmp();
    const crlf = new NodeFs({ eol: "crlf" });
    const p = await filterOutput.writeFilter(crlf, t, "A\nB", "x\r\ny\n");
    expect(readFileSync(p, "latin1")).toBe("A\r\nB\r\n# ===== base filter below =====\r\nx\r\ny\r\n");
  });
});

function src(t: string, name: string, bytes: string): string {
  const d = path.join(t, "src");
  mkdirSync(d, { recursive: true });
  const p = path.join(d, name);
  writeFileSync(p, bytes);
  return p;
}

describe("copy_sounds", () => {
  it("keeps the original file name", async () => {
    const t = tmp(), out = path.join(t, "out");
    const msgs: string[] = [];
    const written = await filterOutput.copySounds(fsx, out, { S: src(t, "airhorn.mp3", "fake mp3 data"), A: null }, null, (m) => msgs.push(m));
    expect(written).toEqual({ S: "airhorn.mp3" });
    expect(msgs).toEqual([]);
    expect(read(path.join(out, "airhorn.mp3"))).toBe("fake mp3 data");
    expect(readdirSync(out).filter((n) => n.startsWith("poe-checker-"))).toEqual([]);
  });

  it("same content is reused, not copied again", async () => {
    const t = tmp(), out = path.join(t, "out");
    mkdirSync(out);
    writeFileSync(path.join(out, "ping.mp3"), "same");
    const before = statSync(path.join(out, "ping.mp3")).mtimeMs;
    const msgs: string[] = [];
    const written = await filterOutput.copySounds(fsx, out, { S: src(t, "ping.mp3", "same") }, null, (m) => msgs.push(m));
    expect(written).toEqual({ S: "ping.mp3" });
    expect(statSync(path.join(out, "ping.mp3")).mtimeMs).toBe(before);
    expect(msgs.some((m) => m.includes("ใช้ไฟล์เดิม"))).toBe(true);
  });

  it("different content asks and obeys", async () => {
    const t = tmp(), out = path.join(t, "out");
    mkdirSync(out);
    writeFileSync(path.join(out, "ping.mp3"), "old");
    const s = src(t, "ping.mp3", "new");
    const asked: [string, string][] = [];
    const keep = await filterOutput.copySounds(fsx, out, { S: s }, (n, alt) => { asked.push([n, alt]); return "keep"; });
    expect(asked).toEqual([["ping.mp3", "ping-2.mp3"]]);
    expect(keep).toEqual({ S: "ping-2.mp3" });
    expect(read(path.join(out, "ping.mp3"))).toBe("old");
    expect(read(path.join(out, "ping-2.mp3"))).toBe("new");
    const over = await filterOutput.copySounds(fsx, out, { S: s }, () => "overwrite");
    expect(over).toEqual({ S: "ping.mp3" });
    expect(read(path.join(out, "ping.mp3"))).toBe("new");
    // no decide callback = keep the old file; the free name skips ones already taken
    expect(await filterOutput.copySounds(fsx, out, { S: src(t, "ping.mp3", "third") })).toEqual({ S: "ping-3.mp3" });
  });

  it("one file for several slots is copied once and bad names are fixed", async () => {
    const t = tmp(), out = path.join(t, "out");
    const a = src(t, "a#b;c.mp3", "x");
    const msgs: string[] = [];
    const written = await filterOutput.copySounds(fsx, out, { S: a, A: a, Q: a }, null, (m) => msgs.push(m));
    expect(written).toEqual({ S: "a_b_c.mp3", A: "a_b_c.mp3", Q: "a_b_c.mp3" });
    expect(readdirSync(out)).toEqual(["a_b_c.mp3"]);
    expect(msgs.length).toBe(1);
    expect(msgs[0]).toContain("#");
    expect(msgs[0]).toContain(";");
  });

  it("two different files with one name are told apart without asking", async () => {
    const t = tmp(), out = path.join(t, "out");
    const d1 = path.join(t, "d1"), d2 = path.join(t, "d2");
    mkdirSync(d1);
    mkdirSync(d2);
    writeFileSync(path.join(d1, "x.mp3"), "1");
    writeFileSync(path.join(d2, "x.mp3"), "2");
    const asked: unknown[] = [];
    const written = await filterOutput.copySounds(fsx, out, { S: path.join(d1, "x.mp3"), A: path.join(d2, "x.mp3") }, (...a) => { asked.push(a); return "overwrite"; });
    expect(asked).toEqual([]);
    expect(written).toEqual({ S: "x.mp3", A: "x-2.mp3" });
    expect(read(path.join(out, "x.mp3"))).toBe("1");
    expect(read(path.join(out, "x-2.mp3"))).toBe("2");
  });

  it("a missing source is skipped, not raised", async () => {
    const t = tmp();
    expect(await filterOutput.copySounds(fsx, path.join(t, "out"), { S: path.join(t, "missing.mp3") })).toEqual({});
  });

  it("an empty map returns empty", async () => expect(await filterOutput.copySounds(fsx, tmp(), {})).toEqual({}));
});

// ------------------------------------------------------------------------------------------------ filter_service

const NO_NET: HttpPort = { getText: async (url) => { throw new Error(`no network in this test: ${url}`); } };

function cfgOf(t: string, fg: Record<string, any>) {
  return { get: (k: string, d?: any) => (k === "filter_gen" ? { ...fg, game_dir_poe2: path.join(t, "game") } : d), set: () => {}, save: () => {}, appDir: () => path.join(t, "app") };
}
const envOf = (t: string, http: HttpPort = NO_NET, fs: FsPort = fsx) => ({ fs, http, documentsDir: t, nowMs: () => Date.now(), appVersion: "t" });

/** answers like the real servers do */
function stubHttp(o: { base?: string; tag?: string; hub?: any; hubFails?: boolean }): HttpPort & { urls: string[] } {
  const urls: string[] = [];
  return {
    urls,
    async getText(url: string): Promise<string> {
      urls.push(url);
      if (url.includes("api.github.com")) return JSON.stringify({ tag_name: o.tag ?? "tag1" });
      if (url.includes("raw.githubusercontent.com")) return o.base ?? "";
      if (url.includes("storage.googleapis.com")) {
        if (o.hubFails || o.hub === undefined) throw new Error("down");
        return JSON.stringify(o.hub);
      }
      if (url.includes("/data/items")) return JSON.stringify({ result: [] });
      throw new Error(`unexpected url ${url}`);
    },
  };
}

describe("filter_service.generate_filter", () => {
  it("a whitelist writes the file, returns the result and logs", async () => {
    const t = tmp(), logs: [string, string][] = [];
    const http = stubHttp({});
    const res = (await filterService.generateFilter(cfgOf(t, { whitelist_enabled: true, whitelist_custom_poe2: ["Divine Orb"], whitelist_gold: true }), "poe2",
      "poe2/prices/latest.json", envOf(t, http), { log: (m, tg = "info") => logs.push([tg, m]) }))!;
    expect(http.urls.some((u) => u.includes("storage.googleapis.com"))).toBe(false); // the hub must not be used
    expect(res.mode).toBe("whitelist");
    expect(res.count).toBe(2);
    const text = read(path.join(t, "game", "poe-checker-whitelist.filter"));
    expect(text).toContain('"Divine Orb"');
    expect(text).toContain('"Gold"');
    expect(text.trimEnd().endsWith("Hide")).toBe(true);
    expect(res.path).toBe(path.join(t, "game", "poe-checker-whitelist.filter"));
    expect(logs.map(([tg]) => tg)).toEqual(["ok", "ok"]);
    expect(logs.at(-1)![1]).toContain("Filter updated");
  });

  it("a whitelist with nothing selected returns null and writes nothing", async () => {
    const t = tmp(), logs: [string, string][] = [];
    const res = await filterService.generateFilter(cfgOf(t, { whitelist_enabled: true }), "poe2", "p", envOf(t), { log: (m, tg = "info") => logs.push([tg, m]) });
    expect(res).toBeNull();
    expect(existsSync(path.join(t, "game"))).toBe(false);
    expect(logs.length).toBe(1);
    expect(logs[0][0]).toBe("warn");
  });

  it("a whitelist category needs the hub and degrades when it is down", async () => {
    const t = tmp(), logs: [string, string][] = [];
    const res = (await filterService.generateFilter(cfgOf(t, { whitelist_enabled: true, whitelist_custom_poe2: ["Divine Orb"], whitelist_cats_poe2: ["Rune"] }), "poe2", "p",
      envOf(t, stubHttp({ hubFails: true })), { log: (m, tg = "info") => logs.push([tg, m]) }))!;
    expect(res.mode).toBe("whitelist");
    expect(res.count).toBe(1); // the static part is still generated
    expect(logs[0][0]).toBe("warn");
  });

  it("the default log is a no-op", async () => {
    const t = tmp();
    expect((await filterService.generateFilter(cfgOf(t, { whitelist_enabled: true, whitelist_gold: true }), "poe2", "p", envOf(t)))!.mode).toBe("whitelist");
  });

  it("tier mode is base + header and never calls the hub", async () => {
    const t = tmp();
    const base = 'Show\n\tBaseType "X"\n';
    const http = stubHttp({ base, tag: "tag1" });
    const res = (await filterService.generateFilter(cfgOf(t, {}), "poe2", "p", envOf(t, http)))!;
    expect(http.urls.some((u) => u.includes("storage.googleapis.com"))).toBe(false);
    expect(res.mode).toBe("tier");
    expect(res.base_tag).toBe("tag1");
    expect(new Set(Object.keys(res))).toEqual(new Set(["mode", "path", "base_tag", "filter_name"]));
    expect(read(res.path)).toBe(filterCore.composeFilterBody(filterCore.TIER_HEADER, base));
    expect(existsSync(path.join(t, "app")) ? readdirSync(path.join(t, "app")).filter((n) => /^filter_state_.*\.json$/.test(n)) : []).toEqual([]);
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

  const failingFs = (): FsPort => Object.assign(Object.create(fsx), { writeText: async () => { throw osErr("EBADF"); } });

  it("a blocked whitelist write logs a friendly message and returns null", async () => {
    const t = tmp(), logs: [string, string][] = [];
    const res = await filterService.generateFilter(cfgOf(t, { whitelist_enabled: true, whitelist_gold: true }), "poe2", "p", envOf(t, NO_NET, failingFs()), { log: (m, tg = "info") => logs.push([tg, m]) });
    expect(res).toBeNull();
    expect(logs.at(-1)![0]).toBe("err");
    expect(logs.at(-1)![1]).toContain("Controlled Folder Access");
  });

  it("a blocked tier write logs a friendly message and returns null", async () => {
    const t = tmp(), logs: [string, string][] = [];
    // the cache of NeverSink is written through the same port, so the base filter comes from a pre-filled cache
    const real = fsx;
    mkdirSync(path.join(t, "app", "cache", "neversink", "poe2"), { recursive: true });
    writeFileSync(path.join(t, "app", "cache", "neversink", "poe2", "last_check.json"), JSON.stringify({ tag: "t", checked_at: new Date().toISOString() }));
    writeFileSync(path.join(t, "app", "cache", "neversink", "poe2", "t_2.filter"), "Show\n");
    const onlyFilterWrites: FsPort = Object.assign(Object.create(real), { writeText: async (p: string) => { if (p.endsWith(".filter")) throw osErr("EBADF"); } });
    const res = await filterService.generateFilter(cfgOf(t, {}), "poe2", "p", envOf(t, NO_NET, onlyFilterWrites), { log: (m, tg = "info") => logs.push([tg, m]) });
    expect(res).toBeNull();
    expect(logs.at(-1)![0]).toBe("err");
    expect(logs.at(-1)![1]).toContain("Controlled Folder Access");
  });

  it("the gold minimum reaches the filter and an old config defaults to all stacks", async () => {
    const t = tmp();
    let res = (await filterService.generateFilter(cfgOf(t, { whitelist_enabled: true, whitelist_gold: true, whitelist_gold_min: 25 }), "poe2", "p", envOf(t)))!;
    expect(res.count).toBe(1);
    expect(read(res.path)).toContain("StackSize >= 25");
    res = (await filterService.generateFilter(cfgOf(t, { whitelist_enabled: true, whitelist_gold: true }), "poe2", "p", envOf(t)))!;
    expect(read(res.path)).not.toContain("StackSize");
  });

  it("unique only generates without calling the hub", async () => {
    const t = tmp();
    const http = stubHttp({});
    const res = (await filterService.generateFilter(cfgOf(t, { whitelist_enabled: true, whitelist_unique_all: true }), "poe2", "p", envOf(t, http)))!;
    expect(http.urls.some((u) => u.includes("storage.googleapis.com"))).toBe(false);
    expect(res.count).toBe(1);
    expect(read(res.path)).toContain("Rarity Unique");
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
