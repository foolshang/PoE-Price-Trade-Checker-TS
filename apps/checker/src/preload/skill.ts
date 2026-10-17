/** Preload of the skill reference window (F4): window.skillRef = SkillApi. */
import { contextBridge, ipcRenderer } from "electron";
import type { SkillApi } from "../shared/api.ts";

const api: SkillApi = {
  init: () => ipcRenderer.invoke("skill:init"),
  search: (prefix) => ipcRenderer.invoke("skill:search", prefix),
  select: (skillType, skill) => ipcRenderer.invoke("skill:select", skillType, skill),
  resize: (size) => ipcRenderer.send("skill:resize", size),
  ready: (size) => ipcRenderer.send("skill:ready", size),
  close: () => ipcRenderer.send("skill:close"),
};
contextBridge.exposeInMainWorld("skillRef", api);
