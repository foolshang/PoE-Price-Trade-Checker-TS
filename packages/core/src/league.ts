/** Which league the program uses, from the hub's routing table. Port of App._update_league_menu / _pick_league (poe_price_trade/app.py). */
import { LeagueFiles } from "./hub_client.ts";
import { truthy } from "./py.ts";

export interface LeagueChoice {
  /** false = the hub has no league for this game (the caller loads from the disk cache instead) */
  ok: boolean;
  /** league name -> hub file path, in menu order: main, hardcore, events */
  leaguePaths: Record<string, string>;
  leagues: string[];
  picked: string;
  /** [message, tag] lines for the Status */
  logs: [string, string][];
}

/** auto_pick: main (or hardcore when `preferHc`); otherwise the current league if the hub still has it, else main. */
export function chooseLeague(files: LeagueFiles, opts: { autoPick: boolean; preferHc: boolean; current: string }): LeagueChoice {
  const logs: [string, string][] = [];
  const main = files.main ?? { league: null, path: "" };
  if (!truthy(main.league)) {
    logs.push(["✗ hub ไม่มีข้อมูลลีกสำหรับเกมนี้ — ลองโหลดจาก disk cache เดิม", "err"]);
    return { ok: false, leaguePaths: {}, leagues: [], picked: "", logs };
  }
  const leaguePaths: Record<string, string> = {};
  leaguePaths[main.league!] = main.path;
  if (files.hardcore) leaguePaths[files.hardcore.league] = files.hardcore.path;
  for (const e of files.events ?? []) leaguePaths[e.league] = e.path;
  const leagues = Object.keys(leaguePaths);

  let picked: string;
  if (opts.autoPick) {
    if (opts.preferHc && files.hardcore) picked = files.hardcore.league;
    else {
      if (opts.preferHc) logs.push(["⚠ ไม่มี Hardcore league ให้ใช้ตอนนี้ — ใช้ main league แทน", "warn"]);
      picked = main.league!;
    }
  } else picked = leagues.includes(opts.current) ? opts.current : main.league!;
  logs.push([`✓ พบ ${leagues.length} leagues`, "ok"]);
  return { ok: true, leaguePaths, leagues, picked, logs };
}
