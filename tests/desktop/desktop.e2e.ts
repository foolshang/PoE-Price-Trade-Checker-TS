// @ts-nocheck
/**
 * The desktop app in a real Electron, against a fake internet and a throw-away LOCALAPPDATA / Documents:
 *  - the filter it writes is the original's golden, byte for byte (2 games x 2 tabs; the recorded app name excepted)
 *  - start-up (title, version marker, files), config import from the original (and the original's files untouched),
 *    old filters of every generation open, sounds (copy / same name / same content / the original's paths), Controlled Folder
 *    Access message, the game folder override, NeverSink update check, single instance, what the page can and cannot do.
 * Runs the build output (npm run desktop:build) under the electron of node_modules; with PFG_EXE=<unpacked exe> the packaged app.
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { wlEmbed } from "../../packages/core/src/index.ts";
import { FIXTURES, launch, sandbox, wait } from "./harness.mjs";
import { fakeInternet, fixtureData } from "./stubs.mjs";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const GOLDEN = path.join(ROOT, "tests", "parity", "golden");
const golden = (g) => JSON.parse(fs.readFileSync(path.join(GOLDEN, g + ".json"), "utf-8"));
const cases = (g) => JSON.parse(fs.readFileSync(path.join(ROOT, "tests", "parity", "cases", g + ".json"), "utf-8"));
const goldenText = (name) => zlib.gunzipSync(fs.readFileSync(path.join(GOLDEN, "texts", name + ".txt.gz"))).toString("utf-8");
const sha = (s) => createHash("sha256").update(Buffer.from(s, "utf-8")).digest("hex");
const shaBytes = (b) => createHash("sha256").update(b).digest("hex");
const lf = (t) => t.replace(/\r\n/g, "\n");
const MARK = wlEmbed.MARK;
const stripBlob = (t) => lf(t).split("\n").filter((l) => !l.startsWith(MARK)).join("\n");
const FOLDER = { poe1: "Path of Exile", poe2: "Path of Exile 2" };
const data = fixtureData();
const exe = process.env.PFG_EXE;

let net;
const opened = [];
beforeAll(async () => { net = await fakeInternet(data); });
afterEach(async () => {
  for (const a of opened.splice(0)) { try { await a.close(); } catch { /* gone */ } }
});

const gameDir = (sbx, g) => path.join(sbx.docs, "My Games", FOLDER[g]);
/** the saved filter_gen of the app, polled (the page and the main process both wait a moment before they write) */
async function savedCfg(sbx, ok = () => true) {
  for (let i = 0; i < 40; i++) {
    try {
      const v = JSON.parse(fs.readFileSync(path.join(sbx.configDir, "config.json"), "utf-8")).filter_gen;
      if (ok(v)) return v;
    } catch { /* not there yet */ }
    await wait(250);
  }
  throw new Error("config.json never had the expected content");
}
const writeConfig = (sbx, filterGen) => {
  fs.mkdirSync(sbx.configDir, { recursive: true });
  fs.writeFileSync(path.join(sbx.configDir, "config.json"), JSON.stringify({ filter_gen: filterGen }, null, 2));
};

/** start the app (optionally with a saved config) and wait until the page and the item lists are ready */
async function start(sbx, { cfg, game = "poe2", waitLists = true, inet = net } = {}) {
  if (cfg) writeConfig(sbx, { ...cfg, standalone_game: game });
  const { app, page } = await launch(sbx, { exe, chromiumArgs: inet ? inet.args : [] });
  opened.push(app);
  page.errors = [];
  page.on("console", (m) => m.type() === "error" && page.errors.push(m.text()));
  page.on("pageerror", (e) => page.errors.push(String(e)));
  await page.waitForSelector("#app:not([hidden])", { timeout: 60000 });
  if (waitLists) await page.waitForFunction(() => /โหลดรายการ whitelist แล้ว|ไม่มี NeverSink base/.test(document.querySelector("#log").innerText), null, { timeout: 60000 });
  return { app, page };
}

async function generate(page, mode) {
  await page.click(mode === "tier" ? "#tab-ns" : "#tab-wl");
  await page.evaluate(() => { document.querySelector("#result").hidden = true; });
  await page.click(mode === "tier" ? "#btn-generate-tier" : "#btn-generate-wl");
  await page.waitForSelector("#result:not([hidden])", { timeout: 60000 });
}
const filtersIn = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(".filter")) : []);
const readOnly = (dir) => {
  const f = filtersIn(dir);
  expect(f.length).toBe(1);
  return fs.readFileSync(path.join(dir, f[0]), "utf-8");
};

const embedded = (t) => {
  const e = wlEmbed.extract(lf(t));
  delete e.app;
  for (const k of Object.keys(e.cfg)) {
    if (k.startsWith("whitelist_custom_")) e.cfg[k] = e.cfg[k].map((x) => ({ ...x, rarities: [...x.rarities].sort() }));
  }
  return e;
};

describe("A) the golden of the original, written by the desktop app", () => {
  const tierGolden = golden("tier");
  const tierCases = cases("tier").filter((c) => /-s2-none-(noq|q_color|q_game_sound|q_empty|q_file_sound)$/.test(c.id));
  it.each(tierCases.map((c) => [c.id, c]))("NeverSink tab %s", async (_id, c) => {
    const sbx = sandbox();
    const { page } = await start(sbx, { cfg: c.args.cfg, game: c.args.game });
    await generate(page, "tier");
    const text = readOnly(gameDir(sbx, c.args.game));
    expect(text.includes("\r\r\n")).toBe(false);
    expect(text.includes("\r\n")).toBe(true); // CRLF once
    expect(sha(lf(text))).toBe(tierGolden[c.id].result.file.$text);
    expect(page.errors).toEqual([]);
  }, 120000);

  for (const [group, game] of [["wlrand-poe1", "poe1"], ["wlrand-poe2", "poe2"]]) {
    it(`Whitelist tab ${game}: ${group}/001-build equals the original's file (settings block compared decoded)`, async () => {
      const sbx = sandbox();
      const c = cases(group).find((x) => x.id === `${group}/001-build`);
      const { page } = await start(sbx, { cfg: c.args.cfg, game });
      await generate(page, "whitelist");
      const text = readOnly(gameDir(sbx, game));
      expect(text.includes("\r\r\n")).toBe(false);
      const want = goldenText(`${group}__001-build.file`);
      expect(stripBlob(text)).toBe(stripBlob(want));
      expect(embedded(text)).toEqual(embedded(want));
      expect(page.errors).toEqual([]);
    }, 120000);
  }
});

describe("B) start-up", () => {
  it("title bar, version marker as the first Status line, config and log files", async () => {
    const sbx = sandbox();
    const { app, page } = await start(sbx);
    const ver = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf-8")).version;
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getTitle())).toBe(`PoE1 & PoE2 Filter Generator v${ver}`);
    const lines = (await page.locator("#log").innerText()).split("\n");
    expect(lines[0]).toBe(`PoE Filter Generator v${ver} — config: ${sbx.configDir}`);
    expect(await page.locator("#ver").innerText()).toContain(ver);
    const lastRun = fs.readFileSync(path.join(sbx.configDir, "last_run.txt"), "utf-8");
    expect(lastRun.startsWith(`v${ver}\n`)).toBe(true);
    expect(fs.readFileSync(path.join(sbx.configDir, "log.txt"), "utf-8")).toContain(`PoE Filter Generator v${ver} started`);
    expect(await page.locator("#folder-name").innerText()).toContain(gameDir(sbx, "poe2"));
    expect(page.errors).toEqual([]);
  }, 120000);

  it("remembers the game and the settings across a restart", async () => {
    const sbx = sandbox();
    let { app, page } = await start(sbx);
    await page.click("#game-poe1");
    await page.waitForFunction(() => /โหลดรายการ whitelist แล้ว/.test(document.querySelector("#log").innerText.split("⟳ โหลดรายการ whitelist").pop()));
    await page.fill("#pane-tier input[aria-label='ชื่อ filter']", "my-tier");
    await page.selectOption("#pane-tier select[aria-label='NeverSink Strictness']", "4");
    await app.close();
    opened.length = 0;
    const cfg = JSON.parse(fs.readFileSync(path.join(sbx.configDir, "config.json"), "utf-8")).filter_gen;
    expect(cfg.standalone_game).toBe("poe1");
    expect(cfg.filter_name_tier).toBe("my-tier");
    expect(cfg.strictness_poe1).toBe(4);
    ({ app, page } = await start(sbx));
    expect(await page.locator("#game-poe1").getAttribute("aria-pressed")).toBe("true");
    expect(await page.inputValue("#pane-tier input[aria-label='ชื่อ filter']")).toBe("my-tier");
  }, 180000);
});

describe("C) the original's config is imported once and never written", () => {
  it("imports PoeFilterGen\\config.json, says so, leaves the old files byte-identical", async () => {
    const sbx = sandbox();
    fs.mkdirSync(sbx.oldDir, { recursive: true });
    const oldCfg = path.join(sbx.oldDir, "config.json");
    const override = path.join(sbx.base, "my filters");
    fs.writeFileSync(oldCfg, JSON.stringify({ game_version: "poe2", filter_gen: { standalone_game: "poe1", strictness_poe1: 5, filter_name_tier: "imported-name", game_dir_poe1: override, auto_regen_neversink: true } }, null, 2));
    fs.writeFileSync(path.join(sbx.oldDir, "log.txt"), "old log");
    const before = { cfg: shaBytes(fs.readFileSync(oldCfg)), log: shaBytes(fs.readFileSync(path.join(sbx.oldDir, "log.txt"))), mtime: fs.statSync(oldCfg).mtimeMs };
    const { app, page } = await start(sbx);
    const log = await page.locator("#log").innerText();
    expect(log).toContain("นำเข้าค่าจากโปรแกรมเดิมแล้ว");
    expect(await page.locator("#game-poe1").getAttribute("aria-pressed")).toBe("true");
    expect(await page.inputValue("#pane-tier input[aria-label='ชื่อ filter']")).toBe("imported-name");
    expect(await page.inputValue("#pane-tier select[aria-label='NeverSink Strictness']")).toBe("5");
    expect(await page.locator("#folder-name").innerText()).toContain(override);
    expect(await page.isChecked("#auto-regen-ns")).toBe(true);
    await app.close();
    opened.length = 0;
    expect(shaBytes(fs.readFileSync(oldCfg))).toBe(before.cfg);
    expect(shaBytes(fs.readFileSync(path.join(sbx.oldDir, "log.txt")))).toBe(before.log);
    expect(fs.statSync(oldCfg).mtimeMs).toBe(before.mtime);
    expect(fs.readdirSync(sbx.oldDir).sort()).toEqual(["config.json", "log.txt"]);
    // the second start does not import again
    const second = await start(sbx);
    expect(await second.page.locator("#log").innerText()).not.toContain("นำเข้าค่าจากโปรแกรมเดิมแล้ว");
  }, 180000);
});

describe("D) old filters of every generation open", () => {
  const files = fs.readdirSync(path.join(FIXTURES, "old_filters")).filter((f) => f.endsWith(".gz"));
  it.each(files)("%s opens from the game folder's list with the same result as the core", async (f) => {
    const game = /_poe1_/.test(f) ? "poe1" : "poe2";
    const sbx = sandbox();
    const dir = gameDir(sbx, game);
    fs.mkdirSync(dir, { recursive: true });
    const name = f.replace(/\.gz$/, "");
    const text = zlib.gunzipSync(fs.readFileSync(path.join(FIXTURES, "old_filters", f)));
    fs.writeFileSync(path.join(dir, name), text);
    const { page } = await start(sbx, { game, cfg: {} });
    await page.click("#tab-wl");
    await page.click("#pane-whitelist >> text=เปิด filter");
    await page.waitForSelector(`#open-list li[data-file="${name}"]`);
    const kind = await page.getAttribute(`#open-list li[data-file="${name}"]`, "data-kind");
    expect(kind).toBe("whitelist");
    await page.click(`#open-list li[data-file="${name}"] button`);
    await page.waitForFunction(() => /เปิด|อ่าน|ไฟล์/.test(document.querySelector("#log").innerText.split("\n").slice(-6).join("\n")));
    const viaUi = await page.evaluate(() => JSON.stringify(window.PFG.api.wlConfig()));
    // the same text handed straight to the model (no main process in between) gives the same settings: the bytes arrived intact
    const viaText = await page.evaluate(([t, n]) => { window.PFG.api.wlOpen(t, n, []); return JSON.stringify(window.PFG.api.wlConfig()); }, [text.toString("utf-8"), name]);
    expect(viaUi).toBe(viaText);
    expect(Object.keys(JSON.parse(viaUi)).some((k) => k.startsWith("wl_cat_tier_"))).toBe(true);
    expect(page.errors).toEqual([]);
  }, 180000);
});

describe("E) sounds", () => {
  const mp3 = Buffer.from("ID3-test-sound-one");
  const setSound = async (page, n, name, bytes) => {
    await page.setInputFiles(`#pane-tier input[aria-label='ไฟล์เสียง ${n}']`, { name, mimeType: "audio/mpeg", buffer: bytes });
    await page.waitForFunction((nm) => document.querySelector("#pane-tier").innerText.includes(nm), name);
  };

  it("copies the sound under its own name ('#' and ';' become '_'), and does not copy it again", async () => {
    const sbx = sandbox();
    const { page } = await start(sbx);
    await setSound(page, 1, "my#sound;one.mp3", mp3);
    await generate(page, "tier");
    const dir = gameDir(sbx, "poe2");
    expect(fs.readFileSync(path.join(dir, "my_sound_one.mp3"))).toEqual(mp3);
    expect(readOnly(dir)).toContain("my_sound_one.mp3");
    const mtime = fs.statSync(path.join(dir, "my_sound_one.mp3")).mtimeMs;
    await wait(50);
    await generate(page, "tier"); // same content in the folder: reused
    expect(fs.statSync(path.join(dir, "my_sound_one.mp3")).mtimeMs).toBe(mtime);
    expect(fs.readdirSync(dir).filter((x) => x.endsWith(".mp3"))).toEqual(["my_sound_one.mp3"]);
  }, 180000);

  it("a file of the same name with other content is never overwritten silently: asks, keep -> '-2'", async () => {
    const sbx = sandbox();
    const dir = gameDir(sbx, "poe2");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "clash.mp3"), "OTHER CONTENT");
    const { page } = await start(sbx);
    await setSound(page, 2, "clash.mp3", mp3);
    await page.click("#tab-ns");
    await page.click("#btn-generate-tier");
    await page.waitForSelector("#dlg-ask[open]");
    expect(await page.locator("#dlg-ask").innerText()).toContain("clash.mp3");
    await page.click("#ask-ok"); // the default: keep the old file
    await page.waitForSelector("#result:not([hidden])");
    expect(fs.readFileSync(path.join(dir, "clash.mp3"), "utf-8")).toBe("OTHER CONTENT");
    expect(fs.readFileSync(path.join(dir, "clash-2.mp3"))).toEqual(mp3);
  }, 180000);

  it("the same name and content already in the folder is used as it is (no question, no copy)", async () => {
    const sbx = sandbox();
    const dir = gameDir(sbx, "poe2");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "same.mp3"), mp3);
    const t0 = fs.statSync(path.join(dir, "same.mp3")).mtimeMs;
    const { page } = await start(sbx);
    await setSound(page, 3, "same.mp3", mp3);
    await generate(page, "tier");
    expect(fs.statSync(path.join(dir, "same.mp3")).mtimeMs).toBe(t0);
    expect(fs.readdirSync(dir).filter((x) => x.endsWith(".mp3"))).toEqual(["same.mp3"]);
    expect(await page.locator("#dlg-ask[open]").count()).toBe(0);
  }, 180000);

  it("a sound the original program kept by path: read from there, nothing copied twice", async () => {
    const sbx = sandbox();
    const src = path.join(sbx.base, "My Sounds");
    fs.mkdirSync(src, { recursive: true });
    fs.writeFileSync(path.join(src, "legacy.mp3"), mp3);
    const dir = gameDir(sbx, "poe2");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "legacy.mp3"), mp3); // the original copied it here
    const t0 = fs.statSync(path.join(dir, "legacy.mp3")).mtimeMs;
    const { page } = await start(sbx, { cfg: { sound_1: path.join(src, "legacy.mp3") } });
    expect(await page.evaluate(() => window.PFG.sounds.name("1"))).toBe("legacy.mp3");
    expect(await page.locator("#pane-tier").innerText()).toContain("legacy.mp3");
    await generate(page, "tier");
    expect(fs.statSync(path.join(dir, "legacy.mp3")).mtimeMs).toBe(t0);
    expect(fs.readdirSync(dir).filter((x) => x.endsWith(".mp3"))).toEqual(["legacy.mp3"]);
    expect(readOnly(dir)).toContain("legacy.mp3");
  }, 180000);

  it("the picked sound is still there after a restart (kept in the app's own folder)", async () => {
    const sbx = sandbox();
    let { app, page } = await start(sbx);
    await setSound(page, 4, "keep-me.mp3", mp3);
    await page.waitForFunction(() => window.PFG.sounds.name("4") === "keep-me.mp3");
    await app.close();
    opened.length = 0;
    ({ app, page } = await start(sbx));
    expect(await page.evaluate(() => window.PFG.sounds.name("4"))).toBe("keep-me.mp3");
    await generate(page, "tier");
    expect(fs.readFileSync(path.join(gameDir(sbx, "poe2"), "keep-me.mp3"))).toEqual(mp3);
  }, 180000);

  it("a legacy path the config does not hold is not read", async () => {
    const sbx = sandbox();
    const secret = path.join(sbx.base, "secret.mp3");
    fs.writeFileSync(secret, "secret");
    const { page } = await start(sbx);
    const got = await page.evaluate((p) => window.desktop.readLegacySound("poe2", p), secret);
    expect(got).toBeNull();
  }, 120000);
});

describe("F) writing fails: Controlled Folder Access", () => {
  it("says why and what to do (Thai), writes nothing else", async () => {
    const sbx = sandbox();
    const dir = gameDir(sbx, "poe2");
    fs.mkdirSync(dir, { recursive: true });
    const target = path.join(dir, "blocked.filter");
    fs.writeFileSync(target, "x");
    fs.chmodSync(target, 0o444); // a read-only file refuses the write with EPERM, like a blocked folder
    const { app, page } = await start(sbx, { cfg: { filter_name_tier: "blocked" } });
    await page.click("#tab-ns");
    await page.click("#btn-generate-tier");
    await page.waitForFunction(() => /Controlled Folder Access/.test(document.querySelector("#log").innerText));
    const log = await page.locator("#log").innerText();
    expect(log).toContain("เขียน filter ลงโฟลเดอร์ไม่ได้");
    expect(log).toContain("Ransomware protection");
    const execPath = await app.evaluate(() => process.execPath);
    expect(log).toContain(execPath); // names the exe that has to be allowed (the installed one)
    expect(log).toContain("Game folder override");
    expect(await page.locator("#result").isHidden()).toBe(true);
    expect(fs.readFileSync(target, "utf-8")).toBe("x");
    fs.chmodSync(target, 0o666);
  }, 180000);
});

describe("G) the game folder override and an opened file's folder", () => {
  it("Browse… sets the folder, Generate writes there, the settings keep it", async () => {
    const sbx = sandbox();
    const custom = path.join(sbx.base, "Custom Filters");
    fs.mkdirSync(custom, { recursive: true });
    const { app, page } = await start(sbx);
    await app.evaluate(({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] }); }, custom);
    await page.click("#btn-folder");
    await page.waitForFunction((p) => document.querySelector("#folder-name").innerText.includes(p), custom);
    await generate(page, "tier");
    expect(filtersIn(custom).length).toBe(1);
    expect(filtersIn(gameDir(sbx, "poe2")).length).toBe(0);
    const cfg = await savedCfg(sbx, (v) => v.game_dir_poe2 === custom);
    expect(cfg.game_dir_poe2).toBe(custom);
    // "ใช้โฟลเดอร์มาตรฐาน" goes back
    await page.click("#btn-folder-forget");
    await page.waitForFunction((p) => document.querySelector("#folder-name").innerText.includes(p), gameDir(sbx, "poe2"));
  }, 180000);

  it("opening a file from another folder makes that folder the one Generate writes to", async () => {
    const sbx = sandbox();
    const other = path.join(sbx.base, "elsewhere");
    fs.mkdirSync(other, { recursive: true });
    fs.writeFileSync(path.join(other, "mine.filter"), zlib.gunzipSync(fs.readFileSync(path.join(FIXTURES, "old_filters", "v2_poe2_wl_sample.filter.gz"))));
    const { app, page } = await start(sbx);
    await app.evaluate(({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] }); }, path.join(other, "mine.filter"));
    await page.click("#tab-wl");
    await page.click("#pane-whitelist >> text=เปิด filter");
    await page.waitForSelector("#btn-open-other");
    await page.click("#btn-open-other");
    await page.waitForFunction((p) => document.querySelector("#folder-name").innerText.includes(p), other);
    await generate(page, "whitelist");
    expect(filtersIn(other).sort()).toEqual(["mine.filter"]); // written back over the opened file
    expect(filtersIn(gameDir(sbx, "poe2")).length).toBe(0);
  }, 180000);
});

describe("H) NeverSink update check at start", () => {
  const tagCfg = { neversink_tag_poe2: "v-old" };
  it("not asked to regenerate: says there is a new version, writes nothing", async () => {
    const sbx = sandbox();
    const { page } = await start(sbx, { cfg: tagCfg });
    await page.waitForFunction(() => /NeverSink มีเวอร์ชันใหม่/.test(document.querySelector("#log").innerText), null, { timeout: 30000 });
    expect(filtersIn(gameDir(sbx, "poe2")).length).toBe(0);
  }, 120000);

  it("asked to regenerate: the NeverSink tab is generated by itself", async () => {
    const sbx = sandbox();
    const { page } = await start(sbx, { cfg: { ...tagCfg, auto_regen_neversink: true } });
    await page.waitForFunction(() => /สร้าง filter ใหม่แล้ว/.test(document.querySelector("#log").innerText), null, { timeout: 60000 });
    expect(filtersIn(gameDir(sbx, "poe2")).length).toBe(1);
    expect((await savedCfg(sbx, (v) => v.neversink_tag_poe2 === "v-test")).neversink_tag_poe2).toBe("v-test");
  }, 180000);

  it("nothing generated before: nothing said", async () => {
    const sbx = sandbox();
    const { page } = await start(sbx);
    await wait(3000);
    expect(await page.locator("#log").innerText()).not.toContain("NeverSink มีเวอร์ชันใหม่");
  }, 120000);
});

describe("I) one instance", () => {
  it("a second start exits and the first window is focused (still one window)", async () => {
    const sbx = sandbox();
    const { app } = await start(sbx);
    const env = { ...process.env, LOCALAPPDATA: sbx.local, POE_FILTERGEN_DOCUMENTS: sbx.docs };
    delete env.ELECTRON_RUN_AS_NODE;
    const bin = exe || (await import("electron")).default;
    const child = spawn(bin, exe ? [] : [path.join(ROOT, "apps", "filtergen")], { env, stdio: "ignore" });
    const code = await new Promise((resolve) => { child.on("exit", resolve); setTimeout(() => { child.kill(); resolve("timeout"); }, 30000); });
    expect(code).not.toBe("timeout");
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
  }, 120000);
});

describe("J) what the page can and cannot do", () => {
  it("has no node, no require, no ipc; window.desktop is exactly the typed list", async () => {
    const sbx = sandbox();
    const { page } = await start(sbx);
    const r = await page.evaluate(() => ({
      require: typeof require, process: typeof process, ipc: typeof window.electron, module: typeof module,
      keys: Object.keys(window.desktop).sort(),
    }));
    expect(r.require).toBe("undefined");
    expect(r.process).toBe("undefined");
    expect(r.ipc).toBe("undefined");
    expect(r.module).toBe("undefined");
    expect(r.keys).toEqual(["adoptPickedDir", "clearFolder", "fileExists", "flushDone", "folderInfo", "httpGet", "init", "listFilters", "listNames", "onFlush", "onRegen", "pickFilterFile", "pickFolder", "readFile", "readLegacySound", "ready", "storeDel", "storeSet", "tradeNames", "writeFile"]);
  }, 120000);

  it("names are checked in the main process: no folders, no other file types, no other hosts", async () => {
    const sbx = sandbox();
    const outside = path.join(sbx.base, "outside.filter");
    fs.writeFileSync(outside, "secret");
    const { page } = await start(sbx);
    const r = await page.evaluate(async () => {
      const d = window.desktop;
      const out = {};
      out.readTraversal = await d.readFile("poe2", "..\\..\\outside.filter").then(() => "read", (e) => String(e.message));
      out.readSlash = await d.readFile("poe2", "../outside.filter").then(() => "read", (e) => String(e.message));
      out.readAbs = await d.readFile("poe2", "C:\\Windows\\win.ini").then(() => "read", (e) => String(e.message));
      out.writeExe = await d.writeFile("poe2", "evil.exe", new Uint8Array([1]));
      out.writeTraversal = await d.writeFile("poe2", "..\\evil.filter", new Uint8Array([1]));
      out.writeBadGame = await d.writeFile("poe3", "a.filter", new Uint8Array([1])).catch((e) => ({ ok: false, message: String(e) }));
      out.http = await d.httpGet("https://example.com/");
      out.httpFile = await d.httpGet("file:///C:/Windows/win.ini");
      out.httpOtherPath = await d.httpGet("https://api.github.com/repos/torvalds/linux/releases/latest");
      return out;
    });
    expect(r.readTraversal).toContain("ชื่อไฟล์ไม่ถูกต้อง");
    expect(r.readSlash).toContain("ชื่อไฟล์ไม่ถูกต้อง");
    expect(r.readAbs).toContain("ชื่อไฟล์ไม่ถูกต้อง");
    expect(r.writeExe.ok).toBe(false);
    expect(r.writeTraversal.ok).toBe(false);
    expect(r.writeBadGame.ok).toBe(false);
    for (const k of ["http", "httpFile", "httpOtherPath"]) expect(r[k].ok).toBe(false);
    expect(fs.existsSync(path.join(sbx.base, "evil.filter"))).toBe(false);
    expect(fs.existsSync(path.join(gameDir(sbx, "poe2"), "evil.exe"))).toBe(false);
    expect(net.calls().some((u) => /example\.com|torvalds/.test(u))).toBe(false);
  }, 120000);

  it("the page cannot fetch other sites itself (CSP), cannot navigate away, links go to the browser", async () => {
    const sbx = sandbox();
    const { app, page } = await start(sbx);
    const blocked = await page.evaluate(() => fetch("https://example.com/").then(() => "fetched", () => "blocked"));
    expect(blocked).toBe("blocked");
    const csp = await page.evaluate(() => document.querySelector("meta[http-equiv='Content-Security-Policy']").content);
    expect(csp).toContain("default-src 'none'");
    expect(csp).not.toContain("http");
    const opened = [];
    await app.evaluate(({ shell }) => { globalThis.__ext = []; shell.openExternal = async (u) => { globalThis.__ext.push(u); }; });
    await page.evaluate(() => { window.open("https://example.com/x"); });
    await page.evaluate(() => { location.href = "https://example.com/y"; });
    await wait(800);
    expect(page.url()).toMatch(/^app:\/\/local\//);
    expect(await app.evaluate(() => globalThis.__ext)).toEqual(["https://example.com/x", "https://example.com/y"]);
    void opened;
  }, 120000);

  it("the web preferences are the safe ones", async () => {
    const sbx = sandbox();
    const { app } = await start(sbx);
    const p = await app.evaluate(({ BrowserWindow }) => {
      const wp = BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences();
      return { contextIsolation: wp.contextIsolation, sandbox: wp.sandbox, nodeIntegration: wp.nodeIntegration, webSecurity: wp.webSecurity };
    });
    expect(p).toEqual({ contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true });
  }, 120000);
});

describe("L) the copy button", () => {
  it("puts the generated filter text on the clipboard", async () => {
    const sbx = sandbox();
    const { app, page } = await start(sbx);
    await generate(page, "tier");
    expect(await page.locator("#btn-download").isHidden()).toBe(true); // no download in the desktop app: the file is written
    await page.click("#btn-copy");
    await page.waitForFunction(() => /คัดลอกแล้ว/.test(document.querySelector("#log").innerText));
    const clip = await app.evaluate(({ clipboard }) => clipboard.readText());
    expect(lf(clip)).toBe(lf(readOnly(gameDir(sbx, "poe2"))));
  }, 120000);
});

describe("K) offline", () => {
  it("hub and GGG down: the lists still load from NeverSink, names fall back to the snapshot", async () => {
    const sbx = sandbox();
    const inet = await fakeInternet(data);
    inet.state.hubDown = true;
    inet.state.gggDown = true;
    const { page } = await start(sbx, { inet });
    const log = await page.locator("#log").innerText();
    expect(log).toContain("ดึง hub ไม่ได้");
    expect(log).toContain("snapshot");
    await inet.close();
  }, 120000);
});

describe("Z) the update banner of the Filter Generator", () => {
  it("shows what the update machinery says (a newer version being fetched / ready) and nothing for a failed check", async () => {
    const sbx = sandbox();
    const { app, page } = await start(sbx);
    const send = (s) => app.evaluate(({ BrowserWindow }, st) => BrowserWindow.getAllWindows()[0].webContents.send("upd:state", st), s);
    expect(await page.locator("#update-banner").isHidden()).toBe(true);
    await send({ kind: "error", message: "offline" });
    await wait(200);
    expect(await page.locator("#update-banner").isHidden()).toBe(true);
    await send({ kind: "downloading", version: "9.9.9", percent: 12 });
    await page.locator("#update-banner").waitFor({ state: "visible" });
    expect(await page.locator("#update-text").innerText()).toBe("มีรุ่นใหม่ v9.9.9 กำลังดาวน์โหลดเบื้องหลัง… 12%");
    await send({ kind: "ready", version: "9.9.9" });
    await page.waitForFunction(() => document.querySelector("#update-text").innerText.includes("ติดตั้งเมื่อปิดโปรแกรม"));
    expect(await page.locator("#update-action").innerText()).toBe("รีสตาร์ทเพื่ออัปเดต");
    // clicking it with nothing downloaded does not close the program
    await page.locator("#update-action").click();
    await wait(1200);
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
    expect(await page.evaluate(() => Object.keys(window.updater).sort())).toEqual(["get", "install", "onState", "openRelease"]);
  }, 120000);
});
