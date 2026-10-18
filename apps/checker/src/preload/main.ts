/** Preload of the main window: window.checker = the named calls of shared/api.ts (MainApi), nothing else. */
import { contextBridge, ipcRenderer } from "electron";
import type { UpdateState, UpdaterApi } from "@poe/desktop/updater-api";
import type { GameId, Hotkeys, MainApi, Tag } from "../shared/api.ts";

const api: MainApi = {
  init: () => ipcRenderer.invoke("main:init"),
  openSettings: () => ipcRenderer.send("main:open-settings"),
  openFilter: () => ipcRenderer.send("main:open-filter"),
  setGame: (g: GameId) => ipcRenderer.send("main:set-game", g),
  setLeague: (l: string) => ipcRenderer.send("main:set-league", l),
  refreshLeagues: () => ipcRenderer.send("main:refresh-leagues"),
  onLog: (cb) => { ipcRenderer.on("main:log", (_e, text: string, tag: Tag) => cb(text, tag)); },
  onLeagues: (cb) => { ipcRenderer.on("main:leagues", (_e, leagues: string[], picked: string) => cb(leagues, picked)); },
  onGame: (cb) => { ipcRenderer.on("main:game", (_e, g: GameId) => cb(g)); },
  onHotkeys: (cb) => { ipcRenderer.on("main:hotkeys", (_e, hk: Hotkeys) => cb(hk)); },
};
contextBridge.exposeInMainWorld("checker", api);

// window.updater (the update banner). Written out here, not imported from @poe/desktop/preload: two preload files that share a module
// would be built with a shared chunk, and a sandboxed preload cannot load another file.
const updater: UpdaterApi = {
  get: () => ipcRenderer.invoke("upd:get"),
  onState: (cb) => { ipcRenderer.on("upd:state", (_e, s: UpdateState) => cb(s)); },
  install: () => ipcRenderer.send("upd:install"),
  openRelease: () => ipcRenderer.send("upd:open-release"),
};
contextBridge.exposeInMainWorld("updater", updater);
