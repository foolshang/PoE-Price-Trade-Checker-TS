/** Preload of the mod picker window (F5): window.picker = PickerApi. */
import { contextBridge, ipcRenderer } from "electron";
import type { PickerApi } from "../shared/api.ts";

const api: PickerApi = {
  onInit: (cb) => { ipcRenderer.on("picker:init", (_e, data) => cb(data)); },
  ready: (size) => ipcRenderer.send("picker:ready", size),
  search: (filters) => ipcRenderer.send("picker:search", filters),
  cancel: () => ipcRenderer.send("picker:cancel"),
};
contextBridge.exposeInMainWorld("picker", api);
