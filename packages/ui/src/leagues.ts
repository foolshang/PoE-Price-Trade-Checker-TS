/**
 * The league the filter page takes its hub data from (the Whitelist tab's item names): the list comes from the hub's {game}/prices/index.json
 * (main / hardcore / events), each with its own file. Pure functions: the fetching is in data.ts, the drawing in tab_wl.ts, the order of things in app.ts.
 */
import type { hubClient } from "@poe/core";

export interface LeagueOption {
  /** the league's name as the hub gives it; null for the main league when the hub gave no name (index not loaded) */
  name: string | null;
  /** what the dropdown shows */
  label: string;
  /** the hub file that names this league in the index (identifies the dropdown entry): `poe1/prices/latest.json`, `poe1/prices/hardcore/latest.json`, `poe2/prices/events/<slug>.json` */
  path: string;
  /**
   * the hub file the Whitelist tab's item names are read from. The lists do not use prices, and Hardcore has the same items as the
   * softcore main league (8.1c: the HC file is the main challenge league's counterpart only), so Hardcore reads the main league's file; main and events read their own.
   */
  listPath: string;
}

export const mainPath = (game: string): string => `${game}/prices/latest.json`;

/** A hub path from the index is fetched only when it is a prices file of this game (nothing else, no `..`). */
export function isPricesPath(game: string, path: unknown): path is string {
  return typeof path === "string" && path.startsWith(`${game}/prices/`) && path.endsWith(".json") && !path.includes("..") && /^[A-Za-z0-9_\-./]+$/.test(path);
}

/** The only league there is when the index could not be read: the main one, from latest.json. */
export const mainOnly = (game: string): LeagueOption[] => [{ name: null, label: "ลีกหลัก", path: mainPath(game), listPath: mainPath(game) }];

/** main first, then hardcore, then the events - the menu order of the Checker. Entries whose path is not a prices file of the game are left out. */
export function optionsFromFiles(game: string, files: hubClient.LeagueFiles): LeagueOption[] {
  const out: LeagueOption[] = [];
  const add = (name: string | null, path: string, listPath: string = path): void => {
    if (!isPricesPath(game, path) || (name !== null && out.some((o) => o.name === name))) return;
    out.push({ name, label: name || "ลีกหลัก", path, listPath });
  };
  add(files.main.league, files.main.path);
  if (!out.length) return mainOnly(game); // a main path that is not usable: the plain latest.json
  if (files.hardcore) add(files.hardcore.league, files.hardcore.path, out[0].listPath); // same names as the softcore main league: one file
  for (const e of files.events) add(e.league, e.path);
  return out;
}

/** The option for the league `wanted` (a name); the main league (the first option) when it is not offered any more. `note` says so. */
export function chooseOption(options: LeagueOption[], wanted: string | null | undefined): { option: LeagueOption; note: string | null } {
  const main = options[0];
  if (!wanted) return { option: main, note: null };
  const hit = options.find((o) => o.name === wanted);
  if (hit) return { option: hit, note: null };
  return { option: main, note: `ℹ ลีก "${wanted}" ไม่อยู่ในรายการของ hub แล้ว — ใช้ลีกหลักแทน${main.name ? ` (${main.name})` : ""}` };
}
