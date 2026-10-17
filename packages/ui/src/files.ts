/**
 * Files: the sound files the player picked (kept in IndexedDB, one per slot label: 1-6 = the NeverSink tab's numbered
 * sounds, S/A/B/C/G/Tablet/Map/Gem = the Whitelist tab's, Q = the quest style, shared), the game folder (File System Access
 * API: Chrome / Edge, the handle is remembered in IndexedDB) and the download / zip.
 */
import { toCrlf } from "./dom.ts";
import { S } from "./state.ts";
import { idb } from "./storage.ts";

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  try {
    const d = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
    return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    return ""; // no crypto.subtle: names alone decide "same file"
  }
}

// ---- sound slots ----
const SLOTS = ["1", "2", "3", "4", "5", "6", "S", "A", "B", "C", "Q", "G", "Tablet", "Map", "Gem"];
export interface Sound { name: string; type: string; bytes: Uint8Array; hash: string }

export const sounds = {
  mem: {} as Record<string, Sound>,
  async load(): Promise<void> {
    for (const label of SLOTS) {
      const v = await idb.get("sounds", label);
      if (v && v.bytes) {
        const bytes = new Uint8Array(v.bytes);
        this.mem[label] = { name: v.name, type: v.type || "", bytes, hash: await sha256Hex(bytes) };
      }
    }
  },
  async setBytes(label: string, name: string, type: string, bytes: Uint8Array): Promise<void> {
    this.mem[label] = { name, type: type || "", bytes, hash: await sha256Hex(bytes) };
    const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    await idb.put("sounds", label, { name, type: type || "", bytes: copy });
  },
  async setFile(label: string, file: File): Promise<string> {
    await this.setBytes(label, file.name, file.type, new Uint8Array(await file.arrayBuffer()));
    return file.name;
  },
  async clear(label: string): Promise<void> {
    delete this.mem[label];
    await idb.del("sounds", label);
  },
  /** the file of one slot into another (an old S / A / B file becomes sound 1 / 2 / 3 as well) */
  async copy(from: string, to: string): Promise<void> {
    const v = this.mem[from];
    if (v && !this.mem[to]) await this.setBytes(to, v.name, v.type, v.bytes);
  },
  name(label: string): string {
    return this.mem[label] ? this.mem[label].name : "";
  },
  hashes(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(this.mem)) if (v.hash) out[k] = v.hash;
    return out;
  },
};

// ---- the game folder (File System Access API) ----
// The folder of each game has its own handle (IndexedDB key = "poe1" / "poe2") and its own name in Documents\My Games.
const FOLDER_NAME: Record<string, string> = { poe1: "Path of Exile", poe2: "Path of Exile 2" };
const sameName = (a: unknown, b: unknown): boolean => String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();
const w = window as any;

export const FS = {
  supported: typeof w.showDirectoryPicker === "function",
  handle: null as any,
  /** none | granted | prompt (remembered, permission must be confirmed) */
  state: "none" as "none" | "granted" | "prompt",
  folderName: (game: string): string => FOLDER_NAME[game] || "",
  /** true when the picked folder is called what the game's own folder is called (a player's own folder name is allowed too, after a question) */
  nameOk: (game: string, name: string): boolean => sameName(name, FOLDER_NAME[game]),
  /**
   * A handle kept under another key (an older page kept one handle for both games) goes to the game its folder name says;
   * one with another name stays where it is (it is not guessed). A game that already has its own handle keeps it.
   */
  async migrateLegacy(): Promise<void> {
    let keys: string[] = [];
    try { keys = await idb.keys("handles"); } catch { return; }
    for (const k of keys) {
      if (k === "poe1" || k === "poe2") continue;
      const hd = await idb.get("handles", k);
      const target = hd && Object.keys(FOLDER_NAME).find((g) => sameName(hd.name, FOLDER_NAME[g]));
      if (!target) continue;
      if (!(await idb.get("handles", target))) await idb.put("handles", target, hd);
      await idb.del("handles", k);
    }
  },
  async init(game: string): Promise<string> {
    this.handle = null;
    this.state = "none";
    if (!this.supported) return this.state;
    await this.migrateLegacy();
    const hd = await idb.get("handles", game);
    if (hd && typeof hd.queryPermission === "function") {
      this.handle = hd;
      try { this.state = (await hd.queryPermission({ mode: "readwrite" })) === "granted" ? "granted" : "prompt"; } catch { this.state = "prompt"; }
    }
    return this.state;
  },
  /** the folder picker of a game (starts in Documents, remembers where it was per game); returns the handle, stores nothing */
  choose(game: string): Promise<any> {
    return w.showDirectoryPicker({ id: `poe-filter-${game}`, mode: "readwrite", startIn: "documents" });
  },
  /** make `hd` the folder of `game` (this one is the current one) */
  async adopt(game: string, hd: any): Promise<void> {
    this.handle = hd;
    this.state = "granted";
    await idb.put("handles", game, hd);
  },
  async grant(): Promise<boolean> { // must run from a click
    if (!this.handle) return false;
    this.state = (await this.handle.requestPermission({ mode: "readwrite" })) === "granted" ? "granted" : "prompt";
    return this.state === "granted";
  },
  async forget(game: string): Promise<void> {
    this.handle = null;
    this.state = "none";
    await idb.del("handles", game);
  },
  get ready(): boolean {
    return this.state === "granted" && !!this.handle;
  },
  get name(): string {
    return this.handle ? this.handle.name : "";
  },
  async names(): Promise<string[]> {
    const out: string[] = [];
    for await (const [name, hd] of this.handle.entries()) if (hd.kind === "file") out.push(name);
    return out;
  },
  /** the .filter files of the folder: [{name, size, head}] (head = the first 600 characters, enough to tell who made it) */
  async list(): Promise<{ name: string; size: number; head: string }[]> {
    const out = [];
    for await (const [name, hd] of this.handle.entries()) {
      if (hd.kind !== "file" || !/\.filter$/i.test(name)) continue;
      const f: File = await hd.getFile();
      out.push({ name, size: f.size, head: await f.slice(0, 600).text() });
    }
    return out;
  },
  async getFile(name: string): Promise<File> {
    return (await this.handle.getFileHandle(name)).getFile();
  },
  async exists(name: string): Promise<boolean> {
    try { await this.handle.getFileHandle(name); return true; } catch { return false; }
  },
  async read(name: string): Promise<Uint8Array> {
    const fh = await this.handle.getFileHandle(name);
    return new Uint8Array(await (await fh.getFile()).arrayBuffer());
  },
  async write(name: string, data: Uint8Array): Promise<void> {
    const fh = await this.handle.getFileHandle(name, { create: true });
    const wr = await fh.createWritable();
    try { await wr.write(data); } finally { await wr.close(); }
  },
  /**
   * {file name: content hash or null} for what the sound planner needs: every file of the folder is listed, the content is
   * hashed only for the names the sounds will use (like the desktop copy_sounds).
   */
  async existingFor(wanted: Set<string>): Promise<Record<string, string | null>> {
    const out: Record<string, string | null> = {};
    for (const name of await this.names()) out[name] = wanted.has(name) ? await sha256Hex(await this.read(name)) : null;
    return out;
  },
};

// ---- download (when no folder is connected, or the browser cannot write to one) ----
export interface Download { kind: "filter" | "zip"; filename: string; mime: string; bytes: Uint8Array; names?: string[] }

/** Bytes of what to hand to the player: the .filter alone, or a zip with the sound files the filter names. */
export function packDownload(filterText: string, filterName: string, soundsByLabel: Record<string, string>): Download {
  const dest: Record<string, Uint8Array> = {}; // file name -> bytes (one file once, even for several slots)
  for (const [label, name] of Object.entries(soundsByLabel || {})) {
    const s = sounds.mem[label];
    if (s && !dest[name]) dest[name] = s.bytes;
  }
  const names = Object.keys(dest);
  if (!names.length) {
    return { kind: "filter", filename: `${filterName}.filter`, mime: "text/plain;charset=utf-8", bytes: new TextEncoder().encode(toCrlf(filterText)) };
  }
  return { kind: "zip", filename: `${filterName}.zip`, mime: "application/zip", bytes: S.api.makeZip(toCrlf(filterText), filterName, dest), names };
}

/** Write the filter + the sounds that have to be written into the connected folder. `res` = api.generate result. */
export async function writeToFolder(res: { text?: string; copies?: [string, string][] }, filterName: string): Promise<string[]> {
  const written: string[] = [];
  for (const [label, final] of res.copies ?? []) {
    const s = sounds.mem[label];
    if (!s) continue;
    await FS.write(final, s.bytes);
    written.push(final);
  }
  await FS.write(`${filterName}.filter`, new TextEncoder().encode(toCrlf(res.text as string)));
  written.push(`${filterName}.filter`);
  return written;
}
