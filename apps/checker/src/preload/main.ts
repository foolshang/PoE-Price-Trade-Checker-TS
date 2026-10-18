/** Preload of the main window: window.checker = the named calls of shared/api.ts (MainApi), window.appUpdate = the update calls, nothing else. */
import { contextBridge, ipcRenderer } from "electron";
import type { AppUpdateApi, UpdateInfoState } from "@poe/desktop/update-api";
import type { Details, GameId, Hotkeys, MainApi, Tag } from "../shared/api.ts";

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
  onDetails: (cb) => { ipcRenderer.on("main:details", (_e, d: Details) => cb(d)); },
};
contextBridge.exposeInMainWorld("checker", api);

// window.appUpdate (the update strip). Written out here, not imported from @poe/desktop/preload: two preload files that share a module
// would be built with a shared chunk, and a sandboxed preload cannot load another file.
const appUpdate: AppUpdateApi = {
  get: () => ipcRenderer.invoke("au:get"),
  onState: (cb) => { ipcRenderer.on("au:state", (_e, s: UpdateInfoState) => cb(s)); },
  check: () => ipcRenderer.send("au:check"),
  installNow: () => ipcRenderer.send("au:install-now"),
  installOnExit: () => ipcRenderer.send("au:install-exit"),
  cancel: () => ipcRenderer.send("au:cancel"),
  retry: () => ipcRenderer.send("au:retry"),
  openRelease: () => ipcRenderer.send("au:open-release"),
};
contextBridge.exposeInMainWorld("appUpdate", appUpdate);
