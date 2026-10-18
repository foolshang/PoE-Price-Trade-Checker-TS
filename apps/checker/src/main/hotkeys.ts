/**
 * The hotkeys the player may choose in the settings window: what a hotkey text means, which ones are refused (they clash with keys the
 * game or every text box uses) and when two hotkeys of the program are the same. Free of Electron, so it is tested on its own.
 */

export interface Hotkey {
  /** the hotkey the way Electron wants it: "Ctrl+Alt+Q", "F4" */
  accelerator: string;
  /** the same hotkey in one spelling (modifiers in a fixed order): two texts of the same key are equal here */
  canonical: string;
  mods: string[];
  key: string;
}

export type ParsedHotkey = { ok: true; hotkey: Hotkey } | { ok: false; reason: string };

const MOD_ORDER = ["Ctrl", "Alt", "Shift", "Win"];
const MOD_ALIASES: Record<string, string> = {
  ctrl: "Ctrl", control: "Ctrl", alt: "Alt", shift: "Shift", win: "Win", windows: "Win", super: "Win", meta: "Win",
};
const NAMED_KEYS: Record<string, string> = {
  space: "Space", tab: "Tab", backspace: "Backspace", delete: "Delete", del: "Delete", insert: "Insert", ins: "Insert",
  enter: "Enter", return: "Enter", up: "Up", down: "Down", left: "Left", right: "Right", home: "Home", end: "End",
  pageup: "PageUp", pagedown: "PageDown", escape: "Esc", esc: "Esc",
};

/** The key of a hotkey text, in one spelling; null when it is not a key this program can register. */
function keyName(token: string): string | null {
  const t = token.trim();
  if (/^[a-z]$/i.test(t)) return t.toUpperCase();
  if (/^[0-9]$/.test(t)) return t;
  const f = /^f([1-9]|1[0-9]|2[0-4])$/i.exec(t);
  if (f) return `F${f[1]}`;
  return NAMED_KEYS[t.toLowerCase()] ?? null;
}

/** "F4", "Ctrl+Alt+Q", "ctrl + shift + f9" ... -> the hotkey, or why the text is not one. */
export function parseHotkey(text: unknown): ParsedHotkey {
  if (typeof text !== "string" || !text.trim()) return { ok: false, reason: "ยังไม่ได้ใส่ปุ่ม" };
  const parts = text.split("+").map((p) => p.trim());
  if (parts.some((p) => !p)) return { ok: false, reason: 'รูปแบบไม่ถูก — ใช้ เช่น F4 หรือ Ctrl+Alt+Q (คั่นด้วย "+")' };
  const mods = new Set<string>();
  let key: string | null = null;
  for (const p of parts) {
    const m = MOD_ALIASES[p.toLowerCase()];
    if (m) {
      if (mods.has(m)) return { ok: false, reason: `ใส่ ${m} ซ้ำ` };
      mods.add(m);
      continue;
    }
    const k = keyName(p);
    if (!k) return { ok: false, reason: `ไม่รู้จักปุ่ม "${p}" — ใช้ A-Z, 0-9, F1-F24, Insert, Space, Tab, PageUp ... ` };
    if (key) return { ok: false, reason: "ใส่ปุ่มได้แค่ 1 ปุ่ม (ร่วมกับ Ctrl / Alt / Shift)" };
    key = k;
  }
  if (!key) return { ok: false, reason: "มีแต่ Ctrl / Alt / Shift — ต้องมีปุ่มหลักด้วย" };
  const ordered = MOD_ORDER.filter((m) => mods.has(m));
  const canonical = [...ordered, key].join("+");
  const accelerator = [...ordered.map((m) => (m === "Win" ? "Super" : m)), key === "Esc" ? "Escape" : key === "Enter" ? "Return" : key].join("+");
  return { ok: true, hotkey: { accelerator, canonical, mods: ordered, key } };
}

const GAME_KEYS = new Set(["Home", "Delete", "Enter", "Up", "Down", "Left", "Right"]);

/**
 * The reason a hotkey must not be used, or null when it may. Refused: the keys the game or every text box uses (Ctrl+C, Ctrl+V,
 * Ctrl+A, Ctrl+F, Ctrl+Enter, Home, Delete, Enter, the arrows) and a letter / digit / Space / Tab on its own (it would be taken away from
 * the game's skills and from typing).
 */
export function forbiddenReason(h: Hotkey): string | null {
  const onlyCtrl = h.mods.length === 1 && h.mods[0] === "Ctrl";
  if (onlyCtrl && ["C", "V", "A", "F"].includes(h.key)) return `Ctrl+${h.key} ใช้ในเกมและในช่องพิมพ์ทุกที่ (คัดลอก / วาง / เลือกทั้งหมด / ค้นหา) — เลือกปุ่มอื่น`;
  if (onlyCtrl && h.key === "Enter") return "Ctrl+Enter ใช้ในเกม (แชท) — เลือกปุ่มอื่น";
  if (GAME_KEYS.has(h.key)) return `ปุ่ม ${h.key} ใช้ในเกม (Home / Delete / Enter / ลูกศร) — เลือกปุ่มอื่น`;
  if (h.mods.length === 0 && (/^[A-Z0-9]$/.test(h.key) || h.key === "Space" || h.key === "Tab" || h.key === "Backspace")) {
    return `ปุ่ม ${h.key} เดี่ยวๆ ใช้เล่นเกมและพิมพ์ข้อความ — ใช้ปุ่ม F1-F24 หรือกด Ctrl / Alt ร่วมด้วย`;
  }
  return null;
}

export interface HotkeyFields<T extends string> {
  /** field name -> text */
  values: Record<T, string>;
  /** the names in the order they are checked (the first of two equal hotkeys is accepted, the second is the duplicate) */
  order: T[];
  /** how the program calls each field in a message */
  labels: Record<T, string>;
}

/** The problems of a set of hotkey fields: field -> message (empty = all fine). Every field is checked on its own, then against the others. */
export function checkHotkeys<T extends string>(f: HotkeyFields<T>): Partial<Record<T, string>> {
  const errors: Partial<Record<T, string>> = {};
  const seen = new Map<string, T>();
  for (const name of f.order) {
    const p = parseHotkey(f.values[name]);
    if (!p.ok) {
      errors[name] = p.reason;
      continue;
    }
    const bad = forbiddenReason(p.hotkey);
    if (bad) {
      errors[name] = bad;
      continue;
    }
    const other = seen.get(p.hotkey.canonical);
    if (other) {
      errors[name] = `ซ้ำกับปุ่ม "${f.labels[other]}" (${p.hotkey.canonical}) — แต่ละปุ่มต้องไม่ซ้ำกัน`;
      continue;
    }
    seen.set(p.hotkey.canonical, name);
  }
  return errors;
}
