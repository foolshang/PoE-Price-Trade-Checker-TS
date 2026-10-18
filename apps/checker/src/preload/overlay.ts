/** Preload of the message-over-the-game window: window.overlay = the named calls of shared/api.ts (OverlayApi), nothing else. */
import { contextBridge, ipcRenderer } from "electron";
import type { OverlayApi } from "../shared/api.ts";

const api: OverlayApi = {
  onShow: (cb) => { ipcRenderer.on("overlay:show", (_e, text: string, color: string) => cb(text, color)); },
  ready: (size) => ipcRenderer.send("overlay:ready", size),
};
contextBridge.exposeInMainWorld("overlay", api);
