/**
 * The preload (sandboxed) of a window that shows the filter page: the only bridge between the page and the main process. It exposes
 * `window.desktop` - the named calls of api.ts and nothing else (no ipcRenderer, no fs, no require).
 */
import { contextBridge, ipcRenderer } from "electron";
import type { DesktopApi, GameId, RegenRequest, RegenResult } from "./api.ts";
import type { CloseAction, TrayOptionApi } from "./about_api.ts";
import type { UpdateState, UpdaterApi } from "./updater_api.ts";

const call = (channel: string, ...args: unknown[]): Promise<any> => ipcRenderer.invoke(channel, ...args);

export function exposeDesktopApi(): void {
  const api: DesktopApi = {
    init: () => call("fg:init"),
    storeSet: (key, value) => ipcRenderer.send("fg:store-set", key, value),
    storeDel: (key) => ipcRenderer.send("fg:store-del", key),
    httpGet: (url, headers) => call("fg:http-get", url, headers),
    tradeNames: (game: GameId) => call("fg:names", game),

    folderInfo: (game) => call("fg:folder-info", game),
    pickFolder: (game) => call("fg:folder-pick", game),
    clearFolder: (game) => call("fg:folder-clear", game),
    listFilters: (game) => call("fg:fs-filters", game),
    listNames: (game) => call("fg:fs-names", game),
    fileExists: (game, name) => call("fg:fs-exists", game, name),
    readFile: async (game, name) => {
      const r = await call("fg:fs-read", game, name);
      if (!r.ok) throw new Error(r.message);
      return r.bytes;
    },
    writeFile: (game, name, bytes) => call("fg:fs-write", game, name, bytes),
    pickFilterFile: (game) => call("fg:file-pick", game),
    adoptPickedDir: (game) => call("fg:folder-adopt-picked", game),
    readLegacySound: (game, value) => call("fg:sound-legacy", game, value),

    onFlush: (cb) => {
      ipcRenderer.on("fg:flush", () => cb());
    },
    flushDone: () => ipcRenderer.send("fg:flush-done"),
    ready: () => ipcRenderer.send("fg:ready"),
    onRegen: (cb) => {
      ipcRenderer.on("fg:regen", (_e, req: RegenRequest) => {
        cb(req).then((r: RegenResult) => ipcRenderer.send("fg:regen-done", r), (e: unknown) => ipcRenderer.send("fg:regen-done", { ok: false, tag: null, message: String((e as Error)?.message ?? e) }));
      });
    },
  };
  contextBridge.exposeInMainWorld("desktop", api);
}

/** window.updater: what the update banner needs (the state, "restart to update", the release page) and nothing else. */
export function exposeUpdaterApi(): void {
  const api: UpdaterApi = {
    get: () => call("upd:get"),
    onState: (cb) => { ipcRenderer.on("upd:state", (_e, s: UpdateState) => cb(s)); },
    install: () => ipcRenderer.send("upd:install"),
    openRelease: () => ipcRenderer.send("upd:open-release"),
  };
  contextBridge.exposeInMainWorld("updater", api);
}

/** window.trayOption: what the X button does (the Filter Generator's About window). */
export function exposeTrayOptionApi(): void {
  const api: TrayOptionApi = {
    get: () => call("tray:get"),
    set: (action: CloseAction) => ipcRenderer.send("tray:set", action),
  };
  contextBridge.exposeInMainWorld("trayOption", api);
}
