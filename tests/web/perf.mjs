// Speed of the new page against the Pyodide page of the original (v0.13.5, served from its folder, read only):
//   node tests/web/perf.mjs [runs]
// Both pages get the same stubbed network (fixtures), so the numbers are the page's own: time until the app is usable,
// until the item lists are loaded, to generate a NeverSink / a whitelist file, and the smoothness of scrolling a long list.
import fs from "node:fs";
import path from "node:path";
import { launchBrowser, routeNetwork, startServer, DIST, wait } from "./harness.mjs";

const OLD_WEB = process.env.OLD_WEB || "D:/Projects/PoE_Price-Trade_Checker/web";
const OLD_PYODIDE = process.env.OLD_PYODIDE || "D:/Projects/PoE_Price-Trade_Checker/tests/web_ui/node_modules/pyodide";
const RUNS = parseInt(process.argv[2] || "3", 10);
const MIME = { ".js": "text/javascript", ".json": "application/json", ".wasm": "application/wasm", ".zip": "application/zip", ".mjs": "text/javascript" };

async function routeOldPyodide(context) {
  await context.route(/^https:\/\/cdn\.jsdelivr\.net\/pyodide\//, (route) => {
    const name = new URL(route.request().url()).pathname.split("/").pop();
    const f = path.join(OLD_PYODIDE, name);
    if (!fs.existsSync(f)) return route.fulfill({ status: 404, body: "no" });
    route.fulfill({ status: 200, body: fs.readFileSync(f), contentType: MIME[path.extname(f)] || "application/octet-stream", headers: { "Access-Control-Allow-Origin": "*" } });
  });
}

const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];

async function measure(browser, url, old) {
  const ctx = await browser.newContext({ viewport: { width: 900, height: 1100 }, acceptDownloads: true });
  await routeNetwork(ctx, []);
  if (old) await routeOldPyodide(ctx);
  const page = await ctx.newPage();
  const logText = () => page.locator("#log").innerText();
  const out = {};
  const t0 = Date.now();
  await page.goto(url + "/");
  await page.waitForSelector("#app:not([hidden])", { timeout: 120000 });
  out.appMs = Date.now() - t0;
  await page.waitForFunction(() => /โหลดรายการ whitelist แล้ว/.test(document.querySelector("#log").innerText), null, { timeout: 120000 });
  out.listsMs = Date.now() - t0;
  let t = Date.now();
  await page.click("#btn-generate-tier");
  await page.waitForSelector("#result:not([hidden])", { timeout: 120000 });
  out.tierGenMs = Date.now() - t;
  await page.click("#tab-wl");
  await page.click(".tier-btns button[data-t=B]");
  await page.selectOption("#pane-whitelist select[aria-label=หมวด]", { label: "Currency" });
  await page.evaluate(() => { document.querySelector("#result").hidden = true; });
  t = Date.now();
  await page.click("#btn-generate-wl");
  await page.waitForFunction(() => !document.querySelector("#result").hidden, null, { timeout: 120000 });
  out.wlGenMs = Date.now() - t;
  // the long list: Unique of PoE1 (thousands of rows). Time to draw it, then scroll it for 2 s counting frames.
  await page.click("#game-poe1");
  await page.waitForFunction(() => /โหลดรายการ whitelist แล้ว/.test(document.querySelector("#log").innerText.split("⟳ โหลดรายการ whitelist").pop()), null, { timeout: 120000 });
  await page.click(".tier-btns button[data-t=B]");
  t = Date.now();
  await page.selectOption("#pane-whitelist select[aria-label=หมวด]", { label: "Unique" });
  await page.waitForFunction(() => document.querySelectorAll("table.items tbody tr").length > 1000);
  out.uniqueDrawMs = Date.now() - t;
  out.uniqueRows = await page.locator("table.items tbody tr").count();
  const scroll = await page.evaluate(() => new Promise((resolve) => {
    const el = document.querySelector("#item-list");
    const frames = [];
    let last = performance.now(), n = 0;
    const t0 = last;
    const step = (now) => {
      frames.push(now - last);
      last = now;
      el.scrollTop += 120;
      if (el.scrollTop + el.clientHeight >= el.scrollHeight - 2) el.scrollTop = 0;
      if (++n < 120) requestAnimationFrame(step);
      else resolve({ ms: Math.round(now - t0), frames: frames.length, maxFrame: Math.round(Math.max(...frames)), over34: frames.filter((f) => f > 34).length });
    };
    requestAnimationFrame(step);
  }));
  out.scroll = scroll;
  // ticking one row of that long list (a redraw of the whole list)
  t = Date.now();
  await page.locator("table.items tbody tr input[type=checkbox]").first().click();
  out.tickMs = Date.now() - t;
  void logText;
  await ctx.close();
  return out;
}

const browser = await launchBrowser();
const { srv, url } = await startServer({ root: DIST });
const { srv: oldSrv, url: oldUrl } = await startServer({ root: path.resolve(OLD_WEB) });
const res = { new: [], old: [] };
for (let i = 0; i < RUNS; i++) {
  res.new.push(await measure(browser, url, false));
  res.old.push(await measure(browser, oldUrl, true));
  await wait(200);
}
const summary = {};
for (const k of ["new", "old"]) {
  summary[k] = {};
  for (const m of ["appMs", "listsMs", "tierGenMs", "wlGenMs", "uniqueDrawMs", "tickMs"]) summary[k][m] = median(res[k].map((r) => r[m]));
  summary[k].scroll = res[k][Math.floor(res[k].length / 2)].scroll;
  summary[k].uniqueRows = res[k][0].uniqueRows;
}
console.log(JSON.stringify({ runs: RUNS, summary, raw: res }, null, 1));
await browser.close();
srv.close();
oldSrv.close();
