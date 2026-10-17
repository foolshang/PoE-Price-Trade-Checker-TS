import { createHash } from "node:crypto";
import { promises as fsp } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AppConfig, DEFAULTS, importOldConfig, mergeSaved } from "../src/config.ts";

const tmp = (): Promise<string> => fsp.mkdtemp(path.join(os.tmpdir(), "poe-cfg-"));
const sha = async (p: string): Promise<string> => createHash("sha256").update(await fsp.readFile(p)).digest("hex");

describe("config merge (the original's rules)", () => {
  it("defaults when nothing is saved", () => {
    expect(mergeSaved(null)).toEqual(DEFAULTS);
  });
  it("known keys only; filter_gen merges key by key and keeps unknown sub-keys", () => {
    const m = mergeSaved({ filter_gen: { strictness_poe1: 4, wl_x: 1 }, junk: 1, game_version: "poe1" });
    expect(m.junk).toBeUndefined();
    expect(m.game_version).toBe("poe1");
    expect(m.filter_gen).toEqual({ ...DEFAULTS.filter_gen, strictness_poe1: 4, wl_x: 1 });
  });
  it("a non-dict filter_gen replaces the default (like Python)", () => {
    expect(mergeSaved({ filter_gen: 5 }).filter_gen).toBe(5);
  });
  it("F9 becomes F4", () => {
    expect(mergeSaved({ hotkey_scan: "F9" }).hotkey_scan).toBe("F4");
  });
});

describe("AppConfig", () => {
  it("saves and loads", async () => {
    const dir = await tmp();
    const c = new AppConfig(dir);
    await c.load();
    c.set("filter_gen", { ...c.get("filter_gen"), game_dir_poe1: "X:\\a" });
    await c.save();
    const d = new AppConfig(dir);
    await d.load();
    expect(d.get("filter_gen").game_dir_poe1).toBe("X:\\a");
  });
  it("reads a BOM and survives a broken file", async () => {
    const dir = await tmp();
    await fsp.writeFile(path.join(dir, "config.json"), "\uFEFF" + JSON.stringify({ league: "L" }));
    const c = new AppConfig(dir);
    await c.load();
    expect(c.get("league")).toBe("L");
    await fsp.writeFile(path.join(dir, "config.json"), "{ nope");
    await c.load();
    expect(c.get("league")).toBe("");
  });
});

describe("import from the original's folder", () => {
  it("imports once, never writes the old folder", async () => {
    const oldDir = await tmp(), newDir = path.join(await tmp(), "PoeFilterGenTS");
    const oldFile = path.join(oldDir, "config.json");
    await fsp.writeFile(oldFile, JSON.stringify({ filter_gen: { standalone_game: "poe1", game_dir_poe1: "D:\\g", sound_1: "x.mp3" }, hotkey_scan: "F9" }));
    const before = await sha(oldFile);
    const mtime = (await fsp.stat(oldFile)).mtimeMs;
    const r = await importOldConfig(newDir, oldDir);
    expect(r.status).toBe("imported");
    expect(r.message).toContain("นำเข้า");
    const c = new AppConfig(newDir);
    await c.load();
    expect(c.get("filter_gen").standalone_game).toBe("poe1");
    expect(c.get("filter_gen").sound_1).toBe("x.mp3");
    expect(c.get("filter_gen").strictness_poe2).toBe(2);
    expect(await sha(oldFile)).toBe(before);
    expect((await fsp.stat(oldFile)).mtimeMs).toBe(mtime);
    expect((await fsp.readdir(oldDir)).sort()).toEqual(["config.json"]);
    // second start: nothing again, even when the old file changed
    await fsp.writeFile(oldFile, JSON.stringify({ filter_gen: { standalone_game: "poe2" } }));
    expect((await importOldConfig(newDir, oldDir)).status).toBe("already");
    await c.load();
    expect(c.get("filter_gen").standalone_game).toBe("poe1");
  });
  it("no old config / unreadable old config", async () => {
    const newDir = path.join(await tmp(), "n");
    expect((await importOldConfig(newDir, await tmp())).status).toBe("no-old-config");
    const oldDir = await tmp();
    await fsp.writeFile(path.join(oldDir, "config.json"), "{ nope");
    const r = await importOldConfig(newDir, oldDir);
    expect(r.status).toBe("unreadable");
  });
  it("an existing config of the new app is never overwritten", async () => {
    const oldDir = await tmp(), newDir = await tmp();
    await fsp.writeFile(path.join(oldDir, "config.json"), JSON.stringify({ league: "OLD" }));
    await fsp.writeFile(path.join(newDir, "config.json"), JSON.stringify({ league: "MINE" }));
    expect((await importOldConfig(newDir, oldDir)).status).toBe("already");
    const c = new AppConfig(newDir);
    await c.load();
    expect(c.get("league")).toBe("MINE");
  });
});
