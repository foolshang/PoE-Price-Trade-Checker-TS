// @ts-nocheck
/**
 * The Filter Generator's tray and About (beta.15): the X button goes to the tray (and says so once), a second start brings the window back,
 * the About window (history, link, what the X does), and no tray icon = the X closes the program.
 * Runs the build output (npm run desktop:build); with PFG_EXE=<installed exe> the installed program.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { launch, sandbox, wait } from "./harness.mjs";
import { fakeInternet, fixtureData } from "./stubs.mjs";
import { bringTitleToFront, openGame } from "../checker/standin_game.mjs";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const exe = process.env.PFG_EXE;
const ver = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf-8")).version;
const TITLE = `PoE1 & PoE2 Filter Generator v${ver}`;
const opened = [];
const extra = [];
const root = fs.mkdtempSync(path.join(os.tmpdir(), "pfg-fgtray-"));
let net;
beforeAll(async () => { net = await fakeInternet(fixtureData()); });
afterEach(async () => {
  for (const a of opened.splice(0)) { try { await a.close(); } catch { /* gone */ } }
  for (const f of extra.splice(0)) { try { await f(); } catch { /* gone */ } }
});

const hook = (app, fn, ...args) => app.evaluate((_e, [name, a]) => globalThis.__poeFG[name](...a), [fn, args]);
const until = async (fn, ms = 20000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return true; await wait(150); } return false; };
const logTxt = (sbx) => { try { return fs.readFileSync(path.join(sbx.configDir, "log.txt"), "utf-8"); } catch { return ""; } };

async function start(sbx, { cfg, env } = {}) {
  if (cfg) { fs.mkdirSync(sbx.configDir, { recursive: true }); fs.writeFileSync(path.join(sbx.configDir, "config.json"), JSON.stringify(cfg)); }
  const { app, page } = await launch(sbx, { exe, chromiumArgs: net.args, extraEnv: env ?? {} });
  opened.push(app);
  await page.waitForSelector("#app:not([hidden])", { timeout: 60000 });
  return { app, page };
}
const closeWindow = (app) => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());

describe("About", () => {
  it("name, version, history of every release, the link, what the X does; closes with the cross, Esc and a click outside", async () => {
    const { app, page } = await start(sandbox());
    expect(await page.locator(".game-toggle + #btn-about").count()).toBe(1); // right after the PoE1 / PoE2 buttons
    await page.click("#btn-about");
    const win = page.locator("#about-window");
    await win.waitFor({ state: "visible" });
    expect(await win.innerText()).toContain("PoE1 & PoE2 Filter Generator");
    expect(await page.locator("#about-version").innerText()).toBe(`เวอร์ชัน ${ver}`);
    expect(await page.locator("#about-link").getAttribute("href")).toBe("https://github.com/foolshang/PoE-Filter-Generator");
    const versions = await page.locator(".about-entry").evaluateAll((es) => es.map((e) => e.dataset.version));
    expect(versions[0]).toBe(ver);
    expect(versions).toContain("1.0.0-beta.13");
    expect(versions).toContain("1.0.0-beta.3");
    expect(await page.locator("#about-close-action").inputValue()).toBe("minimize"); // the default: the tray
    expect(await page.locator("#about-newer").count()).toBe(0);
    await page.locator("#about-window .modal-x").click();
    await win.waitFor({ state: "detached" });
    await page.click("#btn-about");
    await win.waitFor({ state: "visible" });
    await page.keyboard.press("Escape");
    await win.waitFor({ state: "detached" });
    // a newer version the updater knows (not installed yet) with what its release page says
    await hook(app, "updaterInject", { kind: "ready", version: "9.9.9", notes: "- ข้อความจากหน้า release" });
    await page.click("#btn-about");
    await win.waitFor({ state: "visible" });
    expect(await page.locator("#about-newer").innerText()).toContain("รุ่นใหม่ v9.9.9");
    expect(await page.locator("#about-newer").innerText()).toContain("ข้อความจากหน้า release");
    // a click outside the program
    await bringTitleToFront(TITLE);
    const other = await openGame("poe1", root, { folder: "elsewhere", title: "Some Other Program" });
    extra.push(() => other.close());
    await other.front();
    await win.waitFor({ state: "detached", timeout: 10000 });
  }, 180000);
});

describe("the X button and the tray", () => {
  it("X goes to the tray (the program lives on), says so ONCE, the window comes back from the tray; a second start brings it back too", async () => {
    const sbx = sandbox();
    const { app } = await start(sbx);
    expect(await hook(app, "trayOk")).toBe(true);
    expect(await hook(app, "closeAction")).toBe("minimize");
    await closeWindow(app);
    expect(await until(async () => !(await hook(app, "visible")), 5000)).toBe(true);
    expect(await hook(app, "hiddenToTray")).toBe(true);
    await wait(1500);
    expect(await hook(app, "quitting")).toBe(false);
    expect(fs.existsSync(path.join(sbx.configDir, "tray-hint-shown.txt"))).toBe(true);
    expect(logTxt(sbx).match(/tray hint shown/g)?.length).toBe(1);
    // the tray's "open the window"
    await hook(app, "showWindow");
    expect(await until(() => hook(app, "visible"), 5000)).toBe(true);
    // the X again: hidden again, no second message
    await closeWindow(app);
    expect(await until(async () => !(await hook(app, "visible")), 5000)).toBe(true);
    expect(logTxt(sbx).match(/tray hint shown/g)?.length).toBe(1);
    // a second start of the program while it sits in the tray: it exits, the first window comes back
    const env = { ...process.env, LOCALAPPDATA: sbx.local, POE_FILTERGEN_DOCUMENTS: sbx.docs };
    delete env.ELECTRON_RUN_AS_NODE;
    const bin = exe || (await import("electron")).default;
    const child = spawn(bin, exe ? [] : [path.join(ROOT, "apps", "filtergen")], { env, stdio: "ignore" });
    const code = await new Promise((resolve) => { child.on("exit", resolve); setTimeout(() => { child.kill(); resolve("timeout"); }, 30000); });
    expect(code).not.toBe("timeout");
    expect(await until(() => hook(app, "visible"), 5000)).toBe(true);
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
  }, 180000);

  it("the choice in About: 'close for real' -> the X closes the program; it is saved; 'tray' -> hides again", async () => {
    const sbx = sandbox();
    const { app, page } = await start(sbx);
    await page.click("#btn-about");
    await page.locator("#about-close-action").selectOption("exit");
    await until(() => { try { return JSON.parse(fs.readFileSync(path.join(sbx.configDir, "config.json"), "utf-8")).close_action === "exit"; } catch { return false; } }, 10000);
    expect(JSON.parse(fs.readFileSync(path.join(sbx.configDir, "config.json"), "utf-8")).close_action).toBe("exit");
    expect(await hook(app, "closeAction")).toBe("exit");
    await page.locator("#about-close-action").selectOption("minimize");
    expect(await until(async () => (await hook(app, "closeAction")) === "minimize", 5000)).toBe(true);
    await page.locator("#about-close-action").selectOption("exit");
    expect(await until(async () => (await hook(app, "closeAction")) === "exit", 5000)).toBe(true);
    const gone = new Promise((r) => app.process().once("exit", r));
    await closeWindow(app);
    await Promise.race([gone, wait(30000).then(() => { throw new Error("the X did not close the program"); })]);
    opened.length = 0;
  }, 120000);

  it("a saved 'exit' starts the program closing on X; no tray icon: the X closes the program and About says why", async () => {
    const sbx = sandbox();
    const { app, page } = await start(sbx, { env: { POE_FILTERGEN_NO_TRAY: "1" } });
    expect(await hook(app, "trayOk")).toBe(false);
    await page.click("#btn-about");
    expect(await page.locator("#about-close-action").isDisabled()).toBe(true);
    expect(await page.locator("#about-tray").innerText()).toContain("สร้างไอคอน tray ไม่ได้");
    await page.keyboard.press("Escape");
    expect(logTxt(sbx)).toContain("tray icon unavailable");
    const gone = new Promise((r) => app.process().once("exit", r));
    await closeWindow(app);
    await Promise.race([gone, wait(30000).then(() => { throw new Error("with no tray the X must close the program"); })]);
    opened.length = 0;
  }, 120000);
});
