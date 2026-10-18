/**
 * Updates of the program itself, the way the player chooses them (the Checker). electron-updater against GitHub Releases. Rules:
 *  - the check runs a little after the start and then every 24 hours - whether or not "automatic update" is on;
 *  - automatic update ON: a newer release is downloaded in the background; OFF: it is only announced (nothing is downloaded);
 *  - either way NOTHING is installed unless the player chooses: "update now" (install, start the new version) or "update when the
 *    program is closed" (the real exit - not the X that goes to the tray); the second can be cancelled;
 *  - a release with a "-" in its version (beta, rc) is skipped - unless this copy is itself a beta (testers follow the betas);
 *  - the zip copy cannot update itself (it is not installed): it only says that a newer release exists, with the link;
 *  - a network that is down, a broken file (the checksum does not match) or anything else is a line in the log and - for the check -
 *    nothing in the window; a download that fails is shown with the reason and "try again".
 * The feed is the one electron-builder wrote into the program (resources/app-update.yml); POE_UPDATE_FEED=<url> replaces it (tests).
 */
import { testEnv } from "./test_env.ts";
import { ipcMain } from "electron";
import type { BrowserWindow, IpcMainEvent, IpcMainInvokeEvent } from "electron";
import { autoUpdater } from "electron-updater";
import type { UpdateInfo } from "electron-updater";
import { notesToText } from "./changelog.ts";
import type { UpdateInfoState } from "./update_api.ts";
import { decideOffer, isPrerelease } from "./updater_logic.ts";
import { installedByInstaller } from "./updater.ts";

export const CHECK_EVERY_MS = 24 * 3600 * 1000;
export const FIRST_CHECK_MS = 20_000;

export interface ManagedUpdaterOptions {
  version: string;
  isPackaged: boolean;
  exePath: string;
  /** the feed channel of this program ("latest" -> latest.yml) */
  channel: string;
  /** where a person gets the release by hand */
  releasesUrl: string;
  /** "automatic update" (the setting) */
  autoDownload: () => boolean;
  log: (level: string, msg: string) => void;
  windows: () => BrowserWindow[];
  allow: (e: IpcMainEvent | IpcMainInvokeEvent) => boolean;
  openExternal: (url: string) => void;
  /** a newer version was found for the first time (the red dot and the details window) */
  onFound?: (version: string, notes: string) => void;
  /** "update now" was chosen and the update is downloaded: save and close the program, then call `installAtExit` */
  onInstallRequested: () => void;
}

export class ManagedUpdater {
  private s: UpdateInfoState;
  private timer: NodeJS.Timeout | null = null;
  private checking = false;
  private downloaded = false;
  private installStarted = false;
  private announced = "";
  private installRequested = false;
  private readonly feed = testEnv("POE_UPDATE_FEED") || "";

  constructor(private readonly o: ManagedUpdaterOptions) {
    const packaged = o.isPackaged || !!this.feed;
    const mode = !packaged ? "off" : installedByInstaller(o.exePath) ? "installer" : "manual"; // (a feed in POE_UPDATE_FEED does not make a zip copy an installed one)
    this.s = { phase: "idle", auto: o.autoDownload(), exitPending: false, installNow: false, mode, userCheck: false, upToDate: false };
    const ask = (e: IpcMainInvokeEvent | IpcMainEvent): boolean => o.allow(e);
    ipcMain.handle("au:get", (e) => (ask(e) ? this.snapshot() : null));
    ipcMain.on("au:check", (e) => { if (ask(e)) void this.check(true); });
    ipcMain.on("au:install-now", (e) => { if (ask(e)) this.installNow(); });
    ipcMain.on("au:install-exit", (e) => { if (ask(e)) this.installOnExit(); });
    ipcMain.on("au:cancel", (e) => { if (ask(e)) this.cancel(); });
    ipcMain.on("au:retry", (e) => { if (ask(e)) this.retry(); });
    ipcMain.on("au:open-release", (e) => { if (ask(e)) o.openExternal(o.releasesUrl); });

    if (mode === "off") return;
    const u = autoUpdater;
    u.autoDownload = false; // (the code below decides: a pre-release is not downloaded, "automatic update" may be off)
    u.autoInstallOnAppQuit = false; // (installed only by installAtExit, and only when the player chose)
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
    u.on("update-not-available", () => this.set({ phase: "idle", upToDate: true, version: undefined, notes: undefined, message: undefined, failed: undefined }));
    u.on("download-progress", (p: { percent: number }) => this.set({ phase: "downloading", percent: Math.round(p.percent) }));
    u.on("update-downloaded", (info: UpdateInfo) => {
      this.downloaded = true;
      this.set({ phase: "ready", version: info.version, percent: 100 });
      o.log("INFO", `updater: ${info.version} downloaded${this.s.exitPending ? " - installed when the program is closed" : this.s.installNow ? " - installing now" : " - waiting for the player's choice"}`);
      if (this.s.installNow) this.requestInstall();
    });
    u.on("error", (e: Error) => this.fail(e));
  }

  get currentMode(): "installer" | "manual" | "off" {
    return this.s.mode;
  }

  snapshot(): UpdateInfoState {
    return { ...this.s, auto: this.o.autoDownload() };
  }

  /** a downloaded update that the player asked to install when the program is closed */
  get installOnCloseChosen(): boolean {
    return this.downloaded && (this.s.exitPending || this.installRequested);
  }

  /** Start checking: once after `firstMs`, then every 24 hours. */
  start(firstMs = Number(testEnv("POE_UPDATE_FIRST_MS")) || FIRST_CHECK_MS): void {
    if (this.s.mode === "off") {
      this.o.log("INFO", "updater: off (not an installed program)");
      return;
    }
    this.o.log("INFO", `updater: ${this.s.mode} mode, channel ${this.o.channel}, auto=${this.o.autoDownload()}${this.feed ? `, feed ${this.feed}` : ""}`);
    this.arm(firstMs);
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private arm(ms: number): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.check(false), ms);
    this.timer.unref?.();
  }

  /** One check now (`user` = the player pressed the button). Never throws; the next one is always scheduled. */
  async check(user: boolean): Promise<void> {
    if (this.s.mode === "off") return;
    const busy = this.checking || this.downloaded || this.s.phase === "downloading";
    if (busy) {
      if (user) this.set({ userCheck: true });
      if (!this.checking) this.arm(Number(testEnv("POE_UPDATE_EVERY_MS")) || CHECK_EVERY_MS);
      return;
    }
    this.checking = true;
    this.s = { ...this.s, userCheck: user };
    if (user) this.set({ phase: "checking", upToDate: false, message: undefined, failed: undefined });
    try {
      await autoUpdater.checkForUpdates();
    } catch (e) {
      this.fail(e as Error, "check");
    } finally {
      this.checking = false;
      this.arm(Number(testEnv("POE_UPDATE_EVERY_MS")) || CHECK_EVERY_MS);
    }
  }

  private onAvailable(info: UpdateInfo): void {
    const what = decideOffer(this.o.version, info.version, this.s.mode === "manual" ? "manual" : "installer");
    if (what === "skip-prerelease") {
      this.o.log("INFO", `updater: ${info.version} is a pre-release - skipped`);
      this.set({ phase: "idle", upToDate: true, version: undefined, notes: undefined });
      return;
    }
    const notes = notesToText(info.releaseNotes);
    if (what === "manual") {
      this.set({ phase: "manual", version: info.version, url: this.o.releasesUrl, notes, upToDate: false });
      this.o.log("INFO", `updater: ${info.version} exists (this copy is not installed, it cannot update itself): ${this.o.releasesUrl}`);
    } else {
      this.set({ phase: "available", version: info.version, notes, upToDate: false, message: undefined, failed: undefined });
      this.o.log("INFO", `updater: ${info.version} is available (automatic update: ${this.o.autoDownload() ? "on" : "off"})`);
    }
    if (this.announced !== info.version) {
      this.announced = info.version;
      this.o.onFound?.(info.version, notes);
    }
    if (what === "download" && this.o.autoDownload()) this.startDownload();
  }

  private startDownload(): void {
    if (this.downloaded || this.s.phase === "downloading") return;
    this.o.log("INFO", `updater: downloading ${this.s.version}`);
    this.set({ phase: "downloading", percent: 0, message: undefined, failed: undefined });
    autoUpdater.downloadUpdate().catch((e: Error) => this.fail(e, "download"));
  }

  private fail(e: Error, stage?: "check" | "download"): void {
    const failed = stage ?? (this.s.phase === "downloading" ? "download" : "check");
    this.o.log("WARNING", `updater: ${failed} failed: ${e?.message ?? e}`);
    const message = String(e?.message ?? e).split("\n")[0].slice(0, 300);
    if (failed === "check") {
      // a check that fails (the net is down) must not take away what the window already shows: a newer version found earlier
      if (this.downloaded || ["available", "downloading", "ready", "manual"].includes(this.s.phase)) return;
      this.set({ phase: "error", failed: "check", message });
    } else {
      this.set({ phase: "error", failed: "download", message });
    }
  }

  private set(patch: Partial<UpdateInfoState>): void {
    this.s = { ...this.s, ...patch };
    this.publish();
  }

  /** push the state to the windows (also after the setting "automatic update" changed) */
  publish(): void {
    const snap = this.snapshot();
    for (const w of this.o.windows()) {
      try {
        if (!w.isDestroyed()) w.webContents.send("au:state", snap);
      } catch { /* a window that is going away */ }
    }
  }

  /** The setting "automatic update" was changed: turning it on downloads a newer release that was only announced. */
  autoChanged(): void {
    if (this.s.mode === "installer" && this.o.autoDownload() && this.s.phase === "available") this.startDownload();
    else this.publish();
  }

  installNow(): void {
    if (this.s.mode !== "installer") return;
    if (this.downloaded) {
      this.set({ installNow: true });
      this.requestInstall();
      return;
    }
    if (!["available", "downloading", "error"].includes(this.s.phase) || !this.s.version) return;
    this.set({ installNow: true, exitPending: false });
    if (this.s.phase !== "downloading") this.startDownload();
  }

  installOnExit(): void {
    if (this.s.mode !== "installer") return;
    if (!this.downloaded && !["available", "downloading", "error"].includes(this.s.phase)) return;
    if (!this.s.version) return;
    this.set({ exitPending: true, installNow: false });
    this.o.log("INFO", `updater: ${this.s.version} will be installed when the program is closed`);
    if (!this.downloaded && this.s.phase !== "downloading") this.startDownload();
  }

  cancel(): void {
    if (!this.s.exitPending && !this.s.installNow) return;
    this.o.log("INFO", "updater: the choice was cancelled - nothing will be installed");
    this.set({ exitPending: false, installNow: false });
  }

  retry(): void {
    if (this.s.phase !== "error") return;
    if (this.s.failed === "download") this.startDownload();
    else void this.check(true);
  }

  private requestInstall(): void {
    this.installRequested = true;
    this.o.onInstallRequested();
  }

  /**
   * The last step of closing the program: if the player chose to install (now, or when the program is closed) and the update is
   * downloaded, install it. Returns true when the installer was started (the program is then quitting on its own).
   */
  installAtExit(): boolean {
    if (!this.installOnCloseChosen) return false;
    if (this.installStarted) return true;
    this.installStarted = true;
    try {
      this.o.log("INFO", `updater: installing ${this.s.version} (restart: ${this.installRequested})`);
      autoUpdater.quitAndInstall(true, this.installRequested);
      return true;
    } catch (e) {
      this.installStarted = false;
      this.o.log("WARNING", `updater: could not start the installer: ${(e as Error).message}`);
      return false;
    }
  }

  /** For tests: make the windows believe in a state. */
  inject(patch: Partial<UpdateInfoState>): void {
    this.set(patch);
  }
}
