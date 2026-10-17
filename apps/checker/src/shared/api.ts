/**
 * What each window of the Checker gets from the main process. Three windows, three small bridges: the main window cannot search
 * skills, the picker cannot change the game, the skill window cannot open the browser. No window gets the network, the file system
 * or a path; the main process does the work and sends the result.
 */
export type GameId = "poe1" | "poe2";
export type Tag = "ok" | "err" | "warn" | "info" | "dim";

// ------------------------------------------------------------------------------------------------ main window
export interface MainInit {
  version: string;
  buildTime: string;
  configDir: string;
  game: GameId;
  league: string;
  leagues: string[];
  hotkeys: { scan: string; trade: string; quit: string };
  /** lines for the Status that were produced before the window was ready (hotkey problems, config import ...) */
  log: [string, Tag][];
}

export interface MainApi {
  init(): Promise<MainInit>;
  setGame(game: GameId): void;
  setLeague(league: string): void;
  refreshLeagues(): void;
  onLog(cb: (text: string, tag: Tag) => void): void;
  onLeagues(cb: (leagues: string[], picked: string) => void): void;
}

// ------------------------------------------------------------------------------------------------ picker (F5)
export interface PickerRowData {
  text: string;
  /** explicit / implicit / desecrated / rune / enchant / fractured */
  modType: string;
  /** the stat id was found (the row can be ticked) */
  searchable: boolean;
  /** the value the min box starts with (Python's "{:g}"), "" when the line has no number */
  min: string;
  badge: string | null;
  arrow: string | null;
  affix: string;
  /** [Tn/total] and the money flag from the meta */
  tier: number;
  total: number;
  money: boolean;
}

export interface PickerInit {
  head: string;
  sub: string;
  summary: string;
  rows: PickerRowData[];
}

export interface PickerFilter {
  /** index of the row */
  row: number;
  min: string;
  max: string;
}

export interface PickerApi {
  onInit(cb: (data: PickerInit) => void): void;
  /** the page is drawn: its size, so the window can be sized, put near the mouse and shown */
  ready(size: { width: number; height: number }): void;
  search(filters: PickerFilter[]): void;
  cancel(): void;
}

// ------------------------------------------------------------------------------------------------ skill reference (F4)
export interface SkillHit { skillType: string; skill: string; facetCount: number }
export interface SkillMod { text: string; usagePct: number; valueMin: number | null; valueMax: number | null }
export interface SkillPassive { keypassive: string; usagePct: number }

export interface SkillDetail {
  skillType: string;
  skill: string;
  populations: Record<string, number>;
  /** bracket -> slot -> mods */
  mods: Record<string, Record<string, SkillMod[]>>;
  /** bracket -> passives */
  passives: Record<string, SkillPassive[]>;
}

export interface SkillApi {
  /** false = the hub data could not be loaded (the window says so) */
  init(): Promise<{ available: boolean }>;
  search(prefix: string): Promise<SkillHit[]>;
  select(skillType: string, skill: string): Promise<SkillDetail>;
  resize(size: { width: number; height: number }): void;
  ready(size: { width: number; height: number }): void;
  close(): void;
}

declare global {
  interface Window {
    checker?: MainApi;
    picker?: PickerApi;
    skillRef?: SkillApi;
  }
}
