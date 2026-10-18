// Manual check against the REAL GitHub Releases (not part of npm test): the installed program finds the newer (pre)release by itself,
// shows the release text, and updates itself with the real installer.
//   node tests/release/real_update.mjs checker|filtergen <expected version>
// It uses the real installed program and its real settings (the update changes the install, nothing else).
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { _electron as electron } from "playwright";

const [which, want] = process.argv.slice(2);
const APPS = {
  checker: { image: "PoE-Price-Trade-Checker-TS.exe", dir: "PoE-Price-Trade-Checker-TS", cfg: "PoePriceTradeTS", proc: "PoE-Price-Trade-Checker-TS", titleStart: "PoE Price & Trade Checker" },
  filtergen: { image: "PoE-Filter-Generator-TS.exe", dir: "PoE-Filter-Generator-TS", cfg: "PoeFilterGenTS", proc: "PoE-Filter-Generator-TS", titleStart: "PoE1 & PoE2 Filter Generator" },
};
const a = APPS[which];
if (!a || !want) { console.error("usage: node tests/release/real_update.mjs checker|filtergen <version>"); process.exit(2); }
const exe = path.join(process.env.LOCALAPPDATA, "Programs", a.dir, a.image);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ps = (c) => { try { return execFileSync("powershell", ["-NoProfile", "-Command", c], { encoding: "utf-8", windowsHide: true }).trim(); } catch { return ""; } };
const title = () => ps(`(Get-Process -Name ${a.proc} -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle } | Select-Object -First 1).MainWindowTitle`);
const log = () => { try { return fs.readFileSync(path.join(process.env.LOCALAPPDATA, a.cfg, "log.txt"), "utf-8"); } catch { return ""; } };

try { execFileSync("taskkill", ["/F", "/IM", a.image, "/T"], { stdio: "ignore" }); } catch { /* none */ }
await sleep(2500);
console.log("installed before:", title() || "(not running)", "|", exe, fs.existsSync(exe));

const app = await electron.launch({ executablePath: exe, env: { ...process.env, POE_CHECKER_TEST: "1", POE_UPDATE_FIRST_MS: "3000" } });
const pageOf = async () => { const w = app.windows(); return w.length ? w[0] : await app.waitForEvent("window"); };
const page = await pageOf();
console.log("running:", await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getTitle()));

const sel = which === "checker" ? "#update-bar .update-text" : "#update-text";
const readyText = which === "checker" ? "พร้อมติดตั้ง" : "รีสตาร์ท";
const t0 = Date.now();
let text = "";
while (Date.now() - t0 < 300000) {
  text = await page.locator(sel).first().innerText().catch(() => "");
  if (text.includes(want) && (which === "checker" ? text.includes(readyText) : (await page.locator("#update-action").isVisible().catch(() => false)))) break;
  await sleep(2000);
}
console.log("update strip:", JSON.stringify(text), `(${Math.round((Date.now() - t0) / 1000)} s after start)`);
console.log("log:", log().split("\n").filter((l) => /updater/i.test(l)).slice(-6).map((l) => l.slice(0, 200)).join("\n      "));

await page.click("#btn-about");
const about = page.locator("#about-window");
await about.waitFor({ state: "visible", timeout: 10000 });
console.log("About, newer-version part:", JSON.stringify(await page.locator("#about-newer").innerText().catch(() => "(none)")));
await page.keyboard.press("Escape");

const before = new Set(ps(`(Get-Process -Name ${a.proc} -ErrorAction SilentlyContinue | ForEach-Object { $_.Id }) -join ','`).split(","));
await page.click(which === "checker" ? '#update-bar button[data-act="install-now"]' : "#update-action");
console.log("clicked update now");
const t1 = Date.now();
let now = "";
while (Date.now() - t1 < 240000) {
  await sleep(3000);
  now = title();
  const pids = ps(`(Get-Process -Name ${a.proc} -ErrorAction SilentlyContinue | ForEach-Object { $_.Id }) -join ','`).split(",").filter(Boolean);
  if (now.includes(`v${want}`) && pids.some((p) => !before.has(p))) break;
}
console.log("after the update:", now, "|", ps(`(Get-Process -Name ${a.proc} -ErrorAction SilentlyContinue | Select-Object -First 1).Path`));
console.log(now.includes(`v${want}`) ? "UPDATED" : "NOT UPDATED");
