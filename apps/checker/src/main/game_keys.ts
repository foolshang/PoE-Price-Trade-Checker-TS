/**
 * The key chord that makes the game copy an item: Ctrl+C in PoE1 (its copy is always the detailed format since 3.29), and in PoE2
 * Ctrl + the player's "show advanced item descriptions" key + C. That key is read (never written) from the game's own settings file
 *   <Documents>\My Games\Path of Exile 2\poe2_production_Config.ini   [ACTION_KEYS] show_advanced_item_descriptions=<vk> [<modifier>]
 * where <vk> is a Windows virtual-key code and <modifier> is 1 = Shift, 2 = Ctrl, 3 = Alt; 0 = not bound. When the file or the setting
 * cannot be read, Alt (the game's default) is used and the caller says so.
 */
import { promises as fsp } from "node:fs";
import path from "node:path";

export const VK = { SHIFT: 0x10, CTRL: 0x11, ALT: 0x12, LWIN: 0x5b, RWIN: 0x5c, C: 0x43 } as const;
const MODIFIER_OF: Record<string, number> = { "1": VK.SHIFT, "2": VK.CTRL, "3": VK.ALT };

/** The virtual-key codes (modifier first) of the setting's value, or null when it is not a usable binding. */
export function parseBinding(value: string): number[] | null {
  const parts = value.trim().split(/\s+/);
  if (!/^\d+$/.test(parts[0] ?? "") || parts.length > 2) return null;
  const main = parseInt(parts[0], 10);
  if (main < 1 || main > 254) return null; // 0 = not bound
  if (parts.length === 1) return [main];
  const mod = MODIFIER_OF[parts[1]];
  return mod === undefined ? null : [mod, main];
}

/** The binding in the text of the settings file ([ACTION_KEYS] only), or null. */
export function advancedKeyFromIni(text: string): number[] | null {
  let section = "";
  for (const raw of text.replace(/^﻿/, "").split(/\r?\n/)) {
    const line = raw.trim();
    const sec = /^\[([^\]]*)\]$/.exec(line);
    if (sec) {
      section = sec[1];
      continue;
    }
    if (section !== "ACTION_KEYS") continue;
    const m = /^show_advanced_item_descriptions\s*=\s*(.*)$/.exec(line);
    if (m) return parseBinding(m[1]);
  }
  return null;
}

export interface AdvancedKey {
  keys: number[];
  /** where the keys came from, for the log */
  source: "ini" | "default";
  note: string;
}

const DEFAULT_ALT: number[] = [VK.ALT];

export async function readAdvancedKey(documentsDir: string): Promise<AdvancedKey> {
  const file = path.join(documentsDir, "My Games", "Path of Exile 2", "poe2_production_Config.ini");
  let text: string;
  try {
    text = await fsp.readFile(file, "utf-8");
  } catch (e) {
    return { keys: DEFAULT_ALT, source: "default", note: `อ่านไฟล์ตั้งค่าของ PoE2 ไม่ได้ (${file}: ${(e as NodeJS.ErrnoException).code ?? (e as Error).message}) ใช้ Alt` };
  }
  const keys = advancedKeyFromIni(text);
  if (!keys) return { keys: DEFAULT_ALT, source: "default", note: "ไม่พบปุ่ม show_advanced_item_descriptions ที่ตั้งไว้ในไฟล์ตั้งค่าของ PoE2 ใช้ Alt" };
  return { keys, source: "ini", note: "" };
}

/** Ctrl, then the advanced key (once, in order), then C is added by the sender. PoE1: Ctrl only. */
export function copyChord(game: string, advanced: number[]): number[] {
  if (game !== "poe2") return [VK.CTRL];
  return [...new Set([VK.CTRL, ...advanced])];
}

export function keyName(vk: number): string {
  const names: Record<number, string> = { [VK.SHIFT]: "Shift", [VK.CTRL]: "Ctrl", [VK.ALT]: "Alt", [VK.LWIN]: "Win", [VK.RWIN]: "Win" };
  if (names[vk]) return names[vk];
  if ((vk >= 0x30 && vk <= 0x39) || (vk >= 0x41 && vk <= 0x5a)) return String.fromCharCode(vk);
  if (vk >= 0x70 && vk <= 0x87) return `F${vk - 0x6f}`;
  return `VK${vk}`;
}
