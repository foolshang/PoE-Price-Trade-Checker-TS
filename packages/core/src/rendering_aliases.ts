/**
 * The runtime half of the hub's rendering aliases (RePoE-derived item wording -> GGG stat). Port of AliasIndex in
 * Poe_Hub/src/processing/rendering_aliases.py (the hub's own code; the generator that BUILDS the payload stays in the hub, this program
 * only reads the published file). An unreadable payload gives an empty index, never an exception.
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

  private build(payload: { deprecated?: unknown[]; aliases: any[] }): void {
    this.deprecated = new Set((payload.deprecated ?? []).map((n) => String(n)));
    for (const raw of payload.aliases) {
      try {
        const a: Alias = {
          num: String(raw.n), kinds: [...raw.k], text: String(raw.x), regex: null, literal: "", statOf: raw.p, negate: raw.ng, div: raw.dv,
          sign: raw.sg, cond: raw.c, implied: raw.iv, deprecated: !!raw.dep,
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
