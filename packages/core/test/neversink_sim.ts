/**
 * A small first-match evaluator of a filter, port of tools/compare_neversink.py (test support only).
 * Only the conditions that matter for synthetic items are evaluated (BaseType, Class, Rarity, StackSize, AreaLevel,
 * ItemLevel, Quality, DropLevel, GemLevel, MapTier / WaystoneTier); a block with any other condition never matches.
 */
import { WlModel, filterWhitelist as w, py } from "../src/index.ts";
import { data } from "./helpers.ts";

const RARITY = ["Normal", "Magic", "Rare", "Unique"];
const OPS: Record<string, (a: number, b: number) => boolean> = {
  ">=": (a, b) => a >= b, "<=": (a, b) => a <= b, "<": (a, b) => a < b, ">": (a, b) => a > b, "==": (a, b) => a === b, "=": (a, b) => a === b,
};
const KNOWN = new Set(["BaseType", "Class", "Rarity", "StackSize", "AreaLevel", "ItemLevel", "Quality", "DropLevel", "GemLevel", "MapTier", "WaystoneTier"]);
const NOT_COND = new Set(["SetFontSize", "SetTextColor", "SetBorderColor", "SetBackgroundColor", "PlayAlertSound", "PlayEffect", "MinimapIcon",
  "DisableDropSound", "CustomAlertSound", "CustomAlertSoundOptional", "Continue"]);

export type Cond = [kw: string, op: string | null, vals: string[], quoted: boolean];
export type SimBlock = [kind: string, conds: Cond[], cont: boolean];
export interface SimItem { base: string; cls: string; rarity: string; stack: number; area: number; ilvl: number; quality: number; drop: number; gem: number; maptier?: number }

export const item = (o: Partial<SimItem> & Pick<SimItem, "base" | "cls">): SimItem =>
  ({ rarity: "Normal", stack: 1, area: 70, ilvl: 80, quality: 0, drop: 80, gem: 1, ...o });

export function parseBlocks(text: string): SimBlock[] {
  const out: SimBlock[] = [];
  let cur: SimBlock | null = null;
  for (const raw of py.splitLines(text)) {
    const line = py.pyStrip(raw.split("#", 1)[0]);
    if (!line) continue;
    const kw = py.splitWs(line, 1)[0];
    if (kw === "Show" || kw === "Hide") {
      cur = [kw, [], false];
      out.push(cur);
      continue;
    }
    if (cur === null) continue;
    if (kw === "Continue") {
      cur[2] = true;
      continue;
    }
    if (NOT_COND.has(kw)) continue;
    let rest = py.pyStrip(line.slice(kw.length));
    let op: string | null = null;
    const m = /^(==|>=|<=|<|>|=)\s*(.*)$/s.exec(rest);
    if (m) [, op, rest] = m as unknown as [string, string, string];
    const quoted = [...rest.matchAll(/"([^"]*)"/g)].map((x) => x[1]);
    cur[1].push([kw, op, quoted.length ? quoted : py.splitAll(rest), rest.startsWith('"') || rest.includes('"')]);
  }
  return out;
}

function matches(conds: Cond[], it: SimItem): boolean {
  for (const [kw, op, vals] of conds) {
    if (!KNOWN.has(kw)) return false;
    let ok: boolean;
    if (kw === "BaseType") ok = op === "==" || op === "=" ? vals.includes(it.base) : vals.some((v) => it.base.toLowerCase().includes(v.toLowerCase()));
    else if (kw === "Class") ok = op === "==" || op === "=" ? vals.includes(it.cls) : vals.some((v) => it.cls.toLowerCase().includes(v.toLowerCase()));
    else if (kw === "Rarity") {
      if (op !== null && op in OPS && vals.length) ok = OPS[op](RARITY.indexOf(it.rarity), RARITY.indexOf(vals[0]));
      else ok = vals.includes(it.rarity);
    } else {
      const key = ({ StackSize: "stack", AreaLevel: "area", ItemLevel: "ilvl", Quality: "quality", DropLevel: "drop", GemLevel: "gem", MapTier: "maptier", WaystoneTier: "maptier" } as Record<string, keyof SimItem>)[kw];
      const f = OPS[op ?? "=="];
      if (!f || !vals.length || !/^[+-]?\d+$/.test(py.pyStrip(vals[0]))) return false;
      ok = f(Number((it as any)[key] ?? 0), parseInt(vals[0], 10));
    }
    if (!ok) return false;
  }
  return true;
}

/** [shown, block index] of the first block that decides the item (no match = the game shows it) */
export function visible(blocks: SimBlock[], it: SimItem): [boolean, number] {
  for (let i = 0; i < blocks.length; i++) {
    const [kind, conds, cont] = blocks[i];
    if (cont) continue;
    if (matches(conds, it)) return [kind === "Show", i];
  }
  return [true, -1];
}

/** {name: first Class of a NeverSink block listing it} */
export function nameClasses(baseText: string): Map<string, string> {
  const [lines, blocks] = w.scan(baseText);
  const out = new Map<string, string>();
  for (const b of blocks) {
    const names = w.exactNames(lines, b);
    if (!names.length) continue;
    const cls = lines.slice(b.start + 1, b.end).filter((l) => /^\s*Class/.test(l)).flatMap((l) => [...l.matchAll(/"([^"]*)"/g)].map((m) => m[1]));
    if (cls.length) for (const n of names) if (!out.has(n)) out.set(n, cls[0]);
  }
  return out;
}

const PROBES: Record<string, [string, string][]> = {
  poe1: [["Runegraft of Zzz Not Yet Listed", "Stackable Currency"], ["Vial of Zzz Not Yet Listed", "Stackable Currency"], ["Zzz Not Yet Listed", "Corpses"]],
  poe2: [],
};

export function compare(game: string, stacks: number[] = [1, 3, 20], area = 70, model?: WlModel) {
  const [hub, base, extra] = data(game);
  const m = model ?? new WlModel(game);
  m.setData(hub, base, extra);
  const ns = parseBlocks(base);
  const wl = parseBlocks(m.build().text);
  const classes = nameClasses(base);
  const universe = w.universe(game, hub, base);
  const diffs = new Map<string, [string, number][]>();
  let total = 0, same = 0;
  for (const [name, cat] of py.sortedBy(universe, (e) => [e[0]])) {
    let cls = classes.get(name) || "Stackable Currency";
    if (w.isTablet(game, name)) cls = "Tablet";
    else if (cat === "Relic") cls = "Relics";
    for (const stack of stacks) {
      const it = item({ base: name, cls, stack, area });
      const a = visible(ns, it)[0], b = visible(wl, it)[0];
      total++;
      if (a === b) same++;
      else {
        const k = `${cat}|${a ? "NeverSink shows" : "NeverSink hides"}`;
        if (!diffs.has(k)) diffs.set(k, []);
        diffs.get(k)!.push([name, stack]);
      }
    }
  }
  for (const [name, cls] of PROBES[game] ?? []) {
    const it = item({ base: name, cls, area: 70 });
    const a = visible(ns, it)[0], b = visible(wl, it)[0];
    total++;
    if (a === b) same++;
    else {
      const k = `probe|${a ? "NeverSink shows" : "NeverSink hides"}`;
      if (!diffs.has(k)) diffs.set(k, []);
      diffs.get(k)!.push([name, 1]);
    }
  }
  return { total, same, diffs };
}

/** shown(text, name, cls, rarity, stack) of tests.test_wl_a3 */
export function shown(text: string, name: string, cls: string, rarity = "Normal", stack = 1): boolean {
  return visible(parseBlocks(text), item({ base: name, cls, rarity, stack }))[0];
}

/** (shown, index) of the first block that decides the item (tests.test_wl_rarity.probe) */
export function probe(text: string, cls: string, rarity: string, base = "Test Base"): [boolean, number] {
  return visible(parseBlocks(text), item({ base, cls, rarity }));
}

/** Title comment of every Show / Hide block, in order (the comment line right above it) */
export function titles(text: string): string[] {
  const out: string[] = [];
  let last = "";
  for (const l of py.splitLines(text)) {
    const s = py.pyStrip(l);
    if (s.startsWith("#")) last = s;
    else if (s.split(" ")[0] === "Show" || s.split(" ")[0] === "Hide") {
      out.push(last);
      last = "";
    } else if (!s) last = "";
  }
  return out;
}
