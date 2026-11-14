/**
 * The shape of GGG's item list (trade(2)/data/items) as it is shipped (data/trade_names_<game>.json) and cached on the desktop.
 * Only the names are used (the real-name check of the whitelist); the groups and `assigned` are kept in the file for a later use.
 * GGG's names are NOT written into a filter on their own: a name GGG lists is not proof that the game has it as a BaseType
 * (3.30: the old Scarab names are still listed, the game rejects some of them) - see docs/archive/GGG_CATEGORY_MAP.md.
 */
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
