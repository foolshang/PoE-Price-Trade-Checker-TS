// The life of the installed program on THIS machine (it installs, replaces and removes the per-user install, so it is run by hand):
//   node tests/desktop/installer.mjs <old Setup.exe> <new Setup.exe>
// Checks: install over a running older version (the installer closes it, nothing half-installed), the settings survive, the
// uninstaller removes the program, the shortcuts and the registry entry but never %LOCALAPPDATA%\PoeFilterGenTS, the original's
// PoeFilterGen folder or the game folders; reinstalling brings the program back with the same settings. Ends with the NEW version installed.
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const [oldSetup, newSetup] = process.argv.slice(2);
if (!oldSetup || !newSetup) throw new Error("usage: node installer.mjs <old Setup.exe> <new Setup.exe>");
const LOCAL = process.env.LOCALAPPDATA;
const NAME = "PoE-Filter-Generator-TS";
const dir = path.join(LOCAL, "Programs", NAME);
const exe = path.join(dir, `${NAME}.exe`);
const cfgDir = path.join(LOCAL, "PoeFilterGenTS");
const oldDir = path.join(LOCAL, "PoeFilterGen");
const startMenu = path.join(process.env.APPDATA, "Microsoft", "Windows", "Start Menu", "Programs", "PoE Filter Generator (TypeScript).lnk");
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? "  - " + detail : ""}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ps = (cmd) => execFileSync("powershell", ["-NoProfile", "-Command", cmd], { encoding: "utf-8" }).trim();
const running = () => ps(`(Get-Process -Name ${NAME} -ErrorAction SilentlyContinue | Measure-Object).Count`) | 0;
const titles = () => ps(`(Get-Process -Name ${NAME} -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle } | ForEach-Object { $_.MainWindowTitle }) -join '|'`);
const regKey = () => ps(`Get-ChildItem HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall | ForEach-Object { $p = Get-ItemProperty $_.PSPath; if ($p.DisplayName -like '${NAME}*') { $p.DisplayVersion } }`);

function tree(root, skip = () => false) {
  const out = {};
  const walk = (d) => {
    for (const e of fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }) : []) {
      const p = path.join(d, e.name);
      if (skip(p)) continue;
      if (e.isDirectory()) walk(p);
      else out[path.relative(root, p)] = createHash("sha256").update(fs.readFileSync(p)).digest("hex");
    }
  };
  walk(root);
  return out;
}
// the files that are the player's: settings and cache (the running program also writes log.txt / last_run.txt / its own electron folder)
const mine = () => tree(cfgDir, (p) => /\\(electron|log\.txt|last_run\.txt)(\\|$)/.test(p) && !/config\.json$/.test(p));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

async function waitTitle(ver, secs = 90) {
  const t0 = Date.now();
  while (Date.now() - t0 < secs * 1000) {
    if (titles().includes(`v${ver}`)) return Date.now() - t0;
    await sleep(300);
  }
  return -1;
}
const verOf = (setup) => path.basename(setup).match(/Setup-(.+)\.exe$/)[1];
const stopAll = async () => { spawnSync("taskkill", ["/F", "/IM", `${NAME}.exe`], { stdio: "ignore" }); await sleep(1500); };
const install = (setup, label) => {
  const t0 = Date.now();
  const r = spawnSync(setup, ["/S"], { stdio: "ignore" });
  const ms = Date.now() - t0;
  check(`${label}: installer exit code 0`, r.status === 0, `${ms} ms`);
  return ms;
};

// ---- a known old version is installed and RUNNING with settings
await stopAll();
install(oldSetup, "old version");
check("old version registered", regKey().includes(verOf(oldSetup)), regKey());
if ((await waitTitle(verOf(oldSetup))) < 0) { spawn(exe, [], { detached: true, stdio: "ignore" }).unref(); await waitTitle(verOf(oldSetup)); }
check("old version running", titles().includes(`v${verOf(oldSetup)}`), titles());
const settingsBefore = mine();
check("the player's settings exist", Object.keys(settingsBefore).includes("config.json"), Object.keys(settingsBefore).join(", "));
const oldFolderBefore = tree(oldDir);

// ---- the new version over the running old one, no uninstall first
const msOver = install(newSetup, "new version over the running old one");
// a silent install does not start the program again; what matters: the old one was closed by the installer, nothing runs half-replaced
check("the installer closed the running old version", running() === 0 || !titles().includes(`v${verOf(oldSetup)}`), titles() || "nothing running");
await stopAll();
spawn(exe, [], { detached: true, stdio: "ignore" }).unref();
const up = await waitTitle(verOf(newSetup));
check("the new version starts from the installed folder (title bar)", up >= 0, titles());
check("only one version runs", titles().split("|").filter(Boolean).length === 1, titles());
check("registry says the new version", regKey().trim() === verOf(newSetup), regKey());
check("install folder is complete (exe, asar, dlls)", ["resources\\app.asar", "ffmpeg.dll", `${NAME}.exe`, `Uninstall ${NAME}.exe`].every((f) => fs.existsSync(path.join(dir, f))));
await stopAll();
check("settings survive the install over", same(mine(), settingsBefore));

// ---- uninstall
const un = spawnSync(path.join(dir, `Uninstall ${NAME}.exe`), ["/currentuser", "/S"], { stdio: "ignore" });
for (let i = 0; i < 90 && fs.existsSync(exe); i++) await sleep(500); // (the uninstaller copies itself to temp and finishes there)
await sleep(1500);
check("uninstaller exit code 0", un.status === 0, String(un.status));
check("program folder removed", !fs.existsSync(exe));
check("Start menu shortcut removed", !fs.existsSync(startMenu));
check("registry entry removed", regKey() === "", regKey());
check("settings and cache still there after uninstall", same(mine(), settingsBefore));
check("the original's PoeFilterGen folder untouched", same(tree(oldDir), oldFolderBefore));

// ---- install again: settings are the same, program back
install(newSetup, "reinstall");
if ((await waitTitle(verOf(newSetup))) < 0) { spawn(exe, [], { detached: true, stdio: "ignore" }).unref(); await waitTitle(verOf(newSetup)); }
check("reinstalled version runs", titles().includes(`v${verOf(newSetup)}`), titles());
check("Start menu shortcut is back", fs.existsSync(startMenu));
await stopAll();
check("settings are the same after the reinstall", same(mine(), settingsBefore));
spawn(exe, [], { detached: true, stdio: "ignore" }).unref(); // leave the new version running
await waitTitle(verOf(newSetup));

console.log(JSON.stringify({ failed: results.filter((r) => !r.ok).length, total: results.length, installOverRunningMs: msOver, host: os.hostname() }));
process.exit(results.some((r) => !r.ok) ? 1 : 0);
