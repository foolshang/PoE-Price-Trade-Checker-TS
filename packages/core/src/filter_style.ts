/**
 * Item style (colours, size, minimap icon, beam, alert sound) -> filter lines.
 * Port of poe_price_trade/filter_style.py. One style dict is edited by the style editor and turned into filter text here.
 *
 *   {"text": [r,g,b,a]|null, "border": ..., "bg": ..., "size": 18..45|null,
 *    "icon": {size 0..2, color, shape}|null, "effect": {color, temp}|null,
 *    "sound": {kind: none|game|file, id: 1..16, file, volume: 0..300}, "off": ["text", "sound", ...]}
 */
import { has, isDict, pyInt, pyStr, splitAll, truthy, PyError } from "./py.ts";

export type Style = Record<string, any>;

export const COLORS = ["Red", "Green", "Blue", "Brown", "White", "Yellow", "Cyan", "Grey", "Orange", "Pink", "Purple"];
export const SHAPES = ["Circle", "Diamond", "Hexagon", "Square", "Star", "Triangle", "Cross", "Moon", "Raindrop", "Kite",
  "Pentagon", "UpsideDownHouse"];
export const SOUND_IDS = Array.from({ length: 16 }, (_, i) => i + 1);
export const FONT_MIN = 18, FONT_MAX = 45;
export const VOLUME_MAX = 300;
export const DEFAULT_VOLUME = 300;
export const PARTS = ["text", "border", "bg", "size", "icon", "effect", "sound"];
/** filter keywords each part writes (what "off" removes from a base look) */
export const PART_KEYWORDS: Record<string, string[]> = {
  text: ["SetTextColor"], border: ["SetBorderColor"], bg: ["SetBackgroundColor"], size: ["SetFontSize"],
  icon: ["MinimapIcon"], effect: ["PlayEffect"], sound: ["PlayAlertSound", "CustomAlertSound", "CustomAlertSoundOptional"],
};

const clamp = (lo: number, hi: number, x: number): number => Math.max(lo, Math.min(hi, x));

/** [r, g, b] or [r, g, b, a] clamped to 0..255; anything else -> null. */
function rgba(v: unknown): number[] | null {
  if (!Array.isArray(v) || (v.length !== 3 && v.length !== 4)) return null;
  let out: number[];
  try {
    out = v.map((x) => clamp(0, 255, pyInt(x)));
  } catch (e) {
    if (e instanceof PyError) return null;
    throw e;
  }
  return out.length === 4 ? out : [...out, 255];
}

/** A clean style dict from whatever is stored in a config (unknown keys dropped, numbers clamped, bad values -> null). */
export function normalizeStyle(rawIn: unknown): Style {
  const raw: Record<string, any> = isDict(rawIn) ? rawIn : {};
  const out: Style = { text: rgba(raw.text), border: rgba(raw.border), bg: rgba(raw.bg) };
  const size = raw.size;
  if (size === undefined || size === null || size === "") out.size = null;
  else {
    try {
      out.size = clamp(FONT_MIN, FONT_MAX, pyInt(size));
    } catch {
      out.size = null;
    }
  }
  const icon = raw.icon;
  if (isDict(icon) && COLORS.includes(icon.color) && SHAPES.includes(icon.shape)) {
    try {
      out.icon = { size: clamp(0, 2, pyInt(has(icon, "size") ? icon.size : 0)), color: icon.color, shape: icon.shape };
    } catch {
      out.icon = null;
    }
  } else out.icon = null;
  const eff = raw.effect;
  out.effect = isDict(eff) && COLORS.includes(eff.color) ? { color: eff.color, temp: truthy(eff.temp) } : null;
  const snd: Record<string, any> = isDict(raw.sound) ? raw.sound : {};
  const kind = snd.kind === "game" || snd.kind === "file" ? snd.kind : "none";
  let vol: number;
  try {
    vol = clamp(0, VOLUME_MAX, pyInt(has(snd, "volume") ? snd.volume : DEFAULT_VOLUME));
  } catch {
    vol = DEFAULT_VOLUME;
  }
  let sid: number;
  try {
    sid = pyInt(has(snd, "id") ? snd.id : 1);
    sid = SOUND_IDS.includes(sid) ? sid : 1;
  } catch {
    sid = 1;
  }
  out.sound = { kind, id: sid, file: truthy(snd.file) ? pyStr(snd.file) : "", volume: vol };
  const off = raw.off;
  if (Array.isArray(off)) {
    const parts = [...new Set(off.filter((p) => PARTS.includes(p)))].sort();
    if (parts.length) out.off = parts;
  }
  return out;
}

/** True when the style would write nothing at all (= keep NeverSink's / the game's own). */
export function isEmpty(style: unknown): boolean {
  const s = normalizeStyle(style);
  return !["text", "border", "bg", "icon", "effect"].some((k) => truthy(s[k])) && s.size === null &&
    s.sound.kind === "none" && !truthy(s.off);
}

/** The source file name/path of a file sound, else null. */
export function usesSoundFile(style: unknown): string | null {
  const snd = normalizeStyle(style).sound;
  return snd.kind === "file" && snd.file ? snd.file : null;
}

/** Filter lines for the style, in NeverSink's order. `soundFile` is the name the sound was copied under. */
export function styleLines(style: unknown, soundFile: string | null | undefined = null, indent = "    "): string[] {
  const s = normalizeStyle(style);
  const out: string[] = [];
  if (s.size !== null) out.push(`${indent}SetFontSize ${s.size}`);
  for (const [key, kw] of [["text", "SetTextColor"], ["border", "SetBorderColor"], ["bg", "SetBackgroundColor"]] as const) {
    if (truthy(s[key])) out.push(`${indent}${kw} ` + (s[key] as number[]).join(" "));
  }
  const snd = s.sound;
  if (snd.kind === "game") out.push(`${indent}PlayAlertSound ${snd.id} ${snd.volume}`);
  else if (snd.kind === "file" && truthy(soundFile)) out.push(`${indent}CustomAlertSoundOptional "${soundFile}" ${snd.volume}`);
  if (s.effect) out.push(`${indent}PlayEffect ${s.effect.color}` + (s.effect.temp ? " Temp" : ""));
  if (s.icon) out.push(`${indent}MinimapIcon ${s.icon.size} ${s.icon.color} ${s.icon.shape}`);
  return out;
}

/** The style dict of filter style lines (SetFontSize / Set*Color / PlayAlertSound / PlayEffect / MinimapIcon). */
export function linesToStyle(lines: Iterable<string> | null | undefined): Style {
  const raw: Record<string, any> = { sound: { kind: "none" } };
  for (const line of lines ?? []) {
    const toks = splitAll(String(line));
    if (!toks.length) continue;
    const kw = toks[0], vals = toks.slice(1);
    try {
      if (kw === "SetFontSize") {
        if (!vals.length) continue;
        raw.size = pyInt(vals[0]);
      } else if (kw === "SetTextColor") raw.text = vals.map(pyInt);
      else if (kw === "SetBorderColor") raw.border = vals.map(pyInt);
      else if (kw === "SetBackgroundColor") raw.bg = vals.map(pyInt);
      else if (kw === "PlayAlertSound") {
        if (!vals.length) continue;
        const id = pyInt(vals[0]);
        raw.sound = { kind: "game", id, volume: vals.length > 1 ? pyInt(vals[1]) : DEFAULT_VOLUME };
      } else if (kw === "PlayEffect") {
        if (!vals.length) continue;
        raw.effect = { color: vals[0], temp: vals.slice(1).includes("Temp") };
      } else if (kw === "MinimapIcon") {
        if (vals.length < 3) continue;
        raw.icon = { size: pyInt(vals[0]), color: vals[1], shape: vals[2] };
      }
    } catch (e) {
      if (e instanceof PyError) continue;
      throw e;
    }
  }
  return normalizeStyle(raw);
}

/** `over` on top of `base`: every part `over` sets replaces the one of `base`; a part in over's "off" is removed. */
export function mergeStyles(base: unknown, over: unknown): Style {
  const b = normalizeStyle(base), o = normalizeStyle(over);
  const out: Style = { ...b };
  delete out.off;
  for (const k of ["text", "border", "bg", "size", "icon", "effect"]) {
    if (o[k] !== null && !(Array.isArray(o[k]) && o[k].length === 0)) out[k] = o[k];
  }
  if (o.sound.kind !== "none") out.sound = o.sound;
  for (const part of o.off ?? []) {
    out[part] = part === "sound" ? normalizeStyle({}).sound : null;
  }
  return out;
}

/** What the Q (quest items) editor starts from: green text, nothing else. */
export function defaultQuestStyle(): Style {
  const s = normalizeStyle({});
  s.text = [74, 230, 58, 255];
  return s;
}

function preset(kw: Style): Style {
  return { ...normalizeStyle({}), ...kw };
}

/** What the whitelist tab starts from for the things NeverSink has no matching block for. */
export const DEFAULT_STYLES: Record<string, Style> = {
  C: preset({ text: [190, 178, 135, 255], border: [120, 112, 85, 255], bg: [20, 20, 0, 255], size: 36,
    icon: { size: 2, color: "Grey", shape: "Circle" } }),
  G: preset({ text: [255, 215, 0, 255], border: [255, 215, 0, 255], bg: [40, 30, 0, 255], size: 40 }),
  Tablet: preset({ text: [0, 230, 230, 255], border: [0, 230, 230, 255], bg: [0, 30, 40, 255], size: 40,
    icon: { size: 1, color: "Cyan", shape: "Square" } }),
  Map: preset({ text: [255, 255, 255, 255], border: [200, 200, 200, 255], bg: [30, 30, 30, 255], size: 40,
    icon: { size: 1, color: "White", shape: "Diamond" } }),
};
