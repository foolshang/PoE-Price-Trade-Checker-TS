/**
 * config.json of the apps - the exact rules of poe_price_trade/config.py (known keys only, dict-valued defaults merge key by
 * key), plus the one-time import from the original program's folder. The original's files are only ever READ here.
 */
import { promises as fsp } from "node:fs";
import path from "node:path";

export const CONFIG_FILE = "config.json";
export const IMPORT_MARKER = "imported-from-PoeFilterGen.txt";

export const DEFAULTS: Record<string, any> = {
  game_version: "poe2",
  league: "",
  prefer_hardcore: false,
  auto_league: true,
  currency_unit: "auto",
  overlay_opacity: 0.85,
  price_offset_px: 2,
  hotkey_scan: "F4",
  hotkey_trade: "F5",
  hotkey_settings: "F8",
  hotkey_quit: "Ctrl+Alt+Q",
  match_threshold: 0.8,
  log_level: "INFO",
  mod_badge_archetype: "all",
  close_action: "minimize",
  f4_mode: "price",
  filter_gen: {
    strictness_poe1: 2, strictness_poe2: 2,
    sound_s: "", sound_a: "", sound_b: "", sound_c: "",
    game_dir_poe1: "", game_dir_poe2: "",
    staleness_hours: 24, regen_cooldown_min: 60, auto_regen: true,
  },
};

const isDict = (v: unknown): v is Record<string, any> => v !== null && typeof v === "object" && !Array.isArray(v);

/** The settings a saved file means: the defaults with every known saved key on top (dicts merged key by key). */
export function mergeSaved(saved: unknown, defaults: Record<string, any> = DEFAULTS): Record<string, any> {
  const data: Record<string, any> = structuredClone(defaults);
  if (isDict(saved)) {
    for (const [k, def] of Object.entries(defaults)) {
      if (!(k in saved)) continue;
      data[k] = isDict(def) && isDict(saved[k]) ? { ...def, ...saved[k] } : saved[k];
    }
  }
  if (data.hotkey_scan === "F9") data.hotkey_scan = "F4"; // (the original's migration)
  return data;
}

/** Parse the text of a config.json (a UTF-8 BOM is allowed); null when it is not a JSON object. */
export function parseConfigText(text: string): Record<string, any> | null {
  try {
    const v = JSON.parse(text.replace(/^﻿/, ""));
    return isDict(v) ? v : null;
  } catch {
    return null;
  }
}

export class AppConfig {
  data: Record<string, any>;
  constructor(private dir: string, private defaults: Record<string, any> = DEFAULTS) {
    this.data = structuredClone(defaults);
  }

  appDir(): string {
    return this.dir;
  }

  async load(): Promise<void> {
    let saved: unknown = null;
    try {
      saved = parseConfigText(await fsp.readFile(path.join(this.dir, CONFIG_FILE), "utf-8"));
    } catch { /* none yet */ }
    this.data = mergeSaved(saved, this.defaults);
  }

  /** Written to a temp file and renamed over config.json: a program that is killed in the middle of a save leaves the old file, never a half one. */
  async save(): Promise<void> {
    await fsp.mkdir(this.dir, { recursive: true });
    const file = path.join(this.dir, CONFIG_FILE);
    const tmp = `${file}.${process.pid}.tmp`;
    await fsp.writeFile(tmp, JSON.stringify(this.data, null, 2), "utf-8");
    await fsp.rename(tmp, file);
  }

  get(key: string, dflt: any = null): any {
    return key in this.data ? this.data[key] : dflt;
  }
  set(key: string, value: any): void {
    this.data[key] = value;
  }
}

export interface ImportResult {
  status: "imported" | "already" | "no-old-config" | "unreadable";
  message: string;
}

/**
 * First start of the app: take the original's config (`oldDir`\config.json) once. The new folder gets the merged config and
 * a marker file; nothing in `oldDir` is written. A new folder that already has a config.json is never overwritten.
 */
export async function importOldConfig(newDir: string, oldDir: string, opts: { defaults?: Record<string, any>; marker?: string } = {}): Promise<ImportResult> {
  const defaults = opts.defaults ?? DEFAULTS;
  const mine = path.join(newDir, CONFIG_FILE);
  const marker = path.join(newDir, opts.marker ?? IMPORT_MARKER);
  const exists = async (p: string): Promise<boolean> => fsp.stat(p).then(() => true, () => false);
  if ((await exists(marker)) || (await exists(mine))) return { status: "already", message: "" };
  const oldFile = path.join(oldDir, CONFIG_FILE);
  let text: string;
  try {
    text = await fsp.readFile(oldFile, "utf-8");
  } catch {
    return { status: "no-old-config", message: "" };
  }
  const parsed = parseConfigText(text);
  if (parsed === null) return { status: "unreadable", message: `ค่าเดิมอ่านไม่ได้ (${oldFile}) — เริ่มด้วยค่าเริ่มต้น ไฟล์เดิมไม่ถูกแตะ` };
  await fsp.mkdir(newDir, { recursive: true });
  await fsp.writeFile(mine, JSON.stringify(mergeSaved(parsed, defaults), null, 2), "utf-8");
  await fsp.writeFile(marker, `imported once from ${oldFile} at ${new Date().toISOString()}\nthe original's files are never written\n`, "utf-8");
  return { status: "imported", message: `นำเข้าค่าจากโปรแกรมเดิมแล้ว (${oldFile}) — ไฟล์เดิมไม่ถูกแก้` };
}

/**
 * The Checker keeps the keys of the original that the new program still reads. The price-scan keys (overlay, scan, hover, match,
 * currency unit, f4_mode, ...) are not here: a saved config that has them is read and the keys are dropped, no error.
 */
export const CHECKER_DEFAULTS: Record<string, any> = {
  game_version: "poe2",
  league: "",
  prefer_hardcore: false,
  auto_league: true,
  hotkey_scan: "F4",
  hotkey_trade: "F5",
  hotkey_settings: "F8",
  hotkey_quit: "Ctrl+Alt+Q",
  log_level: "INFO",
  mod_badge_archetype: "all",
  close_action: "minimize",
  f5_mod_picker: true,
  filter_gen: structuredClone(DEFAULTS.filter_gen),
};
