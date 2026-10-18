/** Preload of the settings window: window.settings = the named calls of shared/api.ts (SettingsApi), nothing else. */
import { contextBridge, ipcRenderer } from "electron";
import type { SettingsApi } from "../shared/api.ts";

const api: SettingsApi = {
  init: () => ipcRenderer.invoke("settings:init"),
  check: (values) => ipcRenderer.invoke("settings:check", values),
  apply: (values) => ipcRenderer.invoke("settings:apply", values),
  cancel: () => ipcRenderer.send("settings:cancel"),
};
contextBridge.exposeInMainWorld("settings", api);
