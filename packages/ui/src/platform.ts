/**
 * What differs between the browser page and a desktop shell around the same UI. The page uses the defaults below; the
 * Electron renderer installs its own with `setPlatform` before `boot`. Nothing here is a second UI: it only swaps where the
 * bytes come from (network through the main process, game folder through IPC) and adds the few desktop-only rows.
 */
export interface HttpResult { ok: boolean; status: number; text: string }

export interface Controls {
  game(): string;
  /** true when a filter was made and handed over */
  generate(mode: "tier" | "whitelist", refresh: boolean): Promise<boolean>;
  log(text: string, tag?: string): void;
  /** the NeverSink version recorded by the last tier generate (config `neversink_tag_<game>`) etc. live in the config */
  cfg(): Record<string, any>;
}

export interface Platform {
  kind: "web" | "desktop";
  /** GET a text file from the network (the desktop goes through the main process: no CORS, host allow-list) */
  getText(url: string, headers?: Record<string, string>): Promise<HttpResult>;
  /** the real item names from somewhere better than the shipped snapshot (desktop: GGG's trade data, 7-day cache) */
  getNames?(game: string): Promise<string[] | null>;
  /** after a successful generate (desktop: remember the name and the NeverSink tag in the config) */
  afterGenerate?(info: { mode: string; game: string; name: string; baseTag: string | null; path?: string }): void | Promise<void>;
  /** after the saved settings and the sound slots are loaded, before the game is set up (desktop: sounds of the original program) */
  beforeStart?(game: string): Promise<void>;
  /** right after the page skeleton is drawn, before anything else is logged (desktop: the first Status line) */
  onShell?(log: (text: string, tag?: string) => void): void;
  /** once, when the page is up (desktop: the NeverSink update check) */
  onReady?(ctl: Controls): void;
  /** extra rows at the end of the NeverSink tab (desktop: "regenerate automatically when NeverSink has a new version") */
  nsExtras?(cfg: Record<string, any>, changed: () => void): HTMLElement[];
  /** where an opened file lies: the folder Generate writes back to (desktop: the game folder override) */
  adoptOpenedDir?(game: string): Promise<void>;
}

async function fetchResult(url: string, headers?: Record<string, string>): Promise<HttpResult> {
  const resp = await fetch(url, headers ? { headers } : undefined);
  return { ok: resp.ok, status: resp.status, text: resp.ok ? await resp.text() : "" };
}

let current: Platform = { kind: "web", getText: fetchResult };

export const platform = (): Platform => current;
export function setPlatform(p: Platform): void {
  current = p;
}
