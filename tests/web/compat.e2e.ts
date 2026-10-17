// @ts-nocheck
/**
 * Compatibility with the page of the original (Pyodide, v0.13.5): the OLD page is driven in a real browser profile and leaves its
 * localStorage + IndexedDB (sound files, folder handles) behind; the NEW page is then opened on the same origin and the same
 * profile and must show the same settings, find the sound files and the remembered folder, open the files the old page wrote,
 * and write the same filters from those settings (only the recorded app name differs).
 * The old page is served from its folder (read only); Pyodide comes from the old repo's node_modules.
 * Run: npm run test:e2e   (needs apps/web/dist and the original repo at OLD_REPO)
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { chromium } from "playwright";
import { wlEmbed } from "../../packages/core/src/index.ts";
import { PICKER_STUBS, launchOptions, routeNetwork, startServer, DIST } from "./harness.mjs";

const OLD_REPO = process.env.OLD_REPO || "D:/Projects/PoE_Price-Trade_Checker";
const OLD_WEB = path.join(OLD_REPO, "web");
const OLD_PYODIDE = path.join(OLD_REPO, "tests", "web_ui", "node_modules", "pyodide");
const MARK = wlEmbed.MARK;
const lf = (t) => t.replace(/\r\n/g, "\n");
const stripBlob = (t) => lf(t).split("\n").filter((l) => !l.startsWith(MARK)).join("\n");
const appOf = (t) => wlEmbed.extract(lf(t)).app;
const settingsOf = (t) => { const e = wlEmbed.extract(lf(t)); return e.cfg; };

const profile = fs.mkdtempSync(path.join(os.tmpdir(), "compat-profile-"));
const PORT = 47311;
let ctx;
afterAll(async () => { await ctx?.close(); });

async function routeOldPyodide(context) {
  await context.route(/^https:\/\/cdn\.jsdelivr\.net\/pyodide\//, (route) => {
    const name = new URL(route.request().url()).pathname.split("/").pop();
    const f = path.join(OLD_PYODIDE, name);
    if (!fs.existsSync(f)) return route.fulfill({ status: 404, body: "no" });
    const mime = f.endsWith(".wasm") ? "application/wasm" : f.endsWith(".json") ? "application/json" : f.endsWith(".js") ? "text/javascript" : "application/octet-stream";
    route.fulfill({ status: 200, body: fs.readFileSync(f), contentType: mime, headers: { "Access-Control-Allow-Origin": "*" } });
  });
}

const state = {}; // what the old page leaves behind, read back after the new page is up

describe("settings made in the Pyodide page are there in the new page", () => {
  it("old page: set many things, generate both files, remember a folder", async () => {
    const { srv } = await startServer({ root: path.resolve(OLD_WEB), port: PORT });
    ctx = await chromium.launchPersistentContext(profile, { ...launchOptions(), acceptDownloads: true, viewport: { width: 900, height: 1100 } });
    await routeNetwork(ctx, []);
    await routeOldPyodide(ctx);
    await ctx.addInitScript(PICKER_STUBS);
    const page = await ctx.newPage();
    page.on("dialog", (d) => d.accept());
    await page.goto(`http://127.0.0.1:${PORT}/`);
    await page.waitForSelector("#app:not([hidden])", { timeout: 120000 });
    await page.waitForFunction(() => /โหลดรายการ whitelist แล้ว/.test(document.querySelector("#log").innerText));
    // NeverSink tab: name, strictness, a sound file, the quest style
    await page.fill('#pane-tier input[aria-label="ชื่อ filter"]', "old-ns");
    await page.selectOption('#pane-tier select[aria-label="NeverSink Strictness"]', "3");
    await page.locator("#pane-tier input[type=file]").first().setInputFiles({ name: "snd#1.mp3", mimeType: "audio/mpeg", buffer: Buffer.from("ID3-old-page-sound") });
    await page.waitForTimeout(300);
    // Whitelist tab
    await page.click("#tab-wl");
    await page.fill('#pane-whitelist input[aria-label="ชื่อ filter"]', "old-wl");
    await page.click(".tier-btns button[data-t=B]");
    await page.selectOption("#pane-whitelist select[aria-label=หมวด]", { label: "Currency" });
    const chaos = page.locator('table.items tr[data-key="Chaos Orb"]');
    await chaos.waitFor();
    await chaos.locator("input[type=checkbox]").click(); // hide
    await page.click(".tier-btns button[data-t=A]");
    await page.locator('table.items tr[data-key="Divine Orb"] td.name .txt').click();
    await page.click("#btn-move");
    await page.click(".tier-btns button[data-t=S]"); // a sound file for tier S
    await page.locator('#tier-style-editor select[aria-label="ชนิดเสียง"]').selectOption("file");
    await page.locator('#tier-style-editor input[type=file]').setInputFiles({ name: "tier-s.mp3", mimeType: "audio/mpeg", buffer: Buffer.from("ID3-tier-s") });
    await page.click(".tier-btns button[data-t=B]");
    await page.locator('#tier-style-editor input[aria-label="ความทึบ พื้นหลัง"]').fill("120");
    await page.locator('#tier-style-editor input[aria-label="ความทึบ พื้นหลัง"]').dispatchEvent("input");
    await page.fill('#pane-whitelist input[aria-label="โชว์เมื่อจำนวน ≥ (tier)"]', "5");
    await page.locator('#pane-whitelist input[aria-label="โชว์เมื่อจำนวน ≥ (tier)"]').dispatchEvent("input");
    await page.selectOption("#pane-whitelist select[aria-label=หมวด]", { label: "Flask / Charm" });
    await page.locator('input[aria-label="Flask ตั้งค่าเอง"]').check();
    await page.selectOption('select[aria-label="Flask rarity Magic"]', "D");
    await page.selectOption("#pane-whitelist select[aria-label=หมวด]", { label: "อุปกรณ์ตาม class" });
    await page.click("#equip-tab-armour");
    await page.locator('input[aria-label="Boots ตั้งค่าเอง"]').check();
    await page.selectOption('select[aria-label="Boots rarity Rare"]', "D");
    await page.click("#subtab-gold");
    await page.check("#chk-gold");
    await page.locator('input[aria-label="จำนวนขั้นต่ำของ Gold"]').fill("25");
    await page.locator('input[aria-label="จำนวนขั้นต่ำของ Gold"]').dispatchEvent("input");
    await page.click("#subtab-custom");
    await page.fill("#custom-input", "heavy belt");
    await page.click("#custom-add");
    await page.click("#subtab-gem");
    await page.locator('#pane-sub-gem input[type=number]').first().fill("17");
    await page.locator('#pane-sub-gem input[type=number]').first().dispatchEvent("input");
    await page.locator('#pane-sub-gem input[type=checkbox]').first().check();
    await page.waitForTimeout(500);
    // a folder for PoE2 (the stub hands out a real OPFS directory) and a PoE1 visit
    await page.click("#btn-folder");
    await page.waitForFunction(() => document.querySelector("#folder-name").textContent.includes("Path of Exile 2"));
    // files made by the old page: the whitelist into the folder, the NeverSink one (with the sound) as a zip? -> the folder as well
    await page.click("#btn-generate-wl");
    await page.waitForFunction(() => document.querySelector("#result-info").textContent.includes("old-wl.filter"));
    await page.click("#tab-ns");
    await page.click("#btn-generate-tier");
    await page.waitForFunction(() => document.querySelector("#result-info").textContent.includes("old-ns.filter"));
    state.oldFolder = await page.evaluate(async () => {
      const d = await (await navigator.storage.getDirectory()).getDirectoryHandle("Path of Exile 2");
      const out = {};
      for await (const [n, h] of d.entries()) out[n] = await (await h.getFile()).text();
      return out;
    });
    state.oldSoundsInFolder = Object.keys(state.oldFolder).filter((n) => n.endsWith(".mp3"));
    // what the old page itself says about its model, to compare with the new page afterwards
    state.oldCfg = await page.evaluate(() => JSON.parse(localStorage.getItem("poeFilterGen.cfg")));
    state.oldConfig = await page.evaluate(() => JSON.parse(window.PFG.glue.wl_config()));
    state.oldParts = await page.evaluate(() => JSON.parse(window.PFG.glue.wl_parts()));
    state.oldRows = await page.evaluate(() => JSON.parse(window.PFG.glue.wl_rows("Currency", "")).rows.map((r) => [r.key, r.tier, r.user_set, r.stack]));
    // the NeverSink text the old page cached
    state.nsKeys = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("poeFilterGen.ns.")));
    await page.close();
    srv.close();
    expect(state.oldFolder["old-wl.filter"].length).toBeGreaterThan(1000);
    expect(state.oldSoundsInFolder.length).toBeGreaterThan(0);
  }, 240000);

  it("new page on the same profile: same settings, sounds, folder, cache", async () => {
    const { srv } = await startServer({ root: DIST, port: PORT });
    await routeNetwork(ctx, []);
    const page = await ctx.newPage();
    page.on("dialog", (d) => d.accept());
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.goto(`http://127.0.0.1:${PORT}/`);
    await page.waitForSelector("#app:not([hidden])", { timeout: 60000 });
    await page.waitForFunction(() => /โหลดรายการ whitelist แล้ว/.test(document.querySelector("#log").innerText));
    // the model: exactly the old page's
    const config = await page.evaluate(() => JSON.parse(JSON.stringify(window.PFG.api.wlConfig())));
    expect(config).toEqual(state.oldConfig);
    const parts = await page.evaluate(() => JSON.parse(JSON.stringify(window.PFG.api.wlParts())));
    expect(parts).toEqual(state.oldParts);
    const rows = await page.evaluate(() => window.PFG.api.wlRows("Currency", "").rows.map((r) => [r.key, r.tier, r.user_set, r.stack]));
    expect(rows).toEqual(state.oldRows);
    // the NeverSink tab
    expect(await page.inputValue('#pane-tier input[aria-label="ชื่อ filter"]')).toBe("old-ns");
    expect(await page.inputValue('#pane-tier select[aria-label="NeverSink Strictness"]')).toBe("3");
    expect(await page.locator("#pane-tier").innerText()).toContain("snd#1.mp3");
    // the sound files the old page kept in IndexedDB
    const snd = await page.evaluate(() => { const s = window.PFG.sounds.mem; return { one: s["1"] && [s["1"].name, [...s["1"].bytes].length], tierS: s["S"] && s["S"].name }; });
    expect(snd.one).toEqual(["snd#1.mp3", "ID3-old-page-sound".length]);
    expect(snd.tierS).toBe("tier-s.mp3");
    // the folder handle: remembered, permission already granted in this profile
    await page.waitForFunction(() => document.querySelector("#folder-name").textContent.includes("Path of Exile 2"));
    // the NeverSink text cached by the old page is reused (no download of the file)
    const keys = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("poeFilterGen.ns.")));
    for (const k of state.nsKeys) expect(keys).toContain(k);
    // the file the old page wrote opens in the new page
    await page.click("#tab-wl");
    await page.click("#btn-open");
    await page.waitForSelector("#open-list");
    const listed = await page.locator("#open-list li").evaluateAll((li) => li.map((x) => [x.dataset.file, x.dataset.kind]));
    expect(listed).toContainEqual(["old-wl.filter", "whitelist"]);
    expect(listed).toContainEqual(["old-ns.filter", "tier"]);
    await page.locator('#open-list li[data-file="old-wl.filter"] button').click();
    await page.waitForFunction(() => /เปิด old-wl.filter แล้ว/.test(document.querySelector("#log").innerText));
    expect(await page.evaluate(() => JSON.parse(JSON.stringify(window.PFG.api.wlConfig())))).toEqual(state.oldConfig);
    expect(errors).toEqual([]);
    state.page = page;
    state.srv = srv;
  }, 120000);

  it("the new page writes the same filters from those settings (only the app name differs)", async () => {
    const page = state.page;
    // the whitelist into the folder (the file exists: the confirm is accepted)
    await page.click("#btn-generate-wl");
    await page.waitForFunction(() => document.querySelector("#result-info").textContent.includes("old-wl.filter"));
    await page.click("#tab-ns");
    await page.click("#btn-generate-tier");
    await page.waitForFunction(() => document.querySelector("#result-info").textContent.includes("old-ns.filter"));
    const now = await page.evaluate(async () => {
      const d = await (await navigator.storage.getDirectory()).getDirectoryHandle("Path of Exile 2");
      const out = {};
      for await (const [n, h] of d.entries()) out[n] = await (await h.getFile()).text();
      return out;
    });
    expect(now["old-ns.filter"]).toBe(state.oldFolder["old-ns.filter"]); // the NeverSink file: every byte
    expect(stripBlob(now["old-wl.filter"])).toBe(stripBlob(state.oldFolder["old-wl.filter"]));
    expect(settingsOf(now["old-wl.filter"])).toEqual(settingsOf(state.oldFolder["old-wl.filter"]));
    expect(appOf(state.oldFolder["old-wl.filter"])).toMatch(/^web-0\./);
    expect(appOf(now["old-wl.filter"])).toMatch(/^web-1\./);
    expect(now["old-wl.filter"].includes("\r\r\n")).toBe(false);
    expect(Object.keys(now).filter((n) => n.endsWith(".mp3")).sort()).toEqual(state.oldSoundsInFolder.sort()); // no sound written twice (no -2)
    await page.close();
    state.srv.close();
  }, 120000);
});
