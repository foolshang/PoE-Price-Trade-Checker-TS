// Probe: what every window of the Checker does while F5 runs (show / hide / focus / blur / closed, with time and bounds).
//   node tests/checker/probe_windows.mjs poe1 poe1_rare_body
import fs from "node:fs";
import path from "node:path";
import { CHECKER_DIR, launch, sandbox, wait, ROOT } from "../desktop/harness.mjs";
import { fakeInternet, fixtureData } from "../desktop/stubs.mjs";
import { openTextBox, pressKey, visibleWindowsOf, zOrderTitles, foregroundTitle } from "./win.mjs";

const [game = "poe1", item = "poe1_rare_body"] = process.argv.slice(2);
const net = await fakeInternet(fixtureData());
net.state.realItems = true;
const sbx = sandbox();
fs.mkdirSync(sbx.checkerDir, { recursive: true });
fs.writeFileSync(path.join(sbx.checkerDir, "config.json"), JSON.stringify({ game_version: game }));
const { app, page } = await launch(sbx, { appDir: CHECKER_DIR, chromiumArgs: net.args, exe: process.env.PFG_CHECKER_EXE });
await page.waitForSelector("#league");
await page.waitForFunction(() => /พบ \d+ leagues/.test(document.querySelector("#log").innerText), null, { timeout: 30000 });
await app.evaluate(({ app: a, BrowserWindow, shell }) => {
  globalThis.__tl = [];
  const t0 = Date.now();
  const rec = (w, what) => {
    let b = null;
    try { b = w.isDestroyed() ? null : w.getBounds(); } catch { /* gone */ }
    globalThis.__tl.push({ t: Date.now() - t0, id: w.id, title: w.__title ?? "", what, vis: w.isDestroyed() ? null : w.isVisible(), b });
  };
  const hook = (w) => {
    w.__title = w.getTitle();
    for (const ev of ["show", "hide", "focus", "blur", "minimize", "restore", "closed", "ready-to-show", "move", "resize"]) w.on(ev, () => rec(w, ev));
    rec(w, "created");
  };
  BrowserWindow.getAllWindows().forEach((w) => { w.__title = w.getTitle(); });
  a.on("browser-window-created", (_e, w) => hook(w));
  globalThis.__opened = [];
  shell.openExternal = async (u) => { globalThis.__opened.push(u); globalThis.__tl.push({ t: Date.now() - t0, what: "openExternal " + u.slice(0, 60) }); };
  globalThis.__mark = (s) => globalThis.__tl.push({ t: Date.now() - t0, what: "MARK " + s });
  BrowserWindow.getAllWindows().forEach((w) => hook(w));
});
if (process.env.CLIP === "image") {
  const { execFileSync } = await import("node:child_process");
  execFileSync("powershell", ["-NoProfile", "-STA", "-Command", "Add-Type -AssemblyName System.Windows.Forms,System.Drawing; $b = New-Object System.Drawing.Bitmap 40,40; [System.Windows.Forms.Clipboard]::SetImage($b)"], { windowsHide: true });
}
const box = await openTextBox(path.join(ROOT, "tests", "parity", "fixtures", "items", item + ".txt"), "PFG-PROBE-BOX", { grab: process.env.GRAB === "1" });
const pids = await app.evaluate(({ app: a }) => a.getAppMetrics().map((m) => m.pid));
const seen = new Map();
let stop = false;
const t0 = Date.now();
const sampler = (async () => {
  while (!stop) {
    for (const w of visibleWindowsOf(pids)) {
      const k = `${w.title}|${w.cls}`;
      const e = seen.get(k) ?? { first: Date.now() - t0, n: 0, w, firstRect: JSON.stringify([w.x, w.y, w.w, w.h]) };
      e.n++; e.last = Date.now() - t0; e.w = w; seen.set(k, e);
    }
    await wait(10);
  }
})();
await wait(300);
await app.evaluate(() => globalThis.__mark("F5 pressed"));
console.log("F5 at", Date.now() - t0);
await pressKey("F5");
await wait(3500);
console.log("z-order (top first):", JSON.stringify(zOrderTitles().slice(0, 6)), "foreground:", foregroundTitle());
stop = true;
await sampler;
console.log("OS windows of the program's processes (first seen, last seen, samples):");
for (const [k, e] of seen) console.log(" ", k, e.first, e.last, e.n, "firstRect", e.firstRect, "lastRect", JSON.stringify([e.w.x, e.w.y, e.w.w, e.w.h]));
const tl = await app.evaluate(() => globalThis.__tl);
for (const e of tl) console.log(JSON.stringify(e));
const lastLines = (t, n) => t.split(/\r?\n/).slice(-n).join(" | ");
console.log("STATUS:", lastLines(await page.locator("#log").innerText(), 5));
try { console.log("LOG:", lastLines(fs.readFileSync(path.join(sbx.checkerDir, "log.txt"), "utf-8"), 8)); } catch { /* none */ }
await box.close();
await app.close().catch(() => {});
process.exit(0);
