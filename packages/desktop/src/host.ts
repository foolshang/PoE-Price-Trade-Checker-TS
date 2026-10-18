/**
 * The main-process side of the filter page (the page of @poe/ui running in a window of an Electron app). Shared by the Filter
 * Generator and the Checker: it owns the config's `filter_gen`, the game folders, the network for the few allowed hosts and the
 * flush-before-close handshake. The page can only call what preload.ts exposes; every call arrives here, is checked, and answered.
 *
 * Paths never come from the page: the host knows the game folder of each game (the default or the folder the player picked with
 * Browse...) and takes file NAMES.
 */
import { BrowserWindow, dialog, ipcMain, net } from "electron";
import type { IpcMainEvent, IpcMainInvokeEvent } from "electron";
import { promises as fsp } from "node:fs";
import path from "node:path";
import { filterOutput, filterService, tradeNames } from "@poe/core";
import type { HttpPort } from "@poe/core";
import { AppConfig, NodeFs, NodeHttp } from "@poe/node";
import type { FilterFileInfo, GameId, InitData, RegenRequest, RegenResult } from "./api.ts";
import { MAX_FILE_BYTES, cleanHeaders, collectSoundPaths, enforceGameDirs, isAllowedName, isAllowedUrl, isGame } from "./guard.ts";

export const KEY_CFG = "poeFilterGen.cfg";
export const KEY_GAME = "poeFilterGen.game";
const NS_PREFIX = "poeFilterGen.ns.";

export interface FilterHostOptions {
  config: AppConfig;
  configDir: string;
  version: string;
  buildTime: string;
  /** the full path of the exe: the Controlled Folder Access message names it */
  exeName: string;
  documentsDir: () => string;
  log: (level: string, msg: string) => void;
  /** true when the message comes from a page this host serves (the app:// page of one of its windows) */
  allow: (e: IpcMainEvent | IpcMainInvokeEvent) => boolean;
  /** what the first start did with the original program's config */
  importNote?: () => string;
  /** where the page's choice of game lives (default: `filter_gen.standalone_game`, the Filter Generator's own memory) */
  gameStore?: { get(): GameId | null; set(g: GameId): void };
}

const bad = (m: string): { ok: false; message: string } => ({ ok: false, message: m });

export class FilterHost {
  private readonly nodeFs = new NodeFs();
  private approved: Record<string, string> = { poe1: "", poe2: "" }; // the game_dir_<game> values the page may keep
  private soundPaths = new Set<string>(); // paths of the original program's sounds named in the config
  private uiStore: Record<string, string> = {}; // the NeverSink cache and other keys that are not the settings
  private readonly cacheFile: string;
  private cacheDirty = false;
  private saveTimer: NodeJS.Timeout | null = null;
  private lastPicked: { game: GameId; dir: string } | null = null;
  private registered = false;
  private regenWaiters = new Map<number, (r: RegenResult) => void>();
  private readyWaiters = new Map<number, () => void>();
  private readyWins = new Set<number>();
  private flushWaiters = new Map<number, () => void>();

  constructor(private readonly o: FilterHostOptions) {
    this.cacheFile = path.join(o.configDir, "cache", "ui-store.json");
  }

  private http(timeoutMs = 20000): HttpPort {
    return new NodeHttp(timeoutMs, net.fetch as typeof fetch);
  }

  /** The `filter_gen` dict of the config. */
  fg(): Record<string, any> {
    const v = this.o.config.get("filter_gen", {});
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  }

  private gameGet(): GameId | null {
    if (this.o.gameStore) return this.o.gameStore.get();
    const g = this.fg().standalone_game;
    return g === "poe1" || g === "poe2" ? g : null;
  }

  private gameSet(g: GameId): void {
    if (this.o.gameStore) this.o.gameStore.set(g);
    else this.o.config.set("filter_gen", { ...this.fg(), standalone_game: g });
  }

  /** Call after the config is loaded (and again after it changed on disk). */
  async load(): Promise<void> {
    this.approved = { poe1: String(this.fg().game_dir_poe1 || ""), poe2: String(this.fg().game_dir_poe2 || "") };
    this.soundPaths = collectSoundPaths(this.fg());
    try {
      this.uiStore = JSON.parse(await fsp.readFile(this.cacheFile, "utf-8"));
    } catch {
      this.uiStore = {};
    }
  }

  scheduleSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => void this.flushSave(), 300);
  }

  async flushSave(): Promise<void> {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = null;
    try {
      await this.o.config.save();
      if (this.cacheDirty) {
        this.cacheDirty = false;
        await fsp.mkdir(path.dirname(this.cacheFile), { recursive: true });
        await fsp.writeFile(this.cacheFile, JSON.stringify(this.uiStore), "utf-8");
      }
    } catch (e) {
      this.o.log("WARNING", `save failed: ${(e as Error).message}`);
    }
  }

  /** The settings the page reads (poeFilterGen.cfg) = filter_gen without the remembered game. */
  private cfgForPage(): string {
    const { standalone_game: _g, ...rest } = this.fg();
    return JSON.stringify(rest);
  }

  gameDir(game: GameId): string {
    return filterOutput.gameFilterDir(this.nodeFs, this.o.documentsDir(), game, this.approved[game] || "");
  }

  // ---------------------------------------------------------------------------------------------- ipc
  private handle(channel: string, fn: (e: IpcMainInvokeEvent, ...args: any[]) => unknown): void {
    ipcMain.handle(channel, (e, ...args) => {
      if (!this.o.allow(e)) throw new Error("blocked sender");
      return fn(e, ...args);
    });
  }

  private on(channel: string, fn: (e: IpcMainEvent, ...args: any[]) => void): void {
    ipcMain.on(channel, (e, ...args) => {
      if (this.o.allow(e)) fn(e, ...args);
    });
  }

  register(): void {
    if (this.registered) return;
    this.registered = true;
    const o = this.o;
    const parent = (e: IpcMainInvokeEvent): BrowserWindow | null => BrowserWindow.fromWebContents(e.sender);

    this.handle("fg:init", async (): Promise<InitData> => {
      const store: Record<string, string> = { ...this.uiStore, [KEY_CFG]: this.cfgForPage() };
      const g = this.gameGet();
      if (g) store[KEY_GAME] = g;
      return { version: o.version, buildTime: o.buildTime, exeName: o.exeName, configDir: o.configDir, store, importNote: o.importNote?.() ?? "" };
    });

    this.on("fg:store-set", (_e, key: unknown, value: unknown) => {
      if (typeof key !== "string" || typeof value !== "string" || value.length > 40 * 1024 * 1024) return;
      if (key === KEY_CFG) {
        let parsed: unknown;
        try {
          parsed = JSON.parse(value);
        } catch {
          return;
        }
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return;
        const clean = enforceGameDirs(parsed as Record<string, any>, this.approved);
        const keep = this.fg().standalone_game;
        o.config.set("filter_gen", keep === undefined ? { ...clean } : { ...clean, standalone_game: keep });
      } else if (key === KEY_GAME) {
        if (value === "poe1" || value === "poe2") this.gameSet(value);
      } else if (key.startsWith(NS_PREFIX)) {
        this.uiStore[key] = value;
        this.cacheDirty = true;
      } else return;
      this.scheduleSave();
    });
    this.on("fg:store-del", (_e, key: unknown) => {
      if (typeof key === "string" && key.startsWith(NS_PREFIX) && key in this.uiStore) {
        delete this.uiStore[key];
        this.cacheDirty = true;
        this.scheduleSave();
      }
    });

    this.handle("fg:http-get", async (_e, url: unknown, headers: unknown) => {
      if (!isAllowedUrl(url)) return { ok: false, status: 0, text: "blocked address" };
      try {
        const res = await net.fetch(url as string, { headers: cleanHeaders(headers), signal: AbortSignal.timeout(20000) });
        if (!res.ok) return { ok: false, status: res.status, text: "" };
        const buf = await res.arrayBuffer();
        if (buf.byteLength > 40 * 1024 * 1024) return { ok: false, status: 0, text: "response too large" };
        return { ok: true, status: res.status, text: new TextDecoder("utf-8").decode(buf) };
      } catch (e) {
        return { ok: false, status: 0, text: (e as Error).message };
      }
    });

    this.handle("fg:names", async (_e, game: unknown) => {
      if (!isGame(game)) return null;
      try {
        const names = await tradeNames.getNames(game, path.join(o.configDir, "cache"), {
          fs: this.nodeFs, http: this.http(), now: () => Date.now() / 1000, warn: (m: string) => o.log("WARNING", m),
        });
        return [...names];
      } catch (e) {
        o.log("WARNING", `trade names: ${(e as Error).message}`);
        return null;
      }
    });

    this.handle("fg:folder-info", async (_e, game: unknown) => {
      if (!isGame(game)) return null;
      const dir = this.gameDir(game);
      return { dir, exists: await this.nodeFs.isDir(dir), isOverride: !!this.approved[game] };
    });

    this.handle("fg:folder-pick", async (e, game: unknown) => {
      const win = parent(e);
      if (!isGame(game) || !win) return null;
      const start = this.gameDir(game);
      const r = await dialog.showOpenDialog(win, {
        title: "เลือกโฟลเดอร์ filter ของเกม", defaultPath: (await this.nodeFs.isDir(start)) ? start : o.documentsDir(), properties: ["openDirectory", "createDirectory"],
      });
      if (r.canceled || !r.filePaths[0]) return null;
      this.approved[game] = r.filePaths[0];
      o.log("INFO", `game folder override ${game}: ${this.approved[game]}`);
      return { dir: this.approved[game], name: path.basename(this.approved[game]) || this.approved[game] };
    });

    this.handle("fg:folder-clear", (_e, game: unknown) => {
      if (isGame(game)) this.approved[game] = "";
    });

    this.handle("fg:fs-filters", async (_e, game: unknown): Promise<FilterFileInfo[]> => {
      if (!isGame(game)) return [];
      const dir = this.gameDir(game);
      const out: FilterFileInfo[] = [];
      let names: string[] = [];
      try {
        names = await fsp.readdir(dir);
      } catch {
        return [];
      }
      for (const name of names) {
        if (!/\.filter$/i.test(name) || !isAllowedName(name)) continue;
        const p = path.join(dir, name);
        try {
          const st = await fsp.stat(p);
          if (!st.isFile()) continue;
          const fh = await fsp.open(p, "r");
          try {
            const buf = Buffer.alloc(Math.min(2400, st.size));
            await fh.read(buf, 0, buf.length, 0);
            out.push({ name, size: st.size, head: buf.toString("utf-8").slice(0, 600) });
          } finally {
            await fh.close();
          }
        } catch { /* unreadable: not listed */ }
      }
      return out;
    });

    this.handle("fg:fs-names", async (_e, game: unknown): Promise<string[]> => {
      if (!isGame(game)) return [];
      const dir = this.gameDir(game);
      try {
        const out: string[] = [];
        for (const ent of await fsp.readdir(dir, { withFileTypes: true })) if (ent.isFile()) out.push(ent.name);
        return out;
      } catch {
        return [];
      }
    });

    this.handle("fg:fs-exists", async (_e, game: unknown, name: unknown) => isGame(game) && isAllowedName(name) && (await this.nodeFs.isFile(path.join(this.gameDir(game), name))));

    this.handle("fg:fs-read", async (_e, game: unknown, name: unknown) => {
      if (!isGame(game) || !isAllowedName(name)) return bad("ชื่อไฟล์ไม่ถูกต้อง");
      try {
        const buf = await fsp.readFile(path.join(this.gameDir(game), name));
        return { ok: true, bytes: new Uint8Array(buf) };
      } catch (e) {
        return bad(`อ่านไฟล์ ${name} ไม่ได้: ${(e as Error).message}`);
      }
    });

    this.handle("fg:fs-write", async (_e, game: unknown, name: unknown, bytes: unknown) => {
      if (!isGame(game) || !isAllowedName(name)) return bad("ชื่อไฟล์ไม่ถูกต้อง");
      if (!(bytes instanceof Uint8Array) || bytes.byteLength > MAX_FILE_BYTES) return bad("ข้อมูลไฟล์ไม่ถูกต้อง");
      const dir = this.gameDir(game);
      try {
        await fsp.mkdir(dir, { recursive: true });
        await fsp.writeFile(path.join(dir, name), bytes);
        return { ok: true };
      } catch (e) {
        o.log("WARNING", `write failed ${name}: ${(e as Error).message}`);
        return bad(filterService.writeFailMsg(e, dir, o.exeName));
      }
    });

    this.handle("fg:file-pick", async (e, game: unknown) => {
      const win = parent(e);
      if (!isGame(game) || !win) return null;
      const start = this.gameDir(game);
      const r = await dialog.showOpenDialog(win, {
        title: "เปิด filter", defaultPath: (await this.nodeFs.isDir(start)) ? start : o.documentsDir(),
        properties: ["openFile"], filters: [{ name: "Path of Exile filter", extensions: ["filter"] }],
      });
      if (r.canceled || !r.filePaths[0]) return null;
      const p = r.filePaths[0];
      const st = await fsp.stat(p);
      if (!st.isFile() || st.size > MAX_FILE_BYTES) return null;
      this.lastPicked = { game, dir: path.dirname(p) };
      return { name: path.basename(p), bytes: new Uint8Array(await fsp.readFile(p)), dir: path.dirname(p) };
    });

    this.handle("fg:folder-adopt-picked", (_e, game: unknown) => {
      if (!isGame(game) || !this.lastPicked || this.lastPicked.game !== game) return null;
      const dir = this.lastPicked.dir;
      this.lastPicked = null;
      if (path.resolve(dir).toLowerCase() === path.resolve(this.gameDir(game)).toLowerCase()) return null; // already there
      this.approved[game] = dir;
      o.log("INFO", `game folder follows the opened file ${game}: ${dir}`);
      return { dir, name: path.basename(dir) || dir };
    });

    this.handle("fg:sound-legacy", async (_e, game: unknown, value: unknown) => {
      if (!isGame(game) || typeof value !== "string" || !value) return null;
      const base = path.win32.basename(value);
      if (!isAllowedName(base)) return null;
      const candidates: string[] = [];
      if (this.soundPaths.has(value)) candidates.push(value); // exactly a path the config itself holds
      candidates.push(path.join(this.gameDir(game), base), path.join(this.gameDir(game === "poe1" ? "poe2" : "poe1"), base));
      for (const p of candidates) {
        try {
          const st = await fsp.stat(p);
          if (st.isFile() && st.size <= MAX_FILE_BYTES) return { name: base, bytes: new Uint8Array(await fsp.readFile(p)) };
        } catch { /* next */ }
      }
      return null;
    });

    this.on("fg:flush-done", (e) => {
      this.flushWaiters.get(e.sender.id)?.();
      this.flushWaiters.delete(e.sender.id);
    });

    this.on("fg:ready", (e) => {
      this.readyWins.add(e.sender.id);
      this.readyWaiters.get(e.sender.id)?.();
      this.readyWaiters.delete(e.sender.id);
    });

    this.on("fg:regen-done", (e, r: unknown) => {
      const done = this.regenWaiters.get(e.sender.id);
      if (!done) return;
      this.regenWaiters.delete(e.sender.id);
      const v = (r && typeof r === "object" ? r : {}) as Partial<RegenResult>;
      done({ ok: v.ok === true, tag: typeof v.tag === "string" ? v.tag : null, message: typeof v.message === "string" ? v.message.slice(0, 500) : "" });
    });
  }

  // ---------------------------------------------------------------------------------------------- windows
  /** Ask the page of `win` to save what is in its boxes and wait for its answer (a page that does not answer is not waited for longer than 1.5 s). */
  flushPage(win: BrowserWindow): Promise<void> {
    return new Promise((resolve) => {
      if (win.isDestroyed()) return resolve();
      const id = win.webContents.id;
      const timer = setTimeout(() => {
        this.flushWaiters.delete(id);
        resolve();
      }, 1500);
      this.flushWaiters.set(id, () => {
        clearTimeout(timer);
        resolve();
      });
      win.webContents.send("fg:flush");
    });
  }

  /** Closing a window of the page: the page saves what is in its boxes first, then the config is saved, then the window goes. */
  /** `veto` is asked first when the window is about to close: true = the app dealt with it (it hid the window), nothing is closed or flushed */
  attach(win: BrowserWindow, veto?: () => boolean): void {
    const wcId = win.webContents.id;
    let closing = false;
    win.on("close", (e) => {
      if (closing) return;
      if (veto?.()) {
        e.preventDefault();
        return;
      }
      e.preventDefault();
      closing = true;
      void this.flushPage(win).then(async () => {
        await this.flushSave();
        if (!win.isDestroyed()) win.destroy();
      });
    });
    win.on("closed", () => {
      this.regenWaiters.delete(wcId);
      this.readyWaiters.delete(wcId);
      this.readyWins.delete(wcId);
      this.flushWaiters.delete(wcId);
    });
  }

  /** Resolves true when the page of `win` is up (has registered for regenerate requests), false after `timeoutMs`. */
  waitReady(win: BrowserWindow, timeoutMs = 60000): Promise<boolean> {
    const id = win.webContents.id;
    if (this.readyWins.has(id)) return Promise.resolve(true);
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.readyWaiters.delete(id);
        resolve(false);
      }, timeoutMs);
      this.readyWaiters.set(id, () => {
        clearTimeout(timer);
        resolve(true);
      });
    });
  }

  /** Ask the page of `win` to generate; resolves when it answers (or after `timeoutMs`). */
  requestRegen(win: BrowserWindow, req: RegenRequest, timeoutMs = 10 * 60 * 1000): Promise<RegenResult> {
    return new Promise((resolve) => {
      if (win.isDestroyed()) return resolve({ ok: false, tag: null, message: "หน้า generate ถูกปิดไปแล้ว" });
      const id = win.webContents.id;
      const timer = setTimeout(() => {
        this.regenWaiters.delete(id);
        resolve({ ok: false, tag: null, message: "หมดเวลารอหน้า generate" });
      }, timeoutMs);
      this.regenWaiters.set(id, (r) => {
        clearTimeout(timer);
        resolve(r);
      });
      win.webContents.send("fg:regen", req);
    });
  }
}
