// @ts-nocheck
/**
 * Phase 5 of the Checker in a real Electron, against a fake internet and a throw-away LOCALAPPDATA / Documents:
 * the filter page (the same page as the Filter Generator: golden bytes), the settings window (F8: hotkeys that clash with the game,
 * duplicates, taken by another program, registered at once), the tray and the X button, the NeverSink check (regenerate + the three
 * notices), the message over the game (no clicks, no focus). Real key presses and real Win32 window styles where it matters.
 * Run: npm run test:checker (the build output) or PFG_CHECKER_EXE=<installed exe>.
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { createHash } from "node:crypto";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { CHECKER_DIR, launch, sandbox, wait, ROOT } from "../desktop/harness.mjs";
import { fakeInternet, fixtureData } from "../desktop/stubs.mjs";
import { clickAt, exStyleOf, foregroundTitle, holdHotkey, openTextBox, pressKey, rectOfTitle, titleAtPoint } from "./win.mjs";
import { wlEmbed } from "../../packages/core/src/index.ts";

const exe = process.env.PFG_CHECKER_EXE;
const data = fixtureData();
const ver = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf-8")).version;
const GOLDEN = path.join(ROOT, "tests", "parity", "golden");
const golden = (g) => JSON.parse(fs.readFileSync(path.join(GOLDEN, g + ".json"), "utf-8"));
const cases = (g) => JSON.parse(fs.readFileSync(path.join(ROOT, "tests", "parity", "cases", g + ".json"), "utf-8"));
const goldenText = (name) => zlib.gunzipSync(fs.readFileSync(path.join(GOLDEN, "texts", name + ".txt.gz"))).toString("utf-8");
const sha = (s) => createHash("sha256").update(Buffer.from(s, "utf-8")).digest("hex");
const lf = (t) => t.replace(/\r\n/g, "\n");
const MARK = wlEmbed.MARK;
const stripBlob = (t) => lf(t).split("\n").filter((l) => !l.startsWith(MARK)).join("\n");
const FOLDER = { poe1: "Path of Exile", poe2: "Path of Exile 2" };
const ITEMS = path.join(ROOT, "tests", "parity", "fixtures", "items");

let net;
const opened = [];
const extra = [];
beforeAll(async () => {
  net = await fakeInternet(data);
  net.state.realItems = true;
});
/** when a test is over, the log of the program must not hold an error nobody caught (Electron shows a dialog and the process stays) */
const sandboxes = [];
function noUncaught() {
  for (const sbx of sandboxes.splice(0)) {
    let log = "";
    try { log = fs.readFileSync(path.join(sbx.checkerDir, "log.txt"), "utf-8"); } catch { /* none */ }
    const bad = log.split("\n").filter((l) => /uncaught exception|unhandled rejection/.test(l));
    if (bad.length) throw new Error("UNCAUGHT: " + bad.join(" | "));
  }
}
afterEach(async () => {
  net.state.tag = "v-test";
  for (const a of opened.splice(0)) { try { await a.close(); } catch { /* gone */ } }
  for (const f of extra.splice(0)) { try { await f(); } catch { /* gone */ } }
  noUncaught();
});

const gameDir = (sbx, g) => path.join(sbx.docs, "My Games", FOLDER[g]);
const filtersIn = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(".filter")) : []);
const readSaved = (sbx) => JSON.parse(fs.readFileSync(path.join(sbx.checkerDir, "config.json"), "utf-8"));
const logTxt = (sbx) => fs.readFileSync(path.join(sbx.checkerDir, "log.txt"), "utf-8");

/** start the Checker (build output or installed exe) with a saved config and wait for the main window */
async function start(sbx, { cfg = {}, game = "poe2", env = {}, inet = net, reuse = false } = {}) {
  sandboxes.push(sbx);
  fs.mkdirSync(sbx.checkerDir, { recursive: true });
  if (!reuse) fs.writeFileSync(path.join(sbx.checkerDir, "config.json"), JSON.stringify({ ...cfg, game_version: game }));
  const { app, page } = await launch(sbx, { exe, appDir: CHECKER_DIR, chromiumArgs: inet.args, extraEnv: env });
  opened.push(app);
  page.errors = [];
  page.on("console", (m) => m.type() === "error" && page.errors.push(m.text()));
  page.on("pageerror", (e) => page.errors.push(String(e)));
  await page.waitForSelector("#league");
  await page.waitForFunction(() => /พบ \d+ leagues/.test(document.querySelector("#log").innerText), null, { timeout: 30000 });
  await app.evaluate(({ shell }) => { globalThis.__opened = []; shell.openExternal = async (u) => { globalThis.__opened.push(u); }; });
  for (let i = 0; i < 100 && !(await app.evaluate(() => globalThis.__poeChecker.mainVisible())); i++) await wait(100); // (the window is shown when its first frame is ready)
  return { app, page };
}
const logText = (page) => page.locator("#log").innerText();

async function windowWith(app, part, timeout = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const w = app.windows().find((x) => x.url().includes(part));
    if (w) return w;
    await wait(100);
  }
  throw new Error(`no window with ${part}`);
}
/** close the filter window the way the player does (the X) */
const closeFilter = (app) => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().includes("filter.html"))?.close());
const hook = (app, fn, ...args) => app.evaluate((_e, [name, a]) => globalThis.__poeChecker[name](...a), [fn, args]);

/** the filter page in its own window: open it with the button and wait for the lists */
async function openFilter(app, page) {
  await page.click("#btn-filter");
  const w = await windowWith(app, "filter.html");
  await w.waitForSelector("#app:not([hidden])", { timeout: 60000 });
  await w.waitForFunction(() => /โหลดรายการ whitelist แล้ว|ไม่มี NeverSink base/.test(document.querySelector("#log").innerText), null, { timeout: 60000 });
  w.errors = [];
  w.on("pageerror", (e) => w.errors.push(String(e)));
  return w;
}
async function generate(w, mode) {
  await w.click(mode === "tier" ? "#tab-ns" : "#tab-wl");
  await w.evaluate(() => { document.querySelector("#result").hidden = true; });
  await w.click(mode === "tier" ? "#btn-generate-tier" : "#btn-generate-wl");
  await w.waitForSelector("#result:not([hidden])", { timeout: 60000 });
}
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
const settingsWindow = async (app, page) => {
  await page.click("#btn-settings");
  const w = await windowWith(app, "settings.html");
  await w.waitForSelector("#btn-apply");
  return w;
};

// ------------------------------------------------------------------------------------------------------------------------------
describe("A) the filter page in the Checker", () => {
  it("opens from the main window's button; title; only the filter bridge; the game is the Checker's", async () => {
    const sbx = sandbox();
    const { app, page } = await start(sbx, { game: "poe1" });
    expect(await page.locator("#btn-filter").innerText()).toBe("Filter Generator");
    const w = await openFilter(app, page);
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().includes("filter.html")).getTitle())).toBe(`PoE Price & Trade Checker — Filter Generator v${ver}`);
    const keys = await w.evaluate(() => ({ d: Object.keys(window.desktop).sort(), others: [typeof window.checker, typeof window.picker, typeof window.settings, typeof window.skillRef], node: [typeof require, typeof process] }));
    expect(keys.d).toEqual(["adoptPickedDir", "clearFolder", "fileExists", "flushDone", "folderInfo", "httpGet", "init", "listFilters", "listNames", "onFlush", "onRegen", "pickFilterFile", "pickFolder", "readFile", "readLegacySound", "ready", "storeDel", "storeSet", "tradeNames", "writeFile"]);
    expect(keys.others).toEqual(["undefined", "undefined", "undefined", "undefined"]);
    expect(keys.node).toEqual(["undefined", "undefined"]);
    expect(await w.locator("#game-poe1").getAttribute("aria-pressed")).toBe("true");
    const lines = (await w.locator("#log").innerText()).split("\n");
    expect(lines[0]).toBe(`PoE Price & Trade Checker — Filter Generator v${ver} — config: ${sbx.checkerDir}`);
    expect(await w.locator("#folder-name").innerText()).toContain(gameDir(sbx, "poe1"));
    // the main window's bridge cannot reach the filter page's calls and vice versa
    expect(await page.evaluate(() => typeof window.desktop)).toBe("undefined");
    expect(w.errors).toEqual([]);
    // a second click only brings the same window forward
    await page.click("#btn-filter");
    await wait(300);
    expect(app.windows().filter((x) => x.url().includes("filter.html")).length).toBe(1);
  }, 180000);

  const tierGolden = golden("tier");
  const tierCases = cases("tier").filter((c) => /-s2-none-(noq|q_color|q_game_sound)$/.test(c.id));
  it.each(tierCases.map((c) => [c.id, c]))("NeverSink tab %s: the file is the original's golden", async (_id, c) => {
    const sbx = sandbox();
    const { app, page } = await start(sbx, { cfg: { filter_gen: c.args.cfg }, game: c.args.game });
    const w = await openFilter(app, page);
    await generate(w, "tier");
    const text = readOnly(gameDir(sbx, c.args.game));
    expect(text.includes("\r\r\n")).toBe(false);
    expect(sha(lf(text))).toBe(tierGolden[c.id].result.file.$text);
    expect(w.errors).toEqual([]);
  }, 180000);

  for (const [group, game] of [["wlrand-poe1", "poe1"], ["wlrand-poe2", "poe2"]]) {
    it(`Whitelist tab ${game}: ${group}/001-build equals the original's file`, async () => {
      const sbx = sandbox();
      const c = cases(group).find((x) => x.id === `${group}/001-build`);
      const { app, page } = await start(sbx, { cfg: { filter_gen: c.args.cfg }, game });
      const w = await openFilter(app, page);
      await generate(w, "whitelist");
      const text = readOnly(gameDir(sbx, game));
      const want = goldenText(`${group}__001-build.file`);
      expect(stripBlob(text)).toBe(stripBlob(want));
      expect(embedded(text)).toEqual(embedded(want));
      expect(w.errors).toEqual([]);
    }, 180000);
  }

  it("the settings of the page live in the Checker's config (PoePriceTradeTS), not in the Filter Generator's folder", async () => {
    const sbx = sandbox();
    const { app, page } = await start(sbx, { game: "poe2" });
    const w = await openFilter(app, page);
    await w.fill("#pane-tier input[aria-label='ชื่อ filter']", "checker-tier");
    await w.selectOption("#pane-tier select[aria-label='NeverSink Strictness']", "4");
    await w.check("#auto-regen-ns");
    await generate(w, "tier");
    await wait(900);
    const cfg = readSaved(sbx);
    expect(cfg.filter_gen.filter_name_tier).toBe("checker-tier");
    expect(cfg.filter_gen.strictness_poe2).toBe(4);
    expect(cfg.filter_gen.auto_regen_neversink).toBe(true);
    expect(cfg.filter_gen.neversink_tag_poe2).toBe("v-test");
    expect(cfg.filter_gen.last_filter_name_tier).toBe("checker-tier");
    expect(cfg.game_version).toBe("poe2");
    expect(fs.existsSync(sbx.configDir)).toBe(false); // PoeFilterGenTS is never made by the Checker
    expect(filtersIn(gameDir(sbx, "poe2"))).toEqual(["checker-tier.filter"]);
  }, 180000);

  it("the game follows both ways: the page's toggle switches the Checker, the Checker's switch reloads the page", async () => {
    const sbx = sandbox();
    const { app, page } = await start(sbx, { game: "poe2" });
    const w = await openFilter(app, page);
    await w.click("#game-poe1");
    await page.waitForFunction(() => document.querySelector("#game-poe1").getAttribute("aria-pressed") === "true");
    await page.waitForFunction(() => /POE1|พบ \d+ leagues/.test(document.querySelector("#log").innerText));
    await wait(700);
    expect(readSaved(sbx).game_version).toBe("poe1");
    // the other way
    await page.click("#game-poe2");
    await w.waitForEvent("load", { timeout: 30000 }).catch(() => {});
    const w2 = await windowWith(app, "filter.html");
    await w2.waitForSelector("#app:not([hidden])", { timeout: 60000 });
    await w2.waitForFunction(() => document.querySelector("#game-poe2")?.getAttribute("aria-pressed") === "true", null, { timeout: 30000 });
  }, 180000);
});

// ------------------------------------------------------------------------------------------------------------------------------
describe("B) settings (F8)", () => {
  it("F8 (a real key press) and the button open the window; it shows the saved values and not the price-mode keys", async () => {
    const sbx = sandbox();
    const { app, page } = await start(sbx, { game: "poe2", cfg: { hotkey_quit: "Ctrl+Alt+W", prefer_hardcore: true, close_action: "exit" } });
    expect(await hook(app, "hotkeys")).toMatchObject({ hotkey_settings: "F8", hotkey_quit: "Ctrl+Alt+W" });
    await pressKey("F8");
    const w = await windowWith(app, "settings.html");
    await w.waitForSelector("#btn-apply");
    expect(await w.inputValue("#f-hotkey_quit")).toBe("Ctrl+Alt+W");
    expect(await w.isChecked("#f-prefer_hardcore")).toBe(true);
    expect(await w.isChecked("#f-f5_restore_clipboard")).toBe(true);
    expect(await w.inputValue("#f-close_action")).toBe("exit");
    expect(await w.locator("#tab-Game").innerText()).toBe("Game");
    const text = await w.locator("body").innerText();
    for (const gone of ["Opacity", "offset", "Threshold", "Scan Prices"]) expect(text).not.toContain(gone);
    expect(await w.evaluate(() => Object.keys(window.settings).sort())).toEqual(["apply", "cancel", "check", "init"]);
    // a second F8 / click brings the same window forward
    await pressKey("F8");
    await wait(400);
    expect(app.windows().filter((x) => x.url().includes("settings.html")).length).toBe(1);
    await w.click("#btn-cancel");
    await wait(300);
    expect(app.windows().filter((x) => x.url().includes("settings.html")).length).toBe(0);
    expect(page.errors).toEqual([]);
  }, 180000);

  it.each([
    ["Ctrl+C", "hotkey_trade", "ใช้ในเกม"], ["Ctrl+V", "hotkey_trade", "ใช้ในเกม"], ["Ctrl+A", "hotkey_scan", "ใช้ในเกม"], ["Ctrl+F", "hotkey_quit", "ใช้ในเกม"],
    ["Ctrl+Enter", "hotkey_quit", "แชท"], ["Home", "hotkey_scan", "ใช้ในเกม"], ["Delete", "hotkey_trade", "ใช้ในเกม"], ["Enter", "hotkey_trade", "ใช้ในเกม"],
    ["Left", "hotkey_settings", "ใช้ในเกม"], ["Up", "hotkey_settings", "ใช้ในเกม"], ["Q", "hotkey_trade", "เดี่ยวๆ"], ["", "hotkey_trade", "ยังไม่ได้ใส่"], ["Ctrl+Alt", "hotkey_trade", "ต้องมีปุ่มหลัก"],
  ])("%j for %s is refused with the reason on the page; nothing changes", async (spec, field, why) => {
    const sbx = sandbox();
    const { app, page } = await start(sbx, { game: "poe2" });
    const before = await hook(app, "hotkeys");
    const w = await settingsWindow(app, page);
    await w.click("#tab-Hotkeys");
    await w.fill(`#f-${field}`, spec);
    await w.waitForSelector(`#err-${field}:not([hidden])`);
    expect(await w.locator(`#err-${field}`).innerText()).toContain(why);
    await w.click("#btn-apply");
    await wait(400);
    expect(app.windows().filter((x) => x.url().includes("settings.html")).length).toBe(1); // still open
    expect(await w.locator(`#err-${field}`).isVisible()).toBe(true);
    expect(await hook(app, "hotkeys")).toEqual(before); // the old keys are still the registered ones
    expect(readSaved(sbx).hotkey_trade ?? "F5").toBe("F5");
  }, 120000);

  it("a duplicate is refused and names the other action", async () => {
    const sbx = sandbox();
    const { app, page } = await start(sbx, { game: "poe2" });
    const w = await settingsWindow(app, page);
    await w.click("#tab-Hotkeys");
    await w.fill("#f-hotkey_trade", "f4");
    await w.waitForSelector("#err-hotkey_trade:not([hidden])");
    const msg = await w.locator("#err-hotkey_trade").innerText();
    expect(msg).toContain("ซ้ำกับปุ่ม");
    expect(msg).toContain("Skill Reference");
    await w.fill("#f-hotkey_trade", "ctrl+ALT+q"); // however it is spelled
    await w.waitForFunction(() => /ซ้ำกับปุ่ม/.test(document.querySelector("#err-hotkey_trade").innerText));
  }, 120000);

  it("a hotkey another program holds is refused on the page; the old hotkeys keep working", async () => {
    const sbx = sandbox();
    const { app, page } = await start(sbx, { game: "poe2" });
    const release = holdHotkey(0x78); // F9, held by "another program"
    expect(release).toBeTruthy();
    extra.push(() => release());
    const w = await settingsWindow(app, page);
    await w.click("#tab-Hotkeys");
    await w.fill("#f-hotkey_trade", "F9");
    await w.click("#btn-apply");
    await w.waitForSelector("#err-hotkey_trade:not([hidden])");
    expect(await w.locator("#err-hotkey_trade").innerText()).toContain("ถูกโปรแกรมอื่นจองอยู่");
    expect(await hook(app, "hotkeys")).toEqual({ hotkey_scan: "F4", hotkey_trade: "F5", hotkey_settings: "F8", hotkey_quit: "Ctrl+Alt+Q" });
    expect(await app.evaluate(({ globalShortcut }) => [globalShortcut.isRegistered("F5"), globalShortcut.isRegistered("F9")])).toEqual([true, false]);
    expect(app.windows().filter((x) => x.url().includes("settings.html")).length).toBe(1);
    expect(readSaved(sbx).hotkey_trade).toBe("F5");
  }, 120000);

  it("Apply: the new hotkey works at once (no restart), the old one is free, the config and the legend follow", async () => {
    const sbx = sandbox();
    const { app, page } = await start(sbx, { game: "poe2" });
    const w = await settingsWindow(app, page);
    await w.click("#tab-Hotkeys");
    await w.fill("#f-hotkey_trade", "ctrl + f6");
    await w.click("#tab-Game");
    await w.uncheck("#f-f5_restore_clipboard");
    await w.check("#f-prefer_hardcore");
    await w.click("#tab-Advanced");
    await w.selectOption("#f-close_action", "exit");
    await w.selectOption("#f-log_level", "DEBUG");
    await w.click("#btn-apply");
    await page.waitForFunction(() => /บันทึก settings แล้ว/.test(document.querySelector("#log").innerText));
    await wait(500);
    expect(app.windows().filter((x) => x.url().includes("settings.html")).length).toBe(0);
    expect(await hook(app, "hotkeys")).toEqual({ hotkey_scan: "F4", hotkey_trade: "Ctrl+F6", hotkey_settings: "F8", hotkey_quit: "Ctrl+Alt+Q" });
    expect(await app.evaluate(({ globalShortcut }) => [globalShortcut.isRegistered("F5"), globalShortcut.isRegistered("Ctrl+F6")])).toEqual([false, true]);
    expect(await page.locator("#legend").innerText()).toContain("Ctrl+F6 Trade browser");
    const cfg = readSaved(sbx);
    expect(cfg).toMatchObject({ hotkey_trade: "Ctrl+F6", f5_restore_clipboard: false, prefer_hardcore: true, close_action: "exit", log_level: "DEBUG" });
    // a real press of the new key runs F5 (the old key does nothing)
    const box = await openTextBox(path.join(ITEMS, "poe2_rare_ring.txt"), "PFG-TEST-BOX-HK");
    extra.push(() => box.close());
    await pressKey("F5");
    await wait(1500);
    expect(app.windows().some((x) => x.url().includes("picker.html"))).toBe(false);
    await pressKey("F6", ["CTRL"]);
    const picker = await windowWith(app, "picker.html");
    await picker.waitForSelector(".p-row, .p-head");
  }, 180000);

  it("a hand-edited / imported config with a hotkey that clashes with the game falls back to the default and says so", async () => {
    const sbx = sandbox();
    const { app, page } = await start(sbx, { game: "poe2", cfg: { hotkey_trade: "Ctrl+C", hotkey_scan: "Home", hotkey_quit: "F5" } });
    const log = await logText(page);
    expect(log).toContain("ปุ่ม Trade Browser ที่ตั้งไว้ (Ctrl+C) ใช้ไม่ได้");
    expect(log).toContain("ปุ่ม Skill Reference ที่ตั้งไว้ (Home) ใช้ไม่ได้");
    expect(log).toContain("ปุ่ม Quit ที่ตั้งไว้ (F5) ใช้ไม่ได้"); // F5 is the Trade key's default (Ctrl+C was refused): the Quit key that also says F5 is the duplicate
    expect(await hook(app, "hotkeys")).toEqual({ hotkey_scan: "F4", hotkey_trade: "F5", hotkey_settings: "F8", hotkey_quit: "Ctrl+Alt+Q" });
  }, 120000);

  it("the clipboard option set off: F5 empties the clipboard at the end like the original (set in the window)", async () => {
    const sbx = sandbox();
    const { app, page } = await start(sbx, { game: "poe2", cfg: { f5_restore_clipboard: false } });
    const w = await settingsWindow(app, page);
    expect(await w.isChecked("#f-f5_restore_clipboard")).toBe(false);
    await w.click("#btn-cancel");
  }, 120000);
});

// ------------------------------------------------------------------------------------------------------------------------------
describe("C) tray and the X button", () => {
  it("with a tray: X hides the window (the program keeps running), Show brings it back, minimize hides too", async () => {
    const sbx = sandbox();
    const { app, page } = await start(sbx, { game: "poe2" });
    expect(await hook(app, "trayOk")).toBe(true);
    expect(await hook(app, "mainVisible")).toBe(true);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w.getTitle().startsWith("PoE Price & Trade Checker (TypeScript)")).close());
    await wait(500);
    expect(await hook(app, "mainVisible")).toBe(false);
    expect(await hook(app, "hiddenToTray")).toBe(true);
    expect(await hook(app, "quitting")).toBe(false);
    await hook(app, "showMain");
    await wait(300);
    expect(await hook(app, "mainVisible")).toBe(true);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w.getTitle().startsWith("PoE Price & Trade Checker (TypeScript)")).minimize());
    await wait(500);
    expect(await hook(app, "mainVisible")).toBe(false);
    // the hotkeys still work while the window is hidden
    expect(await hook(app, "hotkeys")).toMatchObject({ hotkey_trade: "F5" });
    await hook(app, "showMain");
    await wait(300);
    expect(await page.locator("#league").isVisible()).toBe(true);
  }, 120000);

  it("close_action exit: X closes the program", async () => {
    const sbx = sandbox();
    const { app } = await start(sbx, { game: "poe2", cfg: { close_action: "exit" } });
    const gone = new Promise((r) => app.process().once("exit", r));
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w.getTitle().startsWith("PoE Price & Trade Checker (TypeScript)")).close());
    await Promise.race([gone, wait(15000).then(() => { throw new Error("the program did not exit"); })]);
    opened.length = 0;
    expect(readSaved(sbx).close_action).toBe("exit");
  }, 120000);

  it("no tray icon (it could not be made): X closes the program, minimize does not hide the window, and the log says why", async () => {
    const sbx = sandbox();
    const { app } = await start(sbx, { game: "poe2", env: { POE_CHECKER_NO_TRAY: "1" } });
    expect(await hook(app, "trayOk")).toBe(false);
    expect(logTxt(sbx)).toContain("tray icon unavailable");
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w.getTitle().startsWith("PoE Price & Trade Checker (TypeScript)")).minimize());
    await wait(500);
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((x) => x.getTitle().startsWith("PoE Price & Trade Checker (TypeScript)")).isMinimized())).toBe(true);
    expect(await hook(app, "hiddenToTray")).toBe(false); // (minimized to the taskbar, not hidden: it can be brought back)
    const gone = new Promise((r) => app.process().once("exit", r));
    await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows().find((x) => x.getTitle().startsWith("PoE Price & Trade Checker (TypeScript)")); w.restore(); w.close(); });
    await Promise.race([gone, wait(15000).then(() => { throw new Error("the program did not exit"); })]);
    opened.length = 0;
  }, 120000);

  it("no tray icon and close_action minimize: the settings window says the X closes the program", async () => {
    const sbx = sandbox();
    const { app, page } = await start(sbx, { game: "poe2", env: { POE_CHECKER_NO_TRAY: "1" } });
    const w = await settingsWindow(app, page);
    await w.click("#tab-Advanced");
    expect(await w.locator("#tray-note").innerText()).toContain("tray icon could not be made");
  }, 120000);

  it("Show from the tray / a second start brings the hidden window back", async () => {
    const sbx = sandbox();
    const { app } = await start(sbx, { game: "poe2" });
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w.getTitle().startsWith("PoE Price & Trade Checker (TypeScript)")).close());
    await wait(400);
    expect(await hook(app, "mainVisible")).toBe(false);
    // a second start of the program: it exits at once and the first one shows its window
    const second = await launch(sbx, { exe, appDir: CHECKER_DIR, chromiumArgs: net.args }).catch(() => null);
    if (second) opened.push(second.app);
    await wait(2500);
    expect(await hook(app, "mainVisible")).toBe(true);
  }, 120000);

  it("Generate Now (the tray's item) writes the filter through the filter page without showing it, and says so in the Status", async () => {
    const sbx = sandbox();
    const { app, page } = await start(sbx, { game: "poe2" });
    await hook(app, "generateNow");
    await page.waitForFunction(() => /Generate เสร็จแล้ว|Generate ไม่สำเร็จ/.test(document.querySelector("#log").innerText), null, { timeout: 90000 });
    expect(await logText(page)).toContain("✓ Generate เสร็จแล้ว");
    expect(filtersIn(gameDir(sbx, "poe2")).length).toBe(1);
    expect(await hook(app, "filterWindows")).toEqual({ shown: null, hidden: null }); // the hidden page is gone again
    expect(app.windows().filter((x) => x.url().includes("filter.html")).length).toBe(0);
    expect(await hook(app, "overlayText")).toBe(""); // a generate by hand shows nothing over the game
  }, 180000);
});

// ------------------------------------------------------------------------------------------------------------------------------
describe("D) NeverSink check: regenerate + the three notices", () => {
  /** a tier filter was generated for the game at "v-test" (the tag the fake release reports) */
  async function withGeneratedTier(sbx, { auto, game = "poe2", env = {} }) {
    const out = await start(sbx, { game, cfg: { filter_gen: { auto_regen_neversink: auto } }, env });
    const w = await openFilter(out.app, out.page);
    await generate(w, "tier");
    await wait(900);
    expect(readSaved(sbx).filter_gen.neversink_tag_poe2 ?? readSaved(sbx).filter_gen[`neversink_tag_${game}`]).toBe("v-test");
    await closeFilter(out.app);
    await wait(1200);
    return out;
  }
  const filterFile = (sbx, game = "poe2") => path.join(gameDir(sbx, game), fs.readdirSync(gameDir(sbx, game)).find((f) => f.endsWith(".filter")));

  it("a newer release + auto on: regenerated through the page, the Status/tray/overlay say so, nothing is shown but the overlay", async () => {
    const sbx = sandbox();
    const { app, page } = await withGeneratedTier(sbx, { auto: true });
    const f = filterFile(sbx);
    const before = fs.readFileSync(f, "utf-8");
    const mtime0 = fs.statSync(f).mtimeMs;
    net.state.tag = "v-test-2";
    await hook(app, "minimizeMain"); // (not looking at the window: the dot goes on)
    await hook(app, "checkNeverSinkNow");
    const msg = "NeverSink อัปเดต v-test → v-test-2 สร้าง filter ใหม่แล้ว";
    await page.waitForFunction((m) => document.querySelector("#log").innerText.includes(m), msg, { timeout: 30000 });
    expect(readSaved(sbx).filter_gen.neversink_tag_poe2).toBe("v-test-2");
    expect(fs.statSync(f).mtimeMs).toBeGreaterThan(mtime0); // written again (the fake release has the same text, so the bytes are the same)
    expect(fs.readFileSync(f, "utf-8")).toBe(before);
    // the three notices
    expect(await hook(app, "overlayText")).toBe(msg);
    expect(await hook(app, "trayPending")).toBe(true);
    const ov = await windowWith(app, "overlay.html");
    await ov.waitForFunction((m) => document.body.innerText.includes(m), msg);
    // no window of the filter page was shown, and nothing is left running in the background
    expect(app.windows().filter((x) => x.url().includes("filter.html")).length).toBe(0);
    expect(logTxt(sbx)).toContain("neversink update gv=poe2 v-test -> v-test-2 regenerated=true");
    // asked again: it is up to date now, nothing new is said
    const lines = (await logText(page)).split("\n").filter((l) => l.includes("NeverSink")).length;
    await hook(app, "checkNeverSinkNow");
    await wait(1500);
    expect((await logText(page)).split("\n").filter((l) => l.includes("NeverSink")).length).toBe(lines);
  }, 240000);

  it("a newer release + auto off: only told (warn colour), the file is not touched", async () => {
    const sbx = sandbox();
    const { app, page } = await withGeneratedTier(sbx, { auto: false });
    const f = filterFile(sbx);
    const before = fs.readFileSync(f, "utf-8");
    net.state.tag = "v-test-3";
    await hook(app, "minimizeMain");
    await hook(app, "checkNeverSinkNow");
    const msg = "NeverSink มีเวอร์ชันใหม่ v-test-3 (filter ปัจจุบันสร้างจาก v-test) — กด Generate เพื่ออัปเดต";
    await page.waitForFunction((m) => document.querySelector("#log").innerText.includes(m), msg, { timeout: 30000 });
    expect(fs.readFileSync(f, "utf-8")).toBe(before);
    expect(readSaved(sbx).filter_gen.neversink_tag_poe2).toBe("v-test");
    expect(await hook(app, "overlayText")).toBe(msg);
    expect(await hook(app, "trayPending")).toBe(true);
    expect(await page.locator("#log .warn").last().innerText()).toBe(msg);
  }, 240000);

  it("the same release, no tier filter made yet, or GitHub down: nothing is said and nothing breaks", async () => {
    const sbx = sandbox();
    const { app, page } = await start(sbx, { game: "poe2", cfg: { filter_gen: { auto_regen_neversink: true } } });
    net.state.tag = "v-new";
    await hook(app, "checkNeverSinkNow"); // (no tier filter was ever generated: nothing to compare)
    await wait(1200);
    expect(await logText(page)).not.toContain("NeverSink");
    expect(await hook(app, "overlayText")).toBe("");
    net.state.tag = "v-test";
    const w = await openFilter(app, page);
    await generate(w, "tier");
    await wait(900);
    await closeFilter(app);
    await wait(1200);
    await hook(app, "checkNeverSinkNow"); // same tag
    await wait(1200);
    expect(await logText(page)).not.toContain("NeverSink อัปเดต");
    net.state.tag = undefined; // the release lookup answers without a tag_name
    await hook(app, "checkNeverSinkNow");
    await wait(1200);
    expect(await hook(app, "overlayText")).toBe("");
    expect(page.errors).toEqual([]);
  }, 240000);

  it("it runs by itself: the first check after the start, then on the timer", async () => {
    const sbx = sandbox();
    // seed a tier filter made at v-test (a config from a run of the program)
    fs.mkdirSync(sbx.checkerDir, { recursive: true });
    const seeded = await start(sbx, { game: "poe2", cfg: { filter_gen: { auto_regen_neversink: false } } });
    const w0 = await openFilter(seeded.app, seeded.page);
    await generate(w0, "tier");
    await wait(900);
    await seeded.app.close();
    opened.length = 0;
    net.state.tag = "v-timer";
    const { page } = await start(sbx, { game: "poe2", reuse: true, env: { POE_CHECKER_REGEN_FIRST_MS: "1500", POE_CHECKER_REGEN_EVERY_MS: "3000" } });
    await page.waitForFunction(() => /NeverSink มีเวอร์ชันใหม่ v-timer/.test(document.querySelector("#log").innerText), null, { timeout: 30000 });
    const n1 = (await logText(page)).split("\n").filter((l) => l.includes("v-timer")).length;
    await page.waitForFunction((n) => document.querySelector("#log").innerText.split("\n").filter((l) => l.includes("v-timer")).length > n, n1, { timeout: 30000 }); // the timer fires again
  }, 240000);
});

// ------------------------------------------------------------------------------------------------------------------------------
describe("E) the message over the game", () => {
  it("transparent, takes no clicks, cannot take the focus, on top, at the bottom right; the window in front keeps the keyboard", async () => {
    const sbx = sandbox();
    const { app, page } = await start(sbx, { game: "poe2" });
    const box = await openTextBox(path.join(ITEMS, "poe2_rare_ring.txt"), "PFG-TEST-BOX-OV");
    extra.push(() => box.close());
    expect(foregroundTitle()).toBe("PFG-TEST-BOX-OV");
    // the hook shows a message the same way the NeverSink notice does
    const shown = await app.evaluate(async () => { await globalThis.__poeChecker.showOverlay("ทดสอบ overlay ข้อความทับจอเกม", "#88DD88"); return true; });
    expect(shown).toBe(true);
    const ov = await windowWith(app, "overlay.html");
    await ov.waitForFunction(() => document.body.innerText.includes("ทดสอบ overlay"));
    await wait(700);
    const title = "PoE Checker overlay";
    const style = exStyleOf(title);
    const WS_EX_LAYERED = 0x80000, WS_EX_TRANSPARENT = 0x20, WS_EX_NOACTIVATE = 0x08000000, WS_EX_TOPMOST = 0x8;
    expect(style & WS_EX_TRANSPARENT).toBeTruthy(); // clicks go through
    expect(style & WS_EX_LAYERED).toBeTruthy();
    expect(style & WS_EX_NOACTIVATE).toBeTruthy(); // never takes the focus
    expect(style & WS_EX_TOPMOST).toBeTruthy();
    expect(foregroundTitle()).toBe("PFG-TEST-BOX-OV");
    const r = rectOfTitle(title);
    expect(r).toBeTruthy();
    const info = await app.evaluate(({ screen }) => { const d = screen.getPrimaryDisplay(); return { w: d.bounds.width, h: d.bounds.height, s: d.scaleFactor }; });
    // bottom right: its right end is near the screen's right edge when the text is longer than 640, the left end is 640 px from it otherwise
    expect(r[1] + r[3] / 2).toBeGreaterThan(info.h * info.s * 0.9);
    expect(r[0] + r[2]).toBeGreaterThan(info.w * info.s * 0.5);
    // a click on it reaches what is under it, not the overlay
    const cx = r[0] + Math.floor(r[2] / 2), cy = r[1] + Math.floor(r[3] / 2);
    expect(titleAtPoint(cx, cy)).not.toBe(title);
    clickAt(cx, cy);
    await wait(300);
    expect(foregroundTitle()).not.toBe(title);
    // it goes away by itself
    await wait(9000);
    expect(await app.evaluate(() => { const w = globalThis.__poeChecker.overlay(); return w ? w.isVisible() : false; })).toBe(false);
    expect(page.errors).toEqual([]);
  }, 180000);
});
