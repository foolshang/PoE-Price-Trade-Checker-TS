/** Preload of the filter window: window.desktop = the named calls of @poe/desktop/api, nothing else. */
import { exposeDesktopApi } from "@poe/desktop/preload";

exposeDesktopApi();
