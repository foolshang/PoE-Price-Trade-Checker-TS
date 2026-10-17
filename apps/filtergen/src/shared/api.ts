/**
 * The whole surface the renderer gets from the main process (window.desktop, made by the preload). Typed, small, and every
 * member does one named thing: there is no generic fs / ipc / require for the page. Paths never come from the page: the main
 * process knows the game folder of each game (the default or the folder the player picked with Browse…) and takes file NAMES.
 */
export type GameId = "poe1" | "poe2";

export interface InitData {
  version: string;
  buildTime: string;
  exeName: string;
  configDir: string;
  /** localStorage-style keys: poeFilterGen.cfg / poeFilterGen.game and the NeverSink cache */
  store: Record<string, string>;
  /** what the first start did with the original program's config (empty when nothing to say) */
  importNote: string;
}

export interface FolderInfo {
  dir: string;
  exists: boolean;
  isOverride: boolean;
}

export interface FilterFileInfo {
  name: string;
  size: number;
  /** the first 600 characters (enough to tell who made the file) */
  head: string;
}

export interface PickedDir {
  dir: string;
  name: string;
}

export interface PickedFile {
  name: string;
  bytes: Uint8Array;
  /** the folder the file lies in */
  dir: string;
}

export interface ReadSound {
  name: string;
  bytes: Uint8Array;
}

/** `ok: false` carries a message that is ready to show (Thai) */
export type Result = { ok: true } | { ok: false; message: string };

export interface DesktopApi {
  init(): Promise<InitData>;
  /** settings / cache keys (written to the app's own files by the main process) */
  storeSet(key: string, value: string): void;
  storeDel(key: string): void;
  /** the network, for the few hosts the page needs (hub, NeverSink on GitHub) */
  httpGet(url: string, headers?: Record<string, string>): Promise<{ ok: boolean; status: number; text: string }>;
  /** GGG's trade item names (7-day cache on disk); null when unavailable */
  tradeNames(game: GameId): Promise<string[] | null>;

  folderInfo(game: GameId): Promise<FolderInfo>;
  /** the folder dialog (starts at the game's folder); the picked folder becomes the game's folder; null = cancelled */
  pickFolder(game: GameId): Promise<PickedDir | null>;
  /** back to Documents\My Games\... */
  clearFolder(game: GameId): Promise<void>;
  listFilters(game: GameId): Promise<FilterFileInfo[]>;
  listNames(game: GameId): Promise<string[]>;
  fileExists(game: GameId, name: string): Promise<boolean>;
  readFile(game: GameId, name: string): Promise<Uint8Array>;
  writeFile(game: GameId, name: string, bytes: Uint8Array): Promise<Result>;
  /** the open dialog for a .filter file (starts at the game's folder); null = cancelled */
  pickFilterFile(game: GameId): Promise<PickedFile | null>;
  /** the folder of the file picked last becomes the game's folder (Generate writes back next to it) */
  adoptPickedDir(game: GameId): Promise<PickedDir | null>;
  /** a sound named in the config by a path of the original program: its bytes, from that path or from the game folder */
  readLegacySound(game: GameId, value: string): Promise<ReadSound | null>;

  /** the main process asks the page to save before closing; the page answers with flushDone */
  onFlush(cb: () => void): void;
  flushDone(): void;
}

declare global {
  interface Window {
    desktop: DesktopApi;
  }
}
