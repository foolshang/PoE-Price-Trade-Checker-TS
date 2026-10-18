// @ts-nocheck
/**
 * The main window's game buttons and the switch of PoE 1 / PoE 2 by the game that is in front, in a real Electron with stand-in game
 * windows (a program called PathOfExile_x64Steam.exe in a folder "Path of Exile" / "Path of Exile 2", like the Steam install: the same
 * exe name in both games, so only the folder / title tell them apart). Real key presses for F5.
 * Run: npm run test:checker (the build output) or PFG_CHECKER_EXE=<installed exe>.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeAll, afterAll, describe, expect, it } from "vitest";
import { CHECKER_DIR, launch, sandbox, wait } from "../desktop/harness.mjs";
import { fakeInternet, fixtureData } from "../desktop/stubs.mjs";
import { foregroundTitle, pressKey } from "./win.mjs";
import { openGame } from "./standin_game.mjs";

const exe = process.env.PFG_CHECKER_EXE;
const data = fixtureData();
let net;
const opened = [];
const games = [];
const sandboxes = [];
const root = fs.mkdtempSync(path.join(os.tmpdir(), "pfg-games-"));
beforeAll(async () => { net = await fakeInternet(data); });
afterAll(() => { try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* in use */ } });
afterEach(async () => {
  for (const g of games.splice(0)) await g.close();
  for (const a of opened.splice(0)) { try { await a.close(); } catch { /* gone */ } }
  for (const sbx of sandboxes.splice(0)) {
    let log = "";
    try { log = fs.readFileSync(path.join(sbx.checkerDir, "log.txt"), "utf-8"); } catch { /* none */ }
    const bad = log.split("\n").filter((l) => /uncaught exception|unhandled rejection/.test(l));
    if (bad.length) throw new Error("UNCAUGHT: " + bad.join(" | "));
  }
});

const hook = (app, fn, ...args) => app.evaluate((_e, [name, a]) => globalThis.__poeChecker[name](...a), [fn, args]);
const logTxt = (sbx) => fs.readFileSync(path.join(sbx.checkerDir, "log.txt"), "utf-8");

async function start(sbx, { cfg = {}, game = "poe2", env = {} } = {}) {
  sandboxes.push(sbx);
  fs.mkdirSync(sbx.checkerDir, { recursive: true });
  fs.writeFileSync(path.join(sbx.checkerDir, "config.json"), JSON.stringify({ ...cfg, game_version: game }));
  const { app, page } = await launch(sbx, { exe, appDir: CHECKER_DIR, chromiumArgs: net.args, extraEnv: env });
  opened.push(app);
  await page.waitForSelector("#league");
  await page.waitForFunction(() => /พบ \d+ leagues/.test(document.querySelector("#log").innerText), null, { timeout: 30000 });
  for (let i = 0; i < 100 && !(await hook(app, "mainVisible")); i++) await wait(100);
  return { app, page };
}
const stand = async (game, opts) => { const g = await openGame(game, root, opts); games.push(g); return g; };
const pressed = (page) => page.evaluate(() => [...document.querySelectorAll(".game-toggle button")].filter((b) => b.getAttribute("aria-pressed") === "true").map((b) => b.dataset.game));
async function until(fn, ms = 8000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (await fn()) return true; await wait(150); }
  return false;
}

describe("1) the game buttons sit in the League row, before League", () => {
  it("[PoE 1|PoE 2]  League: [dropdown]  [Refresh Leagues] in one row; nothing in the top right; they still switch", async () => {
    const { app, page } = await start(sandbox(), { game: "poe2", cfg: { auto_game: false } });
    const layout = await page.evaluate(() => {
      const row = document.querySelector("#league").closest(".row");
      const kids = [...row.children].map((e) => e.id || e.className || e.tagName);
      return { kids, toggleInHeader: !!document.querySelector("header .game-toggle"), pressed: [...row.querySelectorAll(".game-toggle button")].map((b) => b.textContent) };
    });
    expect(layout.toggleInHeader).toBe(false);
    expect(layout.kids).toEqual(["game-toggle", "l", "league", "btn-leagues", "btn-about"]);
    expect(layout.pressed).toEqual(["PoE 1", "PoE 2"]);
    // the order on the screen, left to right, and one line
    const r = await page.evaluate(() => ["#game-poe1", "#game-poe2", "label[for=league]", "#league", "#btn-leagues", "#btn-about"].map((s) => { const b = document.querySelector(s).getBoundingClientRect(); return [Math.round(b.left), Math.round(b.right), Math.round(b.top)]; }));
    for (let i = 1; i < r.length; i++) expect(r[i][0]).toBeGreaterThanOrEqual(r[i - 1][1] - 1);
    expect(new Set(r.map((x) => Math.abs(x[2] - r[0][2]) < 12)).size).toBe(1);
    // by hand
    expect(await pressed(page)).toEqual(["poe2"]);
    await page.click("#game-poe1");
    expect(await until(async () => (await hook(app, "game")) === "poe1")).toBe(true);
    expect(await pressed(page)).toEqual(["poe1"]);
    await page.click("#game-poe2");
    expect(await until(async () => (await hook(app, "game")) === "poe2")).toBe(true);
  }, 120000);
});

describe("2) the game follows the window in front", () => {
  it("a PoE 1 window comes to the front -> PoE 1 (button, league, log); then PoE 2 -> PoE 2; both open -> the one in front; none -> unchanged", async () => {
    const sbx = sandbox();
    const { app, page } = await start(sbx, { game: "poe2", env: { POE_CHECKER_GAME_POLL_MS: "300" } });
    const poe1 = await stand("poe1");
    const poe2 = await stand("poe2");
    await poe1.front();
    expect(await until(async () => (await hook(app, "game")) === "poe1")).toBe(true);
    expect(await pressed(page)).toEqual(["poe1"]);
    await page.waitForFunction(() => document.querySelector("#log").innerText.includes("สลับเป็น PoE 1"), null, { timeout: 8000 });
    await page.waitForFunction(() => (document.querySelector("#log").innerText.match(/พบ \d+ leagues/g) ?? []).length >= 2, null, { timeout: 20000 });
    await poe2.front();
    expect(await until(async () => (await hook(app, "game")) === "poe2")).toBe(true);
    expect(await pressed(page)).toEqual(["poe2"]);
    await poe1.front(); // (both are open; the one in front decides)
    expect(await until(async () => (await hook(app, "game")) === "poe1")).toBe(true);
    // what the log says it looked at: the folder, the class and the title of the window
    const log = logTxt(sbx);
    expect(log).toMatch(/game window in front: PoE 1 \(class=.*title='Path of Exile' exe='.*Path of Exile[\\/]PathOfExile_x64Steam\.exe'\)/);
    expect(log).toMatch(/game window in front: PoE 2 \(.*title='Path of Exile 2' exe='.*Path of Exile 2[\\/]PathOfExile_x64Steam\.exe'\)/);
    expect(log).toMatch(/auto game: poe2 -> poe1/);
    // a window that is not a game comes to the front (the program's own): nothing changes
    await poe2.close(); // (closing the one behind first: closing the front one would bring the other to the front)
    await poe1.close();
    games.length = 0;
    await page.bringToFront();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].focus());
    await wait(1500);
    expect(await hook(app, "game")).toBe("poe1");
  }, 240000);

  it("a switch by hand stays until the OTHER game comes to the front", async () => {
    const { app, page } = await start(sandbox(), { game: "poe2", env: { POE_CHECKER_GAME_POLL_MS: "300" } });
    const poe1 = await stand("poe1");
    const poe2 = await stand("poe2");
    await poe1.front();
    expect(await until(async () => (await hook(app, "game")) === "poe1")).toBe(true);
    await page.click("#game-poe2"); // by hand: PoE 2, while PoE 1 was the last game in front
    expect(await until(async () => (await hook(app, "game")) === "poe2")).toBe(true);
    await poe1.front(); // the same game as before comes back to the front: the choice stays
    await wait(2500);
    expect(await hook(app, "game")).toBe("poe2");
    await poe2.front();
    await wait(1500);
    await poe1.front(); // the other game: now it follows
    expect(await until(async () => (await hook(app, "game")) === "poe1")).toBe(true);
    expect(await pressed(page)).toEqual(["poe1"]);
  }, 240000);

  it("F5 uses the game of the window it was pressed in, even before the poll has seen it", async () => {
    const sbx = sandbox();
    const { app } = await start(sbx, { game: "poe2", env: { POE_CHECKER_GAME_POLL_MS: "600000" } }); // (no poll in this test)
    const poe1 = await stand("poe1");
    await poe1.front();
    await wait(1200);
    expect(await hook(app, "game")).toBe("poe2"); // not switched: only a key press can
    await pressKey("F5");
    expect(await until(async () => (await hook(app, "game")) === "poe1")).toBe(true);
    expect(logTxt(sbx)).toMatch(/auto game: poe2 -> poe1 \(ตอนกดปุ่ม\)/);
  }, 120000);

  it("the option off: neither the front window nor a key press changes the game", async () => {
    const sbx = sandbox();
    const { app, page } = await start(sbx, { game: "poe2", cfg: { auto_game: false }, env: { POE_CHECKER_GAME_POLL_MS: "300" } });
    const poe1 = await stand("poe1");
    await poe1.front();
    await wait(2500);
    await pressKey("F5");
    await wait(1500);
    expect(await hook(app, "game")).toBe("poe2");
    expect(await pressed(page)).toEqual(["poe2"]);
  }, 120000);

  it("a game window with a renamed folder is told by its title; an unknown window is nothing", async () => {
    const { app } = await start(sandbox(), { game: "poe2", env: { POE_CHECKER_GAME_POLL_MS: "300" } });
    const g = await stand("poe1", { folder: "my-game-folder" });
    await g.front();
    expect(await until(async () => (await hook(app, "game")) === "poe1")).toBe(true);
    const other = await stand("poe2", { folder: "other", title: "Some Other Title" });
    await other.front();
    await wait(2000);
    expect(foregroundTitle()).toBe("Some Other Title");
    expect(await hook(app, "game")).toBe("poe1");
  }, 120000);
});

describe("3) the option in F8", () => {
  it("a checkbox in the Game tab, on by default, saved with Apply", async () => {
    const sbx = sandbox();
    const { app, page } = await start(sbx, { game: "poe2" });
    await page.click("#btn-settings");
    let w;
    for (let i = 0; i < 100 && !(w = app.windows().find((x) => x.url().includes("settings.html"))); i++) await wait(100);
    await w.waitForSelector("#btn-apply");
    expect(await w.isChecked("#f-auto_game")).toBe(true);
    await w.uncheck("#f-auto_game");
    await w.click("#btn-apply");
    await until(() => { try { return JSON.parse(fs.readFileSync(path.join(sbx.checkerDir, "config.json"), "utf-8")).auto_game === false; } catch { return false; } });
    expect(JSON.parse(fs.readFileSync(path.join(sbx.checkerDir, "config.json"), "utf-8")).auto_game).toBe(false);
    expect(await hook(app, "game")).toBe("poe2");
  }, 120000);

  it("a game that followed the front window while F8 was open is not switched back by Apply", async () => {
    const { app, page } = await start(sandbox(), { game: "poe2", env: { POE_CHECKER_GAME_POLL_MS: "300" } });
    await page.click("#btn-settings");
    let w;
    for (let i = 0; i < 100 && !(w = app.windows().find((x) => x.url().includes("settings.html"))); i++) await wait(100);
    await w.waitForSelector("#btn-apply");
    const poe1 = await stand("poe1");
    await poe1.front();
    expect(await until(async () => (await hook(app, "game")) === "poe1")).toBe(true);
    await w.click("#btn-apply"); // the window still says PoE 2 (what it was opened with)
    await wait(1500);
    expect(await hook(app, "game")).toBe("poe1");
  }, 120000);
});
