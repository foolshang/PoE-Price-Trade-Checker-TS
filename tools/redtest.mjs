// Red-dot test helper (a dev tool: never packaged, never part of a release).
//   node tools/redtest.mjs start   - closes the installed Checker, serves a fake newer version (the real installer, a fake Thai release text)
//                                    from 127.0.0.1, makes the NeverSink tags look old, starts the installed Checker pointed at that feed
//   node tools/redtest.mjs stop    - closes it, stops the feed, puts the config values back, starts the installed Checker normally, verifies
//   node tools/redtest.mjs status  - what is running and what is still changed
// The feed is only reached through POE_UPDATE_FEED (honoured only together with POE_CHECKER_TEST=1: packages/desktop/src/test_env.ts) of the one process this script starts: a normal start of the
// program never sees it. What is changed in config.json: filter_gen.neversink_tag_poe1/poe2 and filter_gen.auto_regen_neversink (so the
// test cannot rewrite the real filter); the originals are kept in %TEMP%\poe-redtest-state.json and put back by "stop".
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { serveFolder } from "../tests/checker/feed.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.join(ROOT, "dist-checker");
const LOCAL = process.env.LOCALAPPDATA;
const EXE = path.join(LOCAL, "Programs", "PoE-Price-Trade-Checker-TS", "PoE-Price-Trade-Checker-TS.exe");
const IMAGE = path.basename(EXE);
const CONFIG = path.join(LOCAL, "PoePriceTradeTS", "config.json");
const STATE = path.join(os.tmpdir(), "poe-redtest-state.json");
const PORT = 47653;
const FAKE = "99.0.0-beta.1";
const KEYS = ["neversink_tag_poe1", "neversink_tag_poe2", "auto_regen_neversink"];
const NOTES = [
  "## ทดสอบจุดแดง (ข้อความปลอม)",
  "- นี่คือข้อความ release ปลอมสำหรับเทสหน้ารายละเอียด",
  "- แก้บั๊กตัวอย่าง: ปุ่มกดไม่ตอบสนองหลังย่อลง tray",
  "- เพิ่มตัวอย่าง: แสดงประวัติอัปเดตในหน้า About",
].join("\n");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ps = (cmd) => { try { return execFileSync("powershell", ["-NoProfile", "-Command", cmd], { encoding: "utf-8", windowsHide: true }).trim(); } catch { return ""; } };
const killChecker = () => { try { execFileSync("taskkill", ["/F", "/IM", IMAGE, "/T"], { stdio: "ignore" }); } catch { /* none running */ } };
const title = () => ps(`(Get-Process -Name PoE-Price-Trade-Checker-TS -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle } | Select-Object -First 1).MainWindowTitle`);
const readCfg = () => JSON.parse(fs.readFileSync(CONFIG, "utf-8"));
const writeCfg = (c) => fs.writeFileSync(CONFIG, JSON.stringify(c, null, 2), "utf-8");
const launch = (env) => spawn(EXE, [], { detached: true, stdio: "ignore", windowsHide: false, env: { ...process.env, ...env } }).unref();
const listening = () => ps(`(Get-NetTCPConnection -LocalPort ${PORT} -State Listen -ErrorAction SilentlyContinue | Measure-Object).Count`) !== "0";

async function serve() {
  await serveFolder(DIST, { port: PORT, yml: { "latest.yml": (t) => {
    const body = t.replace(/^version: .+$/m, `version: ${FAKE}`);
    return `${body.trimEnd()}\nreleaseNotes: |\n${NOTES.split("\n").map((l) => "  " + l).join("\n")}\n`;
  } } }); // (the open server keeps this process alive)
}

async function start() {
  if (fs.existsSync(STATE)) { console.log("a test is already running - run 'stop' first"); process.exit(1); }
  if (!fs.existsSync(path.join(DIST, "latest.yml"))) { console.log("dist-checker/latest.yml is missing - run the Checker pack first"); process.exit(1); }
  killChecker();
  await sleep(2000);
  const cfg = readCfg();
  const fg = { ...(cfg.filter_gen ?? {}) };
  const saved = {};
  for (const k of KEYS) saved[k] = k in fg ? { had: true, value: fg[k] } : { had: false };
  fs.writeFileSync(STATE, JSON.stringify({ saved, at: new Date().toISOString() }), "utf-8");
  fg.neversink_tag_poe1 = "0.0.1";
  fg.neversink_tag_poe2 = "0.0.1";
  fg.auto_regen_neversink = false; // the notice only: nothing is generated into the game folder
  cfg.filter_gen = fg;
  writeCfg(cfg);
  const server = spawn(process.execPath, [fileURLToPath(import.meta.url), "serve"], { detached: true, stdio: "ignore", windowsHide: true });
  server.unref();
  fs.writeFileSync(STATE, JSON.stringify({ saved, serverPid: server.pid, at: new Date().toISOString() }), "utf-8");
  for (let i = 0; i < 40 && !listening(); i++) await sleep(500);
  launch({ POE_CHECKER_TEST: "1", POE_UPDATE_FEED: `http://127.0.0.1:${PORT}`, POE_UPDATE_FIRST_MS: "40000", POE_CHECKER_REGEN_FIRST_MS: "50000" });
  console.log("started: Checker pointed at the fake feed (update check in 40 s, NeverSink check in 50 s)");
}

async function stop() {
  killChecker();
  if (fs.existsSync(STATE)) {
    const st = JSON.parse(fs.readFileSync(STATE, "utf-8"));
    if (st.serverPid) { try { execFileSync("taskkill", ["/F", "/PID", String(st.serverPid), "/T"], { stdio: "ignore" }); } catch { /* gone */ } }
  }
  ps(`Get-NetTCPConnection -LocalPort ${PORT} -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }`);
  await sleep(2000);
  if (fs.existsSync(STATE)) {
    const { saved } = JSON.parse(fs.readFileSync(STATE, "utf-8"));
    const cfg = readCfg();
    const fg = { ...(cfg.filter_gen ?? {}) };
    for (const k of KEYS) { if (saved[k].had) fg[k] = saved[k].value; else delete fg[k]; }
    cfg.filter_gen = fg;
    writeCfg(cfg);
    fs.rmSync(STATE);
  }
  // the fake "99.0.0" download (a copy of the real installer) is not kept
  fs.rmSync(path.join(LOCAL, "poe-price-trade-checker-ts-updater", "pending"), { recursive: true, force: true });
  launch({});
  await sleep(12000);
  await status(true);
}

async function status(afterStop = false) {
  const cfg = readCfg();
  const fg = cfg.filter_gen ?? {};
  const out = {
    checkerWindow: title() || "(not running)",
    feedServerListening: listening(),
    testStateFile: fs.existsSync(STATE),
    neversink_tag_poe1: fg.neversink_tag_poe1, neversink_tag_poe2: fg.neversink_tag_poe2, auto_regen_neversink: fg.auto_regen_neversink,
  };
  console.log(JSON.stringify(out, null, 2));
  if (afterStop) console.log(out.feedServerListening || out.testStateFile ? "NOT fully restored" : "restored: the real feed, the real NeverSink tags, the real auto_regen setting");
}

const cmd = process.argv[2];
if (cmd === "serve") await serve();
else if (cmd === "start") await start();
else if (cmd === "stop") await stop();
else if (cmd === "status") await status();
else console.log("usage: node tools/redtest.mjs start|stop|status");
