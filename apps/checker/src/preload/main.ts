/** Preload of the main window: window.checker = the named calls of shared/api.ts (MainApi), nothing else. */
import { contextBridge, ipcRenderer } from "electron";
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
