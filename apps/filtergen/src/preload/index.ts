/** The preload of the Filter Generator window: window.desktop = the named calls of @poe/desktop/api, window.updater = the update banner's, nothing else. */
import { exposeDesktopApi, exposeTrayOptionApi, exposeUpdaterApi } from "@poe/desktop/preload";

exposeDesktopApi();
exposeUpdaterApi();
exposeTrayOptionApi();
