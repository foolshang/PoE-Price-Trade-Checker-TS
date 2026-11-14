/**
 * GGG's item names (trade(2)/data/items) as the 4th source of the whitelist's item universe (see docs/GGG_CATEGORY_MAP.md).
 *
 * GGG's payload is `result[] = { id: <group>, entries[] = { name?, type?, text? } }`. The group is coarse (PoE1 `currency` holds
 * Currency, Essence, Fossil, Oil, ...), so a name is put in one of our categories by "GGG group + a rule on the name". The name
 * itself is GGG's string, never changed: a rule only decides the category.
 *
 * A name no rule fits is
 *   - an OLD name (it was in the snapshot shipped with the app): not added;
 *   - a NEW name (live GGG has it, the shipped snapshot does not): added to the main category of its group.
 * A new name keeps its category when the next snapshot includes it: the snapshot stores it in `assigned`.
 */
import { badName } from "./filter_whitelist.ts";
import { WHITELIST_CATEGORIES } from "./filter_gen.ts";
import { cmpStr, truthy } from "./py.ts";

/** GGG group id -> names of that group (GGG's strings, de-duplicated, sorted). */
export type Groups = Record<string, string[]>;

/** The shipped / cached form (format 2). The old form was a bare list of names. */
export interface Snapshot {
  groups: Groups;
  /** name -> category: new names no rule fitted, put in their group's main category when they first appeared */
  assigned: Record<string, string>;
}

export const FORMAT = 2;

/** `entry.name / type / text` of every entry, per group. */
export function groupsFromPayload(data: any): Groups {
  const out: Groups = {};
  const result = data && truthy(data.result) ? data.result : [];
  for (const grp of result) {
    if (!grp || !truthy(grp.id)) continue;
    const set = new Set<string>(out[String(grp.id)] ?? []);
    for (const e of truthy(grp.entries) ? grp.entries : []) {
      for (const k of ["name", "type", "text"]) if (e && truthy(e[k])) set.add(String(e[k]));
    }
    out[String(grp.id)] = [...set].sort(cmpStr);
  }
  return out;
}

export function namesOfGroups(groups: Groups): Set<string> {
  const out = new Set<string>();
  for (const names of Object.values(groups)) for (const n of names) out.add(n);
  return out;
}

export interface Loaded {
  /** every name GGG has (the real-name check) */
  names: Set<string>;
  /** null = the old form (names only): the names check works, nothing is added from it */
  snapshot: Snapshot | null;
}

/** Reads a snapshot / cache file of either form; null when it is neither (or has no names). Never throws. */
export function parseSnapshot(raw: unknown): Loaded | null {
  if (Array.isArray(raw)) {
    const names = new Set(raw.filter((n) => typeof n === "string" && n !== "") as string[]);
    return names.size ? { names, snapshot: null } : null;
  }
  if (raw && typeof raw === "object" && (raw as any).format === FORMAT && (raw as any).groups && typeof (raw as any).groups === "object") {
    const groups: Groups = {};
    for (const [id, list] of Object.entries<any>((raw as any).groups)) {
      if (Array.isArray(list)) groups[id] = list.filter((n) => typeof n === "string" && n !== "");
    }
    const assigned: Record<string, string> = {};
    const a = (raw as any).assigned;
    if (a && typeof a === "object" && !Array.isArray(a)) for (const [n, c] of Object.entries<any>(a)) if (typeof c === "string") assigned[n] = c;
    const names = namesOfGroups(groups);
    return names.size ? { names, snapshot: { groups, assigned } } : null;
  }
  return null;
}

export function snapshotJson(groups: Groups, assigned: Record<string, string>): string {
  const sortedAssigned: Record<string, string> = {};
  for (const n of Object.keys(assigned).sort(cmpStr)) sortedAssigned[n] = assigned[n];
  return JSON.stringify({ format: FORMAT, groups, assigned: sortedAssigned });
}

// ---------------------------------------------------------------------------
// The rules
// ---------------------------------------------------------------------------

/** The groups whose names can be whitelist items, and the category a NEW unmatched name of the group goes to. */
export const GROUP_MAIN: Record<string, Record<string, string>> = {
  poe1: { currency: "Currency", card: "DivinationCard", map: "Fragment" },
  poe2: { currency: "Currency", map: "Fragment" },
};

type Rule = [string, RegExp];
// first match wins; a rule applies to the groups listed with it
const RULES: Record<string, { groups: string[]; rules: Rule[] }[]> = {
  poe1: [
    { groups: ["card"], rules: [["DivinationCard", /./]] },
    { groups: ["currency", "map"], rules: [
      ["Scarab", /(?:^| )Scarab(?: |$)/],
      ["Fragment", /^Splinter of |(?: Splinter|Breachstone|Emblem|Reliquary Key|[A-Za-z]'s Key| Fragment)$|^(?:Sacrifice at|Mortal) /],
    ] },
    { groups: ["currency"], rules: [
      ["Oil", / Oil$/],
      ["Fossil", / Fossil$/],
      ["Resonator", / Resonator$/],
      ["Essence", /Essence of |^Remnant of Corruption$/],
      ["DeliriumOrb", /(?:^| )Delirium Orb$/],
      ["Artifact", / Artifact$/],
    ] },
  ],
  poe2: [
    { groups: ["currency"], rules: [
      ["Omen", /^Omen of /],
      ["SoulCore", /^Soul Core\b/],
      ["Rune", /(?:^|\s)Rune$|^Rune of /],
      ["Essence", /(?:^| )Essence(?: |$)|Essence of /],
      ["Artifact", / Artifact$/],
      ["Catalyst", /Catalyst$/],
    ] },
    { groups: ["currency", "map"], rules: [
      ["Fragment", /Calamity Fragment$|Reliquary Key/],
    ] },
  ],
};

/** A map-group name that is a map / waystone / tablet: those have their own handling, never a fallback item. */
const NOT_AN_ITEM = /(?:^|\W)Map(?:\W|$)|^Waystone|Tablet$/;
/** A name in the form of an internal id (AbyssalTemplar, Crit1HShadowPhysSpell): never a fallback item. */
const INTERNAL_ID = /^[A-Za-z0-9]+$/;
const hasInnerCapital = (n: string): boolean => /[a-z0-9][A-Z]/.test(n);

const wantedOf = (game: string): Set<string> => new Set(WHITELIST_CATEGORIES[game] ?? []);

/** The category a rule gives the name (null: no rule fits, or the category is not a whitelist category). Never for a bad name. */
export function categoryByRule(game: string, group: string, name: string): string | null {
  if (!name || badName(name)) return null;
  const wanted = wantedOf(game);
  for (const set of RULES[game] ?? []) {
    if (!set.groups.includes(group)) continue;
    for (const [cat, rx] of set.rules) if (rx.test(name)) return wanted.has(cat) ? cat : null;
  }
  return null;
}

/** The category of a NEW name no rule fits: the main category of its group (null: not a group of whitelist items). */
export function fallbackCategory(game: string, group: string, name: string): string | null {
  const cat = GROUP_MAIN[game]?.[group];
  if (!cat || !name || badName(name) || !wantedOf(game).has(cat)) return null;
  if (group === "map" && NOT_AN_ITEM.test(name)) return null;
  if (INTERNAL_ID.test(name) && hasInnerCapital(name)) return null;
  return cat;
}

const GROUP_ORDER = ["card", "currency", "map"];

/**
 * {name: category} of the names to add: by rule; plus (when a baseline is known) the NEW names no rule fits, and the names the
 * baseline recorded as assigned. `live` = the groups of the payload in hand (live GGG, or the snapshot itself); `base` = the
 * snapshot shipped with the app (null = unknown: nothing but rules). Not filtered against the other sources: universe() does that.
 */
export function addedNames(game: string, live: Groups, base: Snapshot | null): Map<string, string> {
  const out = new Map<string, string>();
  const known = base ? namesOfGroups(base.groups) : null;
  const groups = Object.keys(live).filter((g) => GROUP_MAIN[game]?.[g] !== undefined || (RULES[game] ?? []).some((s) => s.groups.includes(g)))
    .sort((a, b) => (GROUP_ORDER.indexOf(a) + 1 || 99) - (GROUP_ORDER.indexOf(b) + 1 || 99) || cmpStr(a, b));
  const wanted = wantedOf(game);
  for (const g of groups) {
    for (const n of live[g]) {
      if (out.has(n) || badName(n)) continue;
      let cat = categoryByRule(game, g, n);
      if (cat === null && known) {
        const kept = base!.assigned[n];
        if (kept !== undefined) cat = kept;
        else if (!known.has(n)) cat = fallbackCategory(game, g, n);
      }
      if (cat !== null && wanted.has(cat)) out.set(n, cat);
    }
  }
  return out;
}

/** The `assigned` map of the next snapshot: what the previous one recorded (names still in GGG's data) + the new names no rule fits. */
export function nextAssigned(game: string, live: Groups, prev: Loaded | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!prev) return out; // no previous snapshot: nothing is known to be new
  const liveNames = namesOfGroups(live);
  const wanted = wantedOf(game);
  for (const [n, c] of Object.entries(prev.snapshot?.assigned ?? {})) if (liveNames.has(n) && wanted.has(c) && !badName(n)) out[n] = c;
  for (const [g, names] of Object.entries(live)) {
    for (const n of names) {
      if (n in out || prev.names.has(n) || categoryByRule(game, g, n) !== null) continue;
      const cat = fallbackCategory(game, g, n);
      if (cat !== null) out[n] = cat;
    }
  }
  return out;
}
