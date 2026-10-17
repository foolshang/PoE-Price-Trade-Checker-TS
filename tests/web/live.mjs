// The built page against the REAL servers (hub, GitHub API + raw NeverSink files), no stubs.
//   node tests/web/live.mjs pages    the production build, answered under https://foolshang.github.io/PoE-Filter-Generator/ts/ (the
//                                    origin the hub's CORS header allows) while every other request goes to the real network
//   node tests/web/live.mjs local    `npm run web:local` style: the localhost build, the hub reached through the preview server's proxy
//   node tests/web/live.mjs <url>    any running page
// It checks that the browser may call every server, that the lists load, that a NeverSink filter and a whitelist can be
// generated and downloaded, and prints the timings.
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { DIST, REPO, launchBrowser, startServer, wait } from "./harness.mjs";

const mode = process.argv[2] || "pages";
const PAGES = "https://foolshang.github.io/PoE-Filter-Generator/ts/";
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json" };

const browser = await launchBrowser();
const ctx = await browser.newContext({ acceptDownloads: true });
let url = mode, preview = null;
if (mode === "pages") {
  url = PAGES;
  await ctx.route(new RegExp("^" + PAGES.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")), (route) => {
    const p = decodeURIComponent(new URL(route.request().url()).pathname.slice("/PoE-Filter-Generator/ts/".length)) || "index.html";
    const f = path.join(DIST, p);
    if (!f.startsWith(DIST) || !fs.existsSync(f)) return route.fulfill({ status: 404, body: "not found" });
    route.fulfill({ status: 200, contentType: MIME[path.extname(f)] || "application/octet-stream", body: fs.readFileSync(f) });
  });
} else if (mode === "local") {
  const dir = path.join(REPO, "apps", "web");
  await new Promise((resolve, reject) => {
    const b = spawn("npx", ["vite", "build", "--mode", "localhost", "--outDir", "dist-local"], { cwd: dir, shell: true, stdio: "ignore" });
    b.on("exit", (c) => (c === 0 ? resolve() : reject(new Error("build failed"))));
  });
  preview = spawn("npx", ["vite", "preview", "--outDir", "dist-local", "--host", "127.0.0.1", "--port", "4399", "--strictPort"], { cwd: dir, shell: true, stdio: "ignore" });
  url = "http://127.0.0.1:4399/";
  await wait(2500);
}
const page = await ctx.newPage();
const errors = [], failed = [], bad = [], seen = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
page.on("pageerror", (e) => errors.push(String(e)));
page.on("requestfailed", (r) => failed.push(r.url() + " " + (r.failure() || {}).errorText));
page.on("response", (r) => { seen.push(r.status() + " " + r.url().replace(/\?.*/, "")); if (r.status() >= 400) bad.push(r.status() + " " + r.url()); });
const out = { mode, url };
const t0 = Date.now();
await page.goto(url, { waitUntil: "load" });
await page.waitForSelector("#app:not([hidden])", { timeout: 60000 });
out.bootMs = Date.now() - t0;
out.ver = await page.locator("#ver").innerText();
const t1 = Date.now();
await page.waitForFunction(() => /โหลดรายการ whitelist แล้ว/.test(document.querySelector("#log").innerText), null, { timeout: 120000 });
out.listsMs = Date.now() - t1;
const log0 = await page.locator("#log").innerText();
out.hubReached = !log0.includes("ดึง hub ไม่ได้");

// NeverSink tab
const tg = Date.now();
await page.click("#btn-generate-tier");
await page.waitForSelector("#btn-download:not([hidden])", { timeout: 120000 });
out.tierGenerateMs = Date.now() - tg;
let [dl] = await Promise.all([page.waitForEvent("download", { timeout: 60000 }), page.click("#btn-download")]);
let text = fs.readFileSync(await dl.path(), "utf-8");
out.tier = { name: dl.suggestedFilename(), bytes: text.length, shows: (text.match(/^Show/gm) || []).length, crlf: text.includes("\r\n"), doubleCr: text.includes("\r\r\n") };

// Whitelist tab, PoE2 then PoE1
for (const game of ["poe2", "poe1"]) {
  if (game !== "poe2") await page.click(`#game-${game}`);
  await page.waitForFunction(() => /โหลดรายการ whitelist แล้ว/.test(document.querySelector("#log").innerText.split("⟳ โหลดรายการ whitelist").pop()), null, { timeout: 120000 });
  await page.click("#tab-wl");
  await page.click(".tier-btns button[data-t=B]");
  await page.selectOption("#pane-whitelist select[aria-label=หมวด]", { label: "Currency" });
  const rows = await page.locator("table.items tbody tr").count();
  const t2 = Date.now();
  await page.click("#btn-generate-wl");
  await page.waitForSelector("#btn-download:not([hidden])", { timeout: 120000 });
  const ms = Date.now() - t2;
  [dl] = await Promise.all([page.waitForEvent("download", { timeout: 60000 }), page.click("#btn-download")]);
  text = fs.readFileSync(await dl.path(), "utf-8");
  const uniq = await page.locator("#pane-whitelist select[aria-label=หมวด] option").allInnerTexts();
  out[game] = { rows, generateMs: ms, name: dl.suggestedFilename(), bytes: text.length, embedded: text.includes("# poe-checker-config:"), shows: (text.match(/^Show/gm) || []).length,
    categories: uniq.length };
}
out.errors = errors;
out.failed = failed;
out.bad = bad;
out.servers = [...new Set(seen.filter((s) => !/127\.0\.0\.1|foolshang\.github\.io\/PoE-Filter-Generator\/ts\//.test(s)).map((s) => s.replace(/^(\d+) https?:\/\/([^/]+)\/(.{0,70}).*/, "$1 $2/$3")))].slice(0, 14);
console.log(JSON.stringify(out, null, 1));
await browser.close();
if (preview) preview.kill();
if (preview && process.platform === "win32") spawn("taskkill", ["/F", "/T", "/PID", String(preview.pid)], { stdio: "ignore" });
const ok = !errors.length && !failed.length && !bad.length && out.hubReached && out.tier.shows > 100 && out.poe2.embedded && out.poe1.embedded && !out.tier.doubleCr;
process.exit(ok ? 0 : 1);
void startServer;
