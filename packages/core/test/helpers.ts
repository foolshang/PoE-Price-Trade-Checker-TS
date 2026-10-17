/** Shared helpers of the unit tests (the same fixtures the original tests use: tests/parity/fixtures). */
import { dataFor, fixture } from "../../../tests/parity/runner.ts";
import { WlModel, filterStyle, wlEmbed } from "../src/index.ts";
import { filterCore, filterWhitelist as w } from "../src/index.ts";

export { fixture };

export type Data = [hub: any, base: string, names: Set<string>];

/** (hub, NeverSink s2 text, real names) of a game, like tests.test_wl_phase3b.data() */
export const data = (game: string): Data => dataFor(game);

export function model(game: string, fg: Record<string, any> = {}): WlModel {
  const m = WlModel.fromConfig(structuredClone(fg), game);
  const [hub, base, names] = data(game);
  m.setData(hub, base, names);
  return m;
}

/** the text from `header` to the next blank line */
export function block(text: string, header: string): string {
  const i = text.indexOf(header);
  if (i < 0) throw new Error(`no ${JSON.stringify(header)}`);
  const j = text.indexOf("\n\n", i);
  return text.slice(i, j > 0 ? j : text.length);
}

export const noop = (): void => {};

// ------------------------------------------------------------------------------------------------ lint (test_filter_vocabulary)

const OPS = new Set(["==", "=", "!=", "<", ">", "<=", ">="]);
const MANUAL_KEYWORDS = new Set([
  "Rarity", "Class", "BaseType", "AreaLevel", "MapTier", "WaystoneTier", "GemLevel", "StackSize", "ItemLevel",
  "DropLevel", "Quality", "Height", "Width", "Sockets", "LinkedSockets", "SocketGroup", "HasExplicitMod",
  "HasInfluence", "AnyEnchantment", "AlwaysShow", "Corrupted", "Identified", "FracturedItem", "Mirrored",
  "SynthesisedItem", "TwiceCorrupted", "BlightedMap", "UberBlightedMap", "ZanaMemory", "MemoryStrands",
  "CorruptedMods", "HasCruciblePassiveTree", "Replica",
  "SetFontSize", "SetTextColor", "SetBorderColor", "SetBackgroundColor", "PlayAlertSound",
  "CustomAlertSound", "CustomAlertSoundOptional", "MinimapIcon", "PlayEffect", "DisableDropSound", "Continue",
]);
const MANUAL_RARITY_OPS = new Set(["<", "<=", ">", ">=", "=", "==", "!="]);
const RARITIES = new Set(["Normal", "Magic", "Rare", "Unique"]);
const NOT_IN_NEVERSINK_OK = new Set(["CustomAlertSoundOptional", "Rarity <", "Rarity >=", "Rarity <=", "GemLevel >=", "WaystoneTier >=", "MapTier >="]);
const CLASSES_NOT_IN_NEVERSINK_OK = new Set(["Tablet"]);

/** shlex.split(line) (posix): quotes group, backslash escapes; throws on an unmatched quote */
export function shlexSplit(line: string): string[] {
  const out: string[] = [];
  let cur = "", has = false, q: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === q) q = null;
      else if (q === '"' && c === "\\" && (line[i + 1] === '"' || line[i + 1] === "\\")) cur += line[++i];
      else cur += c;
    } else if (c === '"' || c === "'") {
      q = c;
      has = true;
    } else if (c === "\\") {
      cur += line[++i] ?? "";
      has = true;
    } else if (/\s/.test(c)) {
      if (cur || has) out.push(cur);
      cur = "";
      has = false;
    } else {
      cur += c;
      has = true;
    }
  }
  if (q) throw new Error("No closing quotation");
  if (cur || has) out.push(cur);
  return out;
}

export function lintParse(text: string): [string, string | null, string[]][] {
  const out: [string, string | null, string[]][] = [];
  for (const raw of text.split(/\r\n|\r|\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    let toks: string[];
    try {
      toks = shlexSplit(line);
    } catch {
      toks = line.split(/\s+/);
    }
    const kw = toks[0];
    let rest = toks.slice(1);
    let op: string | null = null;
    if (rest.length && OPS.has(rest[0])) {
      op = rest[0];
      rest = rest.slice(1);
    }
    out.push([kw, op, rest]);
  }
  return out;
}

const isDigits = (v: string): boolean => /^\d+$/.test(v);

/** List of problems with a generated filter (empty = clean). The lines must use only keywords / operators / values the game knows. */
export function lint(text: string, baseText: string): string[] {
  const problems: string[] = [];
  const ns = lintParse(baseText);
  const nsKw = new Set(ns.map(([k]) => k));
  const nsPairs = new Set(ns.map(([k, o]) => `${k} ${o}`));
  const nsClasses = new Set(ns.filter(([k]) => k === "Class").flatMap(([, , v]) => v));
  for (const [kw, op, vals] of lintParse(text)) {
    if (kw === "Show" || kw === "Hide") continue;
    if (!MANUAL_KEYWORDS.has(kw) && !nsKw.has(kw)) {
      problems.push(`unknown keyword ${kw}`);
      continue;
    }
    if (!nsKw.has(kw) && !NOT_IN_NEVERSINK_OK.has(kw)) problems.push(`keyword ${kw} not used by NeverSink and not verified`);
    if (op && !nsPairs.has(`${kw} ${op}`) && !NOT_IN_NEVERSINK_OK.has(`${kw} ${op}`)) problems.push(`operator ${kw} ${op} not used by NeverSink and not verified`);
    if (kw === "Rarity") {
      if (op && !MANUAL_RARITY_OPS.has(op)) problems.push(`Rarity operator ${op}`);
      const bad = vals.filter((v) => !RARITIES.has(v));
      if (bad.length) problems.push(`Rarity value ${bad}`);
    } else if (kw === "Class") {
      for (const c of vals) if (!nsClasses.has(c) && !CLASSES_NOT_IN_NEVERSINK_OK.has(c)) problems.push(`Class '${c}' unknown to NeverSink`);
    } else if (kw === "SetTextColor" || kw === "SetBorderColor" || kw === "SetBackgroundColor") {
      if (![3, 4].includes(vals.length) || !vals.every((v) => isDigits(v) && +v >= 0 && +v <= 255)) problems.push(`${kw} ${vals}`);
    } else if (kw === "SetFontSize") {
      if (!(vals.length && isDigits(vals[0]) && +vals[0] >= 1 && +vals[0] <= 45)) problems.push(`SetFontSize ${vals}`);
    } else if (kw === "PlayAlertSound") {
      if (!([1, 2].includes(vals.length) && isDigits(vals[0]) && +vals[0] >= 1 && +vals[0] <= 16 &&
          (vals.length === 1 || (isDigits(vals[1]) && +vals[1] >= 0 && +vals[1] <= 300)))) problems.push(`PlayAlertSound ${vals}`);
    } else if (kw === "CustomAlertSoundOptional") {
      if (!([1, 2].includes(vals.length) && /\.(mp3|wav|ogg)$/i.test(vals[0]) &&
          (vals.length === 1 || (isDigits(vals[1]) && +vals[1] >= 0 && +vals[1] <= 300)))) problems.push(`CustomAlertSoundOptional ${vals}`);
    } else if (kw === "MinimapIcon") {
      if (!(vals.length === 3 && ["0", "1", "2"].includes(vals[0]) && filterStyle.COLORS.includes(vals[1]) && filterStyle.SHAPES.includes(vals[2]))) problems.push(`MinimapIcon ${vals}`);
    } else if (kw === "PlayEffect") {
      if (!(vals.length && filterStyle.COLORS.includes(vals[0]) && (vals.length === 1 || (vals.length === 2 && vals[1] === "Temp")))) problems.push(`PlayEffect ${vals}`);
    } else if (["StackSize", "AreaLevel", "MapTier", "WaystoneTier", "GemLevel", "ItemLevel"].includes(kw)) {
      const bare = op === null && nsPairs.has(`${kw} null`); // `GemLevel 1`: no operator = "equal", NeverSink writes it
      if (!(((op !== null && OPS.has(op)) || bare) && vals.length === 1 && isDigits(vals[0]))) problems.push(`${kw} ${op} ${vals}`);
    } else if (["AlwaysShow", "Corrupted", "Identified", "FracturedItem", "Mirrored", "AnyEnchantment"].includes(kw)) {
      if (!(vals.length === 1 && (vals[0] === "True" || vals[0] === "False"))) problems.push(`${kw} ${vals}`);
    }
  }
  return problems;
}

/** (base text, whitelist text) with every block kind switched on (tests.test_filter_vocabulary.everything_on) */
export function everythingOn(game: string): [string, string] {
  const [hub, base, trade] = data(game);
  const full = { icon: { size: 1, color: "Cyan", shape: "Square" }, effect: { color: "Red", temp: true },
    sound: { kind: "file", file: "a.mp3", volume: 300 }, text: [1, 2, 3, 255], border: [1, 2, 3, 255], bg: [1, 2, 3, 255], size: 40 };
  const cfg: Record<string, any> = {
    whitelist_gold: true, whitelist_gold_min: 10, wl_map_on: true, wl_map_tier_min: 5, wl_map_rarity_min: "Rare",
    style_q: filterStyle.defaultQuestStyle(),
    [`whitelist_custom_${game}`]: [{ name: "x", rarities: ["Magic"], tier: "A" }],
    wl_tier_style: Object.fromEntries(["S", "A", "B", "G", "Tablet", "Map"].map((k) => [k, { ...full }])),
    [`wl_item_tier_${game}`]: { "Chaos Orb": "S" }, wl_tier_stack: { S: 2, A: 3, B: 4 }, [`wl_item_stack_${game}`]: { "Divine Orb": 6 },
  };
  cfg.wl_tier_style.B = { ...full, bg: [1, 2, 3, 0], off: ["effect", "icon"] }; // transparent + switched-off parts
  if (game === "poe2") cfg.whitelist_gem_uncut_poe2 = { "Uncut Skill Gem": 10 };
  const quest = filterCore.buildQuestBlocks(game, cfg.style_q, "q.mp3");
  const res = w.buildWhitelistFilter(game, cfg, base, hub, quest, Object.fromEntries(["S", "A", "B", "G", "Tablet", "Map"].map((k) => [k, "a.mp3"])), trade);
  return [base, wlEmbed.embed(res.text, cfg, game)]; // with the settings comment lines
}

// ------------------------------------------------------------------------------------------------ _generate (tests.test_wl_phase3b)

import { mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { NodeFs } from "../../node/src/nodefs.ts";
import { filterService } from "../src/index.ts";

export const tmpDir = (): string => mkdtempSync(path.join(os.tmpdir(), "poe-ts-"));
export const readText = (p: string): string => readFileSync(p, "utf-8");

/** generate_filter (whitelist mode, wl_v2) with the fixtures as inputs; returns the result of the service */
export async function generate(cfgDict: Record<string, any>, game: string, tmp: string, name = "wl-test") {
  const [hub, base, extra] = data(game);
  const fg = { ...cfgDict, whitelist_enabled: true, wl_v2: true, [`game_dir_${game}`]: path.join(tmp, "game"), filter_name_whitelist: name };
  const config = { get: (k: string, d?: any) => (k === "filter_gen" ? { ...fg } : d), set: () => {}, save: () => {}, appDir: () => path.join(tmp, "app") };
  const env = { fs: new NodeFs({ eol: "lf" }), http: { getText: async (): Promise<string> => { throw new Error("no net"); } }, documentsDir: tmp, nowMs: () => Date.now(), appVersion: "t",
    deps: { fetchBaseFilter: async (): Promise<[string | null, string | null]> => [base, "t"], getPrices: async () => hub, getNames: async () => extra } };
  return (await filterService.generateFilter(config, game, "p", env, { mode: "whitelist" }))!;
}
