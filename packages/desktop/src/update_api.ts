/** What the managed updater (managed_updater.ts) tells a window: window.appUpdate, made by the preload of the app. Types only. */

export type UpdatePhase =
  | "idle" // nothing newer (or not asked yet)
  | "checking" // the player asked and the answer is not there yet
  | "available" // a newer release exists; nothing is downloaded (automatic update is off)
  | "downloading"
  | "ready" // downloaded; nothing is installed until the player chooses
  | "error"
  | "manual"; // a newer release exists but this copy cannot update itself (the zip): the link is the way

export interface UpdateInfoState {
  phase: UpdatePhase;
  /** the newer version (available / downloading / ready / manual / error while downloading) */
  version?: string;
  /** 0-100 while downloading */
  percent?: number;
  /** the reason, for "error" */
  message?: string;
  /** what failed: the check or the download */
  failed?: "check" | "download";
  /** where to get it by hand, for "manual" */
  url?: string;
  /** what the release page says about the newer version (plain text) */
  notes?: string;
  /** "automatic update" is on: a newer release is downloaded in the background */
  auto: boolean;
  /** "update when the program is closed" was chosen */
  exitPending: boolean;
  /** "update now" was chosen and waits for the download */
  installNow: boolean;
  mode: "installer" | "manual" | "off";
  /** the player pressed "check for updates" (the answer is shown, even "nothing new" or "failed") */
  userCheck: boolean;
  /** the last check found nothing newer */
  upToDate: boolean;
}

export interface AppUpdateApi {
  get(): Promise<UpdateInfoState>;
  onState(cb: (state: UpdateInfoState) => void): void;
  /** check now (the player pressed the button) */
  check(): void;
  /** download if needed, then close the program, install, start the new version */
  installNow(): void;
  /** download if needed, install when the player closes the program (the real exit, not the X that goes to the tray) */
  installOnExit(): void;
  /** forget "update on exit" / "update now" (a download that runs goes on) */
  cancel(): void;
  /** the download failed: try again */
  retry(): void;
  /** the browser, on the release page (the zip copy) */
  openRelease(): void;
}

declare global {
  interface Window {
    appUpdate?: AppUpdateApi;
  }
}
