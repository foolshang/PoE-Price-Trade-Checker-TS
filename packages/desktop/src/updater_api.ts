/** What the update machinery tells a window (window.updater, made by the preload of @poe/desktop) - types only. */

export type UpdateKind =
  | "idle" // nothing to say
  | "downloading" // a newer release is being fetched in the background
  | "ready" // downloaded: installed when the program is closed, or now on request
  | "manual" // a newer release exists but this copy cannot update itself (the zip): the link is the way
  | "error"; // the check or the download failed (the program goes on; the log has the reason)

export interface UpdateState {
  kind: UpdateKind;
  /** the newer version */
  version?: string;
  /** 0-100 while downloading */
  percent?: number;
  /** the reason, for "error" */
  message?: string;
  /** where to get it by hand, for "manual" */
  url?: string;
}

export interface UpdaterApi {
  /** the state now (a window that opens late asks) */
  get(): Promise<UpdateState>;
  onState(cb: (state: UpdateState) => void): void;
  /** close the program, install the new version, start it again (only when the player clicks) */
  install(): void;
  /** the browser, on the release page (the zip copy) */
  openRelease(): void;
}

declare global {
  interface Window {
    updater?: UpdaterApi;
  }
}
