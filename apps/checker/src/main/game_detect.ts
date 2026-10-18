/**
 * Which game a window belongs to. PoE1 and PoE2 run from executables with the SAME names (PathOfExile.exe / PathOfExile_x64.exe, and the
 * Steam builds PathOfExileSteam.exe / PathOfExile_x64Steam.exe in both), so the name only says "a Path of Exile client"; the game comes from
 * the install folder (".../Path of Exile 2/..." vs ".../Path of Exile/...": standalone, Steam, and Epic when it keeps GGG's folder name), and
 * when the folder does not say (a renamed folder) from the window title ("Path of Exile 2" vs "Path of Exile").
 */
import type { GameId } from "../shared/api.ts";

export interface WindowInfo {
  /** full path of the program that owns the window ("" = not readable) */
  exePath: string;
  /** window class name */
  cls: string;
  title: string;
}

const squash = (s: string): string => s.toLowerCase().replace(/[\s_\-.]+/g, "");
const SEP = /[\\/]/;
const fileOf = (p: string): string => p.split(SEP).pop() ?? "";

/** is it a Path of Exile client at all? (the game's window class is POEWindowClass; the executables are PathOfExile*) */
export function isPoeClient(w: WindowInfo): boolean {
  return w.cls === "POEWindowClass" || /^pathofexile/.test(squash(fileOf(w.exePath)));
}

function gameFromText(text: string): GameId | null {
  const s = squash(text);
  if (/pathofexile(2|ii)(?!\d)/.test(s)) return "poe2";
  if (s.includes("pathofexile")) return "poe1";
  return null;
}

/** The game this window is, or null when it is not a Path of Exile client (or neither the folder nor the title tells). */
export function gameOfWindow(w: WindowInfo): GameId | null {
  if (!isPoeClient(w)) return null;
  const folders = w.exePath.split(SEP).slice(0, -1).reverse(); // nearest folder first
  for (const f of folders) {
    const g = gameFromText(f);
    if (g) return g;
  }
  return /^path of exile( 2)?$/i.test(w.title.trim()) ? gameFromText(w.title) : null;
}

/**
 * What to do when the window in front changes. `lastFront` = the game that was in front the last time a game was in front (null = never).
 * A game that comes to the front switches the program to it when it is not the one that was in front before - so a switch made by hand
 * stays until the OTHER game comes to the front. Nothing (a browser, this program) in front = nothing changes.
 */
export function onFront(front: GameId | null, lastFront: GameId | null): { switchTo: GameId | null; lastFront: GameId | null } {
  if (!front) return { switchTo: null, lastFront };
  return { switchTo: front !== lastFront ? front : null, lastFront: front };
}
