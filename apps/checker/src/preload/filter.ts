/** Preload of the filter window: window.desktop = the named calls of @poe/desktop/api, nothing else (the update strip lives in the main window). */
import { exposeDesktopApi } from "@poe/desktop/preload";

exposeDesktopApi();
