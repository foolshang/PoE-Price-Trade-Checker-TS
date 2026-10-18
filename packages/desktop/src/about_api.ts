/** window.trayOption (Filter Generator): the one setting of the About window that lives in the main process - what the X button does. Types only. */
export type CloseAction = "minimize" | "exit";

export interface TrayOptionApi {
  /** what the X button does, and whether the tray icon exists (when it could not be made the X always closes the program) */
  get(): Promise<{ action: CloseAction; trayOk: boolean }>;
  set(action: CloseAction): void;
}

declare global {
  interface Window {
    trayOption?: TrayOptionApi;
  }
}
