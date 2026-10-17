/**
 * The preload (sandboxed): the only bridge between the page and the main process. It exposes `window.desktop` - the named
 * calls of shared/api.ts and nothing else (no ipcRenderer, no fs, no require).
 */
import { contextBridge, ipcRenderer } from "electron";
import type { DesktopApi, GameId } from "../shared/api.ts";

const call = (channel: string, ...args: unknown[]): Promise<any> => ipcRenderer.invoke(channel, ...args);

const api: DesktopApi = {
  init: () => call("init"),
  storeSet: (key, value) => ipcRenderer.send("store:set", key, value),
  storeDel: (key) => ipcRenderer.send("store:del", key),
  httpGet: (url, headers) => call("http:get", url, headers),
  tradeNames: (game: GameId) => call("names:get", game),

  folderInfo: (game) => call("folder:info", game),
  pickFolder: (game) => call("folder:pick", game),
  clearFolder: (game) => call("folder:clear", game),
  listFilters: (game) => call("fs:filters", game),
  listNames: (game) => call("fs:names", game),
  fileExists: (game, name) => call("fs:exists", game, name),
  readFile: async (game, name) => {
    const r = await call("fs:read", game, name);
    if (!r.ok) throw new Error(r.message);
    return r.bytes;
  },
  writeFile: (game, name, bytes) => call("fs:write", game, name, bytes),
  pickFilterFile: (game) => call("file:pick", game),
  adoptPickedDir: (game) => call("folder:adopt-picked", game),
  readLegacySound: (game, value) => call("sound:legacy", game, value),

  onFlush: (cb) => {
    ipcRenderer.on("app:flush", () => cb());
  },
  flushDone: () => ipcRenderer.send("app:flush-done"),
};

contextBridge.exposeInMainWorld("desktop", api);
