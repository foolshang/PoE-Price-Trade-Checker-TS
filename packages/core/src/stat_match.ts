/**
 * Item mod text -> GGG trade stat id, WITHOUT guessing. A port of the matching rules of the hub's ModNormalizer
 * (Poe_Hub/src/processing/normalizer.py), so that this program and the hub give the same stat id to the same text - the hub's meta
 * (badges) is keyed by those ids. Nothing here is fuzzy: a text either follows one of the rules below (every rule is an exact
 * comparison of words) or it has no stat id. The order of the rules is the hub's:
 *   1 exact: the numbers collapsed to '#' (sign swallowed first, or kept first when the text spells a "+")
 *   2 the same with the trailing plural "s" removed, then "reduced"/"less" turned back to "increased"/"more" (values negated)
 *   3 a "(Local)" template whose suffix-less text is unique
 *   4 a template with a fixed number ("per 15 Strength"): every fixed number must be equal
 *   5 a negative roll of a "+#..." template
 *   6 singular / plural variants of the words
 *   7 the hub's rendering aliases (RePoE wordings), current stats before deprecated ones, two candidates = no answer
 * The hub's rules cover the groups explicit / implicit / fractured; the same rules are applied to the other groups of GGG's table
 * (rune, enchant, crafted, ...), which the hub does not read. Pure functions and classes, no I/O.
 */
import { AliasIndex } from "./rendering_aliases.ts";

export interface StatEntry { id: string; text: string; type: string }

export interface StatMatch {
  statId: string;
  template: string;
  values: number[];
  /** which rule answered (for tests and the log) */
  rule: "exact" | "local" | "literal" | "negative" | "plural" | "alias";
  /** the text was changed before it matched (plural, sign, reduced -> increased): only these answers can be vetoed by RePoE */
  loose?: boolean;
}

const NUMBER_WITH_SIGN = /[+-]?\d+(?:\.\d+)?/g;
const NUMBER_NO_SIGN = /\d+(?:\.\d+)?/g;
const WORD = "[\\p{L}\\p{N}_]";
const EXPLICIT_PLUS = new RegExp(`(?<!${WORD}|\\.)\\+\\d`, "u");
const TRAILING_S = new RegExp(`(${WORD})s$`, "u");
const LOCAL_SUFFIX = /\s*\(Local\)\s*$/;
const NEGATIVE_SIGN = new RegExp(`(?<!${WORD}|\\.)-(?=\\d)`, "gu");
const NEGATIVE_SIGN_AT = new RegExp(`(?<!${WORD}|\\.)-(?=\\d)`, "uy");
const TOKEN_SIGNED = /[+-]?(?:\d+(?:\.\d+)?|#)/g;
const TOKEN_UNSIGNED = /(?:\d+(?:\.\d+)?|#)/g;
const NEGATION_PAIRS: [string, string][] = [["reduced", "increased"], ["less", "more"]];
const NOT_PLURAL_SUFFIXES = ["ss", "us", "is"];

/** drops one trailing 's' from every word of 4+ letters ("Charges" -> "Charge", but not "Bonus" / "Stasis" / "Glass") */
export function depluralize(text: string): string {
  return text.split(/(\s+)/).map((word) => {
    if (word && !/^\s+$/.test(word) && word.replace(/[^A-Za-z]/g, "").length > 3 && word.endsWith("s") && !NOT_PLURAL_SUFFIXES.some((s) => word.endsWith(s))) {
      return word.slice(0, -1);
    }
    return word;
  }).join("");
}

function skeletonize(text: string, pattern: RegExp): [string, number[]] {
  const values: number[] = [];
  const skeleton = text.replace(pattern, (m) => { values.push(Number(m)); return "#"; });
  return [skeleton, values];
}

type Fixed = (number | null)[];
type LiteralEntry = [string, string, Fixed]; // stat id, full text, the fixed number of each token (null = a real '#')

function fixedOf(tokens: string[]): Fixed {
  return tokens.map((t) => (t.replace(/^[+-]+/, "") === "#" ? null : Number(t)));
}


/** ids that share one text inside a group (GGG lists 262 such texts): the last one is the answer, like the hub; all are kept for the diagnostics */
export interface SharedText { kind: string; text: string; ids: string[] }

export class StatMatcher {
  private byKind = new Map<string, Map<string, string>>();
  private textById = new Map<string, Map<string, string>>();
  private localAlias = new Map<string, Map<string, [string, string]>>();
  private literalIndex = new Map<string, { signed: Map<string, LiteralEntry[]>; unsigned: Map<string, LiteralEntry[]> }>();
  private pluralIndex = new Map<string, Map<string, LiteralEntry[]>>();
  private aliases = AliasIndex.empty();
  private aliasMemo = new Map<string, ReturnType<AliasIndex["candidates"]>>();
  /** groups of the table, in the order of their first appearance */
  kinds: string[] = [];
  shared: SharedText[] = [];

  setAliases(index: AliasIndex): void {
    this.aliases = index;
    this.aliasMemo.clear();
  }

  aliasCount(): number {
    return this.aliases.size;
  }

  build(stats: StatEntry[]): void {
    this.byKind = new Map();
    this.textById = new Map();
    this.kinds = [];
    this.shared = [];
    const dups = new Map<string, Map<string, string[]>>();
    for (const { id, text, type: kind } of stats) {
      if (!id || !text) continue;
      let bucket = this.byKind.get(kind);
      if (!bucket) {
        this.byKind.set(kind, (bucket = new Map()));
        this.kinds.push(kind);
      }
      const old = bucket.get(text);
      if (old !== undefined && old !== id) {
        let perKind = dups.get(kind);
        if (!perKind) dups.set(kind, (perKind = new Map()));
        const ids = perKind.get(text) ?? [old];
        ids.push(id);
        perKind.set(text, ids);
      }
      bucket.set(text, id);
      let byId = this.textById.get(kind);
      if (!byId) this.textById.set(kind, (byId = new Map()));
      byId.set(id, text);
    }
    for (const [kind, perKind] of dups) for (const [text, ids] of perKind) this.shared.push({ kind, text, ids });
    this.localAlias = new Map([...this.byKind].map(([k, b]) => [k, StatMatcher.buildLocalAlias(b)]));
    this.literalIndex = new Map([...this.byKind].map(([k, b]) => [k, StatMatcher.buildLiteralIndex(b)]));
    this.pluralIndex = new Map([...this.byKind].map(([k, b]) => [k, StatMatcher.buildPluralIndex(b)]));
    this.aliasMemo.clear();
  }

  /** the template text GGG lists for a stat id (diagnostics) */
  templateOfId(kind: string, id: string): string | undefined {
    return this.textById.get(kind)?.get(id);
  }

  /** every stat id that has this exact template text in the group (more than one = the text alone cannot say which) */
  idsOfTemplate(kind: string, text: string): string[] {
    const found = this.shared.find((s) => s.kind === kind && s.text === text);
    if (found) return found.ids;
    const id = this.byKind.get(kind)?.get(text);
    return id === undefined ? [] : [id];
  }

  // ------------------------------------------------------------------ index builders

  private static buildLocalAlias(bucket: Map<string, string>): Map<string, [string, string]> {
    const candidates = new Map<string, [string, string][]>();
    for (const [text, id] of bucket) {
      const m = LOCAL_SUFFIX.exec(text);
      if (m === null) continue;
      const base = text.slice(0, m.index);
      const list = candidates.get(base);
      if (list) list.push([id, text]);
      else candidates.set(base, [[id, text]]);
    }
    const out = new Map<string, [string, string]>();
    for (const [base, found] of candidates) if (found.length === 1 && !bucket.has(base)) out.set(base, found[0]);
    return out;
  }

  private static buildLiteralIndex(bucket: Map<string, string>): { signed: Map<string, LiteralEntry[]>; unsigned: Map<string, LiteralEntry[]> } {
    const index = { signed: new Map<string, LiteralEntry[]>(), unsigned: new Map<string, LiteralEntry[]>() };
    for (const [text, id] of bucket) {
      if (LOCAL_SUFFIX.test(text)) continue;
      const signedTokens = text.match(TOKEN_SIGNED) ?? [];
      if (!signedTokens.some((t) => t.replace(/^[+-]+/, "") !== "#")) continue; // no fixed number: the ordinary exact match covers it
      const hasLiteralSign = signedTokens.some((t) => t[0] === "+" || t[0] === "-");
      const [mode, pattern] = hasLiteralSign ? (["unsigned", TOKEN_UNSIGNED] as const) : (["signed", TOKEN_SIGNED] as const);
      const tokens = text.match(pattern) ?? [];
      const key = text.replace(pattern, "#");
      const list = index[mode].get(key);
      const entry: LiteralEntry = [id, text, fixedOf(tokens)];
      if (list) list.push(entry);
      else index[mode].set(key, [entry]);
    }
    return index;
  }

  private static buildPluralIndex(bucket: Map<string, string>): Map<string, LiteralEntry[]> {
    const index = new Map<string, LiteralEntry[]>();
    for (const [text, id] of bucket) {
      if (LOCAL_SUFFIX.test(text)) continue;
      const tokens = text.match(TOKEN_SIGNED) ?? [];
      const key = depluralize(text.replace(TOKEN_SIGNED, "#"));
      const entry: LiteralEntry = [id, text, fixedOf(tokens)];
      const list = index.get(key);
      if (list) list.push(entry);
      else index.set(key, [entry]);
    }
    return index;
  }

  // ------------------------------------------------------------------ matching

  /**
   * the stat of one mod line in one group of the table; null = no rule applies (never a guess).
   * `hubOnly` runs exactly the hub's rules. Without it one thing is added: when RePoE (the aliases) says this very wording is rendered by
   * other stats than the one a LOOSE rule picked (the text was changed first: plural, sign), the rule is wrong and the answer is RePoE's, or none
   * (measured: a plural rule that merged "Area contains" with "Areas contain"). A template with the text's own numbers beats a singularized one
   * ("within 1.5 metres" belongs to the stat that has 1.5 in its template).
   */
  match(text: string, kind: string, hubOnly = false): StatMatch | null {
    const result = this.matchHub(text, kind);
    if (hubOnly || result === null || !result.loose) return result;
    // a template that has the very numbers of the text in it is more specific than the same words with a plural / sign changed
    if (result.rule === "exact") {
      const literal = this.matchLiteral(text, kind);
      if (literal !== null) return literal;
    }
    if (!this.aliases.size) return result;
    const cands = this.aliasCandidates(text, kind);
    if (!cands.size) return result;
    const num = result.statId.slice(result.statId.lastIndexOf("_") + 1);
    if (cands.has(num)) return result;
    return this.aliasCandidate(text, kind);
  }

  private aliasCandidates(text: string, kind: string): ReturnType<AliasIndex["candidates"]> {
    const key = `${kind}\u0001${text}`;
    let cands = this.aliasMemo.get(key);
    if (cands === undefined) {
      cands = this.aliases.candidates(kind, text);
      this.aliasMemo.set(key, cands);
    }
    return cands;
  }

  private matchHub(text: string, kind: string): StatMatch | null {
    const result = this.matchRules(text, kind);
    if (result !== null && this.aliases.deprecated.size && this.aliases.deprecated.has(result.statId.slice(result.statId.lastIndexOf("_") + 1))) {
      // the table maps this text to a stat that only exists for old items; if exactly one CURRENT stat renders the same text, that is the owner
      const better = this.aliasCandidate(text, kind, result.statId.slice(result.statId.lastIndexOf("_") + 1));
      if (better !== null) return better;
    }
    return result;
  }

  private matchRules(text: string, kind: string): StatMatch | null {
    const exact = this.matchExact(text, kind);
    if (exact !== null) return exact;
    const alias = this.localAlias.get(kind);
    if (alias && alias.size) {
      for (const pattern of [NUMBER_WITH_SIGN, NUMBER_NO_SIGN]) {
        const [skeleton, values] = skeletonize(text, pattern);
        const hit = alias.get(skeleton);
        if (hit !== undefined) return { statId: hit[0], template: hit[1], values, rule: "local" };
      }
    }
    return this.matchLiteral(text, kind) ?? this.matchNegativeOfPlus(text, kind) ?? this.matchPlural(text, kind) ?? this.aliasCandidate(text, kind);
  }

  private aliasCandidate(text: string, kind: string, exclude: string | null = null): StatMatch | null {
    if (!this.aliases.size) return null;
    const cands = this.aliasCandidates(text, kind);
    let pool =new Map([...cands].filter(([n]) => n !== exclude));
    const current = new Map([...pool].filter(([, v]) => !v.deprecated));
    if (current.size) pool = current;
    if (pool.size !== 1) return null; // none, or two stats render the same text = ambiguous = no answer
    const [num, v] = [...pool][0];
    const statId = `${kind}.stat_${num}`;
    const template = this.textById.get(kind)?.get(statId);
    if (template === undefined) return null;
    return { statId, template, values: [...v.values], rule: "alias" };
  }

  private matchPlural(text: string, kind: string): StatMatch | null {
    const index = this.pluralIndex.get(kind);
    if (!index || !index.size) return null;
    const [skeleton, numbers] = skeletonize(text, NUMBER_WITH_SIGN);
    const matches = (index.get(depluralize(skeleton)) ?? []).filter(([, , fixed]) => fixed.length === numbers.length && fixed.every((f, i) => f === null || f === numbers[i]));
    if (!matches.length) return null;
    if (new Set(matches.map((m) => m[0])).size > 1) return null;
    const [statId, template, fixed] = matches[0];
    return { statId, template, values: numbers.filter((_, i) => fixed[i] === null), rule: "plural", loose: true };
  }

  private matchNegativeOfPlus(text: string, kind: string): StatMatch | null {
    NEGATIVE_SIGN.lastIndex = 0;
    if (!NEGATIVE_SIGN.test(text)) return null;
    const flipped = text.replace(NEGATIVE_SIGN, "+");
    const result = this.matchExact(flipped, kind);
    if (result === null) return null;
    const flags: boolean[] = [];
    for (const m of text.matchAll(NUMBER_NO_SIGN)) {
      const at = m.index!;
      NEGATIVE_SIGN_AT.lastIndex = at - 1;
      flags.push(at > 0 && text[at - 1] === "-" && NEGATIVE_SIGN_AT.test(text));
    }
    if (flags.length !== result.values.length) return null; // the rule that matched dropped or added numbers: do not guess which was negative
    return { statId: result.statId, template: result.template, values: result.values.map((v, i) => (flags[i] ? -v : v)), rule: "negative", loose: true };
  }

  private matchLiteral(text: string, kind: string): StatMatch | null {
    const index = this.literalIndex.get(kind);
    if (!index) return null;
    for (const [mode, pattern] of [["signed", NUMBER_WITH_SIGN], ["unsigned", NUMBER_NO_SIGN]] as const) {
      const [skeleton, numbers] = skeletonize(text, pattern);
      const matches = (index[mode].get(skeleton) ?? []).filter(([, , fixed]) => fixed.length === numbers.length && fixed.every((f, i) => f === null || f === numbers[i]));
      if (!matches.length) continue;
      if (new Set(matches.map((m) => m[0])).size > 1) return null; // ambiguous: stay unmapped rather than guess
      const [statId, template, fixed] = matches[0];
      return { statId, template, values: numbers.filter((_, i) => fixed[i] === null), rule: "literal" };
    }
    return null;
  }

  private matchExact(text: string, kind: string): StatMatch | null {
    const bucket = this.byKind.get(kind);
    if (!bucket) return null;
    const direct = tryEach(text, bucket);
    if (direct !== null) return direct;
    // GGG's templates never use the plural of the last word ("Has # Charm Slot")
    const singular = text.replace(TRAILING_S, "$1");
    if (singular !== text) {
      const r = tryEach(singular, bucket);
      if (r !== null) return { ...r, loose: true };
    }
    // the game writes "reduced" / "less" for a negative roll; GGG's table only lists "increased" / "more"
    const lower = text.toLowerCase();
    for (const [negative, positive] of NEGATION_PAIRS) {
      if (!lower.includes(negative)) continue;
      const swapped = text.replace(new RegExp(negative, "gi"), positive);
      const r = tryEach(swapped, bucket);
      if (r !== null) return { ...r, values: r.values.map((v) => -v), loose: true };
    }
    return null;
  }
}

function tryEach(text: string, bucket: Map<string, string>): StatMatch | null {
  const patterns = EXPLICIT_PLUS.test(text) ? [NUMBER_NO_SIGN, NUMBER_WITH_SIGN] : [NUMBER_WITH_SIGN, NUMBER_NO_SIGN];
  for (const pattern of patterns) {
    const [skeleton, values] = skeletonize(text, pattern);
    if (bucket.has(skeleton)) return { statId: bucket.get(skeleton)!, template: skeleton, values, rule: "exact" };
  }
  return null;
}

