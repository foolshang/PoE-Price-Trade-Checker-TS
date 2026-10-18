// @ts-nocheck
/**
 * The updates of the Checker and the windows around them (beta.15).
 *  A) any build: what the update strip says and offers for each state, the "check for updates" button, About (history, link, newer
 *     version, closes with the cross / Esc / a click outside the program), the red dot on the taskbar + tray and the details window
 *  B) the INSTALLED program (PFG_CHECKER_EXE=<installed exe>) against a local feed made of the last pack: automatic update on / off x
 *     update now / update when the program is closed / cancel; nothing is installed without the choice; the check every 24 hours (time
 *     shortened); a feed that is down or has a wrong file changes nothing.
 * The feed offers a version above any installed one but the file of the last pack (its checksum is right), so a real installer runs.
 * Nothing here talks to the internet; the feed is a folder served on 127.0.0.1.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { CHECKER_DIR, launch, sandbox, wait, ROOT } from "../desktop/harness.mjs";
import { serveFolder } from "./feed.mjs";
import { bringTitleToFront, openGame } from "./standin_game.mjs";
import os from "node:os";

const exe = process.env.PFG_CHECKER_EXE;
const DIST = path.join(ROOT, "dist-checker");
const ver = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf-8")).version;
const REPO = "https://github.com/foolshang/PoE-Price-Trade-Checker-TS";
const opened = [];
const extra = [];
const sandboxes = [];
const gamesRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pfg-upd-"));
afterEach(async () => {
  for (const a of opened.splice(0)) { try { await a.close(); } catch { /* gone */ } }
  for (const f of extra.splice(0)) { try { await f(); } catch { /* gone */ } }
  for (const sbx of sandboxes.splice(0)) {
    let log = "";
    try { log = fs.readFileSync(path.join(sbx.checkerDir, "log.txt"), "utf-8"); } catch { /* none */ }
    const bad = log.split("\n").filter((l) => /uncaught exception|unhandled rejection/.test(l));
    if (bad.length) throw new Error("UNCAUGHT: " + bad.join(" | "));
  }
});

const hook = (app, fn, ...args) => app.evaluate((_e, [name, a]) => globalThis.__poeChecker[name](...a), [fn, args]);
const logTxt = (sbx) => { try { return fs.readFileSync(path.join(sbx.checkerDir, "log.txt"), "utf-8"); } catch { return ""; } };
const until = async (fn, ms = 20000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return true; await wait(150); } return false; };

async function startPlain(sbx, { cfg = {}, env = {} } = {}) {
  sandboxes.push(sbx);
  fs.mkdirSync(sbx.checkerDir, { recursive: true });
  fs.writeFileSync(path.join(sbx.checkerDir, "config.json"), JSON.stringify({ game_version: "poe2", auto_game: false, ...cfg }));
  const { app, page } = await launch(sbx, { exe, appDir: CHECKER_DIR, extraEnv: env });
  opened.push(app);
  await page.waitForSelector("#league");
  for (let i = 0; i < 100 && !(await hook(app, "mainVisible")); i++) await wait(100);
  return { app, page };
}
const inject = (app, patch) => hook(app, "updaterInject", { mode: "installer", ...patch });
const acts = (page) => page.locator("#update-bar button").evaluateAll((bs) => bs.map((b) => b.dataset.act));
const stripText = (page) => page.locator("#update-bar .update-text").innerText();

describe("A) the update strip", () => {
  it("each state: the text and the buttons; the 'check for updates' button only without automatic update", async () => {
    const { app, page } = await startPlain(sandbox(), { cfg: { auto_update: false } });
    const bar = page.locator("#update-bar");
    expect(await bar.isHidden()).toBe(true);
    await inject(app, { phase: "idle" });
    await page.locator("#btn-update-check").waitFor({ state: "visible" });
    await inject(app, { phase: "available", version: "9.9.9", notes: "x" });
    await bar.waitFor({ state: "visible" });
    expect(await stripText(page)).toBe("มีรุ่นใหม่ v9.9.9");
    expect(await acts(page)).toEqual(["install-now", "install-exit"]);
    expect(await page.locator("#btn-update-check").isHidden()).toBe(true);
    await inject(app, { phase: "downloading", version: "9.9.9", percent: 37 });
    await page.waitForFunction(() => document.querySelector("#update-bar .update-text").innerText.includes("37%"));
    await inject(app, { phase: "downloading", version: "9.9.9", percent: 50, exitPending: true });
    await page.waitForFunction(() => document.querySelector("#update-bar .update-text").innerText.includes("จะอัปเดตตอนปิดโปรแกรม"));
    expect(await acts(page)).toEqual(["cancel"]);
    await inject(app, { phase: "ready", version: "9.9.9", exitPending: false });
    await page.waitForFunction(() => document.querySelector("#update-bar .update-text").innerText.includes("พร้อมติดตั้ง"));
    expect(await acts(page)).toEqual(["install-now", "install-exit"]);
    await inject(app, { phase: "error", failed: "download", version: "9.9.9", message: "ECONNRESET" });
    await page.waitForFunction(() => document.querySelector("#update-bar .update-text").innerText.includes("ECONNRESET"));
    expect(await acts(page)).toEqual(["retry"]);
    await inject(app, { phase: "idle", version: undefined, exitPending: false });
    await bar.waitFor({ state: "hidden" });
  }, 120000);

  it("automatic update on: no 'check for updates' button", async () => {
    const { app, page } = await startPlain(sandbox(), { cfg: { auto_update: true } });
    await inject(app, { phase: "idle" });
    await wait(500);
    expect(await page.locator("#btn-update-check").isHidden()).toBe(true);
  }, 60000);

  it("clicking the buttons of a state the updater is not in (a program that is not installed) does nothing and never closes the program", async () => {
    const { app, page } = await startPlain(sandbox());
    const realMode = await hook(app, "updaterMode");
    await inject(app, { phase: "ready", version: "9.9.9" });
    await page.locator('#update-bar button[data-act="install-now"]').click();
    await page.locator('#update-bar button[data-act="install-exit"]').click();
    await wait(1500);
    expect(await hook(app, "quitting")).toBe(false);
    expect(await hook(app, "mainVisible")).toBe(true);
    expect(realMode).toBe(exe ? "installer" : "off");
  }, 120000);
});

describe("A) About", () => {
  it("name, version, the history of every release, the GitHub link, the newer version when known; closes with the cross, Esc and a click outside", async () => {
    const { app, page } = await startPlain(sandbox());
    await page.click("#btn-about");
    const win = page.locator("#about-window");
    await win.waitFor({ state: "visible" });
    expect(await win.innerText()).toContain("PoE Price & Trade Checker (TypeScript)");
    expect(await page.locator("#about-version").innerText()).toBe(`เวอร์ชัน ${ver}`);
    expect(await page.locator("#about-link").getAttribute("href")).toBe(REPO);
    const versions = await page.locator(".about-entry").evaluateAll((es) => es.map((e) => e.dataset.version));
    expect(versions[0]).toBe(ver);
    expect(versions).toContain("1.0.0-beta.14");
    expect(versions).toContain("1.0.0-beta.8");
    expect(await page.locator(`.about-entry[data-version="${ver}"]`).innerText()).toContain("รุ่นที่ใช้อยู่");
    expect(await page.locator("#about-newer").count()).toBe(0);
    // the cross
    await page.locator("#about-window .modal-x").click();
    await win.waitFor({ state: "detached" });
    // Esc
    await page.click("#btn-about");
    await win.waitFor({ state: "visible" });
    await page.keyboard.press("Escape");
    await win.waitFor({ state: "detached" });
    // a newer version that is known (not installed yet): what its release page says
    await inject(app, { phase: "available", version: "9.9.9", notes: "- แก้บั๊ก A\n- เพิ่ม B" });
    await page.waitForSelector("#update-bar:not([hidden])");
    await page.click("#btn-about");
    await win.waitFor({ state: "visible" });
    expect(await page.locator("#about-newer").innerText()).toContain("รุ่นใหม่ v9.9.9");
    expect(await page.locator("#about-newer").innerText()).toContain("แก้บั๊ก A");
    // a click outside the program window: another program comes to the front (the window had the focus before, as it does when the player clicks in it)
    await bringTitleToFront(`PoE Price & Trade Checker (TypeScript) v${ver}`);
    const other = await openGame("poe1", gamesRoot, { folder: "elsewhere", title: "Some Other Program" });
    extra.push(() => other.close());
    await other.front();
    await win.waitFor({ state: "detached", timeout: 10000 });
    // the link opens in the browser (and nothing opens in the program)
    await app.evaluate(({ shell }) => { globalThis.__opened = []; shell.openExternal = async (u) => { globalThis.__opened.push(u); }; });
    await hook(app, "showMain");
    await page.click("#btn-about");
    await win.waitFor({ state: "visible" });
    await page.click("#about-link");
    expect(await until(async () => (await app.evaluate(() => globalThis.__opened)).length > 0, 5000)).toBe(true);
    expect(await app.evaluate(() => globalThis.__opened)).toEqual([REPO]);
    expect(app.windows().length).toBe(1);
  }, 180000);
});

describe("A) the red dot and the details window", () => {
  it("something new while the program is not looked at: the dot on the taskbar and the tray; opening it shows the details of all of it; the dot goes", async () => {
    const { app, page } = await startPlain(sandbox());
    await hook(app, "minimizeMain"); // (the X / minimize goes to the tray)
    expect(await until(async () => !(await hook(app, "mainVisible")), 5000)).toBe(true);
    expect(await hook(app, "dot")).toMatchObject({ tray: false, taskbar: false });
    await hook(app, "notifyUpdate", "9.9.9", "- ฟีเจอร์ใหม่ 1\n- ฟีเจอร์ใหม่ 2");
    await hook(app, "notifyNeverSink", "NeverSink มีเวอร์ชันใหม่ v-test-9");
    expect(await hook(app, "dot")).toMatchObject({ tray: true, taskbar: true });
    // the window comes back (tray / taskbar / Show): the details of both things
    await hook(app, "showMain");
    const win = page.locator("#details-window");
    await win.waitFor({ state: "visible", timeout: 10000 });
    expect(await page.locator("#details-update").innerText()).toContain("มีรุ่นใหม่ v9.9.9");
    expect(await page.locator("#details-update").innerText()).toContain("ฟีเจอร์ใหม่ 2");
    expect(await page.locator("#details-neversink").innerText()).toContain("v-test-9");
    expect(await hook(app, "dot")).toMatchObject({ tray: false, taskbar: false, update: null, neversink: null });
    // the cross
    await page.locator("#details-window .modal-x").click();
    await win.waitFor({ state: "detached" });
    // again, and now closed by a click outside the program
    await hook(app, "minimizeMain");
    expect(await until(async () => !(await hook(app, "mainVisible")), 5000)).toBe(true);
    await hook(app, "notifyNeverSink", "NeverSink มีเวอร์ชันใหม่ v-test-10");
    expect(await hook(app, "dot")).toMatchObject({ tray: true, taskbar: true });
    await hook(app, "showMain");
    await win.waitFor({ state: "visible", timeout: 10000 });
    expect(await page.locator("#details-update").count()).toBe(0);
    await bringTitleToFront(`PoE Price & Trade Checker (TypeScript) v${ver}`);
    const other = await openGame("poe2", gamesRoot, { folder: "elsewhere2", title: "Some Other Program 2" });
    extra.push(() => other.close());
    await other.front();
    await win.waitFor({ state: "detached", timeout: 10000 });
  }, 180000);

  it("the update buttons are in the details window, and still in the main window after it is closed", async () => {
    const { app, page } = await startPlain(sandbox(), { cfg: { auto_update: false } });
    await inject(app, { phase: "available", version: "9.9.9", notes: "n" });
    await hook(app, "minimizeMain");
    expect(await until(async () => !(await hook(app, "mainVisible")), 5000)).toBe(true);
    await hook(app, "notifyUpdate", "9.9.9", "n");
    await hook(app, "showMain");
    await page.locator("#details-window").waitFor({ state: "visible", timeout: 10000 });
    expect(await page.locator("#details-update-controls button").evaluateAll((bs) => bs.map((b) => b.dataset.act))).toEqual(["install-now", "install-exit"]);
    await page.locator("#details-window .modal-x").click();
    expect(await acts(page)).toEqual(["install-now", "install-exit"]);
  }, 120000);

  it("while the player looks at the window nothing is marked", async () => {
    const { app } = await startPlain(sandbox());
    await hook(app, "showMain");
    if (!(await until(async () => hook(app, "mainFocused"), 5000))) return; // (the machine did not give the window the focus: nothing to prove)
    await hook(app, "notifyUpdate", "9.9.9", "n");
    expect(await hook(app, "dot")).toMatchObject({ tray: false, taskbar: false });
  }, 60000);
});

// ------------------------------------------------------------------------------------------------------------------------------
const haveFeed = fs.existsSync(path.join(DIST, "checker.yml"));
describe.skipIf(!exe || !haveFeed)("B) the installed program updates itself from a local feed", () => {
  const FAKE = "99.0.0-beta.1";
  const fakeNewer = (t) => t.replace(/^version: .+$/m, `version: ${FAKE}`);
  const killAll = () => { try { execFileSync("taskkill", ["/F", "/IM", "PoE-Price-Trade-Checker-TS.exe", "/T"], { stdio: "ignore" }); } catch { /* none */ } };
  const pids = () => {
    try {
      return execFileSync("powershell", ["-NoProfile", "-Command", "(Get-Process -Name PoE-Price-Trade-Checker-TS -ErrorAction SilentlyContinue | ForEach-Object { $_.Id }) -join ','"], { encoding: "utf-8", windowsHide: true }).trim().split(",").filter(Boolean);
    } catch { return []; }
  };
  const runningTitle = () => {
    try {
      return execFileSync("powershell", ["-NoProfile", "-Command", "(Get-Process -Name PoE-Price-Trade-Checker-TS -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle } | Select-Object -First 1).MainWindowTitle"], { encoding: "utf-8", windowsHide: true }).trim();
    } catch { return ""; }
  };
  /** start the installed program with the feed; mutable = what the feed offers right now */
  async function begin(cfg, { first = 1000, every, yml } = {}) {
    killAll();
    await wait(1500);
    const state = { offer: true, wrongSum: false };
    const feed = await serveFolder(DIST, { yml: { "checker.yml": (t) => {
      let x = state.offer ? fakeNewer(t) : t.replace(/^version: .+$/m, `version: ${ver}`);
      if (state.wrongSum) x = x.replace(/sha512: .+/g, "sha512: " + "A".repeat(86) + "==");
      return yml ? yml(x) : x;
    } } });
    extra.push(() => feed.close());
    const sbx = sandbox();
    const out = await startPlain(sbx, { cfg: { ...cfg }, env: { POE_UPDATE_FEED: feed.url, POE_UPDATE_FIRST_MS: String(first), ...(every ? { POE_UPDATE_EVERY_MS: String(every) } : {}) } });
    return { ...out, feed, sbx, state };
  }
  const exes = (feed) => feed.requests.filter((r) => r.name.endsWith(".exe")).length;
  /** wait until a NEW program process (not one of `old`) shows a window titled with this version */
  async function newProgramRunning(old, ms = 240000) {
    return until(async () => pids().some((p) => !old.includes(p)) && runningTitle().includes(`v${ver}`), ms);
  }

  it("automatic update OFF: the newer version is only announced (nothing downloaded), with both choices and the red dot", async () => {
    const { app, page, feed } = await begin({ auto_update: false });
    await page.locator("#update-bar").waitFor({ state: "visible", timeout: 60000 });
    expect(await stripText(page)).toContain(`มีรุ่นใหม่ v${FAKE}`);
    expect(await acts(page)).toEqual(["install-now", "install-exit"]);
    expect(await page.locator("#btn-update-check").isHidden()).toBe(true);
    await wait(4000);
    expect(exes(feed)).toBe(0); // not a byte of the program was fetched
    expect(await hook(app, "updaterState")).toMatchObject({ phase: "available", version: FAKE, auto: false });
    expect(await hook(app, "quitting")).toBe(false);
  }, 180000);

  it("automatic update ON: downloaded in the background, then waits for the choice - nothing closes, nothing is installed", async () => {
    const { app, page, feed, sbx } = await begin({ auto_update: true });
    await page.waitForFunction(() => document.querySelector("#update-bar .update-text")?.innerText.includes("พร้อมติดตั้ง"), null, { timeout: 240000 });
    expect(exes(feed)).toBeGreaterThan(0);
    expect(await acts(page)).toEqual(["install-now", "install-exit"]);
    await wait(4000);
    expect(await hook(app, "quitting")).toBe(false);
    expect(logTxt(sbx)).not.toContain("installing");
    expect(await hook(app, "updaterState")).toMatchObject({ phase: "ready", exitPending: false, installNow: false });
  }, 360000);

  it("'update when the program is closed': the X (tray) does not install, cancel forgets it, the real exit installs and does not start the program again", async () => {
    const { app, page, sbx } = await begin({ auto_update: true, close_action: "minimize" });
    await page.waitForFunction(() => document.querySelector("#update-bar .update-text")?.innerText.includes("พร้อมติดตั้ง"), null, { timeout: 240000 });
    await page.locator('#update-bar button[data-act="install-exit"]').click();
    await page.waitForFunction(() => document.querySelector("#update-bar .update-text").innerText.includes("จะอัปเดตตอนปิดโปรแกรม"));
    expect(await acts(page)).toEqual(["install-now", "cancel"]);
    // the X: the window goes to the tray, the program lives on, nothing is installed
    const before = pids();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
    await wait(5000);
    expect(await hook(app, "hiddenToTray")).toBe(true);
    expect(logTxt(sbx)).not.toContain("installing");
    expect(pids().sort()).toEqual(before.sort());
    // back, cancel
    await hook(app, "showMain");
    await page.locator("#details-window").waitFor({ state: "detached", timeout: 3000 }).catch(() => {});
    await page.locator('#update-bar button[data-act="cancel"]').click();
    await page.waitForFunction(() => document.querySelector("#update-bar .update-text").innerText.includes("พร้อมติดตั้ง"));
    expect(await hook(app, "updaterState")).toMatchObject({ exitPending: false });
    // choose again; the real exit (the tray's Quit) installs
    await page.locator('#update-bar button[data-act="install-exit"]').click();
    await page.waitForFunction(() => document.querySelector("#update-bar .update-text").innerText.includes("จะอัปเดตตอนปิดโปรแกรม"));
    const old = pids();
    const gone = new Promise((r) => app.process().once("exit", r));
    await app.evaluate(({ app: a }) => a.quit());
    await Promise.race([gone, wait(60000).then(() => { throw new Error("the program did not close"); })]);
    opened.length = 0;
    expect(await until(() => logTxt(sbx).includes(`installing ${FAKE} (restart: false)`), 15000)).toBe(true);
    // the installer runs and does not start the program again
    await wait(45000);
    expect(pids().filter((p) => !old.includes(p))).toEqual([]);
    killAll();
  }, 600000);

  it("cancel, then close: nothing is installed", async () => {
    const { app, page, sbx } = await begin({ auto_update: true });
    await page.waitForFunction(() => document.querySelector("#update-bar .update-text")?.innerText.includes("พร้อมติดตั้ง"), null, { timeout: 240000 });
    await page.locator('#update-bar button[data-act="install-exit"]').click();
    await page.locator('#update-bar button[data-act="cancel"]').click();
    await page.waitForFunction(() => document.querySelector("#update-bar .update-text").innerText.includes("พร้อมติดตั้ง"));
    const gone = new Promise((r) => app.process().once("exit", r));
    await app.evaluate(({ app: a }) => a.quit());
    await Promise.race([gone, wait(60000).then(() => { throw new Error("the program did not close"); })]);
    opened.length = 0;
    await wait(20000);
    expect(logTxt(sbx)).not.toContain("installing");
    expect(logTxt(sbx)).toContain("the choice was cancelled");
    expect(pids()).toEqual([]);
  }, 480000);

  it("'update now' with automatic update OFF: downloads, closes, installs, the new version starts; the settings are all kept", async () => {
    const settings = { auto_update: false, game_version: "poe1", league: "Allflame", auto_league: false, prefer_hardcore: true, hotkey_trade: "F6", hotkey_quit: "Ctrl+Alt+W", close_action: "exit", f5_restore_clipboard: false,
      filter_gen: { strictness_poe1: 4, filter_name_tier: "my-tier", auto_regen_neversink: true } };
    const { app, page, sbx, feed } = await begin(settings);
    await page.locator("#update-bar").waitFor({ state: "visible", timeout: 60000 });
    expect(exes(feed)).toBe(0);
    const old = pids();
    await page.locator('#update-bar button[data-act="install-now"]').click();
    await page.waitForFunction(() => document.querySelector("#update-bar .update-text")?.innerText.includes("ทันทีที่โหลดเสร็จ"), null, { timeout: 30000 });
    const gone = new Promise((r) => app.process().once("exit", r));
    await Promise.race([gone, wait(240000).then(() => { throw new Error("the program did not close after 'update now'"); })]);
    opened.length = 0;
    expect(logTxt(sbx)).toContain(`installing ${FAKE} (restart: true)`);
    expect(await newProgramRunning(old)).toBe(true);
    killAll();
    await wait(1500);
    const after = JSON.parse(fs.readFileSync(path.join(sbx.checkerDir, "config.json"), "utf-8"));
    expect(after).toMatchObject({ ...settings, filter_gen: expect.objectContaining(settings.filter_gen) });
  }, 900000);

  it("the check repeats (every 24 hours, shortened here) and finds a version published later, with automatic update on or off", async () => {
    const { page, feed, state } = await begin({ auto_update: false }, { first: 1000, every: 3000 });
    state.offer = false; // (nothing newer at first)
    await wait(1500);
    const count = () => feed.requests.filter((r) => r.name === "checker.yml").length;
    expect(await until(() => count() >= 3, 20000)).toBe(true); // asked again and again
    expect(await page.locator("#update-bar").isHidden()).toBe(true); // ... and said nothing
    state.offer = true; // published meanwhile
    await page.locator("#update-bar").waitFor({ state: "visible", timeout: 30000 });
    expect(await stripText(page)).toContain(`v${FAKE}`);
  }, 180000);

  it("'check for updates': only without automatic update; it answers 'up to date', then finds the newer version", async () => {
    const off = await begin({ auto_update: false }, { first: 3600000 });
    off.state.offer = false;
    await off.page.locator("#btn-update-check").waitFor({ state: "visible", timeout: 30000 });
    await off.page.click("#btn-update-check");
    await off.page.waitForFunction(() => document.querySelector("#update-bar .update-text")?.innerText.includes("เป็นรุ่นล่าสุดแล้ว"), null, { timeout: 30000 });
    off.state.offer = true;
    await off.page.click("#btn-update-check");
    await off.page.waitForFunction((v) => document.querySelector("#update-bar .update-text")?.innerText.includes(`v${v}`), FAKE, { timeout: 30000 });
    expect(await acts(off.page)).toEqual(["install-now", "install-exit"]);
    expect(await off.page.locator("#btn-update-check").isHidden()).toBe(true);
    await off.app.close();
    opened.length = 0;
    const on = await begin({ auto_update: true }, { first: 3600000 });
    await wait(1500);
    expect(await on.page.locator("#btn-update-check").isHidden()).toBe(true);
  }, 240000);

  it("a feed that is down: silent in the window (the log has it); 'check for updates' by the player says it failed", async () => {
    killAll();
    await wait(1000);
    const dead = await serveFolder(DIST);
    const url = dead.url;
    await dead.close();
    const sbx = sandbox();
    const { app, page } = await startPlain(sbx, { cfg: { auto_update: false }, env: { POE_UPDATE_FEED: url, POE_UPDATE_FIRST_MS: "1000" } });
    await until(() => /updater: check failed/.test(logTxt(sbx)), 30000);
    expect(await page.locator("#update-bar").isHidden()).toBe(true);
    expect(logTxt(sbx)).toMatch(/updater: check failed: .*(ECONNREFUSED|ERR_CONNECTION|net::)/i);
    await page.click("#btn-update-check");
    await page.waitForFunction(() => document.querySelector("#update-bar .update-text")?.innerText.includes("เช็คอัปเดตไม่สำเร็จ"), null, { timeout: 30000 });
    expect(await hook(app, "mainVisible")).toBe(true);
    expect(await hook(app, "quitting")).toBe(false);
  }, 180000);

  it("a download whose file does not match its checksum: refused, the reason is shown, 'try again' is offered, nothing is installed", async () => {
    const { app, page, sbx, state } = await begin({ auto_update: true });
    state.wrongSum = true;
    await page.waitForFunction(() => document.querySelector("#update-bar .update-text")?.innerText.includes("ไม่สำเร็จ"), null, { timeout: 240000 });
    expect(await acts(page)).toEqual(["retry"]);
    expect(await stripText(page)).toMatch(/sha512|checksum/i);
    expect(logTxt(sbx)).not.toContain("installing");
    await page.locator('#update-bar button[data-act="retry"]').click();
    await page.waitForFunction(() => document.querySelector("#update-bar .update-text")?.innerText.includes("ไม่สำเร็จ"), null, { timeout: 240000 });
    expect(await hook(app, "quitting")).toBe(false);
  }, 600000);
});
