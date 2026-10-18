// @ts-nocheck
/**
 * The updates of the program itself.
 *  A) the banner (any build): what a window says for each state, the button that only the player clicks, a window that opens late
 *  B) the real thing, with the INSTALLED program (PFG_CHECKER_EXE=<installed exe>) and a local feed made of the last pack
 *     (dist-checker\checker.yml + its Setup): the installed older version downloads it in the background, says so, installs it when the
 *     player clicks "restart to update", and the settings are all still there; a feed that is down or has a wrong checksum changes nothing.
 * Nothing here talks to the internet; the feed is a folder served on 127.0.0.1.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { CHECKER_DIR, launch, sandbox, wait, ROOT } from "../desktop/harness.mjs";
import { serveFolder } from "./feed.mjs";

const exe = process.env.PFG_CHECKER_EXE;
const DIST = path.join(ROOT, "dist-checker");
const opened = [];
const extra = [];
afterEach(async () => {
  for (const a of opened.splice(0)) { try { await a.close(); } catch { /* gone */ } }
  for (const f of extra.splice(0)) { try { await f(); } catch { /* gone */ } }
});

const hook = (app, fn, ...args) => app.evaluate((_e, [name, a]) => globalThis.__poeChecker[name](...a), [fn, args]);
const sendState = (app, state, urlPart = "index.html") =>
  app.evaluate(({ BrowserWindow }, [s, part]) => { for (const w of BrowserWindow.getAllWindows()) if (w.webContents.getURL().includes(part)) w.webContents.send("upd:state", s); }, [state, urlPart]);

async function startPlain(sbx, env = {}) {
  fs.mkdirSync(sbx.checkerDir, { recursive: true });
  fs.writeFileSync(path.join(sbx.checkerDir, "config.json"), JSON.stringify({ game_version: "poe2" }));
  const { app, page } = await launch(sbx, { exe, appDir: CHECKER_DIR, extraEnv: env });
  opened.push(app);
  await page.waitForSelector("#league");
  return { app, page };
}

describe("A) the update banner", () => {
  it("shows nothing for idle / error; the text and the button of each state", async () => {
    const { app, page } = await startPlain(sandbox());
    const banner = page.locator("#update-banner");
    expect(await banner.isHidden()).toBe(true);
    await sendState(app, { kind: "error", message: "network" });
    await wait(200);
    expect(await banner.isHidden()).toBe(true);
    await sendState(app, { kind: "downloading", version: "9.9.9", percent: 37 });
    await banner.waitFor({ state: "visible" });
    expect(await page.locator("#update-text").innerText()).toBe("มีรุ่นใหม่ v9.9.9 กำลังดาวน์โหลดเบื้องหลัง… 37%");
    expect(await page.locator("#update-action").isHidden()).toBe(true);
    await sendState(app, { kind: "ready", version: "9.9.9" });
    await page.waitForFunction(() => document.querySelector("#update-text").innerText.includes("ติดตั้งเมื่อปิดโปรแกรม"));
    expect(await page.locator("#update-action").innerText()).toBe("รีสตาร์ทเพื่ออัปเดต");
    await sendState(app, { kind: "manual", version: "9.9.9", url: "https://example.invalid/" });
    await page.waitForFunction(() => document.querySelector("#update-text").innerText.includes("zip"));
    expect(await page.locator("#update-action").innerText()).toBe("เปิดหน้าดาวน์โหลด");
    await sendState(app, { kind: "idle" });
    await banner.waitFor({ state: "hidden" });
  }, 120000);

  it("clicking 'restart to update' with nothing downloaded does nothing (the program is never closed on its own)", async () => {
    const { app, page } = await startPlain(sandbox());
    await sendState(app, { kind: "ready", version: "9.9.9" });
    await page.locator("#update-action").click();
    await wait(1500);
    expect(await hook(app, "quitting")).toBe(false);
    expect(await hook(app, "mainVisible")).toBe(true);
    expect(await hook(app, "updaterMode")).toBe(exe ? "installer" : "off");
  }, 120000);

  it("a window that opens late asks for the state; the filter window has the banner too", async () => {
    const { app, page } = await startPlain(sandbox());
    await hook(app, "updaterInject", { kind: "ready", version: "9.9.9" });
    await page.locator("#update-banner").waitFor({ state: "visible" });
    await page.click("#btn-filter");
    const t0 = Date.now();
    let w;
    while (!(w = app.windows().find((x) => x.url().includes("filter.html"))) && Date.now() - t0 < 30000) await wait(100);
    await w.waitForSelector("#app:not([hidden])", { timeout: 60000 });
    await w.locator("#update-banner").waitFor({ state: "visible", timeout: 20000 });
    expect(await w.locator("#update-text").innerText()).toContain("v9.9.9");
    expect(await w.evaluate(() => Object.keys(window.updater).sort())).toEqual(["get", "install", "onState", "openRelease"]);
    // the page of the main window cannot do more than that with its bridge
    expect(await page.evaluate(() => Object.keys(window.updater).sort())).toEqual(["get", "install", "onState", "openRelease"]);
  }, 180000);
});

// ------------------------------------------------------------------------------------------------------------------------------
const haveFeed = fs.existsSync(path.join(DIST, "checker.yml"));
describe.skipIf(!exe || !haveFeed)("B) the installed program updates itself from a local feed", () => {
  const feedYml = () => fs.readFileSync(path.join(DIST, "checker.yml"), "utf-8");
  const feedVersion = () => /^version: (.+)$/m.exec(feedYml())[1].trim();
  const mainTitle = (app) => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w.getTitle().startsWith("PoE Price & Trade Checker (TypeScript)"))?.getTitle() ?? "");
  const titleVersion = (t) => /v(\S+)$/.exec(t)?.[1];
  const runningTitle = () => {
    try {
      return execFileSync("powershell", ["-NoProfile", "-Command", "(Get-Process -Name PoE-Price-Trade-Checker-TS -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle } | Select-Object -First 1).MainWindowTitle"], { encoding: "utf-8", windowsHide: true }).trim();
    } catch { return ""; }
  };
  const killAll = () => { try { execFileSync("taskkill", ["/F", "/IM", "PoE-Price-Trade-Checker-TS.exe", "/T"], { stdio: "ignore" }); } catch { /* none */ } };

  it("downloads in the background, says so, installs on the click, keeps every setting, starts the new version", async () => {
    const feed = await serveFolder(DIST);
    extra.push(() => feed.close());
    const sbx = sandbox();
    const settings = { game_version: "poe1", league: "Allflame", prefer_hardcore: true, hotkey_trade: "F6", hotkey_quit: "Ctrl+Alt+W", close_action: "exit", f5_restore_clipboard: false, filter_gen: { strictness_poe1: 4, filter_name_tier: "my-tier", auto_regen_neversink: true } };
    fs.mkdirSync(sbx.checkerDir, { recursive: true });
    fs.writeFileSync(path.join(sbx.checkerDir, "config.json"), JSON.stringify(settings));
    killAll();
    await wait(1500);
    const { app, page } = await launch(sbx, { exe, extraEnv: { POE_UPDATE_FEED: feed.url, POE_UPDATE_FIRST_MS: "1500" } });
    opened.push(app);
    await page.waitForSelector("#league");
    const oldVersion = titleVersion(await mainTitle(app));
    const newVersion = feedVersion();
    expect(oldVersion).toBeTruthy();
    expect(oldVersion).not.toBe(newVersion);
    expect(await hook(app, "updaterMode")).toBe("installer");
    // downloading (the banner), then ready
    await page.locator("#update-banner").waitFor({ state: "visible", timeout: 60000 });
    await page.waitForFunction((v) => document.querySelector("#update-text").innerText.includes(`v${v}`), newVersion, { timeout: 60000 });
    await page.waitForFunction(() => document.querySelector("#update-text").innerText.includes("ติดตั้งเมื่อปิดโปรแกรม"), null, { timeout: 240000 });
    expect(await page.locator("#update-action").innerText()).toBe("รีสตาร์ทเพื่ออัปเดต");
    // nothing was closed or installed by itself
    expect(await hook(app, "quitting")).toBe(false);
    expect(titleVersion(await mainTitle(app))).toBe(oldVersion);
    const asked = feed.requests.map((r) => r.name);
    expect(asked).toContain("checker.yml");
    expect(asked.some((n) => n.endsWith(".exe"))).toBe(true);
    // the player clicks: the program closes, the installer runs, the new version starts
    const gone = new Promise((r) => app.process().once("exit", r));
    await page.locator("#update-action").click();
    await Promise.race([gone, wait(60000).then(() => { throw new Error("the program did not close after the click"); })]);
    opened.length = 0;
    let t = "";
    for (let i = 0; i < 240 && !t.includes(`v${newVersion}`); i++) { await wait(1000); t = runningTitle(); }
    expect(t).toContain(`v${newVersion}`);
    killAll();
    await wait(1500);
    // every setting is still there
    const after = JSON.parse(fs.readFileSync(path.join(sbx.checkerDir, "config.json"), "utf-8"));
    expect(after).toMatchObject(settings);
    expect(after.filter_gen).toMatchObject(settings.filter_gen);
  }, 900000);

  it("a feed that is down: the program goes on, the log says why, no banner", async () => {
    const feed = await serveFolder(DIST);
    const url = feed.url;
    await feed.close(); // (nothing listens there now)
    const sbx = sandbox();
    killAll();
    await wait(1000);
    const { app, page } = await launch(sbx, { exe, extraEnv: { POE_UPDATE_FEED: url, POE_UPDATE_FIRST_MS: "1000" } });
    opened.push(app);
    await page.waitForSelector("#league");
    await wait(8000);
    expect(await page.locator("#update-banner").isHidden()).toBe(true);
    expect(await hook(app, "updaterState")).toMatchObject({ kind: "error" });
    expect(await hook(app, "mainVisible")).toBe(true);
    expect(fs.readFileSync(path.join(sbx.checkerDir, "log.txt"), "utf-8")).toMatch(/updater: .*(ECONNREFUSED|ERR_CONNECTION|net::)/i);
    expect(await hook(app, "quitting")).toBe(false);
  }, 180000);

  it("a feed whose checksum does not match the file: refused, nothing is installed, the version stays", async () => {
    const feed = await serveFolder(DIST, { yml: { "checker.yml": (t) => t.replace(/sha512: .+/g, "sha512: " + "A".repeat(86) + "==") } });
    extra.push(() => feed.close());
    const sbx = sandbox();
    killAll();
    await wait(1000);
    const { app, page } = await launch(sbx, { exe, extraEnv: { POE_UPDATE_FEED: feed.url, POE_UPDATE_FIRST_MS: "1000" } });
    opened.push(app);
    await page.waitForSelector("#league");
    const v0 = titleVersion(await mainTitle(app));
    await page.waitForFunction(() => true);
    for (let i = 0; i < 240 && (await hook(app, "updaterState")).kind !== "error"; i++) await wait(1000);
    const st = await hook(app, "updaterState");
    expect(st.kind).toBe("error");
    expect(st.message).toMatch(/sha512|checksum/i);
    expect(await page.locator("#update-banner").isHidden()).toBe(true);
    expect(titleVersion(await mainTitle(app))).toBe(v0);
    expect(await hook(app, "quitting")).toBe(false);
  }, 600000);
});
