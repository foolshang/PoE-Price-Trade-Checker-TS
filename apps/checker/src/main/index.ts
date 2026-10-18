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
import { baseDb, f5, filterService, hubClient, itemLang, league as leagueMod, metaDb, modBadge, modDb, neversinkSource, profiles, py, pyextra, skillRef, tradeUrl } from "@poe/core";
const { PyFloat } = py;
type PyFloat = InstanceType<typeof PyFloat>;
import type { HttpPort, models } from "@poe/core";
import { AppConfig, CHECKER_DEFAULTS, NodeFs, NodeHttp, PRICE_MODE_KEYS, importOldConfig } from "@poe/node";
import { isExternalLink } from "@poe/desktop/guard";
import { FilterHost } from "@poe/desktop/host";
import { testEnv } from "@poe/desktop/test-env";
import { ManagedUpdater } from "@poe/desktop/managed-updater";
import { TrayIcon, dotIcon } from "@poe/desktop/tray";
import type { Details, GameId, Hotkeys, MainInit, PickerFilter, SettingsErrors, SettingsInit, SettingsResult, SettingsValues, SkillDetail, Tag } from "../shared/api.ts";
import { checkHotkeys, parseHotkey } from "./hotkeys.ts";
import { MessageOverlay, OK_COLOR, WARN_COLOR } from "./overlay.ts";
import { NeverSinkWatcher } from "./regen.ts";
import { copyChord, keyName, readAdvancedKey } from "./game_keys.ts";
import { copyItemText } from "./item_copy.ts";
import { describeWindow, foregroundElevated, selfElevated, focusWindow, foregroundWindow, sendCopyChord, windowFacts } from "./native.ts";
import { gameOfWindow, onFront } from "./game_detect.ts";
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
// an error nobody caught: into log.txt (Electron would show a dialog and keep the process, and its hotkeys, alive)
process.on("uncaughtException", (e) => fileLog("ERROR", `uncaught exception: ${e?.stack ?? e}`));
process.on("unhandledRejection", (e) => fileLog("ERROR", `unhandled rejection: ${(e as Error)?.stack ?? e}`));

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
const importDetails: string[] = [];
let game: GameId = "poe2";
let league = "";
let leagues: string[] = [];
let mainWin: BrowserWindow | null = null;
let pickerWin: BrowserWindow | null = null;
let skillWin: BrowserWindow | null = null;
let settingsWin: BrowserWindow | null = null;
let filterWin: BrowserWindow | null = null; // the filter page the player sees
let regenWin: BrowserWindow | null = null; // the same page, not shown: generates in the background (auto-regenerate, the tray's Generate Now)
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

const filterHost = new FilterHost({
  config, configDir, version: VERSION, buildTime: __BUILD_TIME__, exeName: process.execPath, documentsDir: () => documentsDir(), log: fileLog,
  allow: (e) => [filterWin, regenWin].some((w) => w && !w.isDestroyed() && e.sender === w.webContents) && (e.senderFrame?.url ?? "").startsWith("app://local/"),
  importNote: () => importNote,
  // the game of the filter page is the game of the Checker (like the original's Filter Generator window)
  gameStore: { get: () => game, set: (g) => setGame(g, "filter") },
});

// updates of the program itself: the Releases of the Checker's own repo (public), channel "latest" (latest.yml); the feed is the one
// electron-builder wrote into the program. The player chooses what happens (see managed_updater.ts); a newer version raises the red dot.
const REPO_URL = "https://github.com/foolshang/PoE-Price-Trade-Checker-TS";
const updater = new ManagedUpdater({
  version: VERSION, isPackaged: app.isPackaged, exePath: process.execPath, channel: "latest",
  releasesUrl: `${REPO_URL}/releases/latest`, log: fileLog,
  autoDownload: () => cfgBool("auto_update", true),
  windows: () => (mainWin && !mainWin.isDestroyed() ? [mainWin] : []),
  allow: (e) => !!mainWin && !mainWin.isDestroyed() && e.sender === mainWin.webContents && (e.senderFrame?.url ?? "").startsWith("app://local/"),
  openExternal: (u) => void shell.openExternal(u),
  onFound: (version, notes) => noticeUpdate(version, notes),
  onInstallRequested: () => quit(), // (saves, closes, and the last step of quit() starts the installer)
});

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

function setGame(g: GameId, from: "main" | "settings" | "filter" | "auto" = "main"): void {
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
  if (from !== "main" && mainWin && !mainWin.isDestroyed() && ready) mainWin.webContents.send("main:game", g);
  if (from !== "filter" && filterWin && !filterWin.isDestroyed()) {
    const w = filterWin;
    void filterHost.flushPage(w).then(() => { if (!w.isDestroyed()) w.webContents.reloadIgnoringCache(); }); // the page follows the game
  }
  void fetchLeagues(cfgBool("auto_league", true));
}

// ---------------------------------------------------------------------------------------------- the game in front
// The program follows the game that is in front (option auto_game, on by default): when a PoE1 / PoE2 window comes to the front the game
// switches to it, and the key presses F4 / F5 use the game of the window they were pressed in. Polled once a second: one GetForegroundWindow
// call; the window is looked at (class, program path, title) only when it is a different one than a second ago.
const GAME_NAME: Record<GameId, string> = { poe1: "PoE 1", poe2: "PoE 2" };
let lastFront: GameId | null = null; // the game that was in front the last time a game was in front
let polledHwnd = 0n;
let polledGame: GameId | null = null;

const autoGameOn = (): boolean => cfgBool("auto_game", true);

function gameOfFront(fresh: boolean): GameId | null {
  let hwnd: bigint;
  try { hwnd = foregroundWindow(); } catch { return null; }
  if (!hwnd) return null;
  if (!fresh && hwnd === polledHwnd) return polledGame;
  try {
    const w = describeWindow(hwnd);
    polledHwnd = hwnd;
    polledGame = gameOfWindow(w);
    if (polledGame) fileLog("INFO", `game window in front: ${GAME_NAME[polledGame]} (class=${w.cls} title='${w.title}' exe='${w.exePath}')`);
  } catch (e) {
    fileLog("WARNING", `game in front: could not look at the window: ${(e as Error).message}`);
    polledGame = null;
  }
  return polledGame;
}

function followFront(front: GameId | null, why: string, force: boolean): void {
  const r = onFront(front, lastFront);
  lastFront = r.lastFront;
  const target = force ? front : r.switchTo;
  if (!target || target === game) return;
  say(`⇄ สลับเป็น ${GAME_NAME[target]} ตามเกมที่เปิดอยู่หน้าสุด${why ? ` (${why})` : ""} — โหลด league ใหม่`, "info");
  debugEvent(`auto game: ${game} -> ${target} (${why || "front window"})`);
  setGame(target, "auto");
}

/** F4 / F5: the game of the window the key was pressed in (a switch the poll has not made yet) */
function gameOfKeyPress(): void {
  if (!autoGameOn()) return;
  followFront(gameOfFront(true), "ตอนกดปุ่ม", true);
}

let gamePoll: NodeJS.Timeout | null = null;
function startGamePoll(): void {
  gamePoll = setInterval(() => {
    if (quitting || !autoGameOn()) return;
    try { followFront(gameOfFront(false), "", false); } catch (e) { fileLog("WARNING", `game poll: ${(e as Error).message}`); }
  }, Number(testEnv("POE_CHECKER_GAME_POLL_MS")) || 1000); // (the env value: tests only)
  gamePoll.unref();
}

// ---------------------------------------------------------------------------------------------- F5
let f5Busy = false;
const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const ADMIN_MSG = "⚠ Windows ไม่ให้โปรแกรมนี้ส่งปุ่ม Ctrl+C ไปที่เกม — เกมน่าจะรันแบบ Administrator: เปิดเกมแบบปกติ " +
  "หรือรันโปรแกรมนี้แบบ Administrator เหมือนเกม";

/** the Documents folder of the player (the game's settings are under it); POE_CHECKER_DOCUMENTS = a different one, for tests */
const documentsDir = (): string => testEnv("POE_CHECKER_DOCUMENTS") || app.getPath("documents");

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
  gameOfKeyPress();
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
    width: 680, height: 520, minWidth: 600, minHeight: 420, title: TITLE, icon: iconPath(), backgroundColor: "#1c1c1c", show: false,
    webPreferences: secureWebPreferences("main.cjs"),
  });
  hardenWindow(mainWin);
  // the About window has links (GitHub): the browser opens them, nothing opens inside the program
  mainWin.webContents.setWindowOpenHandler(({ url }) => {
    if (isExternalLink(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  mainWin.once("ready-to-show", () => mainWin?.show());
  // the X button: hide to the tray, or close the program. Only when the tray icon really exists is the window ever hidden - with no
  // tray there would be no way to bring it back (the original's rule)
  mainWin.on("close", (e) => {
    if (!quitting && !appQuitting && trayOk && cfgStr("close_action", "minimize") === "minimize") {
      e.preventDefault();
      hiddenToTray = true;
      mainWin?.hide();
    }
  });
  mainWin.on("focus", () => acknowledge());
  mainWin.on("minimize", () => {
    if (trayOk && !quitting && !appQuitting) {
      hiddenToTray = true;
      mainWin?.hide();
    }
  });
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
  win.webContents.once("did-finish-load", () => { if (!win.isDestroyed()) win.webContents.send("picker:init", pickerInit(result)); }); // (a second F5 may have replaced this popup already)
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
  gameOfKeyPress();
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

// ---------------------------------------------------------------------------------------------- tray, message over the game, NeverSink check
let trayOk = false;
let hiddenToTray = false; // the main window is hidden because of the X / minimize button
let appQuitting = false; // app.quit() was called (Windows shutdown, another program's close request): the windows must close then
const tray = new TrayIcon({
  items: [
    { label: "Show", click: () => showMain() },
    { label: "Generate Now", click: () => void generateNow() },
    { label: "Settings", click: () => { showMain(); openSettings(); } },
    "-",
    { label: "Quit", click: () => quit() },
  ],
  onClick: () => showMain(), iconPath: () => iconPath(), tip: "PoE Price & Trade Checker", disableEnv: "POE_CHECKER_NO_TRAY",
});
const overlayWin = new MessageOverlay({
  preload: path.join(__dirname, "../preload/overlay.cjs"), url: "app://local/overlay.html", iconPath: undefined, log: (m) => fileLog("WARNING", m),
});

function showMain(): void {
  if (!mainWin || mainWin.isDestroyed()) return;
  if (mainWin.isMinimized()) mainWin.restore();
  mainWin.show();
  mainWin.focus();
  hiddenToTray = false;
}

// ---- "something new" (a newer version, a NeverSink release): a red dot on the taskbar button and on the tray icon, like Discord's. The
// player opens the program (the tray, the taskbar, Show) and gets the details of everything that waits; the dot goes away.
let updateNotice: { version: string; notes: string } | null = null;
let neversinkNotice: string | null = null;
let dotOn = false;
let taskbarDot = false;

const mainSeen = (): boolean => !!mainWin && !mainWin.isDestroyed() && mainWin.isVisible() && !mainWin.isMinimized() && mainWin.isFocused();

function setDot(on: boolean): void {
  dotOn = on;
  tray.setPending(on);
  try {
    if (mainWin && !mainWin.isDestroyed()) {
      mainWin.setOverlayIcon(on ? dotIcon() : null, on ? "มีเรื่องใหม่" : "");
      taskbarDot = on;
    }
  } catch (e) {
    fileLog("WARNING", `taskbar overlay icon: ${(e as Error).message}`);
  }
}

/** something new happened: the dot goes on unless the player is looking at the window right now (the Status / the update strip show it) */
function raise(): void {
  if (mainSeen()) {
    updateNotice = null;
    neversinkNotice = null;
    return;
  }
  setDot(true);
}

/** the window got the focus (opened from the tray / the taskbar / Show): the details of what waited, then the dot goes */
function acknowledge(): void {
  if (!dotOn) return;
  const d: Details = {};
  if (updateNotice) d.update = updateNotice;
  if (neversinkNotice) d.neversink = neversinkNotice;
  updateNotice = null;
  neversinkNotice = null;
  setDot(false);
  if (mainWin && !mainWin.isDestroyed() && ready && (d.update || d.neversink)) mainWin.webContents.send("main:details", d);
}

function noticeUpdate(version: string, notes: string): void {
  updateNotice = { version, notes };
  say(`⬆ มีรุ่นใหม่ v${version} — กดปุ่มอัปเดตด้านบนของหน้าต่าง`, "info");
  tray.notify("PoE Price & Trade Checker", `มีรุ่นใหม่ v${version}`);
  raise();
}

/** the NeverSink-update notice: the Status, the tray (icon dot + balloon) and the message over the game */
let lastOverlayText = "";
function notifyNeverSink(msg: string, regenerated: boolean): void {
  lastOverlayText = msg;
  neversinkNotice = msg;
  say(msg, regenerated ? "ok" : "warn");
  tray.notify("PoE Price & Trade Checker", msg);
  raise();
  void overlayWin.show(msg, regenerated ? OK_COLOR : WARN_COLOR);
}

// ---- the filter page (the same page as the Filter Generator, in a window of its own)
const FILTER_TITLE = `PoE Price & Trade Checker — Filter Generator v${VERSION}`;

function createFilterWindow(visible: boolean): BrowserWindow {
  const win = new BrowserWindow({
    width: 1000, height: 920, minWidth: 720, minHeight: 560, title: FILTER_TITLE, icon: iconPath(), backgroundColor: "#141414", show: false,
    webPreferences: secureWebPreferences("filter.cjs"),
  });
  win.setMenu(null);
  win.on("page-title-updated", (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isExternalLink(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, url) => {
    if (!url.startsWith("app://local/")) {
      e.preventDefault();
      if (isExternalLink(url)) void shell.openExternal(url);
    }
  });
  filterHost.attach(win); // closing = the page saves what is in its boxes first
  win.webContents.on("console-message", (e) => {
    if (e.level === "error" || e.level === "warning") fileLog(e.level === "error" ? "ERROR" : "WARNING", `filter page (${visible ? "shown" : "background"}): ${e.message} [${e.sourceId}:${e.lineNumber}]`);
  });
  win.webContents.on("render-process-gone", (_e, d) => fileLog("ERROR", `filter page renderer gone: ${d.reason}`));
  win.webContents.on("did-fail-load", (_e, code, desc) => fileLog("ERROR", `filter page failed to load: ${code} ${desc}`));
  if (visible) win.once("ready-to-show", () => win.show());
  void win.loadURL("app://local/filter.html");
  return win;
}

function openFilterWindow(): void {
  if (filterWin && !filterWin.isDestroyed()) {
    if (filterWin.isMinimized()) filterWin.restore();
    filterWin.show();
    filterWin.focus();
    return;
  }
  if (regenWin && !regenWin.isDestroyed()) { // the page that works in the background is the one the player sees now
    filterWin = regenWin;
    regenWin = null;
    filterWin.show();
  } else filterWin = createFilterWindow(true);
  const win = filterWin;
  win.on("closed", () => {
    if (filterWin === win) filterWin = null;
  });
}

let regenChain: Promise<unknown> = Promise.resolve();
/** Generate through the filter page (shown or not): the same Generate as the button - sounds, game folder, byte-identical filter. */
function runGenerate(req: { mode: "tier" | "whitelist"; refresh: boolean }): Promise<{ ok: boolean; tag: string | null; message: string }> {
  const job = regenChain.then(async () => {
    let win = filterWin && !filterWin.isDestroyed() ? filterWin : regenWin && !regenWin.isDestroyed() ? regenWin : null;
    let temporary = false;
    if (!win) {
      win = regenWin = createFilterWindow(false);
      temporary = true;
    }
    try {
      if (!(await filterHost.waitReady(win))) return { ok: false, tag: null, message: "หน้า generate เปิดไม่ขึ้น" };
      const r = await filterHost.requestRegen(win, req);
      await filterHost.flushSave();
      return r;
    } finally {
      if (temporary && regenWin === win && !win.isDestroyed()) { // (still the hidden one: nobody opened it meanwhile)
        regenWin = null;
        win.destroy();
      }
    }
  });
  regenChain = job.catch(() => undefined);
  return job;
}

/** The tray's "Generate Now": the tab that was open last, like the original's. */
async function generateNow(): Promise<void> {
  const fg = filterHost.fg();
  const mode = fg.whitelist_enabled ? "whitelist" : "tier";
  say(`⟳ Generate filter (${game.toUpperCase()}, ${mode === "whitelist" ? "Whitelist" : "NeverSink"})…`, "info");
  const r = await runGenerate({ mode, refresh: false });
  say(r.ok ? "✓ Generate เสร็จแล้ว — reload filter ในเกม (Options → Game)" : `✗ Generate ไม่สำเร็จ${r.message ? `: ${r.message}` : ""} (เปิด Filter Generator เพื่อดูรายละเอียด)`, r.ok ? "ok" : "err");
}

const watcher = new NeverSinkWatcher({
  game: () => game,
  check: (g) => filterService.checkNeversinkUpdate(config, g, (gv) => neversinkSource.getLatestTag(gv, { http, warn: (m) => fileLog("WARNING", m) })),
  regenerate: async () => (await runGenerate({ mode: "tier", refresh: true })).ok,
  message: filterService.neversinkUpdateMessage,
  notify: notifyNeverSink,
  debug: debugEvent,
  warn: (m) => fileLog("WARNING", m),
}, Number(testEnv("POE_CHECKER_REGEN_FIRST_MS")) || undefined, Number(testEnv("POE_CHECKER_REGEN_EVERY_MS")) || undefined);

// ---- settings (F8)
const ARCHETYPES = ["all", "attack-melee", "attack-bow", "attack-crossbow", "spell-fire", "spell-cold", "spell-lightning", "spell-chaos", "spell-physical", "minion", "totem-trap-mine"];
const LOG_LEVELS = ["DEBUG", "INFO", "WARNING", "ERROR"];
const HOTKEY_FIELDS = ["hotkey_scan", "hotkey_trade", "hotkey_settings", "hotkey_quit"] as const;
type HotkeyField = (typeof HOTKEY_FIELDS)[number];
const HOTKEY_LABELS: Record<HotkeyField, string> = { hotkey_scan: "Skill Reference", hotkey_trade: "Trade Browser", hotkey_settings: "Settings", hotkey_quit: "Quit" };
const HOTKEY_DEFAULTS: Record<HotkeyField, string> = { hotkey_scan: "F4", hotkey_trade: "F5", hotkey_settings: "F8", hotkey_quit: "Ctrl+Alt+Q" };
const HOTKEY_WHAT: Record<HotkeyField, string> = { hotkey_scan: "F4 skill reference", hotkey_trade: "F5 trade", hotkey_settings: "settings", hotkey_quit: "quit" };

function currentSettings(): SettingsValues {
  return {
    game_version: game,
    auto_league: cfgBool("auto_league", true),
    prefer_hardcore: cfgBool("prefer_hardcore", false),
    mod_badge_archetype: ARCHETYPES.includes(cfgStr("mod_badge_archetype", "all")) ? cfgStr("mod_badge_archetype", "all") : "all",
    f5_restore_clipboard: cfgBool("f5_restore_clipboard", true),
    auto_game: autoGameOn(),
    auto_update: cfgBool("auto_update", true),
    hotkey_scan: cfgStr("hotkey_scan", "F4"),
    hotkey_trade: cfgStr("hotkey_trade", "F5"),
    hotkey_settings: cfgStr("hotkey_settings", "F8"),
    hotkey_quit: cfgStr("hotkey_quit", "Ctrl+Alt+Q"),
    log_level: LOG_LEVELS.includes(cfgStr("log_level", "INFO")) ? cfgStr("log_level", "INFO") : "INFO",
    close_action: cfgStr("close_action", "minimize") === "exit" ? "exit" : "minimize",
  };
}

/** what the settings window sent, made safe: anything unknown falls back to the current value (the window is ours, but be strict anyway) */
function cleanSettings(v: unknown): SettingsValues {
  const cur = currentSettings();
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const str = (k: keyof SettingsValues): string => (typeof o[k] === "string" ? (o[k] as string).slice(0, 80) : String(cur[k]));
  const bool = (k: keyof SettingsValues): boolean => (typeof o[k] === "boolean" ? (o[k] as boolean) : !!cur[k]);
  return {
    game_version: str("game_version") === "poe1" ? "poe1" : "poe2",
    auto_league: bool("auto_league"), prefer_hardcore: bool("prefer_hardcore"),
    mod_badge_archetype: ARCHETYPES.includes(str("mod_badge_archetype")) ? str("mod_badge_archetype") : "all",
    f5_restore_clipboard: bool("f5_restore_clipboard"),
    auto_game: bool("auto_game"),
    auto_update: bool("auto_update"),
    hotkey_scan: str("hotkey_scan"), hotkey_trade: str("hotkey_trade"), hotkey_settings: str("hotkey_settings"), hotkey_quit: str("hotkey_quit"),
    log_level: LOG_LEVELS.includes(str("log_level")) ? str("log_level") : "INFO",
    close_action: str("close_action") === "exit" ? "exit" : "minimize",
  };
}

function checkSettings(v: SettingsValues): SettingsErrors {
  return checkHotkeys({ values: v, order: [...HOTKEY_FIELDS], labels: HOTKEY_LABELS });
}

// ---- hotkeys
const HOTKEY_PROBLEM = (spec: string, what: string): string =>
  `ปุ่ม ${spec} (${what}) ถูกโปรแกรมอื่นจองอยู่ (เช่น PoE Price & Trade Checker ตัวเดิม) — ปิดโปรแกรมนั้น หรือเลือกปุ่มอื่น`;

const hotkeyActions: Record<HotkeyField, () => void> = {
  hotkey_scan: () => void onF4(),
  hotkey_trade: () => void onF5(),
  hotkey_settings: () => openSettings(),
  hotkey_quit: () => quit(),
};
let registered: Partial<Record<HotkeyField, string>> = {}; // field -> the hotkey registered for it (canonical text)

/** Register `specs` (field -> canonical text); the fields that could not be registered are returned with the reason. */
function registerAll(specs: Record<HotkeyField, string>): Partial<Record<HotkeyField, string>> {
  globalShortcut.unregisterAll();
  registered = {};
  const failed: Partial<Record<HotkeyField, string>> = {};
  for (const f of HOTKEY_FIELDS) {
    const p = parseHotkey(specs[f]);
    if (!p.ok) { failed[f] = p.reason; continue; }
    let ok = false;
    try {
      ok = globalShortcut.register(p.hotkey.accelerator, hotkeyActions[f]);
    } catch (e) {
      failed[f] = `ใช้ปุ่มนี้ไม่ได้: ${(e as Error).message}`;
      continue;
    }
    if (ok) {
      registered[f] = p.hotkey.canonical;
      fileLog("INFO", `hotkey ${p.hotkey.canonical} (${HOTKEY_WHAT[f]}) registered`);
    } else failed[f] = HOTKEY_PROBLEM(p.hotkey.canonical, HOTKEY_WHAT[f]);
  }
  return failed;
}

/** At start: the saved hotkeys. One that clashes with the game, is a duplicate or is no hotkey at all (a hand-edited or imported config) is replaced by its default, with a line saying so. */
function startHotkeys(): void {
  const saved = Object.fromEntries(HOTKEY_FIELDS.map((f) => [f, cfgStr(f, HOTKEY_DEFAULTS[f])])) as Record<HotkeyField, string>;
  const specs = { ...saved };
  const replaced = new Set<HotkeyField>();
  for (let round = 0; round < HOTKEY_FIELDS.length; round++) { // (the defaults are distinct, so every round removes one problem for good)
    const errs = checkHotkeys({ values: specs, order: [...HOTKEY_FIELDS], labels: HOTKEY_LABELS });
    const f = HOTKEY_FIELDS.find((x) => errs[x] && !replaced.has(x));
    if (!f) break;
    say(`⚠ ปุ่ม ${HOTKEY_LABELS[f]} ที่ตั้งไว้ (${saved[f]}) ใช้ไม่ได้: ${errs[f]} — ใช้ ${HOTKEY_DEFAULTS[f]} แทน`, "warn");
    specs[f] = HOTKEY_DEFAULTS[f];
    replaced.add(f);
  }
  const failed = registerAll(specs);
  for (const why of Object.values(failed)) say(`✗ ${why}`, "err");
}

function currentHotkeys(): Hotkeys {
  const r = (f: HotkeyField): string => registered[f] ?? cfgStr(f, HOTKEY_DEFAULTS[f]);
  return { scan: r("hotkey_scan"), trade: r("hotkey_trade"), settings: r("hotkey_settings"), quit: r("hotkey_quit") };
}

async function applySettings(raw: unknown): Promise<SettingsResult> {
  const v = cleanSettings(raw);
  const errors = checkSettings(v);
  if (Object.keys(errors).length) return { ok: false, errors };
  // the new hotkeys are taken at once; if the system refuses one, the old ones are put back and the window says which
  const specs = Object.fromEntries(HOTKEY_FIELDS.map((f) => [f, (parseHotkey(v[f]) as { ok: true; hotkey: { canonical: string } }).hotkey.canonical])) as Record<HotkeyField, string>;
  const before = { ...registered };
  const failed = registerAll(specs);
  if (Object.keys(failed).length) {
    registerAll(Object.fromEntries(HOTKEY_FIELDS.map((f) => [f, before[f] ?? HOTKEY_DEFAULTS[f]])) as Record<HotkeyField, string>);
    return { ok: false, errors: failed as SettingsErrors };
  }
  for (const f of HOTKEY_FIELDS) config.set(f, specs[f]);
  config.set("auto_league", v.auto_league);
  config.set("prefer_hardcore", v.prefer_hardcore);
  config.set("mod_badge_archetype", v.mod_badge_archetype);
  config.set("f5_restore_clipboard", v.f5_restore_clipboard);
  config.set("auto_game", v.auto_game);
  const autoUpdateChanged = cfgBool("auto_update", true) !== v.auto_update;
  config.set("auto_update", v.auto_update);
  if (autoUpdateChanged) updater.autoChanged();
  config.set("log_level", v.log_level);
  config.set("close_action", v.close_action);
  // (the settings window shows the game it was opened with: a game that followed the front window meanwhile is not switched back by a Save)
  if (v.game_version !== game && v.game_version !== settingsGameAtOpen) setGame(v.game_version, "settings");
  saveSoon();
  if (mainWin && !mainWin.isDestroyed() && ready) mainWin.webContents.send("main:hotkeys", currentHotkeys());
  say("✓ บันทึก settings แล้ว", "ok");
  debugEvent(`settings applied hotkeys=${JSON.stringify(registered)} close=${v.close_action} restoreClipboard=${v.f5_restore_clipboard}`);
  closeSettings();
  return { ok: true };
}

function closeSettings(): void {
  const w = settingsWin;
  settingsWin = null;
  if (w && !w.isDestroyed()) w.destroy();
}

let settingsGameAtOpen: GameId = game;
function openSettings(): void {
  if (settingsWin && !settingsWin.isDestroyed()) {
    if (settingsWin.isMinimized()) settingsWin.restore();
    settingsWin.show();
    settingsWin.focus();
    return;
  }
  const win = new BrowserWindow({
    width: 560, height: 430, useContentSize: true, title: "PoE Price & Trade Checker — Settings", icon: iconPath(), backgroundColor: "#1c1c1c",
    show: false, resizable: false, maximizable: false, minimizable: false, autoHideMenuBar: true, webPreferences: secureWebPreferences("settings.cjs"),
  });
  settingsWin = win;
  settingsGameAtOpen = game;
  hardenWindow(win);
  win.once("ready-to-show", () => win.show());
  win.on("closed", () => {
    if (settingsWin === win) settingsWin = null;
  });
  void win.loadURL("app://local/settings.html");
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
      hotkeys: currentHotkeys(), log: lines,
    };
  });
  ipcMain.on("main:set-game", (e, g: unknown) => {
    if (isFrom(e, mainWin) && (g === "poe1" || g === "poe2")) setGame(g);
  });
  ipcMain.on("main:open-settings", (e) => {
    if (isFrom(e, mainWin)) openSettings();
  });
  ipcMain.on("main:open-filter", (e) => {
    if (isFrom(e, mainWin)) openFilterWindow();
  });

  ipcMain.handle("settings:init", (e): SettingsInit | null => {
    if (!isFrom(e, settingsWin)) return null;
    return { values: currentSettings(), trayOk, version: VERSION, archetypes: ARCHETYPES, logLevels: LOG_LEVELS };
  });
  ipcMain.handle("settings:check", (e, v: unknown): SettingsErrors => (isFrom(e, settingsWin) ? checkSettings(cleanSettings(v)) : {}));
  ipcMain.handle("settings:apply", (e, v: unknown): Promise<SettingsResult> | SettingsResult => (isFrom(e, settingsWin) ? applySettings(v) : { ok: false, errors: {} }));
  ipcMain.on("settings:cancel", (e) => {
    if (isFrom(e, settingsWin)) closeSettings();
  });

  ipcMain.on("overlay:ready", (e, size: { width: number; height: number }) => {
    if (isFrom(e, overlayWin.window)) overlayWin.onReady(size);
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
    "connect-src 'self'; media-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
  session.defaultSession.webRequest.onHeadersReceived((details, cb) => {
    cb({ responseHeaders: { ...details.responseHeaders, "Content-Security-Policy": [csp] } });
  });
  // nothing is asked of the player: every permission is refused except writing text to the clipboard (the filter page's Copy button)
  session.defaultSession.setPermissionRequestHandler((_wc, perm, cb) => cb(perm === "clipboard-sanitized-write"));
  session.defaultSession.setPermissionCheckHandler((_wc, perm) => perm === "clipboard-sanitized-write");
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

// ---------------------------------------------------------------------------------------------- lifecycle
let quitting = false;
function quit(): void {
  if (quitting) return;
  quitting = true;
  fileLog("INFO", "quit: closing");
  setTimeout(() => app.exit(0), 6000).unref?.(); // (a program that cannot close is worse than one that closes a little rough)
  for (const step of [() => globalShortcut.unregisterAll(), () => watcher.stop(), () => updater.stop(), () => tray.stop(), () => overlayWin.destroy()]) {
    try { step(); } catch (e) { fileLog("WARNING", `quit step failed: ${(e as Error).message}`); }
  }
  void (async () => {
    try {
      await filterHost.flushSave();
      await config.save();
      await fsp.mkdir(debugDir, { recursive: true });
      const body = ["# PoE Price & Trade Checker — Session Log", "", "```", ...sessionEvents, "```", ""].join("\n");
      await fsp.writeFile(path.join(debugDir, "last_session.md"), body, "utf-8");
    } catch { /* the program is closing */ }
    fileLog("INFO", "quit: saved");
    if (!updater.installAtExit()) app.exit(0); // (a downloaded update is installed now; quitAndInstall quits by itself)
  })();
}

/** What the tests may look at and ask for (POE_CHECKER_TEST=1 only; nothing of this exists in a normal run). */
function exposeTestHooks(): void {
  if (process.env.POE_CHECKER_TEST !== "1") return;
  (globalThis as any).__poeChecker = {
    trayOk: () => trayOk,
    updaterMode: () => updater.currentMode,
    updaterState: () => updater.snapshot(),
    updaterInject: (s: any) => updater.inject(s),
    updaterCheck: () => updater.check(true),
    notifyUpdate: (v: string, notes: string) => noticeUpdate(v, notes),
    notifyNeverSink: (m: string) => notifyNeverSink(m, false),
    minimizeMain: () => mainWin?.minimize(),
    mainFocused: () => mainSeen(),
    dot: () => ({ tray: tray.pendingState, taskbar: taskbarDot, update: updateNotice, neversink: neversinkNotice }),
    trayPending: () => tray.pendingState,
    overlayText: () => lastOverlayText,
    quitting: () => quitting,
    hotkeys: () => ({ ...registered }),
    checkNeverSinkNow: () => watcher.runOnce(),
    overlay: () => overlayWin.window,
    showOverlay: (t: string, c: string) => overlayWin.show(t, c),
    filterWindows: () => ({ shown: filterWin && !filterWin.isDestroyed(), hidden: regenWin && !regenWin.isDestroyed() }),
    generateNow: () => generateNow(),
    hiddenToTray: () => hiddenToTray,
    mainVisible: () => !!mainWin && !mainWin.isDestroyed() && mainWin.isVisible(),
    showMain: () => showMain(),
    openFilter: () => openFilterWindow(),
    openSettings: () => openSettings(),
    game: () => game,
    lastFront: () => lastFront,
    pollNow: () => followFront(gameOfFront(false), "", false),
  };
}

if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => showMain());
  void app.whenReady().then(async () => {
    Menu.setApplicationMenu(null);
    const r = await importOldConfig(configDir, oldConfigDir, { defaults: CHECKER_DEFAULTS, marker: "imported-from-PoePriceTrade.txt" });
    if (r.message) importNote = r.message;
    fileLog("INFO", `config import: ${r.status}`);
    if (r.kept) importDetails.push(`ℹ นำเข้า ${r.kept.length} ค่า: ${r.kept.join(", ") || "-"}`);
    if (r.dropped?.length) {
      const price = r.dropped.filter((k) => PRICE_MODE_KEYS.includes(k));
      const other = r.dropped.filter((k) => !PRICE_MODE_KEYS.includes(k));
      importDetails.push(`ℹ ไม่นำเข้า (โหมดราคา/OCR ที่โปรแกรมนี้ไม่มี): ${price.join(", ") || "-"}${other.length ? ` · ไม่รู้จัก: ${other.join(", ")}` : ""}`);
    }
    await config.load();
    await filterHost.load();
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
    filterHost.register();
    say(`PoE Price & Trade Checker v${VERSION} — config: ${configDir}`, "info"); // the version marker first (CLAUDE.md rule 5)
    if (importNote) say(importNote, "info");
    for (const d of importDetails) say(d, "dim");
    const sz = screen.getPrimaryDisplay().size;
    say(`v${VERSION} · ${game.toUpperCase()} · league: ${league} · จอ ${sz.width}×${sz.height}`, "dim");
    startHotkeys();
    startGamePoll();
    const hk = currentHotkeys();
    say(`${hk.scan} Skill Reference  |  ${hk.trade} Trade browser  |  ${hk.settings} Settings  |  ${hk.quit} Quit`, "dim");
    createMainWindow();
    trayOk = tray.start();
    if (trayOk) fileLog("INFO", "tray icon created");
    else fileLog("WARNING", `tray icon unavailable (${tray.lastError}) - the X button closes the program`);
    watcher.start();
    updater.start();
    exposeTestHooks();
    void fetchLeagues(cfgBool("auto_league", true));
  });
  app.on("window-all-closed", () => quit());
  // app.quit() from anywhere (Windows shutdown, a test): do our own closing first (save, tray, log), it ends with app.exit
  app.on("before-quit", (e) => {
    appQuitting = true;
    if (!quitting) {
      e.preventDefault();
      quit();
    }
  });
  app.on("will-quit", () => globalShortcut.unregisterAll());
}
