/**
 * The reader of the hub's public alias file `{game}/aliases/latest.json` (Poe_Hub SPEC.md 8.12): RePoE-derived item wording -> GGG stat
 * (`aliases`), and the stat ids the game cannot tell apart (`stat_groups`, `stat_aliases`). Written against the readable public field names
 * (`text`, `trade_id`, `kinds`, `placeholder_stat_index`, `negate`, `divisor`, `sign`, `conditions`, `implied_values`, `deprecated`); the
 * matching arithmetic is the hub's (its reference reader PublicAliasReader). The generator stays in the hub, this program only reads the
 * published file. An unreadable payload gives an empty index, never an exception; a schema_version this code does not know = absent.
 */
export const ALIAS_SCHEMA_VERSION = 1;
export const ALIAS_KINDS = ["explicit", "implicit", "fractured"] as const;

const PLACE = /\{(\d*)(?::[^}]*)?\}/;
const NUM = "[+-]?\\d+(?:\\.\\d+)?";
const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Python's round(x, nd) for the small values the aliases use (half to even on the decimal repr is not needed at 6 digits) */
const round6 = (x: number): number => Math.round(x * 1e6) / 1e6;

interface Alias {
  num: string;
  kinds: string[];
  regex: RegExp | null;
  literal: string;
  text: string;
  statOf: number[];
  negate: boolean[];
  div: number[];
  sign: number[];
  cond: (number | null)[][];
  implied: number[] | null;
  deprecated: boolean;
}

export type AliasCandidates = Map<string, { values: number[]; deprecated: boolean }>;

export class AliasIndex {
  deprecated: ReadonlySet<string> = new Set();
  size = 0;
  private implied = new Map<string, Alias[]>();
  private regexByKind = new Map<string, Alias[]>(ALIAS_KINDS.map((k) => [k, []]));

  constructor(payload: unknown = null) {
    if (payload && AliasIndex.valid(payload)) this.build(payload as any);
  }

  static empty(): AliasIndex {
    return new AliasIndex(null);
  }

  static valid(payload: unknown): boolean {
    const p = payload as any;
    return !!p && typeof p === "object" && p.schema_version === ALIAS_SCHEMA_VERSION && Array.isArray(p.aliases);
  }

  private build(payload: { deprecated_trade_ids?: unknown[]; aliases: any[] }): void {
    this.deprecated = new Set((payload.deprecated_trade_ids ?? []).map((n) => String(n)));
    for (const raw of payload.aliases) {
      try {
        const a: Alias = {
          num: String(raw.trade_id), kinds: [...raw.kinds], text: String(raw.text), regex: null, literal: "", statOf: raw.placeholder_stat_index,
          negate: raw.negate, div: raw.divisor, sign: raw.sign, cond: raw.conditions, implied: raw.implied_values, deprecated: !!raw.deprecated,
        };
        if (!Array.isArray(a.kinds) || !Array.isArray(a.statOf) || !Array.isArray(a.negate) || !Array.isArray(a.div) || !Array.isArray(a.sign) || !Array.isArray(a.cond)) continue;
        if (a.implied !== null && a.implied !== undefined && a.statOf.length === 0) {
          for (const k of a.kinds) {
            const key = `${k}\u0001${a.text}`;
            const list = this.implied.get(key);
            if (list) list.push(a);
            else this.implied.set(key, [a]);
          }
        } else {
          const parts = a.text.split(PLACE).filter((_, i) => i % 2 === 0); // (the captured groups sit between the pieces)
          a.regex = new RegExp("^" + [escapeRe(parts[0])].concat(parts.slice(1).map((p) => `(${NUM})` + escapeRe(p))).join("") + "$");
          a.literal = parts.reduce((best, p) => (p.length > best.length ? p : best), "");
          for (const k of a.kinds) this.regexByKind.get(k)?.push(a);
        }
        this.size++;
      } catch {
        continue;
      }
    }
  }

  /** {numeric GGG stat id: (stored values, deprecated?)} for every alias that renders exactly `text` */
  candidates(kind: string, text: string): AliasCandidates {
    const out: AliasCandidates = new Map();
    for (const a of this.implied.get(`${kind}\u0001${text}`) ?? []) {
      if (!out.has(a.num)) out.set(a.num, { values: [...(a.implied ?? [])], deprecated: a.deprecated });
    }
    for (const a of this.regexByKind.get(kind) ?? []) {
      if (!text.includes(a.literal)) continue;
      const m = a.regex!.exec(text);
      if (!m) continue;
      const shown = m.slice(1).map(Number);
      const nStats = a.cond.length;
      const displayed: number[] = new Array(nStats).fill(0);
      shown.forEach((g, i) => { displayed[a.statOf[i]] = g; });
      let ok = true;
      for (let i = 0; i < nStats; i++) {
        const internal = round6(displayed[i] * a.div[i] * (a.negate[i] ? -1 : 1));
        const [lo, hi] = a.cond[i];
        if ((lo !== null && lo !== undefined && internal < lo) || (hi !== null && hi !== undefined && internal > hi)) {
          ok = false;
          break;
        }
      }
      if (ok && !out.has(a.num)) out.set(a.num, { values: displayed.map((d, i) => d * a.sign[i]), deprecated: a.deprecated });
    }
    return out;
  }
}

/** stat ids that the item text cannot tell apart (SPEC.md 8.12 `stat_groups`) */
export interface StatGroup {
  kind: string;
  /** "identical_text" (the same table text) | "case_only" (texts that differ only in letter case) */
  reason: string;
  /** the id the hub emits (identical_text); null for case_only: rows may sit under any member */
  canonical: string | null;
  members: string[];
}

/** `stat_aliases`: every member of an identical_text group -> its canonical id. A malformed entry is skipped. */
export function readStatAliases(payload: unknown): Map<string, string> {
  const out = new Map<string, string>();
  const raw = (payload as { stat_aliases?: unknown } | null)?.stat_aliases;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    for (const [from, to] of Object.entries(raw as Record<string, unknown>)) if (from && typeof to === "string" && to && from !== to) out.set(from, to);
  }
  return out;
}

/** `stat_groups`, the well-formed ones */
export function readStatGroups(payload: unknown): StatGroup[] {
  const raw = (payload as { stat_groups?: unknown } | null)?.stat_groups;
  if (!Array.isArray(raw)) return [];
  const out: StatGroup[] = [];
  for (const g of raw) {
    if (g && typeof g === "object" && typeof g.kind === "string" && Array.isArray(g.members) && g.members.every((m: unknown) => typeof m === "string")) {
      out.push({ kind: g.kind, reason: String(g.reason ?? ""), canonical: typeof g.canonical === "string" ? g.canonical : null, members: [...g.members] });
    }
  }
  return out;
}
