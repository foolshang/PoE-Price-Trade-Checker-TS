/**
 * The few things the engines need from the outside world, as ports: the browser (fetch + IndexedDB / File System
 * Access) and Node / Electron (fetch + node:fs) each provide their own. Everything is async.
 */

/** A failed HTTP request (non-2xx). Network errors are plain Errors. */
export class HttpError extends Error {
  constructor(public status: number, public url: string) {
    super(`HTTP ${status}: ${url}`);
  }
}

export interface HttpPort {
  /** GET `url` and return the body decoded as UTF-8 (invalid bytes replaced). Throws HttpError / Error. */
  getText(url: string, headers?: Record<string, string>): Promise<string>;
}

/** File system of the machine (desktop only). Paths are opaque strings built with `join`. */
export interface FsPort {
  join(...parts: string[]): string;
  basename(p: string): string;
  exists(p: string): Promise<boolean>;
  isFile(p: string): Promise<boolean>;
  isDir(p: string): Promise<boolean>;
  readText(p: string): Promise<string>;
  writeText(p: string, text: string): Promise<void>;
  mkdirp(dir: string): Promise<void>;
  /** names of the entries of a folder */
  listDir(dir: string): Promise<string[]>;
  /** modification time in seconds since the epoch */
  mtimeSec(p: string): Promise<number>;
  sha256(p: string): Promise<string>;
  copyFile(src: string, dst: string): Promise<void>;
}

/** What the programs keep in `config.json` (see packages/node for the real thing). */
export interface ConfigLike {
  get(key: string, dflt?: any): any;
  set(key: string, value: any): void;
  save(): Promise<void> | void;
  appDir(): string;
}
