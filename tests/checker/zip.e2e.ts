// @ts-nocheck
/**
 * The zip copy ("Portable"): unpacked into a temp folder it runs from there, keeps its settings in the user's folder
 * (%LOCALAPPDATA% - here a throw-away one), writes NOTHING into the folder it was unpacked to, and - not being installed - does not
 * update itself: it only says that a newer release exists, with the link.
 * Needs the zip of the current version in dist-checker (npm run checker:pack).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { launch, sandbox, wait, ROOT } from "../desktop/harness.mjs";
import { serveFolder } from "./feed.mjs";

const ver = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf-8")).version;
const ZIP = path.join(ROOT, "dist-checker", `PoE-Price-Trade-Checker-TS-Portable-${ver}.zip`);
const opened = [];
const extra = [];
afterEach(async () => {
  for (const a of opened.splice(0)) { try { await a.close(); } catch { /* gone */ } }
  for (const f of extra.splice(0)) { try { await f(); } catch { /* gone */ } }
});

/** every file under dir -> "relative path:size:mtime" */
function snapshot(dir) {
  const out = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else { const st = fs.statSync(p); out.push(`${path.relative(dir, p)}:${st.size}:${st.mtimeMs}`); }
    }
  };
  walk(dir);
  return out.sort();
}

describe.skipIf(!fs.existsSync(ZIP))("the zip copy", () => {
  it("unpacks anywhere, runs, writes nothing next to itself, says (does not install) a newer release", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pfg-zip-"));
    extra.push(() => fs.rmSync(dir, { recursive: true, force: true }));
    execFileSync("powershell", ["-NoProfile", "-Command", `Expand-Archive -LiteralPath "${ZIP}" -DestinationPath "${dir}" -Force`], { windowsHide: true });
    const exe = path.join(dir, "PoE-Price-Trade-Checker-TS.exe");
    expect(fs.existsSync(exe)).toBe(true);
    expect(fs.readdirSync(dir).some((f) => /^Uninstall .*\.exe$/i.test(f))).toBe(false); // (it is not an installed copy)
    const before = snapshot(dir);

    // a feed that offers a newer version: the zip copy tells, it does not download
    const feedDir = fs.mkdtempSync(path.join(os.tmpdir(), "pfg-feed-"));
    extra.push(() => fs.rmSync(feedDir, { recursive: true, force: true }));
    fs.writeFileSync(path.join(feedDir, "latest.yml"), "version: 9.9.9\nfiles:\n  - url: x.exe\n    sha512: AAAA\n    size: 1\npath: x.exe\nsha512: AAAA\nreleaseDate: '2026-01-01T00:00:00.000Z'\n");
    const feed = await serveFolder(feedDir);
    extra.push(() => feed.close());

    const sbx = sandbox();
    fs.mkdirSync(sbx.checkerDir, { recursive: true });
    fs.writeFileSync(path.join(sbx.checkerDir, "config.json"), JSON.stringify({ game_version: "poe2" }));
    const { app, page } = await launch(sbx, { exe, extraEnv: { POE_UPDATE_FEED: feed.url, POE_UPDATE_FIRST_MS: "1000" } });
    opened.push(app);
    await page.waitForSelector("#league");
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getTitle())).toBe(`PoE Price & Trade Checker (TypeScript) v${ver}`);
    expect(await app.evaluate(() => globalThis.__poeChecker.updaterMode())).toBe("manual");
    // the banner: a newer release exists, here is where to get it; no "restart" button
    await page.locator("#update-bar").waitFor({ state: "visible", timeout: 60000 });
    expect(await page.locator("#update-bar .update-text").innerText()).toContain("มีรุ่นใหม่ v9.9.9");
    expect(await page.locator("#update-bar .update-text").innerText()).toContain("zip");
    expect(await page.locator("#update-bar button").allInnerTexts()).toEqual(["อัปเดต (เปิดหน้าดาวน์โหลด)"]); // (the button opens the download page: this copy cannot install)
    expect(feed.requests.map((r) => r.name)).toEqual(["latest.yml"]); // nothing was downloaded
    // the settings are in the user's folder, not next to the exe
    expect(fs.existsSync(path.join(sbx.checkerDir, "log.txt"))).toBe(true);
    await wait(800);
    await app.close();
    opened.length = 0;
    await wait(1500);
    expect(snapshot(dir)).toEqual(before);
  }, 300000);

  it("a stray POE_UPDATE_FEED (without POE_CHECKER_TEST=1, as on a player's machine) does nothing: the feed is never asked", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pfg-zip-"));
    extra.push(() => fs.rmSync(dir, { recursive: true, force: true }));
    execFileSync("powershell", ["-NoProfile", "-Command", `Expand-Archive -LiteralPath "${ZIP}" -DestinationPath "${dir}" -Force`], { windowsHide: true });
    const feedDir = fs.mkdtempSync(path.join(os.tmpdir(), "pfg-feed-"));
    extra.push(() => fs.rmSync(feedDir, { recursive: true, force: true }));
    fs.writeFileSync(path.join(feedDir, "latest.yml"), "version: 9.9.9\nfiles:\n  - url: x.exe\n    sha512: AAAA\n    size: 1\npath: x.exe\nsha512: AAAA\nreleaseDate: '2026-01-01T00:00:00.000Z'\n");
    const feed = await serveFolder(feedDir);
    extra.push(() => feed.close());
    const sbx = sandbox();
    fs.mkdirSync(sbx.checkerDir, { recursive: true });
    fs.writeFileSync(path.join(sbx.checkerDir, "config.json"), JSON.stringify({ game_version: "poe2" }));
    // (the test variable is blanked: with it, the 1 s first check would have asked this feed long before the wait below ends)
    const { app, page } = await launch(sbx, { exe: path.join(dir, "PoE-Price-Trade-Checker-TS.exe"), extraEnv: { POE_CHECKER_TEST: "", POE_UPDATE_FEED: feed.url, POE_UPDATE_FIRST_MS: "1000" } });
    opened.push(app);
    await page.waitForSelector("#league");
    await wait(8000);
    expect(feed.requests).toEqual([]);
    expect(await page.locator("#update-bar").isHidden()).toBe(true);
    expect(fs.readFileSync(path.join(sbx.checkerDir, "log.txt"), "utf-8")).not.toContain(feed.url);
  }, 120000);
});
