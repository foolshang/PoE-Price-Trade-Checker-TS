/**
 * Updates of the program itself (electron-updater, GitHub Releases). Rules:
 *  - the check runs a little after the start (not while the window is still opening) and then every 6 hours;
 *  - a newer release is downloaded in the background; the player is TOLD (the banner of the window and the log), and the program is
 *    never closed on its own: the new version is installed when the player closes the program, or when he clicks "restart to update";
 *  - a release with a "-" in its version (beta, rc) is skipped - unless this copy is itself a beta (testers follow the betas);
 *  - the zip copy cannot update itself (it is not installed): it only says that a newer release exists, with the link;
 *  - a network that is down, a broken file (the checksum in latest.yml does not match) or anything else is a line in the log and
 *    nothing more: the program keeps running as it is.
 * The feed is the one electron-builder wrote into the program (resources/app-update.yml); POE_UPDATE_FEED=<url> replaces it (tests).
 */
import { testEnv } from "./test_env.ts";
import { ipcMain } from "electron";
import type { BrowserWindow, IpcMainEvent, IpcMainInvokeEvent } from "electron";
import { readdirSync } from "node:fs";
import path from "node:path";
import { autoUpdater } from "electron-updater";
import type { UpdateInfo } from "electron-updater";
import { notesToText } from "./changelog.ts";
import type { UpdateState } from "./updater_api.ts";
import { decideOffer, isPrerelease } from "./updater_logic.ts";

export const CHECK_EVERY_MS = 6 * 3600 * 1000;
export const FIRST_CHECK_MS = 20_000;

export interface AppUpdaterOptions {
  version: string;
  isPackaged: boolean;
  exePath: string;
  /** the feed channel of this program ("latest" -> latest.yml) */
  channel: string;
  /** where a person gets the release by hand */
  releasesUrl: string;
  log: (level: string, msg: string) => void;
  windows: () => BrowserWindow[];
  allow: (e: IpcMainEvent | IpcMainInvokeEvent) => boolean;
  openExternal: (url: string) => void;
  /** called when "restart to update" is clicked: save and close the program, then call `installNow` (default: install at once) */
  onInstallRequested?: () => void;
}

/** Is this copy one the installer made (it has its uninstaller next to the exe)? The zip copy has not. */
export function installedByInstaller(exePath: string): boolean {
  try {
    return readdirSync(path.dirname(exePath)).some((f) => /^Uninstall .*\.exe$/i.test(f));
  } catch {
    return false;
  }
}

export class AppUpdater {
  private state: UpdateState = { kind: "idle" };
  private timer: NodeJS.Timeout | null = null;
  private checking = false;
  private downloaded = false;
  private readonly mode: "installer" | "manual" | "off";
  private readonly feed = testEnv("POE_UPDATE_FEED") || "";

  constructor(private readonly o: AppUpdaterOptions) {
    const packaged = o.isPackaged || !!this.feed;
    this.mode = !packaged ? "off" : installedByInstaller(o.exePath) ? "installer" : "manual"; // (a feed in POE_UPDATE_FEED does not make a zip copy an installed one)
    const ask = (e: IpcMainInvokeEvent | IpcMainEvent): boolean => o.allow(e);
    ipcMain.handle("upd:get", (e) => (ask(e) ? this.state : { kind: "idle" }));
    ipcMain.on("upd:install", (e) => {
      if (ask(e)) this.requestInstall();
    });
    ipcMain.on("upd:open-release", (e) => {
      if (ask(e)) o.openExternal(o.releasesUrl);
    });

    if (this.mode === "off") return;
    const u = autoUpdater;
    u.autoDownload = false; // (the check decides first: a pre-release is not downloaded)
    u.autoInstallOnAppQuit = false; // (the program does it itself at the end of its own closing: see installAtExit)
    u.allowPrerelease = isPrerelease(o.version);
    u.allowDowngrade = false;
    // (u.channel stays unset: electron-updater also reads it as the NAME OF THE PRE-RELEASE LINE, and a value like "latest" hides every
    // pre-release from a beta copy. The name of the .yml comes from app-update.yml (written at build time) or from the feed override below.)
    u.logger = {
      info: (m: unknown) => o.log("INFO", `updater: ${String(m)}`),
      warn: (m: unknown) => o.log("WARNING", `updater: ${String(m)}`),
      error: (m: unknown) => o.log("WARNING", `updater: ${String(m)}`),
      debug: () => {},
    } as never;
    if (this.feed) u.setFeedURL({ provider: "generic", url: this.feed, channel: o.channel });
    u.on("update-available", (info: UpdateInfo) => this.onAvailable(info));
    u.on("update-not-available", () => this.set({ kind: "idle" }));
    u.on("download-progress", (p: { percent: number }) => this.set({ kind: "downloading", version: this.state.version, percent: Math.round(p.percent), notes: this.state.notes }, false));
    u.on("update-downloaded", (info: UpdateInfo) => {
      this.downloaded = true;
      this.set({ kind: "ready", version: info.version, notes: this.state.notes });
      o.log("INFO", `updater: ${info.version} downloaded - installed when the program is closed`);
    });
    u.on("error", (e: Error) => this.fail(e));
  }

  get currentMode(): "installer" | "manual" | "off" {
    return this.mode;
  }

  get current(): UpdateState {
    return this.state;
  }

  /** a downloaded update waits for the end of the program */
  get readyToInstall(): boolean {
    return this.downloaded;
  }

  /** Start checking: once after `firstMs`, then every 6 hours. */
  start(firstMs = Number(testEnv("POE_UPDATE_FIRST_MS")) || FIRST_CHECK_MS): void {
    if (this.mode === "off") {
      this.o.log("INFO", "updater: off (not an installed program)");
      return;
    }
    this.o.log("INFO", `updater: ${this.mode} mode, channel ${this.o.channel}${this.feed ? `, feed ${this.feed}` : ""}`);
    this.arm(firstMs);
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private arm(ms: number): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.check(), ms);
    this.timer.unref?.();
  }

  /** One check now. Never throws; the next one is always scheduled. */
  async check(): Promise<void> {
    if (this.mode === "off" || this.checking || this.downloaded) {
      if (this.mode !== "off") this.arm(Number(testEnv("POE_UPDATE_EVERY_MS")) || CHECK_EVERY_MS);
      return;
    }
    this.checking = true;
    try {
      await autoUpdater.checkForUpdates();
    } catch (e) {
      this.fail(e as Error);
    } finally {
      this.checking = false;
      this.arm(Number(testEnv("POE_UPDATE_EVERY_MS")) || CHECK_EVERY_MS);
    }
  }

  private onAvailable(info: UpdateInfo): void {
    const what = decideOffer(this.o.version, info.version, this.mode === "manual" ? "manual" : "installer");
    if (what === "skip-prerelease") {
      this.o.log("INFO", `updater: ${info.version} is a pre-release - skipped`);
      this.set({ kind: "idle" });
      return;
    }
    if (what === "manual") {
      this.set({ kind: "manual", version: info.version, url: this.o.releasesUrl, notes: notesToText(info.releaseNotes) });
      this.o.log("INFO", `updater: ${info.version} exists (this copy is not installed, it cannot update itself): ${this.o.releasesUrl}`);
      return;
    }
    this.o.log("INFO", `updater: ${info.version} is available - downloading`);
    this.set({ kind: "downloading", version: info.version, percent: 0, notes: notesToText(info.releaseNotes) });
    autoUpdater.downloadUpdate().catch((e: Error) => this.fail(e));
  }

  private fail(e: Error): void {
    this.o.log("WARNING", `updater: ${e?.message ?? e}`);
    // a download that failed is not a reason to bother the player; the next check tries again
    this.set({ kind: "error", message: String(e?.message ?? e).slice(0, 300) });
  }

  private set(s: UpdateState, log = true): void {
    this.state = s;
    for (const w of this.o.windows()) {
      try {
        if (!w.isDestroyed()) w.webContents.send("upd:state", s);
      } catch { /* a window that is going away */ }
    }
    void log;
  }

  /** For tests: make the windows believe in a state. */
  inject(s: UpdateState): void {
    this.set(s);
  }

  /** "Restart to update" was clicked: the program closes itself the usual way, then installs (see installAtExit). */
  private requestInstall(): void {
    if (!this.downloaded) return;
    this.installRequested = true;
    if (this.o.onInstallRequested) this.o.onInstallRequested();
    else this.installAtExit();
  }

  installRequested = false;
  private installStarted = false;

  /**
   * The last step of closing the program: if an update was downloaded, install it (silently; start the new version again when the player asked for it).
   * Returns true when the installer was started (the program is then quitting on its own).
   */
  installAtExit(): boolean {
    if (!this.downloaded) return false;
    if (this.installStarted) return true;
    this.installStarted = true;
    try {
      this.o.log("INFO", `updater: installing ${this.state.version} (restart: ${this.installRequested})`);
      autoUpdater.quitAndInstall(true, this.installRequested);
      return true;
    } catch (e) {
      this.installStarted = false;
      this.o.log("WARNING", `updater: could not start the installer: ${(e as Error).message}`);
      return false;
    }
  }
}
