/** The few things every part of the page shares (one page, one state). */
import { WebApi } from "./api.ts";
import type { LeagueOption } from "./leagues.ts";

export interface ListData {
  hub: any;
  base: string | null;
  baseTag: string | null;
  names: string[] | null;
  namesFrom: string;
  /** {name: category} the whitelist adds from GGG's item list (names no other source has) */
  added: Record<string, string> | null;
  /** the hub file of the league these lists were made from (null = not loaded yet) */
  leaguePath: string | null;
}

/** what the tabs ask of the page (see app.ts) */
export interface Ctx {
  cfg: Record<string, any>;
  changed(): void;
  generate(mode: "tier" | "whitelist", refresh: boolean): Promise<boolean>;
  openFile(file: File): Promise<void>;
  gotoNsTab(): void;
  reloadLists(): Promise<void>;
  /** the league dropdown: the hub file (path) of the league picked */
  pickLeague(path: string): void;
  game(): string;
  /** "เปิด filter…": the folder's list / the file picker; `fallback` is the plain file input */
  openFilter(fallback: () => void): Promise<void>;
}

export const S = {
  /** the leagues of the game now on the page, and the one the lists come from */
  leagues: [] as LeagueOption[],
  league: null as LeagueOption | null,
  api: new WebApi(),
  cfg: {} as Record<string, any>,
  data: { hub: null, base: null, baseTag: null, names: null, namesFrom: "", added: null, leaguePath: null } as ListData,
  ctx: null as Ctx | null,
  /** set when "เปิด filter…" threw once: the next click goes straight to the plain file input */
  openFilterBroken: false,
};
