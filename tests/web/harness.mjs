// Shared by the browser tests: a static server for the built site (apps/web/dist, or WEB_ROOT), the browser launcher, and
// routes that answer the page's network calls from local fixtures (NeverSink / hub from tests/parity/fixtures), so the
// tests are fast and offline. live.mjs is the one that talks to the real servers.
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO = path.resolve(HERE, "..", "..");
export const FIXTURES = path.join(REPO, "tests", "parity", "fixtures");
export const DIST = path.join(REPO, "apps", "web", "dist");
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".mjs": "text/javascript",
  ".png": "image/png", ".svg": "image/svg+xml", ".map": "application/json", ".py": "text/plain; charset=utf-8", ".wasm": "application/wasm" };

/** Serve `root` (default: the built site) under `prefix` (like GitHub Pages sub-paths: "/ts"). */
export function startServer({ root = process.env.WEB_ROOT ? path.resolve(process.env.WEB_ROOT) : DIST, prefix = (process.env.WEB_PREFIX || ""), port = 0 } = {}) {
  const PREFIX = prefix.replace(/\/+$/, "");
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
      if (PREFIX) {
        if (p !== PREFIX && !p.startsWith(PREFIX + "/")) { res.writeHead(404); res.end("not found"); return; }
        p = p.slice(PREFIX.length) || "/";
      }
      if (p.endsWith("/")) p += "index.html";
      const file = path.join(root, p);
      if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end("not found"); return; }
      res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-store" });
      fs.createReadStream(file).pipe(res);
    });
    srv.listen(port, "127.0.0.1", () => resolve({ srv, url: `http://127.0.0.1:${srv.address().port}${PREFIX}`, port: srv.address().port }));
  });
}

/** the Chrome the test runs in: PW_CHROME (a path) wins, then the Chrome installed on the machine, then Playwright's own Chromium */
export function launchOptions() {
  if (process.env.PW_CHROME) return { executablePath: process.env.PW_CHROME, headless: true };
  return { channel: "chrome", headless: true };
}
export async function launchBrowser() {
  try { return await chromium.launch(launchOptions()); } catch (e) { return chromium.launch({ headless: true }); }
}

const gz = (f) => zlib.gunzipSync(fs.readFileSync(path.join(FIXTURES, f))).toString("utf-8");
const CORS = { "Access-Control-Allow-Origin": "*" };

/** Answer every call to another site from local fixtures. `calls` collects what the page asked for. */
export async function routeNetwork(context, calls = []) {
  await context.route(/^https:\/\/api\.github\.com\//, (route) => {
    calls.push("ns-api");
    route.fulfill({ status: 200, contentType: "application/json", headers: CORS, body: JSON.stringify({ tag_name: "v-test" }) });
  });
  await context.route(/^https:\/\/raw\.githubusercontent\.com\//, (route) => {
    const url = route.request().url();
    const g = /PoE2/i.test(url) ? "poe2" : "poe1";
    calls.push("ns-file:" + g);
    route.fulfill({ status: 200, contentType: "text/plain; charset=utf-8", headers: CORS,
      body: fs.readFileSync(path.join(FIXTURES, `neversink_${g}_s2.filter`), "utf-8") });
  });
  await context.route(/^https:\/\/storage\.googleapis\.com\/poe-data-hub\//, (route) => {
    const url = route.request().url();
    const m = url.match(/poe-data-hub\/(poe[12])\/(.*)$/);
    calls.push("hub:" + (m ? m[1] + "/" + m[2] : url));
    if (m && m[2] === "prices/latest.json") {
      return route.fulfill({ status: 200, contentType: "application/json", headers: CORS, body: gz(`hub_${m[1]}.json.gz`) });
    }
    route.fulfill({ status: 404, contentType: "text/plain", headers: CORS, body: "not found" });
  });
}

/** stand-ins for the folder / file pickers of Chrome: real handles of the origin private file system (see ui.mjs) */
export const PICKER_STUBS = () => {
  window.__dirPicks = [];
  window.__dirName = null;
  window.__dirAbort = false;
  window.showDirectoryPicker = async (o) => {
    window.__dirPicks.push({ startIn: typeof o.startIn === "string" ? o.startIn : (o.startIn && o.startIn.name), id: o.id });
    if (window.__dirAbort) throw new DOMException("closed", "AbortError");
    const name = window.__dirName || (String(o.id).endsWith("poe1") ? "Path of Exile" : "Path of Exile 2");
    return (await navigator.storage.getDirectory()).getDirectoryHandle(name, { create: true });
  };
  window.__picks = [];
  window.__pickName = "wl-made.filter";
  window.showOpenFilePicker = window.__stubPick = async (o) => {
    window.__picks.push({ startIn: typeof o.startIn === "string" ? o.startIn : (o.startIn && o.startIn.name), id: o.id, multiple: o.multiple });
    const d = await (await navigator.storage.getDirectory()).getDirectoryHandle("Path of Exile 2", { create: true });
    return [await d.getFileHandle(window.__pickName, { create: true })];
  };
};

export const wait = (ms) => new Promise((r) => setTimeout(r, ms));
export const tmpdir = (prefix) => fs.mkdtempSync(path.join(os.tmpdir(), prefix));
