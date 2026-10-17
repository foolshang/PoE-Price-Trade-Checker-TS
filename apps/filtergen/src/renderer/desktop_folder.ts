/**
 * The game folder for the desktop shell: same members as the browser's `FS` (packages/ui/src/files.ts), but the folder is the
 * game's own folder on disk and every call goes to the main process by game id + file name (never a path).
 */
import { S, sha256Hex, store, KEY_CFG } from "@poe/ui";
import type { DesktopApi, FolderInfo, GameId } from "../shared/api.ts";

const FOLDER_NAME: Record<string, string> = { poe1: "Path of Exile", poe2: "Path of Exile 2" };

export function desktopFolder(d: DesktopApi) {
  let game: GameId = "poe2";
  let info: FolderInfo = { dir: "", exists: false, isOverride: false };

  const saveCfg = (): void => {
    store.set(KEY_CFG, JSON.stringify(S.cfg));
  };

  return {
    desktop: true,
    supported: true,
    state: "granted" as const,
    handle: {} as unknown,
    pickedDir: "",
    folderName: (g: string): string => FOLDER_NAME[g] || "",
    nameOk: (): boolean => true, // any folder may be the game's folder (Game folder override)
    async migrateLegacy(): Promise<void> { /* nothing from a browser */ },
    async init(g: string): Promise<string> {
      game = g as GameId;
      info = await d.folderInfo(game);
      return "granted";
    },
    /** the folder dialog; the choice is made the game's folder by adopt() */
    async choose(g: string): Promise<{ name: string; dir: string }> {
      const r = await d.pickFolder(g as GameId);
      if (!r) throw Object.assign(new Error("cancelled"), { name: "AbortError" });
      return { name: r.name, dir: r.dir };
    },
    async adopt(g: string, hd: { dir: string }): Promise<void> {
      S.cfg[`game_dir_${g}`] = hd.dir;
      saveCfg();
      if (g === game) info = await d.folderInfo(game);
    },
    async grant(): Promise<boolean> {
      return true;
    },
    async forget(g: string): Promise<void> {
      await d.clearFolder(g as GameId);
      S.cfg[`game_dir_${g}`] = "";
      saveCfg();
      if (g === game) info = await d.folderInfo(game);
    },
    get ready(): boolean {
      return true;
    },
    get name(): string {
      return info.dir;
    },
    names: (): Promise<string[]> => d.listNames(game),
    list: (): Promise<{ name: string; size: number; head: string }[]> => d.listFilters(game),
    async getFile(name: string): Promise<File> {
      this.pickedDir = "";
      return new File([await d.readFile(game, name) as BlobPart], name);
    },
    exists: (name: string): Promise<boolean> => d.fileExists(game, name),
    read: (name: string): Promise<Uint8Array> => d.readFile(game, name),
    async write(name: string, data: Uint8Array): Promise<void> {
      const r = await d.writeFile(game, name, data);
      if (!r.ok) throw new Error(r.message);
    },
    async existingFor(wanted: Set<string>): Promise<Record<string, string | null>> {
      const out: Record<string, string | null> = {};
      for (const name of await d.listNames(game)) out[name] = wanted.has(name) ? await sha256Hex(await d.readFile(game, name)) : null;
      return out;
    },
    /** "เลือกไฟล์อื่น…": the open dialog; the file's folder is remembered so Generate can write back next to it */
    async pickFile(): Promise<File | null> {
      const r = await d.pickFilterFile(game);
      if (!r) return null;
      this.pickedDir = r.dir;
      return new File([r.bytes as BlobPart], r.name);
    },
  };
}
