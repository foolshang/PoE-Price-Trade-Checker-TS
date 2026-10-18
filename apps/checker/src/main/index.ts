/**
 * PoE Price & Trade Checker (TypeScript) - the Electron main process (phase 4: F4 skill reference + F5 trade).
 *
 * Owns everything that touches the machine: hotkeys, the key press and the clipboard, the hub and GGG's trade data, the browser, the
 * config (%LOCALAPPDATA%\PoePriceTradeTS, imported once from the original's PoePriceTrade) and the windows. The windows show pages
 * from the app:// protocol and can call only what their preload exposes (shared/api.ts).
 */
import { app, BrowserWindow, clipboard, ClipboardItem, globalShortcut, ipcMain, Menu, net, protocol, screen, session, shell } from "electron";
import type { IpcMainEvent, IpcMainInvokeEvent } from "electron";
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { promises as fsp } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { baseDb, f5, hubClient, itemLang, league as leagueMod, metaDb, modBadge, modDb, profiles, py, pyextra, skillRef, tradeUrl } from "@poe/core";
const { PyFloat } = py;
type PyFloat = InstanceType<typeof PyFloat>;
import type { HttpPort, models } from "@poe/core";
import { AppConfig, CHECKER_DEFAULTS, NodeFs, NodeHttp, importOldConfig } from "@poe/node";
import type { GameId, MainInit, PickerFilter, SkillDetail, Tag } from "../shared/api.ts";
import { copyChord, keyName, readAdvancedKey } from "./game_keys.ts";
import { copyItemText } from "./item_copy.ts";
import { foregroundElevated, selfElevated, focusWindow, foregroundWindow, sendCopyChord, windowFacts } from "./native.ts";
import { pickerInit } from "./picker_data.ts";

declare const __APP_VERSION__: string;
declare const __BUILD_TIME__: string;

const VERSION = __APP_VERSION__;
const TITLE = `PoE Price & Trade Checker (TypeScript) v${VERSION}`;

// ---------------------------------------------------------------------------------------------- places, single instance, log
const localAppData = process.env.LOCALAPPDATA || path.join(app.getPath("home"), "AppData", "Local");
const configDir = path.join(localAppData, "PoePriceTradeTS");
const oldConfigDir = path.join(localAppData, "PoePriceTrade"); // the original's folder: only ever read
mkdirSync(configDir, { recursive: true });
app.setPath("userData", path.join(configDir, "electron"));
const gotLock = app.requestSingleInstanceLock();

const logFile = path.join(configDir, "log.txt");
if (gotLock) {
  try { writeFileSync(logFile, "", "utf-8"); } catch { /* no log then */ }
}
function fileLog(level: string, msg: string): void {
  if (!gotLock) return;
  try { appendFileSync(logFile, `${new Date().toISOString()} ${level} main: ${msg}\n`, "utf-8"); } catch { /* nothing to do */ }
}
fileLog("INFO", `PoE Price & Trade Checker v${VERSION} started (frozen=${app.isPackaged}) build=${__BUILD_TIME__}`);

const nodeFs = new NodeFs();
const http: HttpPort = new NodeHttp(20000, net.fetch as typeof fetch);
const resourcesDir = app.isPackaged ? path.join(process.resourcesPath, "meta") : path.join(__dirname, "..", "..", "resources");
const debugDir = path.join(configDir, "debug_logs");
const sessionEvents: string[] = [];

/** developer events (debug.event in the original): kept for debug_logs/last_session.md */
function debugEvent(msg: string): void {
  sessionEvents.push(`${new Date().toTimeString().slice(0, 8)} ${msg}`);
  fileLog("INFO", msg);
}

protocol.registerSchemesAsPrivileged([{ scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

// ---------------------------------------------------------------------------------------------- state
const config = new AppConfig(configDir, CHECKER_DEFAULTS);
let importNote = "";
let game: GameId = "poe2";
let league = "";
let leagues: string[] = [];
let mainWin: BrowserWindow | null = null;
let pickerWin: BrowserWindow | null = null;
let skillWin: BrowserWindow | null = null;
const earlyLog: [string, Tag][] = [];

/** a line for the Status of the main window (kept until the window can show it) and for log.txt */
function say(text: string, tag: Tag = "info"): void {
  fileLog(tag === "err" ? "ERROR" : tag === "warn" ? "WARNING" : "INFO", text);
  if (mainWin && !mainWin.isDestroyed() && !mainWin.webContents.isLoading() && ready) mainWin.webContents.send("main:log", text, tag);
  else earlyLog.push([text, tag]);
}
let ready = false;

const cfgStr = (k: string, d = ""): string => (typeof config.get(k) === "string" ? (config.get(k) as string) : d);
const cfgBool = (k: string, d: boolean): boolean => (config.get(k) === undefined || config.get(k) === null ? d : !!config.get(k));

let saveTimer: NodeJS.Timeout | null = null;
function saveSoon(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => void config.save(), 300);
}

// ---------------------------------------------------------------------------------------------- databases (per game, like the original)
interface Dbs {
  gv: GameId;
  stats: modDb.ModDatabase;
  base: baseDb.BaseDB;
  meta: metaDb.MetaDB;
  profile: profiles.GameProfile;
}
let dbs: Dbs;
const hub = new hubClient.HubClient(http, (m, t) => fileLog(t === "warn" ? "WARNING" : "INFO", m));
const badge = new modBadge.ModBadgeDB({
  fs: nodeFs, hub, cacheDir: path.join(configDir, "cache"), configDir, nowMs: () => Date.now(), warn: (m) => fileLog("WARNING", m),
});

function makeDbs(gv: GameId): Dbs {
  const profile = profiles.profileFor(gv);
  const env = { fs: nodeFs, http, cacheDir: path.join(configDir, "cache"), nowMs: () => Date.now(), warn: (m: string) => fileLog("WARNING", m) };
  return {
    gv, profile, stats: new modDb.ModDatabase(profile, env), base: new baseDb.BaseDB(profile, env),
    meta: new metaDb.MetaDB(gv, { fs: nodeFs, appDir: configDir, bundledDir: resourcesDir, warn: (m) => fileLog("WARNING", m) }),
  };
}

// ---------------------------------------------------------------------------------------------- leagues
async function fetchLeagues(autoPick: boolean): Promise<void> {
  say("⟳ ดึงรายชื่อ league จาก hub…", "info");
  const gv = game;
  try {
    const files = await hub.getLeagueFiles(gv);
    if (gv !== game) return; // the game was switched meanwhile
    const r = leagueMod.chooseLeague(files, { autoPick, preferHc: cfgBool("prefer_hardcore", false), current: league });
    for (const [m, t] of r.logs) say(m, t as Tag);
    if (!r.ok) return;
    leagues = r.leagues;
    league = r.picked;
    config.set("league", league);
    saveSoon();
    debugEvent(`league ${gv}: ${league} (auto=${autoPick})`);
    sendLeagues();
  } catch (e) {
    say(`✗ ดึง league ไม่ได้: ${(e as Error).message}`, "err");
  }
}
function sendLeagues(): void {
  if (mainWin && !mainWin.isDestroyed() && ready) mainWin.webContents.send("main:leagues", leagues, league);
}

function setGame(g: GameId): void {
  if (g === game) return;
  game = g;
  config.set("game_version", g);
  dbs = makeDbs(g);
  leagues = [...profiles.profileFor(g).default_leagues];
  league = leagues[0] ?? "";
  saveSoon();
  sendLeagues();
  closePicker("game switched");
  closeSkill();
  void fetchLeagues(cfgBool("auto_league", true));
}

// ---------------------------------------------------------------------------------------------- F5
let f5Busy = false;
const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const ADMIN_MSG = "⚠ Windows ไม่ให้โปรแกรมนี้ส่งปุ่ม Ctrl+C ไปที่เกม — เกมน่าจะรันแบบ Administrator: เปิดเกมแบบปกติ " +
  "หรือรันโปรแกรมนี้แบบ Administrator เหมือนเกม";

/** the Documents folder of the player (the game's settings are under it); POE_CHECKER_DOCUMENTS = a different one, for tests */
const documentsDir = (): string => process.env.POE_CHECKER_DOCUMENTS || app.getPath("documents");

const NOT_ENGLISH_MSG = "⚠ F5 รองรับเกมภาษาอังกฤษเท่านั้น (ตั้งภาษาในเกมเป็น English)";

/** the keys that copy an item for this game, and a line for the Status saying which (PoE2: the player's own advanced key) */
async function copyKeys(gv: GameId): Promise<{ chord: number[]; label: string }> {
  if (gv !== "poe2") return { chord: copyChord(gv, []), label: "Ctrl+C" };
  const adv = await readAdvancedKey(documentsDir());
  if (adv.source === "default") fileLog("WARNING", adv.note);
  const chord = copyChord(gv, adv.keys);
  return { chord, label: [...chord, 0x43].map(keyName).join("+") + (adv.source === "default" ? " (ค่าเริ่มต้น)" : "") };
}

async function onF5(): Promise<void> {
  if (f5Busy) return;
  f5Busy = true;
  const pressPoint = screen.getCursorScreenPoint(); // the popup goes where the mouse was when the key was pressed
  const gameWindow = foregroundToReturnTo(); // and the focus goes back there when it is closed
  try {
    const gv = game;
    const { chord, label } = await copyKeys(gv);
    const copied = await copyItemText({
      snapshot: async () => {
        const text = (await clipboard.readText()) || "";
        // no text but a picture on the clipboard: keep the picture, so the copy does not cost the player it
        // (kept as bytes: a ClipboardItem that was read cannot be written back, Electron wants a new one)
        let image: Buffer | null = null;
        try {
          if (!text && (await clipboard.has("image/png"))) {
            for (const item of await clipboard.read()) {
              if (item.types.includes("image/png")) image = Buffer.from(await (await item.getType("image/png")).arrayBuffer());
            }
          }
        } catch { /* not readable: the text (empty) is what is kept */ }
        return { text, image };
      },
      restore: async (snap) => {
        // a clipboard that cannot be put back must never cost the player the F5 itself
        try {
          const png = snap.image as Buffer | null;
          if (png) await clipboard.write([new ClipboardItem({ "image/png": new Blob([new Uint8Array(png)], { type: "image/png" }) })]);
          else await clipboard.writeText(snap.text);
        } catch (e) {
          fileLog("WARNING", `F5: could not put the clipboard back: ${(e as Error).message}`);
        }
      },
      writeText: (t) => clipboard.writeText(t),
      readText: () => clipboard.readText(),
      send: () => sendCopyChord(chord),
      sleep: wait,
    }, { restore: cfgBool("f5_restore_clipboard", true) });
    const text = copied.text;
    if (!text) {
      if (copied.sent.blocked) say(ADMIN_MSG, "warn");
      else if (selfElevated() === false && foregroundElevated() === true) say(ADMIN_MSG, "warn");
      else say("⚠ ชี้ที่ item แล้วกด F5 อีกครั้ง", "warn");
      return;
    }
    if (copied.lang !== "en") {
      debugEvent(`F5 item text in ${copied.lang}: not English`);
      say(NOT_ENGLISH_MSG, "warn");
      return;
    }
    const headers = itemLang.hasModifierHeaders(text);
    say(`ℹ F5 (${label}): ข้อความ item ${headers ? "มี" : "ไม่มี"}หัวข้อ { Modifier }`, "dim");
    debugEvent(`F5 copy keys=${label} headers=${headers}`);
    try {
      await fsp.mkdir(debugDir, { recursive: true });
      await fsp.writeFile(path.join(debugDir, "last_raw_item.txt"), text, "utf-8");
    } catch { /* not important */ }
    const d = dbs;
    const result = await f5.prepareF5(text, {
      game: d.gv, league, profile: d.profile, modDb: d.stats, baseDb: d.base, modBadge: badge, metaDb: d.meta,
      cfg: { f5_mod_picker: cfgBool("f5_mod_picker", true), mod_badge_archetype: cfgStr("mod_badge_archetype", "all") },
      debug: debugEvent, log: (m, t) => fileLog("WARNING", m + (t ? "" : "")),
    });
    if (result.kind === "unparsed") {
      say("⚠ อ่าน item ไม่ได้", "warn");
      return;
    }
    if (result.kind === "picker") {
      debugEvent(`F5 picker '${result.item.item_name}' rarity=${result.item.rarity} mods=${result.rows.length} resolved=${result.rows.filter((r) => r.statId).length}`);
      say(`🧩 เลือก mod: ${result.item.item_name}`, "info");
      openPicker(result, pressPoint, gameWindow);
      return;
    }
    debugEvent(`F5 '${result.item.item_name}' rarity=${result.item.rarity} base='${result.item.base_type}' url=${result.url.slice(0, 80)}`);
    await shell.openExternal(result.url);
    say(`🔎 เปิด trade: ${result.item.item_name}`, "ok");
  } catch (e) {
    fileLog("ERROR", `F5 error: ${(e as Error).stack ?? e}`);
    say(`✗ F5: ${(e as Error).message}`, "err");
  } finally {
    f5Busy = false;
  }
}

// ---------------------------------------------------------------------------------------------- windows
function secureWebPreferences(preload: string): Electron.WebPreferences {
  return {
    preload: path.join(__dirname, "../preload", preload), contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true,
    spellcheck: false, devTools: !app.isPackaged || !!process.env.POE_DEVTOOLS,
  };
}

function hardenWindow(win: BrowserWindow): void {
  win.setMenu(null);
  win.on("page-title-updated", (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (e, url) => {
    if (!url.startsWith("app://local/")) e.preventDefault();
  });
}

const iconPath = (): string | undefined =>
  [path.join(process.resourcesPath, "icon.ico"), path.join(__dirname, "..", "..", "build", "icon.ico")].find((p) => existsSync(p));

function createMainWindow(): void {
  mainWin = new BrowserWindow({
    width: 560, height: 520, minWidth: 460, minHeight: 420, title: TITLE, icon: iconPath(), backgroundColor: "#1c1c1c", show: false,
    webPreferences: secureWebPreferences("main.cjs"),
  });
  hardenWindow(mainWin);
  mainWin.once("ready-to-show", () => mainWin?.show());
  mainWin.on("closed", () => {
    mainWin = null;
    quit();
  });
  void mainWin.loadURL("app://local/index.html");
}

/** a small always-on-top tool window (picker / skill reference): hidden until the page says how big it is */
function createToolWindow(title: string, preload: string, page: string): BrowserWindow {
  const win = new BrowserWindow({
    width: 480, height: 300, useContentSize: true, title, icon: iconPath(), backgroundColor: "#1c1c1c", show: false, resizable: false,
    maximizable: false, minimizable: false, alwaysOnTop: true, autoHideMenuBar: true, webPreferences: secureWebPreferences(preload),
  });
  hardenWindow(win);
  win.setAlwaysOnTop(true, "screen-saver"); // above a borderless game window too
  void win.loadURL(`app://local/${page}`);
  return win;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), Math.max(hi, lo));
}

// ---- picker
interface PickerSession { rows: f5.PickerRow[]; item: models.ParsedItem; pressPoint: Electron.Point; returnTo: bigint }
let pickerSession: PickerSession | null = null;

/**
 * The window that has the keyboard focus (the game), unless it is one of ours. When a window that holds the focus is closed, Windows
 * hands the focus to ANOTHER window of the same program - the Checker's main window - which then jumps up over the game and goes away
 * again: the "window that flashes". So the focus is given back to the game before the popup / skill window is closed.
 */
function foregroundToReturnTo(): bigint {
  const h = foregroundWindow();
  const ours = [mainWin, pickerWin, skillWin].some((w) => w && !w.isDestroyed() && w.getNativeWindowHandle().readBigUInt64LE(0) === h);
  return ours ? 0n : h;
}

function giveFocusBack(win: BrowserWindow, to: bigint): void {
  try {
    if (to && !win.isDestroyed() && win.isFocused()) fileLog("INFO", `focus given back to the window in front before (${focusWindow(to) ? "ok" : "refused"})`);
  } catch (e) {
    fileLog("WARNING", `could not give the focus back: ${(e as Error).message}`);
  }
}

function closePicker(reason: string): void {
  const w = pickerWin;
  const to = pickerSession?.returnTo ?? 0n;
  pickerWin = null;
  pickerSession = null;
  if (w && !w.isDestroyed()) {
    fileLog("INFO", `popup closed by the program: ${reason}`);
    giveFocusBack(w, to);
    w.destroy();
  }
}

/** What Windows says about the popup just after it is shown (visible? covered by what? who has the focus?) - in log.txt; a covered popup is raised again */
function watchPopup(win: BrowserWindow): void {
  for (const ms of [150, 600, 1500]) {
    setTimeout(() => {
      if (win.isDestroyed() || pickerWin !== win) return;
      try {
        const f = windowFacts(win.getNativeWindowHandle());
        const hidden = !f.visible || f.minimized || f.covering.length > 0;
        fileLog(hidden ? "WARNING" : "INFO", `popup +${ms}ms: visible=${f.visible} minimized=${f.minimized} focus='${f.foreground}' covered-by=[${f.covering.join(" | ")}]${hidden ? " -> raised again" : ""}`);
        if (hidden) {
          win.setAlwaysOnTop(true, "screen-saver");
          win.show();
          win.moveTop();
        }
      } catch (e) {
        fileLog("WARNING", `popup check failed: ${(e as Error).message}`);
      }
    }, ms);
  }
}

function openPicker(result: Extract<f5.F5Result, { kind: "picker" }>, pressPoint: Electron.Point, returnTo: bigint): void {
  closePicker("replaced by a new F5");
  pickerSession = { rows: result.rows, item: result.item, pressPoint, returnTo };
  const win = createToolWindow("เลือก mod", "picker.cjs", "picker.html");
  pickerWin = win;
  win.on("closed", () => {
    if (pickerWin === win) {
      fileLog("WARNING", "popup window was closed by something else (not by the program)");
      pickerWin = null;
      pickerSession = null;
    }
  });
  win.on("hide", () => fileLog("INFO", "popup hide"));
  win.on("blur", () => fileLog("INFO", "popup blur (lost the keyboard focus)"));
  win.on("minimize", () => fileLog("INFO", "popup minimize"));
  win.webContents.on("render-process-gone", (_e, d) => fileLog("ERROR", `popup renderer gone: ${d.reason} (${d.exitCode})`));
  win.webContents.on("did-fail-load", (_e, code, desc) => fileLog("ERROR", `popup page failed to load: ${code} ${desc}`));
  win.webContents.once("did-finish-load", () => win.webContents.send("picker:init", pickerInit(result)));
}

function placeAtPoint(win: BrowserWindow, size: { width: number; height: number }, pt: Electron.Point): void {
  win.setContentSize(Math.ceil(size.width), Math.ceil(size.height));
  const disp = screen.getDisplayNearestPoint(pt).bounds;
  const [w, h] = win.getSize();
  win.setPosition(clamp(pt.x + 16, disp.x, disp.x + disp.width - w - 8), clamp(pt.y - Math.floor(h / 2), disp.y, disp.y + disp.height - h - 8));
}

function showFocused(win: BrowserWindow): void {
  win.show();
  win.moveTop();
  win.focus();
}

function runPickerSearch(filters: PickerFilter[]): void {
  const s = pickerSession;
  if (!s) return;
  closePicker("search");
  const stat: tradeUrl.StatFilter[] = [];
  for (const f of filters) {
    const row = s.rows[f.row];
    if (!row || !row.statId) continue;
    const entry: tradeUrl.StatFilter = { id: row.statId, disabled: false };
    const val: { min?: PyFloat; max?: PyFloat } = {};
    for (const [k, raw] of [["min", f.min], ["max", f.max]] as const) {
      const n = pyextra.pyFloatOrNull(typeof raw === "string" ? raw : "");
      if (n !== null) val[k] = new PyFloat(n); // not a number -> that box is skipped
    }
    if (val.min !== undefined || val.max !== undefined) entry.value = val;
    stat.push(entry);
  }
  void (async () => {
    try {
      const d = dbs;
      const url = tradeUrl.buildTradeUrl(s.item, d.stats, league, d.profile, 0.8, stat, d.base);
      debugEvent(`F5 picker search '${s.item.item_name}' filters=${stat.length} url=${url.slice(0, 80)}`);
      await shell.openExternal(url);
      say(`🔎 เปิด trade: ${s.item.item_name}`, "ok");
    } catch (e) {
      fileLog("ERROR", `mod picker search error: ${(e as Error).stack ?? e}`);
      say(`✗ F5: ${(e as Error).message}`, "err");
    }
  })();
}

// ---- skill reference (F4)
let skillDb: skillRef.SkillRefDB | null = null;
let skillReturnTo = 0n;
function closeSkill(): void {
  const w = skillWin;
  skillWin = null;
  if (w && !w.isDestroyed()) {
    giveFocusBack(w, skillReturnTo);
    w.destroy();
  }
}

async function onF4(): Promise<void> {
  const back = foregroundToReturnTo();
  closeSkill();
  skillReturnTo = back;
  say("⟳ โหลดข้อมูล skill จาก hub…", "dim");
  const db = new skillRef.SkillRefDB(game, hub, (m) => fileLog("WARNING", m)); // loaded again at every open: no stale hub data for a whole session
  try {
    await db.load();
  } catch (e) {
    say(`✗ F4: ${(e as Error).message}`, "err");
  }
  skillDb = db;
  const win = createToolWindow("Skill Mod Reference", "skill.cjs", "skillref.html");
  skillWin = win;
  win.on("close", () => giveFocusBack(win, skillReturnTo)); // (the player closes it: X / Alt+F4)
  win.on("closed", () => {
    if (skillWin === win) skillWin = null;
  });
}

function skillDetail(db: skillRef.SkillRefDB, t: string, s: string): Promise<SkillDetail> {
  return db.modsForSkill(t, s).then((mods) => {
    const meta = db.skillMeta(t, s);
    const passives = db.passivesForSkill(t, s);
    const out: SkillDetail = { skillType: t, skill: s, populations: meta?.populations ?? {}, mods: {}, passives: {} };
    for (const [bracket, slots] of Object.entries(mods)) {
      out.mods[bracket] = {};
      for (const [slot, rows] of Object.entries(slots)) {
        out.mods[bracket][slot] = rows.map((m) => ({ text: m.text, usagePct: m.usage_pct, valueMin: m.value_min, valueMax: m.value_max }));
      }
    }
    for (const [bracket, rows] of Object.entries(passives)) out.passives[bracket] = rows.map((p) => ({ keypassive: p.keypassive, usagePct: p.usage_pct }));
    return out;
  });
}

// ---------------------------------------------------------------------------------------------- ipc
const isFrom = (e: IpcMainEvent | IpcMainInvokeEvent, win: BrowserWindow | null): boolean =>
  !!win && !win.isDestroyed() && e.sender === win.webContents && (e.senderFrame?.url ?? "").startsWith("app://local/");

function setupIpc(): void {
  ipcMain.handle("main:init", (e): MainInit | null => {
    if (!isFrom(e, mainWin)) return null;
    ready = true;
    const lines = earlyLog.splice(0);
    return {
      version: VERSION, buildTime: __BUILD_TIME__, configDir, game, league, leagues,
      hotkeys: { scan: cfgStr("hotkey_scan", "F4"), trade: cfgStr("hotkey_trade", "F5"), quit: cfgStr("hotkey_quit", "Ctrl+Alt+Q") }, log: lines,
    };
  });
  ipcMain.on("main:set-game", (e, g: unknown) => {
    if (isFrom(e, mainWin) && (g === "poe1" || g === "poe2")) setGame(g);
  });
  ipcMain.on("main:set-league", (e, l: unknown) => {
    if (isFrom(e, mainWin) && typeof l === "string" && leagues.includes(l)) {
      league = l;
      config.set("league", l);
      saveSoon();
      debugEvent(`league picked ${l}`);
    }
  });
  ipcMain.on("main:refresh-leagues", (e) => {
    if (isFrom(e, mainWin)) void fetchLeagues(false);
  });

  ipcMain.on("picker:ready", (e, size: { width: number; height: number }) => {
    if (!isFrom(e, pickerWin) || !pickerWin || !size || !(size.width > 0) || !(size.height > 0)) return;
    placeAtPoint(pickerWin, size, pickerSession?.pressPoint ?? screen.getCursorScreenPoint());
    showFocused(pickerWin);
    fileLog("INFO", `popup shown at ${JSON.stringify(pickerWin.getBounds())} (the mouse was at ${JSON.stringify(pickerSession?.pressPoint ?? null)})`);
    watchPopup(pickerWin);
  });
  ipcMain.on("picker:search", (e, filters: unknown) => {
    if (!isFrom(e, pickerWin) || !Array.isArray(filters)) return;
    runPickerSearch(filters.filter((f) => f && Number.isInteger(f.row)).map((f) => ({ row: f.row, min: String(f.min ?? ""), max: String(f.max ?? "") })));
  });
  ipcMain.on("picker:cancel", (e) => {
    if (isFrom(e, pickerWin)) closePicker("cancel (Esc / button)");
  });

  ipcMain.handle("skill:init", (e) => (isFrom(e, skillWin) ? { available: !!skillDb?.available() } : { available: false }));
  ipcMain.handle("skill:search", (e, prefix: unknown) => {
    if (!isFrom(e, skillWin) || !skillDb || typeof prefix !== "string") return [];
    return skillDb.searchSkills(prefix).slice(0, 200).map((s) => ({ skillType: s.skill_type, skill: s.skill, facetCount: s.facet_count }));
  });
  ipcMain.handle("skill:select", async (e, t: unknown, s: unknown) => {
    if (!isFrom(e, skillWin) || !skillDb || typeof t !== "string" || typeof s !== "string") return null;
    return skillDetail(skillDb, t, s);
  });
  ipcMain.on("skill:ready", (e, size: { width: number; height: number }) => {
    if (!isFrom(e, skillWin) || !skillWin || !size || !(size.width > 0) || !(size.height > 0)) return;
    skillWin.setContentSize(Math.ceil(size.width), Math.ceil(size.height));
    const ref = mainWin && !mainWin.isDestroyed() && mainWin.isVisible() && !mainWin.isMinimized() ? mainWin.getBounds() : screen.getPrimaryDisplay().workArea;
    const [w, h] = skillWin.getSize();
    skillWin.setPosition(Math.max(ref.x + Math.floor((ref.width - w) / 2), 0), Math.max(ref.y + Math.floor((ref.height - h) / 2), 0));
    showFocused(skillWin);
  });
  ipcMain.on("skill:resize", (e, size: { width: number; height: number }) => {
    if (isFrom(e, skillWin) && skillWin && size && size.width > 0 && size.height > 0) skillWin.setContentSize(Math.ceil(size.width), Math.ceil(size.height));
  });
  ipcMain.on("skill:close", (e) => {
    if (isFrom(e, skillWin)) closeSkill();
  });
}

function setupSession(): void {
  const csp = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; " +
    "connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
  session.defaultSession.webRequest.onHeadersReceived((details, cb) => {
    cb({ responseHeaders: { ...details.responseHeaders, "Content-Security-Policy": [csp] } });
  });
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  const root = path.join(__dirname, "..", "renderer");
  protocol.handle("app", (request) => {
    const url = new URL(request.url);
    if (url.hostname !== "local") return new Response("not found", { status: 404 });
    const rel = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
    const file = path.join(root, rel);
    const inside = path.relative(root, file);
    if (!inside || inside.startsWith("..") || path.isAbsolute(inside)) return new Response("not found", { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });
}

// ---------------------------------------------------------------------------------------------- hotkeys
const HOTKEY_PROBLEM = (spec: string, what: string): string =>
  `✗ ลงทะเบียนปุ่ม ${spec} (${what}) ไม่ได้ — มีโปรแกรมอื่นจองปุ่มนี้อยู่ (เช่น PoE Price & Trade Checker ตัวเดิม) ` +
  "ปิดโปรแกรมนั้นแล้วเปิดโปรแกรมนี้ใหม่";

function toAccelerator(spec: string): string {
  return spec.split("+").map((p) => p.trim()).map((p) => (p.toLowerCase() === "win" ? "Super" : p)).join("+");
}

function registerHotkeys(): void {
  const items: [string, string, () => void][] = [
    [cfgStr("hotkey_scan", "F4"), "F4 skill reference", () => void onF4()],
    [cfgStr("hotkey_trade", "F5"), "F5 trade", () => void onF5()],
    [cfgStr("hotkey_quit", "Ctrl+Alt+Q"), "quit", () => quit()],
  ];
  for (const [spec, what, cb] of items) {
    let ok = false;
    try {
      ok = globalShortcut.register(toAccelerator(spec), cb);
    } catch (e) {
      say(`✗ ปุ่ม ${spec} (${what}) ใช้ไม่ได้: ${(e as Error).message}`, "err");
      continue;
    }
    if (ok) fileLog("INFO", `hotkey ${spec} (${what}) registered`);
    else say(HOTKEY_PROBLEM(spec, what), "err");
  }
}

// ---------------------------------------------------------------------------------------------- lifecycle
let quitting = false;
function quit(): void {
  if (quitting) return;
  quitting = true;
  globalShortcut.unregisterAll();
  void (async () => {
    try {
      await config.save();
      await fsp.mkdir(debugDir, { recursive: true });
      const body = `# PoE Price & Trade Checker — Session Log\n\n\`\`\`\n${sessionEvents.join("\n")}\n\`\`\`\n`;
      await fsp.writeFile(path.join(debugDir, "last_session.md"), body, "utf-8");
    } catch { /* the program is closing */ }
    app.exit(0);
  })();
}

if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWin) {
      if (mainWin.isMinimized()) mainWin.restore();
      mainWin.show();
      mainWin.focus();
    }
  });
  void app.whenReady().then(async () => {
    Menu.setApplicationMenu(null);
    const r = await importOldConfig(configDir, oldConfigDir, { defaults: CHECKER_DEFAULTS, marker: "imported-from-PoePriceTrade.txt" });
    if (r.message) importNote = r.message;
    fileLog("INFO", `config import: ${r.status}`);
    await config.load();
    game = cfgStr("game_version", "poe2") === "poe1" ? "poe1" : "poe2";
    dbs = makeDbs(game);
    const prof = profiles.profileFor(game);
    league = cfgStr("league") || prof.default_leagues[0] || "Standard";
    leagues = [...prof.default_leagues];
    if (!leagues.includes(league)) leagues.unshift(league);
    try {
      writeFileSync(path.join(configDir, "last_run.txt"), `v${VERSION}\n${new Date().toISOString()}\nfrozen=${app.isPackaged}\nbuild=${__BUILD_TIME__}\n`, "utf-8");
    } catch { /* not important */ }
    setupSession();
    setupIpc();
    say(`PoE Price & Trade Checker v${VERSION} — config: ${configDir}`, "info"); // the version marker first (CLAUDE.md rule 5)
    if (importNote) say(importNote, "info");
    const sz = screen.getPrimaryDisplay().size;
    say(`v${VERSION} · ${game.toUpperCase()} · league: ${league} · จอ ${sz.width}×${sz.height}`, "dim");
    say(`${cfgStr("hotkey_scan", "F4")} Skill Reference  |  ${cfgStr("hotkey_trade", "F5")} Trade browser  |  ${cfgStr("hotkey_quit", "Ctrl+Alt+Q")} Quit`, "dim");
    registerHotkeys();
    createMainWindow();
    void fetchLeagues(cfgBool("auto_league", true));
  });
  app.on("window-all-closed", () => quit());
  app.on("will-quit", () => globalShortcut.unregisterAll());
}
