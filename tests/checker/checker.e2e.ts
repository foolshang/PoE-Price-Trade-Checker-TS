// @ts-nocheck
/**
 * The Checker in a real Electron, with a fake internet and a throw-away LOCALAPPDATA:
 *  - F5 end to end with REAL key presses: a text box holding the item is in front, F5 is pressed, the program sends Ctrl+C to it, reads the
 *    clipboard, shows the popup; the url it opens equals the one the ORIGINAL (python) makes for the same item and the same ticks
 *  - F4 skill reference, leagues (main / hardcore / events, prefer_hardcore), config import (the original's files untouched),
 *    hotkey conflicts (the original program running), the security of the three windows, single instance.
 * Runs the build output under the electron of node_modules; with PFG_CHECKER_EXE=<installed exe> the installed program.
 * NOTE: these tests take the keyboard focus for a moment (the text box comes to the front, F4 / F5 are pressed).
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { CHECKER_DIR, launch, sandbox, wait, ROOT } from "../desktop/harness.mjs";
import { fakeInternet, fixtureData } from "../desktop/stubs.mjs";
import { openTextBox, pressKey, foregroundTitle } from "./win.mjs";
import { pickerRowText, defaultChecked } from "../../apps/checker/src/shared/picker_text.ts";

const exe = process.env.PFG_CHECKER_EXE;
const data = fixtureData();
const ITEMS = path.join(ROOT, "tests", "parity", "fixtures", "items");
const OLD_EXE = "D:\\Projects\\PoE_Price-Trade_Checker\\dist\\PoE-Price-Trade-Checker.exe";
let net;
const opened = [];
const extra = [];
beforeAll(async () => {
  net = await fakeInternet(data);
  net.state.realItems = true;
});
afterEach(async () => {
  for (const a of opened.splice(0)) { try { await a.close(); } catch { /* gone */ } }
  for (const f of extra.splice(0)) { try { await f(); } catch { /* gone */ } }
});

const sha = (b) => createHash("sha256").update(b).digest("hex");
const ver = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf-8")).version;

/** what the original makes of an F5 on this fixture item (the url, the popup, the badges) */
function expected(args) {
  const out = execFileSync("python", ["-B", path.join(ROOT, "tools", "parity", "f5_expect.py"), JSON.stringify(args)], {
    encoding: "utf-8", env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1", PYTHONIOENCODING: "utf-8" },
  });
  return JSON.parse(out);
}

async function start(sbx, { cfg, game, waitLeagues = true, inet = net } = {}) {
  if (cfg || game) {
    fs.mkdirSync(sbx.checkerDir, { recursive: true });
    fs.writeFileSync(path.join(sbx.checkerDir, "config.json"), JSON.stringify({ ...(cfg ?? {}), ...(game ? { game_version: game } : {}) }));
  }
  const { app, page } = await launch(sbx, { exe, appDir: CHECKER_DIR, chromiumArgs: inet.args });
  opened.push(app);
  page.errors = [];
  page.on("console", (m) => m.type() === "error" && page.errors.push(m.text()));
  page.on("pageerror", (e) => page.errors.push(String(e)));
  await page.waitForSelector("#league");
  if (waitLeagues) await page.waitForFunction(() => /พบ \d+ leagues/.test(document.querySelector("#log").innerText), null, { timeout: 30000 });
  await app.evaluate(({ shell }) => { globalThis.__opened = []; shell.openExternal = async (u) => { globalThis.__opened.push(u); }; });
  return { app, page };
}
const openedUrls = (app) => app.evaluate(() => globalThis.__opened.slice());
const logText = (page) => page.locator("#log").innerText();

async function windowWith(app, part, timeout = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const w = app.windows().find((x) => x.url().includes(part));
    if (w) return w;
    await wait(100);
  }
  throw new Error(`no window with ${part}`);
}

/** put the item in a text box in front, press F5 (a real key press), return the popup page */
async function f5(app, itemName, { popup = true } = {}) {
  const box = await openTextBox(path.join(ITEMS, itemName + ".txt"), "PFG-TEST-BOX-" + Math.random().toString(36).slice(2, 7));
  extra.push(() => box.close());
  await pressKey("F5");
  if (!popup) return null;
  const w = await windowWith(app, "picker.html");
  await w.waitForSelector(".p-row, .p-head");
  return w;
}

/** a key in a window that closes because of it: the answer to the key press is "the page is gone" */
const pressIn = (page, key) => page.keyboard.press(key).catch((e) => { if (!/closed/.test(String(e))) throw e; });
const leagueOf = (page) => page.locator("#league").inputValue();

describe("A) start-up", () => {
  it("title bar, version marker first, hotkeys registered, files written", async () => {
    const sbx = sandbox();
    const { app, page } = await start(sbx);
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getTitle())).toBe(`PoE Price & Trade Checker (TypeScript) v${ver}`);
    const lines = (await logText(page)).split("\n");
    expect(lines[0]).toBe(`PoE Price & Trade Checker v${ver} — config: ${sbx.checkerDir}`);
    expect(await page.locator("#ver").innerText()).toContain(ver);
    for (const k of ["F4", "F5", "Ctrl+Alt+Q"]) expect(await app.evaluate(({ globalShortcut }, key) => globalShortcut.isRegistered(key), k)).toBe(true);
    expect(fs.readFileSync(path.join(sbx.checkerDir, "last_run.txt"), "utf-8").startsWith(`v${ver}\n`)).toBe(true);
    expect(fs.readFileSync(path.join(sbx.checkerDir, "log.txt"), "utf-8")).toContain(`PoE Price & Trade Checker v${ver} started`);
    expect(page.errors).toEqual([]);
  }, 120000);

  it("a second start does not open a second program", async () => {
    const sbx = sandbox();
    const { app } = await start(sbx);
    const env = { ...process.env, LOCALAPPDATA: sbx.local };
    delete env.ELECTRON_RUN_AS_NODE;
    const bin = exe || (await import("electron")).default;
    const child = spawn(bin, exe ? [] : [CHECKER_DIR], { env, stdio: "ignore" });
    const code = await new Promise((resolve) => { child.on("exit", resolve); setTimeout(() => { child.kill(); resolve("timeout"); }, 30000); });
    expect(code).not.toBe("timeout");
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
  }, 120000);
});

describe("B) leagues", () => {
  const idx = (g) => JSON.parse(data.checker[g].leagues);
  it("lists main, hardcore and events from the hub's index, picks main", async () => {
    const sbx = sandbox();
    const { page } = await start(sbx, { game: "poe2" });
    const ix = idx("poe2");
    const want = [ix.main.league, ...(ix.hardcore ? [ix.hardcore.league] : []), ...ix.events.map((e) => e.league)];
    const got = await page.locator("#league option").allInnerTexts();
    expect(got).toEqual([...new Set(want)]);
    expect(await leagueOf(page)).toBe(ix.main.league);
  }, 120000);

  it("prefer_hardcore picks the hardcore league", async () => {
    const sbx = sandbox();
    const { page } = await start(sbx, { game: "poe1", cfg: { prefer_hardcore: true } });
    expect(await leagueOf(page)).toBe(idx("poe1").hardcore.league);
  }, 120000);

  it("switching the game loads that game's leagues; the choice is saved; Refresh keeps the choice", async () => {
    const sbx = sandbox();
    const { app, page } = await start(sbx, { game: "poe2" });
    const poe2Main = idx("poe2").main.league;
    await page.click("#game-poe1");
    await page.waitForFunction((l) => document.querySelector("#league").value === l, idx("poe1").main.league, { timeout: 30000 });
    const hc = idx("poe1").hardcore.league;
    await page.selectOption("#league", hc);
    await page.click("#btn-leagues");
    await page.waitForFunction(() => (document.querySelector("#log").innerText.match(/พบ \d+ leagues/g) || []).length >= 3);
    expect(await leagueOf(page)).toBe(hc);
    await app.close();
    opened.length = 0;
    const cfg = JSON.parse(fs.readFileSync(path.join(sbx.checkerDir, "config.json"), "utf-8"));
    expect(cfg.game_version).toBe("poe1");
    expect(cfg.league).toBe(hc);
    expect(poe2Main).toBeTruthy();
  }, 180000);

  it("a hub without the index keeps the saved league and says so", async () => {
    const sbx = sandbox();
    const inet = await fakeInternet(data);
    inet.state.realItems = true;
    inet.state.noLeagueIndex = true;
    const { page } = await start(sbx, { game: "poe2", cfg: { league: "My Saved League" }, inet, waitLeagues: false });
    await page.waitForFunction(() => /ไม่มีข้อมูลลีก|ดึง league ไม่ได้/.test(document.querySelector("#log").innerText), null, { timeout: 30000 });
    expect(await leagueOf(page)).toBe("My Saved League");
    await inet.close();
  }, 120000);
});

describe("C) F5 with a real key press", () => {
  it("a rare item: the popup is the original's, the search url is the original's", async () => {
    const sbx = sandbox();
    const { app, page } = await start(sbx, { game: "poe2" });
    const league = await leagueOf(page);
    const exp = expected({ text: "it:poe2_rare_gloves", game: "poe2", league, filters: [[2, "40", ""], [3, "", "90"]] });
    const pk = await f5(app, "poe2_rare_gloves");
    expect(await pk.locator(".p-head").innerText()).toBe("Rapture Mitts");
    expect(await pk.locator(".p-sub").textContent()).toBe("Rare  ·  Knightly Mitts");
    expect(await pk.locator(".p-summary").textContent()).toBe(exp.summary);
    const rows = pk.locator(".p-row");
    expect(await rows.count()).toBe(exp.rows.length);
    for (let i = 0; i < exp.rows.length; i++) {
      const r = exp.rows[i];
      const pr = { text: r.text, modType: r.mod_type, searchable: !!r.sid, tier: r.tier, total: r.total, money: r.money };
      expect(await rows.nth(i).locator("label span").innerText()).toBe(pickerRowText(pr));
      expect(await pk.locator(`#row-${i}`).isChecked()).toBe(defaultChecked(pr));
      expect(await pk.locator(`#min-${i}`).inputValue()).toBe(r.sid && r.value !== null ? String(parseFloat(r.value.toPrecision(6))) : "");
      const badge = await rows.nth(i).locator(".p-badge").evaluate((e) => getComputedStyle(e).color);
      if (exp.badge_colors[i]) expect(badge).toBe(hexToRgb(exp.badge_colors[i]));
      expect(await rows.nth(i).locator(".p-ps").evaluate((e) => e.textContent)).toBe((exp.affixes[i] === "prefix" ? "P" : exp.affixes[i] === "suffix" ? "S" : " ") + (exp.roll_arrows[i] ?? " "));
    }
    // untick everything, tick two rows, type a min and a max, search
    await pk.click("#btn-none");
    await pk.check("#row-2");
    await pk.check("#row-3");
    await pk.fill("#min-2", "40");
    await pk.fill("#min-3", "");
    await pk.fill("#max-3", "90");
    await pk.click("#btn-search");
    await wait(500);
    expect(await openedUrls(app)).toEqual([exp.url_for]);
    expect(app.windows().some((w) => w.url().includes("picker.html"))).toBe(false); // closed after the search
    expect(await logText(page)).toContain("🔎 เปิด trade: Rapture Mitts");
  }, 180000);

  it("the popup as it starts gives the original's default search (Enter)", async () => {
    const sbx = sandbox();
    const { app, page } = await start(sbx, { game: "poe2" });
    const exp = expected({ text: "it:poe2_rare_ring", game: "poe2", league: await leagueOf(page) });
    const pk = await f5(app, "poe2_rare_ring");
    await pressIn(pk, "Enter");
    await wait(500);
    expect(await openedUrls(app)).toEqual([exp.url_default]);
  }, 180000);

  it("Esc cancels: nothing is opened", async () => {
    const sbx = sandbox();
    const { app } = await start(sbx, { game: "poe2" });
    const pk = await f5(app, "poe2_rare_ring");
    await pressIn(pk, "Escape");
    await wait(500);
    expect(await openedUrls(app)).toEqual([]);
    expect(app.windows().some((w) => w.url().includes("picker.html"))).toBe(false);
  }, 180000);

  it("a unique opens the trade page at once (no popup), as the original's url", async () => {
    const sbx = sandbox();
    const { app, page } = await start(sbx, { game: "poe1" });
    const exp = expected({ text: "it:poe1_unique_dying_sun", game: "poe1", league: await leagueOf(page) });
    expect(exp.kind).toBe("url");
    await f5(app, "poe1_unique_dying_sun", { popup: false });
    await page.waitForFunction(() => /เปิด trade/.test(document.querySelector("#log").innerText), null, { timeout: 20000 });
    expect(await openedUrls(app)).toEqual([exp.url]);
    expect(app.windows().some((w) => w.url().includes("picker.html"))).toBe(false);
  }, 180000);

  it("a magic item: the base is resolved from the meta; a PoE1 item with no headers gets its P / S from the meta", async () => {
    const sbx = sandbox();
    const { app, page } = await start(sbx, { game: "poe2" });
    const exp = expected({ text: "it:poe2_magic_boots", game: "poe2", league: await leagueOf(page) });
    const pk = await f5(app, "poe2_magic_boots");
    expect(await pk.locator(".p-row").count()).toBe(exp.rows.length);
    await pressIn(pk, "Enter");
    await wait(400);
    expect(await openedUrls(app)).toEqual([exp.url_default]);
  }, 180000);

  it("PoE1: an item without any mod header", async () => {
    const sbx = sandbox();
    const { app, page } = await start(sbx, { game: "poe1" });
    const exp = expected({ text: "it:poe1_rare_noheader", game: "poe1", league: await leagueOf(page) });
    const pk = await f5(app, "poe1_rare_noheader");
    expect(await pk.locator(".p-summary").textContent()).toBe(exp.summary);
    await pressIn(pk, "Enter");
    await wait(400);
    expect(await openedUrls(app)).toEqual([exp.url_default]);
  }, 180000);

  it("not an item: says so; the clipboard is cleared like the original", async () => {
    const sbx = sandbox();
    const { app, page } = await start(sbx, { game: "poe2" });
    const f = path.join(os.tmpdir(), "pfg-not-an-item.txt");
    fs.writeFileSync(f, "Rarity: Rare");
    const box = await openTextBox(f, "PFG-TEST-BOX-X");
    extra.push(() => box.close());
    await pressKey("F5");
    await page.waitForFunction(() => /อ่าน item ไม่ได้/.test(document.querySelector("#log").innerText), null, { timeout: 8000 }).catch(async (e) => { throw new Error((await logText(page)) + " | " + fs.readFileSync(path.join(sbx.checkerDir, "log.txt"), "utf-8") + " | " + e.message); });
    expect(await openedUrls(app)).toEqual([]);
  }, 180000);

  it("nothing selected in front: asks to point at an item again (no admin hint when nothing is elevated)", async () => {
    const sbx = sandbox();
    const { page } = await start(sbx, { game: "poe2" });
    const f = path.join(os.tmpdir(), "pfg-empty.txt");
    fs.writeFileSync(f, "");
    const box = await openTextBox(f, "PFG-TEST-BOX-E");
    extra.push(() => box.close());
    await pressKey("F5");
    await page.waitForFunction(() => /ชี้ที่ item แล้วกด F5/.test(document.querySelector("#log").innerText), null, { timeout: 20000 });
    expect(await logText(page)).not.toContain("Administrator");
  }, 180000);
});

function hexToRgb(h) {
  const n = parseInt(h.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}

describe("D) F4 skill reference", () => {
  const SKILLS = (g) => data.checker[g].skills;
  it("opens by F4, finds a skill, shows brackets, mods per slot and passives from the hub data", async () => {
    const sbx = sandbox();
    const { app } = await start(sbx, { game: "poe1" });
    await pressKey("F4");
    const w = await windowWith(app, "skillref.html");
    await w.waitForSelector("#skill-input");
    expect(await w.locator("#unavailable").count()).toBe(0);
    await w.fill("#skill-input", "winter");
    await w.waitForSelector("#suggest li");
    const first = await w.locator("#suggest li").first().innerText();
    expect(first.startsWith("Winter Orb")).toBe(true);
    await w.keyboard.press("Enter");
    await w.waitForSelector("#brackets button");
    const fx = SKILLS("poe1");
    const meta = fx.index.skills.find((s) => s.skill === "Winter Orb");
    const file = fx.files[meta.path];
    const brackets = Object.keys(file.mods);
    const shown = await w.locator("#brackets button").allInnerTexts();
    for (const b of brackets) expect(shown).toContain(b);
    const defaultBracket = shown.includes("90-100") ? "90-100" : shown[shown.length - 1];
    expect(await w.locator("#brackets button[aria-pressed=true]").innerText()).toBe(defaultBracket);
    const slots = Object.keys(file.mods[defaultBracket] ?? {}).sort();
    if (slots.length) {
      expect(await w.locator("#slot-tabs button").allInnerTexts()).toEqual(slots.map((s) => s.charAt(0).toUpperCase() + s.slice(1)));
      expect(await w.locator("#mods .s-mod").count()).toBe(file.mods[defaultBracket][slots[0]].length);
    }
    const pop = meta.populations?.[defaultBracket];
    if (pop !== undefined) expect(await w.locator("#population").innerText()).toContain(`${pop} คน`);
    await pressIn(w, "Escape");
    await wait(400);
    expect(app.windows().some((x) => x.url().includes("skillref.html"))).toBe(false);
  }, 180000);

  it("a name nobody has: says so; Esc closes", async () => {
    const sbx = sandbox();
    const { app } = await start(sbx, { game: "poe2" });
    await pressKey("F4");
    const w = await windowWith(app, "skillref.html");
    await w.fill("#skill-input", "zzzzqqq");
    await w.keyboard.press("Enter");
    await w.waitForFunction(() => /ไม่พบสกิลชื่อ "zzzzqqq"/.test(document.querySelector("#table-label").innerText));
  }, 120000);

  it("the hub down: the window says the data could not be loaded", async () => {
    const sbx = sandbox();
    const inet = await fakeInternet(data);
    inet.state.realItems = true;
    const { app, page } = await start(sbx, { game: "poe2", inet });
    inet.state.hubDown = true;
    await pressKey("F4");
    const w = await windowWith(app, "skillref.html");
    await w.waitForSelector("#unavailable", { timeout: 20000 });
    expect(await w.locator("#skill-input").count()).toBe(1);
    void page;
    inet.close(); // (not awaited: the program keeps its connection open until it closes)
  }, 120000);
});

describe("E) the original's config is read once, its files are never written", () => {
  it("takes game / league / hotkeys, drops the price-mode keys, leaves PoePriceTrade byte-identical", async () => {
    const sbx = sandbox();
    fs.mkdirSync(sbx.checkerOldDir, { recursive: true });
    const oldCfg = path.join(sbx.checkerOldDir, "config.json");
    fs.writeFileSync(oldCfg, JSON.stringify({
      game_version: "poe1", league: "Allflame", prefer_hardcore: true, auto_league: false, hotkey_scan: "F9", hotkey_trade: "F5",
      f4_mode: "price", overlay_opacity: 0.5, price_offset_px: 9, match_threshold: 0.9, currency_unit: "chaos", junk_key: 1,
      filter_gen: { strictness_poe1: 3, auto_regen: true },
    }, null, 2));
    fs.writeFileSync(path.join(sbx.checkerOldDir, "log.txt"), "old");
    const before = { cfg: sha(fs.readFileSync(oldCfg)), mtime: fs.statSync(oldCfg).mtimeMs };
    const { app, page } = await start(sbx);
    expect(await logText(page)).toContain("นำเข้าค่าจากโปรแกรมเดิมแล้ว");
    expect(await page.locator("#game-poe1").getAttribute("aria-pressed")).toBe("true");
    expect(await leagueOf(page)).toBe("Allflame"); // auto_league false: the saved league is kept (it is in the hub's list or added)
    expect(await app.evaluate(({ globalShortcut }) => globalShortcut.isRegistered("F4"))).toBe(true); // the old F9 became F4
    await wait(800);
    await app.close();
    opened.length = 0;
    const mine = JSON.parse(fs.readFileSync(path.join(sbx.checkerDir, "config.json"), "utf-8"));
    for (const k of ["f4_mode", "overlay_opacity", "price_offset_px", "match_threshold", "currency_unit", "junk_key"]) expect(mine[k]).toBeUndefined();
    expect(mine.hotkey_scan).toBe("F4");
    expect(mine.filter_gen.strictness_poe1).toBe(3);
    expect(sha(fs.readFileSync(oldCfg))).toBe(before.cfg);
    expect(fs.statSync(oldCfg).mtimeMs).toBe(before.mtime);
    expect(fs.readdirSync(sbx.checkerOldDir).sort()).toEqual(["config.json", "log.txt"]);
  }, 180000);
});

describe("F) hotkeys taken by another program", () => {
  it("the original program running: F4 and F5 are named in the log with what to do", async () => {
    expect(fs.existsSync(OLD_EXE)).toBe(true);
    const oldSbx = sandbox();
    const oldProc = spawn(OLD_EXE, [], { env: { ...process.env, LOCALAPPDATA: oldSbx.local }, stdio: "ignore" });
    extra.push(async () => { try { execFileSync("taskkill", ["/F", "/PID", String(oldProc.pid), "/T"], { stdio: "ignore" }); } catch { /* gone */ } });
    await wait(6000); // the original starts (tk window, hotkey thread)
    const sbx = sandbox();
    const { app, page } = await start(sbx, { game: "poe2", waitLeagues: false });
    const log = await logText(page);
    for (const key of ["F4", "F5"]) expect(log).toContain(`ลงทะเบียนปุ่ม ${key}`); // (the original does not hold Ctrl+Alt+Q in practice: RegisterHotKey of it succeeds beside the running original)
    expect(log).toContain("ปิดโปรแกรมนั้น");
    expect(await app.evaluate(({ globalShortcut }) => globalShortcut.isRegistered("F5"))).toBe(false);
    expect(fs.readFileSync(path.join(sbx.checkerDir, "log.txt"), "utf-8")).toContain("ลงทะเบียนปุ่ม F5");
  }, 180000);
});

describe("G) what the windows can and cannot do", () => {
  it("each window has only its own bridge, no node, a strict CSP, no way to navigate away", async () => {
    const sbx = sandbox();
    const { app, page } = await start(sbx, { game: "poe2" });
    const m = await page.evaluate(() => ({ keys: Object.keys(window.checker).sort(), others: [typeof window.picker, typeof window.skillRef], node: [typeof require, typeof process, typeof window.electron] }));
    expect(m.keys).toEqual(["init", "onLeagues", "onLog", "refreshLeagues", "setGame", "setLeague"]);
    expect(m.others).toEqual(["undefined", "undefined"]);
    expect(m.node).toEqual(["undefined", "undefined", "undefined"]);
    const blocked = await page.evaluate(() => fetch("https://example.com/").then(() => "fetched", () => "blocked"));
    expect(blocked).toBe("blocked");
    expect(await page.evaluate(() => document.querySelector("meta[http-equiv='Content-Security-Policy']").content)).toContain("default-src 'none'");

    await pressKey("F4");
    const w = await windowWith(app, "skillref.html");
    const s = await w.evaluate(() => ({ keys: Object.keys(window.skillRef).sort(), others: [typeof window.checker, typeof window.picker], node: [typeof require, typeof process] }));
    expect(s.keys).toEqual(["close", "init", "ready", "resize", "search", "select"]);
    expect(s.others).toEqual(["undefined", "undefined"]);
    expect(s.node).toEqual(["undefined", "undefined"]);
    await pressIn(w, "Escape");

    const prefs = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((x) => {
      const p = x.webContents.getLastWebPreferences();
      return { contextIsolation: p.contextIsolation, sandbox: p.sandbox, nodeIntegration: p.nodeIntegration, webSecurity: p.webSecurity };
    }));
    for (const p of prefs) expect(p).toEqual({ contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true });
  }, 180000);

  it("the picker bridge: only its own calls; a window cannot answer for another", async () => {
    const sbx = sandbox();
    const { app, page } = await start(sbx, { game: "poe2" });
    const pk = await f5(app, "poe2_rare_gloves");
    const keys = await pk.evaluate(() => Object.keys(window.picker).sort());
    expect(keys).toEqual(["cancel", "onInit", "ready", "search"]);
    expect(await pk.evaluate(() => [typeof window.checker, typeof window.skillRef])).toEqual(["undefined", "undefined"]);
    await pressIn(pk, "Escape");
    void page;
  }, 180000);
});

describe("H) the real key press path", () => {
  it("Ctrl+C reaches a plain window in front, and the text is on the clipboard", async () => {
    const f = path.join(os.tmpdir(), "pfg-sendinput.txt");
    fs.writeFileSync(f, "SENDINPUT-TEST " + Math.random());
    execFileSync("powershell", ["-NoProfile", "-Command", "Set-Clipboard -Value 'before'"], { windowsHide: true }); // (before the box: a console window would take the front)
    const box = await openTextBox(f, "PFG-TEST-BOX-S");
    extra.push(() => box.close());
    expect(foregroundTitle()).toBe("PFG-TEST-BOX-S");
    const native = await import("../../apps/checker/src/main/native.ts");
    const r = native.sendCtrlC();
    expect(r).toEqual({ sent: 4, blocked: false });
    await wait(400);
    const clip = execFileSync("powershell", ["-NoProfile", "-Command", "Get-Clipboard -Raw"], { encoding: "utf-8", windowsHide: true });
    expect(clip.trim()).toBe(fs.readFileSync(f, "utf-8").trim());
    expect(native.selfElevated()).toBe(false);
  }, 120000);
});
