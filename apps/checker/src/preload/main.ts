/** Preload of the main window: window.checker = the named calls of shared/api.ts (MainApi), nothing else. */
import { contextBridge, ipcRenderer } from "electron";
import type { GameId, MainApi, Tag } from "../shared/api.ts";

const api: MainApi = {
  init: () => ipcRenderer.invoke("main:init"),
  setGame: (g: GameId) => ipcRenderer.send("main:set-game", g),
  setLeague: (l: string) => ipcRenderer.send("main:set-league", l),
  refreshLeagues: () => ipcRenderer.send("main:refresh-leagues"),
  onLog: (cb) => { ipcRenderer.on("main:log", (_e, text: string, tag: Tag) => cb(text, tag)); },
  onLeagues: (cb) => { ipcRenderer.on("main:leagues", (_e, leagues: string[], picked: string) => cb(leagues, picked)); },
};
contextBridge.exposeInMainWorld("checker", api);
