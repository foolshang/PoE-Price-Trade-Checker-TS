/**
 * Python-semantics helpers. The filter engines were written in Python; to give the same bytes the TS port needs the
 * same answers for truthiness, `int()`, `str.strip()`, `sorted()` on strings, `json.dumps`, ... (see docs/PLAN.md R2/R4).
 * No DOM / node imports: runs in the browser, Node and Electron.
 */

export class PyError extends Error {
  constructor(public kind: "ValueError" | "TypeError" | "IndexError" | "KeyError", message: string) {
    super(message);
  }
}

export type Log = (msg: string, tag?: string) => void;
export const noopLog: Log = () => {};

// Characters str.isspace() / str.strip() / str.split() treat as white space.
const WS = "\\t\\n\\v\\f\\r\\x1c-\\x1f \\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000";
const WS_RE = new RegExp(`[${WS}]`);
const LSTRIP_RE = new RegExp(`^[${WS}]+`);
const RSTRIP_RE = new RegExp(`[${WS}]+$`);
/** Python `\s` (Unicode str pattern) as a character-class body, for use inside RegExp sources. */
export const PY_S = WS;

export const isSpace = (c: string): boolean => c.length > 0 && WS_RE.test(c);
/** `s[:1].isspace()` */
export const firstIsSpace = (s: string): boolean => s.length > 0 && isSpace(s[0]);
export const pyStrip = (s: string): string => s.replace(LSTRIP_RE, "").replace(RSTRIP_RE, "");
export const pyLstrip = (s: string): string => s.replace(LSTRIP_RE, "");
export const pyRstrip = (s: string): string => s.replace(RSTRIP_RE, "");

/** `s.rstrip(chars)` with an explicit character set. */
export function rstripChars(s: string, chars: string): string {
  let end = s.length;
  while (end > 0 && chars.includes(s[end - 1])) end--;
  return s.slice(0, end);
}

/** `s.split(None, maxsplit)` */
export function splitWs(s: string, maxsplit = -1): string[] {
  const out: string[] = [];
  let i = 0;
  const n = s.length;
  while (i < n) {
    while (i < n && isSpace(s[i])) i++;
    if (i >= n) break;
    if (maxsplit >= 0 && out.length === maxsplit) {
      out.push(s.slice(i));
      return out;
    }
    let j = i;
    while (j < n && !isSpace(s[j])) j++;
    out.push(s.slice(i, j));
    i = j;
  }
  return out;
}

/** `s.split()` (no arguments) */
export const splitAll = (s: string): string[] => splitWs(s, -1);

/** `s.splitlines()` */
export function splitLines(s: string): string[] {
  const out: string[] = [];
  let start = 0;
  const n = s.length;
  for (let i = 0; i < n; i++) {
    const c = s[i];
    if (c === "\n" || c === "\r" || c === "\v" || c === "\f" || c === "\x1c" || c === "\x1d" || c === "\x1e" ||
        c === "\x85" || c === " " || c === " ") {
      out.push(s.slice(start, i));
      if (c === "\r" && s[i + 1] === "\n") i++;
      start = i + 1;
    }
  }
  if (start < n) out.push(s.slice(start));
  return out;
}

/** `list[i]` with Python's negative indexes; IndexError when out of range. */
export function pyIndex<T>(arr: readonly T[], i: number): T {
  const j = i < 0 ? arr.length + i : i;
  if (j < 0 || j >= arr.length) throw new PyError("IndexError", "list index out of range");
  return arr[j];
}

/** Python truthiness */
export function truthy(v: unknown): boolean {
  if (v === null || v === undefined || v === false || v === 0 || v === "") return false;
  if (typeof v === "number") return !Number.isNaN(v) ? v !== 0 : true;
  if (Array.isArray(v)) return v.length > 0;
  if (v instanceof Map || v instanceof Set) return v.size > 0;
  if (typeof v === "object") return Object.keys(v as object).length > 0;
  return true;
}

export const isDict = (v: unknown): v is Record<string, any> =>
  v !== null && typeof v === "object" && !Array.isArray(v) && !(v instanceof Map) && !(v instanceof Set);
export const isList = (v: unknown): v is any[] => Array.isArray(v);

const hasOwn = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);
/** `d.get(key)` on a plain object (own keys only, so "constructor" is not a method). */
export function get<T = any>(o: unknown, key: string, dflt?: T): T | undefined {
  if (o !== null && typeof o === "object" && !Array.isArray(o) && hasOwn(o as object, key)) {
    return (o as any)[key];
  }
  return dflt;
}
export const has = (o: unknown, key: string): boolean =>
  o !== null && typeof o === "object" && !Array.isArray(o) && hasOwn(o as object, key);

/** `int(x)` for the values a JSON config can hold. Raises PyError like Python. */
export function pyInt(v: unknown): number {
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "number") {
    if (!Number.isFinite(v)) throw new PyError("ValueError", "cannot convert float to integer");
    return Math.trunc(v);
  }
  if (typeof v === "string") {
    const t = pyStrip(v);
    if (!/^[+-]?[0-9]+(_[0-9]+)*$/.test(t)) throw new PyError("ValueError", `invalid literal for int(): ${JSON.stringify(v)}`);
    return parseInt(t.replace(/_/g, ""), 10);
  }
  throw new PyError("TypeError", "int() argument must be a string or a real number");
}

/** `try: int(x) except (TypeError, ValueError): dflt` */
export function intOr(v: unknown, dflt: number): number {
  try {
    return pyInt(v);
  } catch {
    return dflt;
  }
}

/** `str(x)` for strings / integers / bool / None (what the engines print). */
export function pyStr(v: unknown): string {
  if (v === null || v === undefined) return "None";
  if (v === true) return "True";
  if (v === false) return "False";
  return String(v);
}

/** Code point comparison, what Python's `<` does on str (JS compares UTF-16 code units). */
export function cmpStr(a: string, b: string): number {
  if (a === b) return 0;
  const la = a.length, lb = b.length;
  const n = Math.min(la, lb);
  for (let i = 0; i < n; ) {
    const ca = a.codePointAt(i)!, cb = b.codePointAt(i)!;
    if (ca !== cb) return ca < cb ? -1 : 1;
    i += ca > 0xffff ? 2 : 1;
  }
  return la === lb ? 0 : la < lb ? -1 : 1;
}

/** Element-wise tuple comparison; numbers and strings. */
export function cmpTuple(a: readonly (string | number)[], b: readonly (string | number)[]): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = a[i], y = b[i];
    const c = typeof x === "string" && typeof y === "string" ? cmpStr(x, y) : (x as number) < (y as number) ? -1 : (x as number) > (y as number) ? 1 : 0;
    if (c) return c;
  }
  return a.length === b.length ? 0 : a.length < b.length ? -1 : 1;
}

/** `sorted(strings)` */
export const sortedStr = (it: Iterable<string>): string[] => [...it].sort(cmpStr);

/** `sorted(set(...))` */
export const sortedSet = (it: Iterable<string>): string[] => sortedStr(new Set(it));

/** `dict.fromkeys(items)` keys, i.e. de-duplicate keeping first occurrence */
export const uniq = <T>(it: Iterable<T>): T[] => [...new Set(it)];

/** Stable sort by a key function returning a comparable tuple. */
export function sortedBy<T>(items: Iterable<T>, key: (x: T) => readonly (string | number)[]): T[] {
  const arr = [...items].map((x, i) => ({ x, k: key(x), i }));
  arr.sort((p, q) => cmpTuple(p.k, q.k) || p.i - q.i);
  return arr.map((p) => p.x);
}

// ---------------------------------------------------------------------------------------------------------------
// json.dumps(obj, ensure_ascii=True, sort_keys=?, separators=?)
// ---------------------------------------------------------------------------------------------------------------

function pyFloatRepr(x: number): string {
  if (Number.isInteger(x)) return String(x);
  // JS and Python both print the shortest round-trip digits; only the exponent notation differs.
  const abs = Math.abs(x);
  if (abs >= 1e16 || abs < 1e-4) {
    let s = x.toExponential();
    s = s.replace(/e([+-])(\d)$/, "e$10$2");
    return s;
  }
  return String(x);
}

function jsonStr(s: string, ensureAscii: boolean): string {
  let out = '"';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    const ch = s[i];
    if (ch === '"') out += '\\"';
    else if (ch === "\\") out += "\\\\";
    else if (ch === "\n") out += "\\n";
    else if (ch === "\r") out += "\\r";
    else if (ch === "\t") out += "\\t";
    else if (ch === "\b") out += "\\b";
    else if (ch === "\f") out += "\\f";
    else if (c < 0x20 || (ensureAscii && c > 0x7e)) {
      out += "\\u" + c.toString(16).padStart(4, "0");
    } else out += ch;
  }
  return out + '"';
}

export interface DumpsOptions {
  sortKeys?: boolean;
  ensureAscii?: boolean;
  /** [item separator, key separator]; default Python's (", ", ": ") */
  separators?: [string, string];
  indent?: number;
}

/** Python's `json.dumps`. Integer-valued numbers print as ints (a Python float 1.0 cannot be told apart in JS). */
export function dumps(value: unknown, opts: DumpsOptions = {}): string {
  const ensureAscii = opts.ensureAscii ?? true;
  const sortKeys = opts.sortKeys ?? false;
  const [isep, ksep] = opts.separators ?? (opts.indent !== undefined ? [",", ": "] : [", ", ": "]);
  const ind = opts.indent;
  const rec = (v: unknown, level: number): string => {
    if (v === null || v === undefined) return "null";
    if (v === true) return "true";
    if (v === false) return "false";
    if (typeof v === "number") {
      if (!Number.isFinite(v)) return Number.isNaN(v) ? "NaN" : v > 0 ? "Infinity" : "-Infinity";
      return pyFloatRepr(v);
    }
    if (typeof v === "string") return jsonStr(v, ensureAscii);
    const nl = ind !== undefined ? "\n" + " ".repeat(ind * (level + 1)) : "";
    const end = ind !== undefined ? "\n" + " ".repeat(ind * level) : "";
    const sep = ind !== undefined ? isep + nl : isep;
    if (Array.isArray(v) || v instanceof Set) {
      const arr = [...(v as Iterable<unknown>)];
      if (!arr.length) return "[]";
      return "[" + nl + arr.map((x) => rec(x, level + 1)).join(sep) + end + "]";
    }
    let entries: [string, unknown][] = v instanceof Map ? [...v.entries()] as [string, unknown][] : Object.entries(v as object);
    if (sortKeys) entries = entries.sort((a, b) => cmpStr(a[0], b[0]));
    if (!entries.length) return "{}";
    return "{" + nl + entries.map(([k, x]) => jsonStr(k, ensureAscii) + ksep + rec(x, level + 1)).join(sep) + end + "}";
  };
  return rec(value, 0);
}

// ---------------------------------------------------------------------------------------------------------------
// base64 (no node Buffer)
// ---------------------------------------------------------------------------------------------------------------

export function b64encode(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export function b64decode(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
