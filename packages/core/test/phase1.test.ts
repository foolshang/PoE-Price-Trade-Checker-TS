/** style model, file names, sound-name planning, quest blocks, service (the non-Tk part of test_filter_phase1.py) */
import { existsSync, mkdirSync, mkdtempSync, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { NodeFs } from "../../node/src/nodefs.ts";
import { filterCore, filterService, filterStyle } from "../src/index.ts";

// ---------------------------------------------------------------- filter_style

describe("filter_style", () => {
  it("style lines follow NeverSink's order and skip unset parts", () => {
    const st = { text: [255, 0, 0], border: [1, 2, 3, 4], bg: null, size: 45, icon: { size: 2, color: "Red", shape: "Star" },
      effect: { color: "Green", temp: true }, sound: { kind: "game", id: 6, volume: 250 } };
    expect(filterStyle.styleLines(st)).toEqual([
      "    SetFontSize 45", "    SetTextColor 255 0 0 255", "    SetBorderColor 1 2 3 4", "    PlayAlertSound 6 250", "    PlayEffect Green Temp", "    MinimapIcon 2 Red Star"]);
    expect(filterStyle.styleLines({})).toEqual([]);
    expect(filterStyle.isEmpty({})).toBe(true);
    expect(filterStyle.isEmpty(null)).toBe(true);
  });

  it("a file sound is always written as optional and needs its resolved name", () => {
    const st = { sound: { kind: "file", file: "D:/x/ping.mp3", volume: 120 } };
    expect(filterStyle.usesSoundFile(st)).toBe("D:/x/ping.mp3");
    expect(filterStyle.styleLines(st, "ping.mp3")).toEqual(['    CustomAlertSoundOptional "ping.mp3" 120']);
    expect(filterStyle.styleLines(st)).toEqual([]); // no resolved name -> nothing half-written
    expect(filterStyle.isEmpty(st)).toBe(false);
  });

  it("normalize_style clamps and drops garbage", () => {
    const s = filterStyle.normalizeStyle({ text: [300, -5, "x"], size: "99", icon: { size: 9, color: "Nope" }, effect: { color: "Pink" },
      sound: { kind: "game", id: 99, volume: 9999 }, junk: 1 });
    expect(s.text).toBeNull();
    expect(s.size).toBe(filterStyle.FONT_MAX);
    expect(s.icon).toBeNull();
    expect(s.effect).toEqual({ color: "Pink", temp: false });
    expect(s.sound.id).toBe(1);
    expect(s.sound.volume).toBe(filterStyle.VOLUME_MAX);
    expect("junk" in s).toBe(false);
    expect(filterStyle.normalizeStyle("nonsense")).toEqual(filterStyle.normalizeStyle({}));
    expect(filterStyle.normalizeStyle({ text: [10, 20, 30] }).text).toEqual([10, 20, 30, 255]);
  });
});

// ---------------------------------------------------------------- names

describe("filter names", () => {
  it.each(["poe-checker", "my filter", "ฟิลเตอร์ไทย", "a.b", "x".repeat(100), "CONSOLE"])("good name %s", (name) =>
    expect(filterCore.validateFilterName(name)).toEqual([name, null]));

  it.each(["", "   ", "a<b", "a>b", "a:b", 'a"b', "a/b", "a\\b", "a|b", "a?b", "a*b", "tab\there", "trail.", "trail ", "CON", "con", "NUL", "COM1", "LPT9", "aux.txt", "x".repeat(101)])(
    "bad name says why: %j", (name) => {
      const [, err] = filterCore.validateFilterName(name);
      expect(typeof err).toBe("string");
      expect(err).toBeTruthy();
    });

  it("sound names with # or ; become _ with a reason", () => {
    expect(filterCore.safeSoundName("ping.mp3")).toEqual(["ping.mp3", null]);
    expect(filterCore.safeSoundName("ไม่มี.mp3")).toEqual(["ไม่มี.mp3", null]);
    let [nw, why] = filterCore.safeSoundName("a#b.mp3");
    expect(nw).toBe("a_b.mp3");
    expect(why).toBe('เปลี่ยนชื่อ "a#b.mp3" เป็น "a_b.mp3" เพราะเกมเล่นไฟล์ที่ชื่อมี # ไม่ได้');
    [nw, why] = filterCore.safeSoundName("a;b.mp3");
    expect(nw).toBe("a_b.mp3");
    expect(why!.endsWith("เพราะเกมใช้ ; คั่นหลายไฟล์")).toBe(true);
  });

  it("sound plan statuses", () => {
    const plan = filterCore.planSoundFiles([["S", "new.mp3", "h1"], ["A", "same.mp3", "h2"], ["B", "clash.mp3", "h3"], ["Q", "new.mp3", "h1"]],
      { "same.mp3": "h2", "clash.mp3": "OTHER", "clash-2.mp3": null });
    expect(Object.fromEntries(plan.items.map((i) => [i.dest, i.status]))).toEqual({ "new.mp3": "new", "same.mp3": "same", "clash.mp3": "conflict" });
    expect(plan.dest).toEqual({ S: "new.mp3", A: "same.mp3", B: "clash.mp3", Q: "new.mp3" }); // one file, two labels
    const [dest0, copies0, msgs] = filterCore.resolveSoundPlan(plan, () => "keep");
    let dest = dest0, copies = copies0;
    expect(dest.B).toBe("clash-3.mp3"); // clash-2 is taken on disk
    expect(copies).toContainEqual(["B", "clash-3.mp3"]);
    expect(copies.some((c) => c[1] === "same.mp3")).toBe(false);
    expect(msgs.some((m) => m.includes("ใช้ไฟล์เดิม"))).toBe(true);
    [dest, copies] = filterCore.resolveSoundPlan(plan, () => "overwrite");
    expect(dest.B).toBe("clash.mp3");
    expect(copies).toContainEqual(["B", "clash.mp3"]);
  });
});

// ---------------------------------------------------------------- quest blocks

describe("quest blocks", () => {
  it("per game", () => {
    const st = filterStyle.defaultQuestStyle();
    const poe1 = filterCore.buildQuestBlocks("poe1", st);
    expect(poe1).toContain('Class == "Quest Items" "Cursed Ducat" "Pantheon Souls" "Labyrinth Items" "Labyrinth Trinkets"');
    expect(poe1).not.toContain("BaseType");
    expect(poe1).toContain("SetTextColor 74 230 58 255");
    expect(poe1).not.toContain("Hide");
    const poe2 = filterCore.buildQuestBlocks("poe2", st);
    expect(poe2).toContain('Class == "Quest Items" "Instance Local Items"');
    expect(poe2.split("Show").length - 1).toBe(2);
    expect(poe2).toContain('BaseType == "Bronze Key" "Gold Key" "Silver Key"');
    expect(filterCore.buildQuestBlocks("poe2", {})).toBe("");
    expect(filterCore.buildQuestBlocks("poe2", null)).toBe("");
  });

  it("tier mode puts our quest block ahead of NeverSink's and changes nothing without it", async () => {
    const base = 'Show # $type->questlikeexception $tier->questitems\n\tClass == "Quest Items"\n\tSetFontSize 42\n';
    const plain = (await filterCore.buildFilterText({}, "poe1", { baseText: base, baseTag: "t" }))!;
    expect(plain.generated_section).toBe(filterCore.TIER_HEADER);
    expect(plain.base_text).toBe(base);
    for (const unset of [{ style_q: null }, { style_q: {} }]) {
      expect((await filterCore.buildFilterText(unset, "poe1", { baseText: base }))!.generated_section).toBe(filterCore.TIER_HEADER);
    }
    const res = (await filterCore.buildFilterText({ style_q: { text: [1, 2, 3, 255], size: 40 } }, "poe1", { baseText: base }))!;
    const body = filterCore.composeFilterBody(res.generated_section, res.base_text);
    expect(body.indexOf('Class == "Quest Items" "Cursed Ducat"')).toBeLessThan(body.indexOf("# ===== base filter below ====="));
    expect(res.base_text).toBe(base); // NeverSink's text itself is untouched
  });

  it("the quest file sound goes through the sound copy and uses the name it got", async () => {
    const asked: any[] = [];
    const res = (await filterCore.buildFilterText({ style_q: { sound: { kind: "file", file: "C:/s/my ping.mp3", volume: 200 } } }, "poe2",
      { baseText: "Show\n", copySoundsFn: (m) => { asked.push(m); return { Q: "my ping.mp3" }; } }))!;
    expect(asked[0].Q).toBe("C:/s/my ping.mp3");
    expect(asked[0]["1"]).toBeNull();
    expect(res.generated_section).toContain('CustomAlertSoundOptional "my ping.mp3" 200');
    expect(res.generated_section).not.toContain("C:/s");
  });
});

// ---------------------------------------------------------------- service

const fsx = new NodeFs({ eol: "lf" });
const NO_NET = { getText: async (u: string): Promise<string> => { throw new Error(`no network: ${u}`); } };

function storeCfg(t: string, fg: Record<string, any>) {
  const store: Record<string, any> = { filter_gen: { ...fg, game_dir_poe2: path.join(t, "game") } };
  return { store, get: (k: string, d?: any) => (k in store ? store[k] : d), set: (k: string, v: any) => { store[k] = v; }, save: () => {}, appDir: () => path.join(t, "app") };
}
const envWith = (t: string, base: [string, string]) => ({
  fs: fsx, http: NO_NET, documentsDir: t, nowMs: () => Date.now(), appVersion: "t",
  deps: { fetchBaseFilter: async (): Promise<[string | null, string | null]> => base },
});

describe("filter service, per tab", () => {
  it("each tab writes its own file and a bad name stops before writing", async () => {
    const t = mkdtempSync(path.join(os.tmpdir(), "poe-ts-"));
    const env = envWith(t, ["Show\n\tBaseType \"X\"\n", "tag1"]);
    const cfg = storeCfg(t, { filter_name_tier: "my tier", whitelist_gold: true });
    const logs: [string, string][] = [];
    const tr = (await filterService.generateFilter(cfg, "poe2", "p", env, { mode: "tier", log: (m, tg = "info") => logs.push([tg, m]) }))!;
    const wr = (await filterService.generateFilter(cfg, "poe2", "p", env, { mode: "whitelist" }))!;
    expect(path.basename(tr.path)).toBe("my tier.filter");
    expect(tr.filter_name).toBe("my tier");
    expect(path.basename(wr.path)).toBe("poe-checker-whitelist.filter");
    expect(readdirSync(path.join(t, "game")).filter((n) => n.endsWith(".filter")).sort()).toEqual(["my tier.filter", "poe-checker-whitelist.filter"]);
    const bad = storeCfg(t, { filter_name_tier: "a/b" });
    logs.length = 0;
    expect(await filterService.generateFilter(bad, "poe2", "p", env, { mode: "tier", log: (m, tg = "info") => logs.push([tg, m]) })).toBeNull();
    expect(logs.at(-1)![0]).toBe("err");
    expect(logs.at(-1)![1]).toContain("/");
  });

  it("renaming leaves the old file alone and says it is still there", async () => {
    const t = mkdtempSync(path.join(os.tmpdir(), "poe-ts-"));
    const env = envWith(t, ["Show\n", "t"]);
    const cfg = storeCfg(t, {});
    const logs: string[] = [];
    const r1 = await filterService.generateFilter(cfg, "poe2", "p", env, { mode: "tier" });
    await filterService.rememberResult(cfg, "poe2", r1);
    cfg.store.filter_gen.filter_name_tier = "renamed";
    const r2 = (await filterService.generateFilter(cfg, "poe2", "p", env, { mode: "tier", log: (m) => logs.push(m) }))!;
    expect(existsSync(path.join(t, "game", "poe-checker.filter"))).toBe(true);
    expect(path.basename(r2.path)).toBe("renamed.filter");
    expect(logs.some((m) => m.includes("ไฟล์เดิม poe-checker.filter ยังอยู่"))).toBe(true);
    mkdirSync(path.join(t, "x"), { recursive: true });
  });

  it("remember_result keeps the tag and name", async () => {
    const cfg = storeCfg(os.tmpdir(), {});
    await filterService.rememberResult(cfg, "poe2", { mode: "tier", path: "", base_tag: "0.10.4", filter_name: "x" });
    const fg = cfg.store.filter_gen;
    expect(fg.neversink_tag_poe2).toBe("0.10.4");
    expect(fg.last_filter_name_tier).toBe("x");
    await filterService.rememberResult(cfg, "poe2", { mode: "whitelist", path: "", filter_name: "w" });
    expect(cfg.store.filter_gen.last_filter_name_whitelist).toBe("w");
    expect(cfg.store.filter_gen.neversink_tag_poe2).toBe("0.10.4");
    const before = JSON.stringify(cfg.store);
    await filterService.rememberResult(cfg, "poe2", null); // nothing written -> no change
    expect(JSON.stringify(cfg.store)).toBe(before);
  });

  it("the NeverSink update check", async () => {
    const mk = (fg: Record<string, any>) => ({ get: (k: string, d?: any) => (k === "filter_gen" ? fg : d), set: () => {}, save: () => {}, appDir: () => "" });
    const cfg = mk({ neversink_tag_poe2: "0.10.3", auto_regen_neversink: true });
    expect(await filterService.checkNeversinkUpdate(cfg, "poe2", async () => "0.10.3")).toBeNull(); // same
    expect(await filterService.checkNeversinkUpdate(cfg, "poe2", async () => null)).toBeNull(); // GitHub down
    expect(await filterService.checkNeversinkUpdate(cfg, "poe1", async () => "9")).toBeNull(); // never generated poe1
    const info = (await filterService.checkNeversinkUpdate(cfg, "poe2", async () => "0.10.4"))!;
    expect(info).toEqual({ old: "0.10.3", new: "0.10.4", auto: true });
    expect(filterService.neversinkUpdateMessage(info, true)).toBe("NeverSink อัปเดต 0.10.3 → 0.10.4 สร้าง filter ใหม่แล้ว");
    expect(filterService.neversinkUpdateMessage(info, false)).toContain("มีเวอร์ชันใหม่ 0.10.4");
    const off = mk({ neversink_tag_poe2: "a" });
    expect((await filterService.checkNeversinkUpdate(off, "poe2", async () => "b"))!.auto).toBe(false);
  });
});
