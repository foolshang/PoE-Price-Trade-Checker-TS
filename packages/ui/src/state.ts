/** The few things every part of the page shares (one page, one state). */
import { WebApi } from "./api.ts";

export interface ListData {
  hub: any;
  base: string | null;
  baseTag: string | null;
  names: string[] | null;
  namesFrom: string;
}

/** what the tabs ask of the page (see app.ts) */
export interface Ctx {
  cfg: Record<string, any>;
  changed(): void;
  generate(mode: "tier" | "whitelist", refresh: boolean): Promise<void>;
  openFile(file: File): Promise<void>;
  gotoNsTab(): void;
  reloadLists(): Promise<void>;
  game(): string;
  /** "เปิด filter…": the folder's list / the file picker; `fallback` is the plain file input */
  openFilter(fallback: () => void): Promise<void>;
}

export const S = {
  api: new WebApi(),
  cfg: {} as Record<string, any>,
  data: { hub: null, base: null, baseTag: null, names: null, namesFrom: "" } as ListData,
  ctx: null as Ctx | null,
  /** set when "เปิด filter…" threw once: the next click goes straight to the plain file input */
  openFilterBroken: false,
};
