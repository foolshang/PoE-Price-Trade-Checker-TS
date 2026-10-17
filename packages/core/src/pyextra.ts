/**
 * More Python semantics the item / trade code depends on: `float(str)`, `round(x, n)`, `f"{x:g}"`, `urllib.parse.quote`,
 * `\d` (any Unicode decimal digit) and `str.isalnum()`. No DOM / node imports.
 */
import { PyError, pyStrip } from "./py.ts";

// ---------------------------------------------------------------------------------------------------------------
// Unicode decimal digits: Python's `\d` matches every Nd character and float() / int() read them
// ---------------------------------------------------------------------------------------------------------------

/** Regex source for `\d` of a Python str pattern (use with the `u` flag). */
export const D = "\\p{Nd}";

let digitStarts: number[] | null = null;

/** The value 0-9 of a decimal digit character. */
export function digitValue(ch: string): number {
  const cp = ch.codePointAt(0)!;
  if (cp >= 48 && cp <= 57) return cp - 48;
  if (!digitStarts) {
    // every Nd character comes in runs that are multiples of 10 long, each set of 10 starting at the zero digit
    digitStarts = [];
    const nd = /^\p{Nd}$/u;
    let runStart = -1;
    for (let c = 0; c <= 0x1ffff; c++) {
      const isNd = nd.test(String.fromCodePoint(c));
      if (isNd && runStart < 0) runStart = c;
      if (!isNd && runStart >= 0) {
        for (let z = runStart; z < c; z += 10) digitStarts.push(z);
        runStart = -1;
      }
    }
  }
  let lo = 0, hi = digitStarts.length - 1, best = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (digitStarts[mid] <= cp) {
      best = digitStarts[mid];
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return cp - best;
}

/** The same text with every Unicode decimal digit replaced by its ASCII digit (what float() / int() see). */
export function asciiDigits(s: string): string {
  return s.replace(/\p{Nd}/gu, (c) => String(digitValue(c)));
}

/** `float(text)` for a string; throws like Python (ValueError message not needed by the callers). */
export function pyFloatParse(text: string): number {
  const t = asciiDigits(pyStrip(text));
  const lower = t.toLowerCase();
  const m = /^([+-]?)(inf|infinity|nan)$/.exec(lower);
  if (m) return m[2] === "nan" ? NaN : m[1] === "-" ? -Infinity : Infinity;
  if (!/^[+-]?(?:[0-9]+(?:_[0-9]+)*(?:\.(?:[0-9]+(?:_[0-9]+)*)?)?|\.[0-9]+(?:_[0-9]+)*)(?:[eE][+-]?[0-9]+(?:_[0-9]+)*)?$/.test(t)) {
    throw new PyError("ValueError", `could not convert string to float: ${JSON.stringify(text)}`);
  }
  return Number(t.replace(/_/g, ""));
}

/** `try: float(text) except ValueError: None` */
export function pyFloatOrNull(text: string): number | null {
  try {
    return pyFloatParse(text);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// round(x, n) - the exact value of the double is rounded, a tie goes to the even digit
// ---------------------------------------------------------------------------------------------------------------

export function pyRound(x: number, nd: number): number {
  if (!Number.isFinite(x) || Math.abs(x) >= 2 ** 52) return x; // (no fraction left to round)
  const neg = x < 0 || Object.is(x, -0);
  const exact = Math.abs(x).toFixed(Math.min(100, nd + 60)); // (a double has at most ~1074 fractional digits, 60 more than nd is enough for any value that matters here)
  const dot = exact.indexOf(".");
  const intPart = exact.slice(0, dot);
  const frac = exact.slice(dot + 1);
  const keep = intPart + frac.slice(0, nd);
  const rest = frac.slice(nd);
  let digits = BigInt(keep);
  const first = rest[0];
  const tail = rest.slice(1);
  if (first > "5" || (first === "5" && /[1-9]/.test(tail))) digits += 1n;
  else if (first === "5" && !/[1-9]/.test(tail) && digits % 2n === 1n) digits += 1n; // exact tie -> even
  const s = digits.toString().padStart(nd + 1, "0");
  const out = Number(nd > 0 ? `${s.slice(0, s.length - nd)}.${s.slice(s.length - nd)}` : s);
  return neg ? -out : out;
}

// ---------------------------------------------------------------------------------------------------------------
// f"{x:g}"
// ---------------------------------------------------------------------------------------------------------------

export function pyFormatG(x: number, precision = 6): string {
  if (Number.isNaN(x)) return "nan";
  if (!Number.isFinite(x)) return x > 0 ? "inf" : "-inf";
  if (x === 0) return Object.is(x, -0) ? "-0" : "0";
  const p = precision === 0 ? 1 : precision;
  const e = x.toExponential(p - 1); // d.ddddde+X (correctly rounded)
  const exp = parseInt(e.slice(e.indexOf("e") + 1), 10);
  let out: string;
  if (exp < -4 || exp >= p) {
    let mant = e.slice(0, e.indexOf("e"));
    if (mant.includes(".")) mant = mant.replace(/0+$/, "").replace(/\.$/, "");
    out = `${mant}e${exp < 0 ? "-" : "+"}${String(Math.abs(exp)).padStart(2, "0")}`;
  } else {
    out = x.toFixed(Math.max(0, p - 1 - exp));
    if (out.includes(".")) out = out.replace(/0+$/, "").replace(/\.$/, "");
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// urllib.parse.quote(s, safe="/")
// ---------------------------------------------------------------------------------------------------------------

const ALWAYS_SAFE = /[A-Za-z0-9_.\-~]/;

export function pyQuote(s: string, safe = "/"): string {
  let out = "";
  const enc = new TextEncoder();
  for (const ch of s) {
    if (ALWAYS_SAFE.test(ch) || safe.includes(ch)) {
      out += ch;
      continue;
    }
    for (const b of enc.encode(ch)) out += "%" + b.toString(16).toUpperCase().padStart(2, "0");
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// str.isalnum()
// ---------------------------------------------------------------------------------------------------------------

const ALNUM = /^[\p{L}\p{N}]$/u;
export const pyIsAlnum = (ch: string): boolean => ALNUM.test(ch);

// ---------------------------------------------------------------------------------------------------------------
// datetime.now().isoformat() (naive, local time) and its parsing
// ---------------------------------------------------------------------------------------------------------------

export function isoLocal(ms: number): string {
  const d = new Date(ms);
  const p = (n: number, w = 2): string => String(n).padStart(w, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}000`;
}

/** `datetime.fromisoformat(s)` as epoch ms (a text without an offset is local time); NaN when it is not a date. */
export function parseIso(s: string): number {
  return Date.parse(s.replace(/(\.\d{3})\d+/, "$1"));
}

// ---------------------------------------------------------------------------------------------------------------
// sum(floats) - CPython 3.12 adds floats with Neumaier compensation
// ---------------------------------------------------------------------------------------------------------------

export function pySum(xs: readonly number[]): number {
  let f = 0;
  let c = 0;
  for (const x of xs) {
    const t = f + x;
    if (Math.abs(f) >= Math.abs(x)) c += (f - t) + x;
    else c += (x - t) + f;
    f = t;
  }
  if (c && Number.isFinite(c)) f += c;
  return f;
}
