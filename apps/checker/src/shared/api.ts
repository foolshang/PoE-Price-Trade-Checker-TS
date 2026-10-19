/**
 * What each window of the Checker gets from the main process. Small bridges, one per window: the main window cannot search skills, the
 * picker cannot change the game, the skill window cannot open the browser, the settings window cannot read the file system. (The filter
 * page has the bridge of @poe/desktop.) No window gets the network, the file system or a path; the main process does the work and
 * sends the result.
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
  hotkeys: Hotkeys;
  /** lines for the Status that were produced before the window was ready (hotkey problems, config import ...) */
  log: [string, Tag][];
}

export interface Hotkeys { scan: string; trade: string; settings: string; quit: string }

export interface MainApi {
  init(): Promise<MainInit>;
  openSettings(): void;
  openFilter(): void;
  setGame(game: GameId): void;
  setLeague(league: string): void;
  refreshLeagues(): void;
  onLog(cb: (text: string, tag: Tag) => void): void;
  onLeagues(cb: (leagues: string[], picked: string) => void): void;
  /** the game was changed somewhere else (settings window, filter page) */
  onGame(cb: (game: GameId) => void): void;
  onHotkeys(cb: (hotkeys: Hotkeys) => void): void;
  /** the player opened the program while something new waited (a newer version, a NeverSink release): the details of all of it */
  onDetails(cb: (details: Details) => void): void;
}

export interface Details {
  update?: { version: string; notes: string };
  neversink?: string;
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
  /** nodata = the mod has no stat id (nothing could be looked up); norow = the stat is known, the hub has no row for this slot; plain = the hub has it, not popular; null = no badge for this item */
  badgeNote: "nodata" | "norow" | "plain" | null;
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

// ------------------------------------------------------------------------------------------------ settings (F8)
export interface SettingsValues {
  game_version: GameId;
  auto_league: boolean;
  prefer_hardcore: boolean;
  mod_badge_archetype: string;
  f5_restore_clipboard: boolean;
  /** follow the game that is in front (PoE 1 / PoE 2) */
  auto_game: boolean;
  /** "automatic update": a newer version is downloaded in the background (nothing is installed unless the player chooses) */
  auto_update: boolean;
  hotkey_scan: string;
  hotkey_trade: string;
  hotkey_settings: string;
  hotkey_quit: string;
  log_level: string;
  close_action: "minimize" | "exit";
}

export interface SettingsInit {
  values: SettingsValues;
  /** false = the tray icon could not be made: the X button always closes the program */
  trayOk: boolean;
  version: string;
  archetypes: string[];
  logLevels: string[];
  /** the keys the program presses itself to make the game copy an item (not allowed as hotkeys), read from the game's settings */
  copyKeysNote: string;
}

/** field -> the message to show next to it */
export type SettingsErrors = Partial<Record<keyof SettingsValues, string>>;
export type SettingsResult = { ok: true } | { ok: false; errors: SettingsErrors };

export interface SettingsApi {
  init(): Promise<SettingsInit>;
  /** the problems of these values (nothing is changed): hotkeys that clash with the game, duplicates ... */
  check(values: SettingsValues): Promise<SettingsErrors>;
  /** check, register the hotkeys at once, save; ok = the window may close */
  apply(values: SettingsValues): Promise<SettingsResult>;
  cancel(): void;
}

// ------------------------------------------------------------------------------------------------ the message over the game
export interface OverlayApi {
  onShow(cb: (text: string, color: string) => void): void;
  /** the label is drawn: its size, so the window can be sized, put at the bottom right and shown without taking the focus */
  ready(size: { width: number; height: number }): void;
}

declare global {
  interface Window {
    checker?: MainApi;
    picker?: PickerApi;
    skillRef?: SkillApi;
    settings?: SettingsApi;
    overlay?: OverlayApi;
  }
}
