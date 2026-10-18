/**
 * Mod tier ladders (`mod_meta_<game>.json`), precomputed from the community datamine (repoe-fork `base_items.json` + `mods.json`).
 * Port of tools/build_mod_meta.py of the original program: same filters, same families, same file, byte for byte.
 *
 *   bases   { "Warmonger Bow": {"class": "Bow", "drop_level": 77, "ts": 3}, ... }
 *   tagsets { "3": [ family, ... ] }   family = {gen, text, stats, tiers: [{lvl, rng}], tags}  (tier 0 = T1, highest level first)
 *
 * Important (kept from the original): a RePoE `spawn_weights` list is FIRST-MATCH - the first tag of the list that the base has decides
 * (weight 0 = cannot roll, even when a later tag has weight > 0).
 */
import { cmpStr, sortedStr } from "./py.ts";
import { splitWs } from "./py.ts";

export type Game = "poe1" | "poe2";

/** Domains whose bases / mods count, per game. PoE1 has jewels of its own domains (abyss, cluster) that PoE2 does not. */
export const DOMAIN_ALLOW: Record<Game, ReadonlySet<string>> = {
  poe2: new Set(["item", "misc"]),
  poe1: new Set(["item", "misc", "abyss_jewel", "affliction_jewel"]),
};

export const RAW_URL = (game: Game): string => `https://raw.githubusercontent.com/repoe-fork/${game}/master/data/`;
export const FILES = ["base_items.json", "mods.json"] as const;

const MARKUP_PIPE = /\[([^\]|]*)\|([^\]]*)\]/g; // [Internal|Display] -> Display
const MARKUP_ONE = /\[([^\]]*)\]/g; // [Word] -> Word
const NUM = /[-+]?\(?\p{Nd}+(?:\.\p{Nd}+)?(?:-\p{Nd}+(?:\.\p{Nd}+)?)?\)?/gu;

/** Text the way a clipboard line can be compared with it: markup removed, every number or range -> "#", lower case, one space between words. */
export function normText(t: string | null | undefined): string {
  let s = t ?? "";
  s = s.replace(MARKUP_PIPE, "$2");
  s = s.replace(MARKUP_ONE, "$1");
  s = s.replace(NUM, "#");
  return splitWs(s.toLowerCase()).join(" ");
}

/** First match decides: the first spawn tag the base has says whether the mod can roll on it. */
export function canSpawn(mod: any, baseTags: ReadonlySet<string>): boolean {
  for (const sw of mod.spawn_weights ?? []) {
    if (baseTags.has(sw.tag)) return (sw.weight ?? 0) > 0;
  }
  return false;
}

export interface Family {
  gen: string;
  text: string;
  stats: string[];
  tiers: { lvl: number; rng: number[][] }[];
  tags: string[];
}

export interface ModMeta {
  generated: string;
  source: string;
  bases: Record<string, { class: string; drop_level: number; ts: number }>;
  tagsets: Record<string, Family[]>;
}

export class ModMetaError extends Error {
  constructor(public readonly problems: string[], public readonly game: string) {
    super(`validation failed for --game ${game}: ${problems.join("; ")}`);
  }
}

/** JSON with the keys of every object in order - an equality test of two family lists, like `json.dumps(sort_keys=True)`. */
function canon(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canon).join(",")}]`;
  if (v && typeof v === "object") {
    return `{${Object.keys(v as object).sort(cmpStr).map((k) => `${JSON.stringify(k)}:${canon((v as any)[k])}`).join(",")}}`;
  }
  return JSON.stringify(v);
}

/** Sanity floor before a file is written: a build that "succeeds" with hollow data must fail loudly. */
export function validate(game: string, basesOut: Record<string, unknown>, tagsetsOut: Record<string, Family[]>): string[] {
  const families = Object.values(tagsetsOut).flat();
  const errors: string[] = [];
  if (Object.keys(basesOut).length < 50) errors.push(`bases=${Object.keys(basesOut).length} น้อยผิดปกติ (ควร >= 50)`);
  if (families.length < 50) errors.push(`families=${families.length} น้อยผิดปกติ (ควร >= 50)`);
  if (families.length) {
    const prefixes = families.filter((f) => f.gen === "prefix").length;
    const suffixes = families.filter((f) => f.gen === "suffix").length;
    if (prefixes === 0 || suffixes === 0) errors.push(`prefix=${prefixes} suffix=${suffixes} — ฝั่งใดฝั่งหนึ่งหายไปหมด`);
    const tagged = families.filter((f) => f.tags && f.tags.length).length;
    const coverage = tagged / families.length;
    if (coverage < 0.3) errors.push(`tag coverage ${(coverage * 100).toFixed(1)}% ต่ำผิดปกติ (ควร >= 30%)`);
  }
  void game;
  return errors;
}

export interface BuildResult {
  meta: ModMeta;
  /** how many tag-sets there were before identical ones were merged */
  tagsetsBeforeDedupe: number;
}

/** The whole build. `generated` is the time stamp written into the file (the caller decides, so tests can fix it). */
export function buildModMeta(game: Game, basesRaw: Record<string, any>, modsRaw: Record<string, any>, generated: string): BuildResult {
  const domains = DOMAIN_ALLOW[game];

  // 1) group the bases by (domain, tag tuple): one class can have many tag sets (65 kinds of helmet). The domain is part of the key:
  //    abyss / cluster jewels share generic tags ("default", "jewel"), and their mods must not leak onto each other.
  const tagsetId = new Map<string, number>();
  const tagsetOf: { domain: string; tags: string[] }[] = [];
  const basesOut: ModMeta["bases"] = {};
  for (const v of Object.values<any>(basesRaw)) {
    const name = v.name ?? "";
    const domain = v.domain ?? "item";
    if (!name || !domains.has(domain)) continue;
    const tags: string[] = v.tags ?? [];
    const key = JSON.stringify([domain, tags]);
    if (!tagsetId.has(key)) {
      tagsetId.set(key, tagsetId.size);
      tagsetOf.push({ domain, tags });
    }
    // the same base name twice (rare, across classes): the later one wins
    basesOut[name] = { class: v.item_class ?? "", drop_level: v.drop_level ?? 0, ts: tagsetId.get(key)! };
  }

  // 2) the mods that matter: explicit prefixes / suffixes on normal items (and the abyss / cluster affixes of PoE1)
  const candByDomain = new Map<string, any[]>();
  for (const m of Object.values<any>(modsRaw)) {
    if ((m.generation_type === "prefix" || m.generation_type === "suffix") && domains.has(m.domain ?? "item") && m.stats && m.stats.length) {
      const d = m.domain ?? "item";
      if (!candByDomain.has(d)) candByDomain.set(d, []);
      candByDomain.get(d)!.push(m);
    }
  }

  // 3) per tag set: families (kind, stat ids, normalised text) -> tier ladder
  const tagsetsOut: Record<string, Family[]> = {};
  const seenContent = new Map<string, number>();
  const alias = new Map<number, number>();
  tagsetOf.forEach(({ domain, tags }, tid) => {
    const ts = new Set(tags);
    const fams = new Map<string, { gen: string; sids: string[]; text: string; tiers: [number, number[][]][] }>();
    const famTags = new Map<string, string[]>();
    for (const m of candByDomain.get(domain) ?? []) {
      if (!canSpawn(m, ts)) continue;
      const sids: string[] = m.stats.map((s: any) => s.id ?? "");
      const text = normText(m.text ?? "");
      const key = JSON.stringify([m.generation_type, sids, text]);
      if (!fams.has(key)) fams.set(key, { gen: m.generation_type, sids, text, tiers: [] });
      fams.get(key)!.tiers.push([m.required_level ?? 0, m.stats.map((s: any) => [s.min ?? 0, s.max ?? 0])]);
      // the tags are the same for every tier of one family (the same mod line with other numbers): the first entry is enough
      if (!famTags.has(key)) famTags.set(key, sortedStr(m.implicit_tags ?? []));
    }
    const famList: Family[] = [];
    for (const [key, f] of fams) {
      f.tiers.sort((a, b) => b[0] - a[0]); // (stable: equal levels keep their order)
      famList.push({ gen: f.gen, text: f.text, stats: [...f.sids], tiers: f.tiers.map(([lvl, rng]) => ({ lvl, rng })), tags: famTags.get(key)! });
    }
    famList.sort((a, b) => cmpStr(a.gen, b.gen) || cmpStr(a.text, b.text));
    const blob = canon(famList);
    const seen = seenContent.get(blob);
    if (seen !== undefined) alias.set(tid, seen);
    else {
      seenContent.set(blob, tid);
      tagsetsOut[String(tid)] = famList;
    }
  });

  for (const b of Object.values(basesOut)) b.ts = alias.get(b.ts) ?? b.ts; // the bases point at the tag set that was kept

  const problems = validate(game, basesOut, tagsetsOut);
  if (problems.length) throw new ModMetaError(problems, game);
  return { meta: { generated, source: `repoe-fork/${game}@master`, bases: basesOut, tagsets: tagsetsOut }, tagsetsBeforeDedupe: tagsetOf.length };
}

/** The file text: compact JSON, non-ASCII kept as it is (what `json.dumps(meta, ensure_ascii=False, separators=(",", ":"))` writes). */
export function serialize(meta: ModMeta): string {
  return JSON.stringify(meta);
}

/** `datetime.now(timezone.utc).isoformat(timespec="seconds")` */
export function utcStamp(now: Date = new Date()): string {
  return now.toISOString().replace(/\.\d{3}Z$/, "+00:00");
}

/** Whole numbers written as floats ("1.0") in the source would come out as "1" here (JS has no float 1.0): refuse such a source. */
export function floatLookingIntegers(rawText: string): boolean {
  return /"(?:min|max|drop_level|required_level)"\s*:\s*-?\d+\.0+\b/.test(rawText);
}
