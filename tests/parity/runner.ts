/**
 * Runs the parity cases (tests/parity/cases/*.json) against the TypeScript core. The Python twin is
 * tools/parity/oldlib.py: both produce the same JSON shape, tests/parity/golden/*.json holds what the ORIGINAL gave.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as core from "../../packages/core/src/index.ts";
import { WlModel } from "../../packages/core/src/index.ts";

const { py, filterCore, filterGen, filterStyle, filterWhitelist: w, wlEmbed, wlImport, wlSession, tradeNames } = core;

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const FIX = path.join(ROOT, "tests", "parity", "fixtures");

export interface Case { id: string; fn: string; args: any; keep_text?: boolean }

// ------------------------------------------------------------------------------------------------ fixtures

const snapCache = new Map<string, any>();
function snap(name: string): any {
  if (!snapCache.has(name)) snapCache.set(name, JSON.parse(gunzipSync(readFileSync(path.join(FIX, name))).toString("utf-8")));
  return snapCache.get(name);
}

/** Python reads text files with universal newlines (CRLF and CR become LF); the cases were made that way. */
const universalNewlines = (t: string): string => t.replace(/\r\n?/g, "\n");

export function fixture(ref: string | null | undefined): any {
  if (ref === null || ref === undefined) return null;
  if (ref === "") return "";
  if (!ref.startsWith("fx:")) throw new Error(`bad fixture ref ${ref}`);
  const name = ref.slice(3);
  if (name.startsWith("hub_")) return { currency: [], items: snap(`${name}.json.gz`).items };
  if (name.startsWith("names_")) return new Set<string>(snap(`trade_names_${name.slice(6)}.json.gz`));
  if (name.startsWith("ns_")) {
    const [, game, kind] = name.split("_");
    return universalNewlines(readFileSync(path.join(FIX, `neversink_${game}_${kind}.filter`), "utf-8"));
  }
  if (name.startsWith("old_")) return universalNewlines(gunzipSync(readFileSync(path.join(FIX, "old_filters", `${name.slice(4)}.filter.gz`))).toString("utf-8"));
  throw new Error(`unknown fixture ${ref}`);
}

export function dataFor(game: string, hub: any = "hub", base: any = "s2", names: any = true): [any, string, Set<string>] {
  return [hub ? fixture(`fx:hub_${game}`) : null, base ? fixture(`fx:ns_${game}_${base}`) : "", names ? fixture(`fx:names_${game}`) : new Set()];
}

// ------------------------------------------------------------------------------------------------ outputs

export const Sink: { texts: Map<string, string> } = { texts: new Map() };

const cpLen = (s: string): number => (s.length < 1000 ? [...s].length : Array.from(s).length);
export const sha256 = (s: string): string => createHash("sha256").update(Buffer.from(s, "utf-8")).digest("hex");

export function textRef(caseId: string, name: string, text: string | null | undefined): any {
  if (text === null || text === undefined) return null;
  Sink.texts.set(`${caseId}.${name}`, text);
  return { $text: sha256(text), len: cpLen(text), lines: (text.match(/\n/g) ?? []).length + 1 };
}

/** Python values -> what json.dumps would carry (Map / Set / undefined) */
export function jsonable(x: any): any {
  if (x === undefined || x === null) return null;
  if (typeof x === "number" || typeof x === "boolean" || typeof x === "string") return x;
  if (Array.isArray(x)) return x.map(jsonable);
  if (x instanceof Set) {
    const items = [...x].map(jsonable);
    return items.every((v) => typeof v === "string") ? py.sortedStr(items) : items.sort((a, b) => py.cmpStr(canonical(a), canonical(b)));
  }
  if (x instanceof Map) return Object.fromEntries([...x].map(([k, v]) => [String(k), jsonable(v)]));
  if (typeof x === "object") return Object.fromEntries(Object.entries(x).map(([k, v]) => [k, jsonable(v)]));
  throw new Error(`not jsonable: ${typeof x}`);
}

export const canonical = (x: unknown): string => py.dumps(x, { sortKeys: true, ensureAscii: true, separators: [",", ":"] });

const BIG_TEXT = 2000, BIG_JSON = 30000;

export function compact(caseId: string, x: any): any {
  let counter = 0;
  const walk = (v: any): any => {
    if (typeof v === "string" && (v.length > BIG_TEXT ? cpLen(v) > BIG_TEXT : false)) return textRef(caseId, `r${++counter}`, v);
    if (Array.isArray(v)) return v.map(walk);
    if (v !== null && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, i]) => [k, walk(i)]));
    return v;
  };
  const out = walk(x);
  const blob = canonical(out);
  if (cpLen(blob) > BIG_JSON) return { $json: sha256(blob), n: cpLen(blob) };
  return out;
}

// ------------------------------------------------------------------------------------------------ fn: build_filter_text

const baseName = (p: string): string => p.split(/[\\/]/).pop()!;

function fakeCopy(calls: any[]) {
  return (soundMap: Record<string, string>) => {
    calls.push({ ...soundMap });
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(soundMap)) if (py.truthy(v)) out[k] = filterCore.safeSoundName(baseName(v))[0];
    return out;
  };
}

async function runBuildFilterText(caseId: string, a: any): Promise<any> {
  const logs: any[] = [], calls: any[] = [];
  const sounds = "sounds" in a ? a.sounds : "fake";
  const res = await filterCore.buildFilterText(a.cfg, a.game, {
    hubData: fixture(a.hub), baseText: fixture(a.base), baseTag: a.base_tag ?? null,
    copySoundsFn: py.truthy(sounds) ? fakeCopy(calls) : null, extraNames: fixture(a.names), appVersion: a.version ?? "",
    log: (m, t = "info") => logs.push([t, m]),
  });
  const out: any = { logs, copy_calls: calls };
  if (res === null) {
    out.result = null;
    return out;
  }
  const r: any = {};
  for (const [k, v] of Object.entries(res)) if (k !== "generated_section" && k !== "base_text") r[k] = jsonable(v);
  r.generated_section = textRef(caseId, "section", res.generated_section);
  r.base_text = textRef(caseId, "base", res.base_text ?? null);
  if (py.truthy(res.generated_section) || py.truthy(res.base_text)) {
    r.file = textRef(caseId, "file", filterCore.composeFilterBody(res.generated_section, res.base_text));
  }
  out.result = r;
  return out;
}

async function buildTextOnly(b: any): Promise<string> {
  const calls: any[] = [];
  const res = (await filterCore.buildFilterText(b.cfg, b.game, {
    hubData: fixture(b.hub), baseText: fixture(b.base), baseTag: b.base_tag ?? null, copySoundsFn: fakeCopy(calls),
    extraNames: fixture(b.names), appVersion: b.version ?? "", log: () => {},
  }))!;
  return filterCore.composeFilterBody(res.generated_section, res.base_text);
}

// ------------------------------------------------------------------------------------------------ fn: wl_model

const camel = (s: string): string => s.replace(/_([a-z])/g, (_m, c) => c.toUpperCase());

function applyOp(m: any, op: any[]): any {
  const [name, ...args] = op;
  if (name === "$set") {
    m[args[0]] = args[1];
    return undefined;
  }
  if (name === "$setdict") {
    m[args[0]][args[1]] = args[2];
    return undefined;
  }
  const fn = m[camel(name)];
  if (typeof fn !== "function") throw new py.PyError("TypeError", `no method ${name}`);
  return fn.apply(m, args);
}

const rowDict = (r: any): any => ({ ...r });

function modelSummary(caseId: string, m: WlModel, a: any): any {
  const out: any = {};
  out.cfg = jsonable(m.cfg());
  out.categories = jsonable(m.categories());
  const rows: any = {};
  for (const [c] of m.categories()) {
    const rs = m.rows(c).map(rowDict);
    const blob = py.dumps(rs, { sortKeys: true, ensureAscii: true });
    rows[c] = { n: rs.length, sha: sha256(blob), head: jsonable(rs.slice(0, 2)), changed: m.changedCount(c), cat_tier: m.categoryTier(c) };
  }
  for (const [q, cat] of a.queries ?? []) rows[`?${cat}:${q}`] = jsonable(m.rows(cat, q).map(rowDict).slice(0, 50));
  out.rows = rows;
  out.flask_rows = jsonable(m.flaskRows());
  out.equip_groups = jsonable(m.equipGroups());
  out.conflicts = jsonable(m.uniqueConflicts());
  const styles: any = {};
  for (const lab of ["S", "A", "B", "C", "G", "Tablet", "Map", "Gem"]) styles[lab] = jsonable(m.effectiveStyle(lab));
  out.styles = styles;
  const res = m.build(a.quest_text ?? "", py.truthy(a.sound_names) ? a.sound_names : null);
  const tiers = py.sortedBy([...res.tiers], (e) => [e[0], e[1]]);
  const cats = py.sortedBy([...res.categories], (e) => [e[0], e[1]]);
  out.build = {
    text: textRef(caseId, "build", res.text), count: res.count, report: res.report, skipped: jsonable(res.skipped),
    bad_names: jsonable(res.bad_names), unique_conflicts: jsonable(res.unique_conflicts), gear_tiers: {}, // the original reports them (always empty: its equipment is never listed block by block)
    block_tiers: {}, stack_min: jsonable(res.stack_min),
    tiers_sha: sha256(py.dumps(tiers, { ensureAscii: true })), categories_sha: sha256(py.dumps(cats, { ensureAscii: true })),
  };
  return out;
}

async function runWlModel(caseId: string, a: any): Promise<any> {
  const game = a.game;
  const m = WlModel.fromConfig(structuredClone(a.cfg ?? {}), game);
  const out: any = { notes_before: m.takeNotes() };
  if ("known_lists" in a) m.adoptKnownLists(a.known_lists);
  if (a.data ?? true) {
    const d = dataFor(game, "hub" in a ? a.hub : "hub", "base" in a ? a.base : "s2", "names" in a ? a.names : true);
    m.setData(d[0], d[1], d[2]);
  }
  out.notes_after = m.takeNotes();
  out.op_results = (a.ops ?? []).map((op: any[]) => jsonable(applyOp(m, op)));
  out.notes_ops = m.takeNotes();
  Object.assign(out, modelSummary(caseId, m, a));
  return out;
}

// ------------------------------------------------------------------------------------------------ fn: open_text

/** Deterministic edits of a filter text (the Python twin is oldlib.mutate) */
function mutate(textIn: string, ops: any[]): string {
  let text = textIn;
  for (const op of ops) {
    const kind = op[0];
    if (kind === "drop") {
      const chunks = text.split("\n\n");
      const gone = new Set<number>((op[1] as number[]).map((i) => ((i % chunks.length) + chunks.length) % chunks.length));
      text = chunks.filter((_c, i) => !gone.has(i)).join("\n\n");
    } else if (kind === "perm") {
      const chunks = text.split("\n\n");
      const order: number[] = [];
      const seen = new Set<number>();
      for (const i of op[1] as number[]) {
        const j = ((i % chunks.length) + chunks.length) % chunks.length;
        if (!seen.has(j)) {
          seen.add(j);
          order.push(j);
        }
      }
      for (let j = 0; j < chunks.length; j++) if (!seen.has(j)) order.push(j);
      text = order.map((j) => chunks[j]).join("\n\n");
    } else if (kind === "replace") {
      let n = op[3] as number;
      let out = "", at = 0;
      for (;;) {
        const i = n > 0 ? text.indexOf(op[1], at) : -1;
        if (i < 0) break;
        out += text.slice(at, i) + op[2];
        at = i + op[1].length;
        n--;
      }
      text = out + text.slice(at);
    } else if (kind === "crlf") text = text.replaceAll("\n", "\r\n");
    else if (kind === "truncate") text = text.slice(0, op[1]);
    else if (kind === "append") text = text + op[1];
    else throw new Error(`mutate ${kind}`);
  }
  return text;
}

async function runOpenText(caseId: string, a: any): Promise<any> {
  const game = a.game;
  let text = "text_from_build" in a ? await buildTextOnly(a.text_from_build) : fixture(a.text);
  if (py.truthy(a.mutate)) text = mutate(text, a.mutate);
  const current = WlModel.fromConfig(structuredClone(a.current_cfg ?? {}), game);
  const d = dataFor(game, "hub" in a ? a.hub : "hub", "base" in a ? a.base : "s2", "names" in a ? a.names : true);
  current.setData(d[0], d[1], d[2]);
  const existing = new Set<string>(a.sound_files ?? []);
  const opened = wlSession.openText(text, a.filename ?? "x.filter", game, current, a.with_data ?? true ? d : null,
    { soundFile: (name) => (existing.has(name) ? "/snd/" + name : null), folder: null });
  const out: any = { ok: opened.ok, messages: jsonable(opened.messages), name: opened.name, kind: opened.kind, app: opened.app,
    sounds: jsonable(opened.sounds) };
  if (opened.model !== null) out.model = modelSummary(caseId, opened.model, a);
  return out;
}

// ------------------------------------------------------------------------------------------------ fn: call

const blocksOf = (text: string): any[] => filterGen.parseBlocks(text.split("\n")).map((b) => ({
  block_type: b.blockType, start: b.start, end: b.end, basetype_line: b.basetypeLine, basetype_names: b.basetypeNames }));

function blockJson(b: any): any {
  return b === null ? null : { title: b.title, kind: b.kind, conds: b.conds, style: b.style };
}

function summaryJson(sm: ReturnType<typeof wlImport.summarize>): any {
  if (sm === null) return null;
  const o: any = {};
  for (const [k, v] of Object.entries(sm)) {
    if (k === "tablet_block" || k === "map_block" || k === "gold_block") o[k] = blockJson(v);
    else if (k === "gem_blocks") o[k] = (v as any[]).map(blockJson);
    else o[k] = jsonable(v);
  }
  return o;
}

const decider = (policy: string | null) => (policy === "keep" ? () => "keep" : policy === "overwrite" ? () => "overwrite" : null);

type Fn = (...args: any[]) => any;
const CALLS: Record<string, Fn> = {
  "filter_style.normalize_style": (x) => filterStyle.normalizeStyle(x),
  "filter_style.is_empty": (x) => filterStyle.isEmpty(x),
  "filter_style.uses_sound_file": (x) => filterStyle.usesSoundFile(x),
  "filter_style.style_lines": (style, soundFile = null, indent = "    ") => filterStyle.styleLines(style, soundFile, indent),
  "filter_style.lines_to_style": (lines) => filterStyle.linesToStyle(lines),
  "filter_style.merge_styles": (b, o) => filterStyle.mergeStyles(b, o),
  "filter_style.default_quest_style": () => filterStyle.defaultQuestStyle(),
  "filter_style.DEFAULT_STYLES": () => filterStyle.DEFAULT_STYLES,
  "filter_gen.parse_blocks": (text) => blocksOf(text),
  "filter_gen.sound_id_of": (body) => filterGen.soundIdOf(body),
  "filter_gen.apply_numbered_sounds": (ref, sm) => filterGen.applyNumberedSounds(fixture(ref), sm),
  "filter_gen.apply_numbered_sounds_text": (text, sm) => filterGen.applyNumberedSounds(text, sm),
  "filter_gen.names_in_categories": (ref, cats) => filterGen.namesInCategories(fixture(ref), cats),
  "filter_gen.expand_categories": (ref, cats, ex = null) => filterGen.expandCategories(fixture(ref), cats, ex),
  "filter_gen.normalize_custom": (x) => filterGen.normalizeCustom(x),
  "filter_gen.build_whitelist_section": (exact, uniq = null, contains = null, kw: any = {}) =>
    filterGen.buildWhitelistSection(exact, uniq, contains, { gemUncut: kw.gem_uncut ?? null, gold: kw.gold ?? false, goldMin: kw.gold_min ?? 0, uniqueAll: kw.unique_all ?? false }),
  "filter_core.quote": (s) => filterCore.quote(s),
  "filter_core.neversink_filename": (g, s) => filterCore.neversinkFilename(g, s),
  "filter_core.neversink_file_url": (g, tag, s) => filterCore.neversinkFileUrl(g, tag, s),
  "filter_core.neversink_latest_api_url": (g) => filterCore.neversinkLatestApiUrl(g),
  "filter_core.compose_filter_body": (gen, base) => filterCore.composeFilterBody(gen, base),
  "filter_core.validate_filter_name": (n) => filterCore.validateFilterName(n),
  "filter_core.safe_sound_name": (n) => filterCore.safeSoundName(n),
  "filter_core.plan_sound_files": (req, existing) => filterCore.planSoundFiles(req, existing),
  "filter_core.resolve_sound_plan": (req, existing, policy = null) => filterCore.resolveSoundPlan(filterCore.planSoundFiles(req, existing), decider(policy)),
  "filter_core.build_quest_blocks": (game, style, soundFile = null, defaultLines = null) => filterCore.buildQuestBlocks(game, style, soundFile, defaultLines),
  "filter_core.tier_sound_requests": (cfg) => filterCore.tierSoundRequests(cfg),
  "filter_core.migrate_sounds": (cfg) => filterCore.migrateSounds(cfg),
  "filter_core.plan_fetch": (cfg, game) => filterCore.planFetch(cfg, game),
  "filter_core.add_shared_tier_sounds": (section, copied) => filterCore.addSharedTierSounds(section, copied),
  "w.tier_of_step": (tag) => w.tierOfStep(tag),
  "w.bad_name": (n) => w.badName(n),
  "w.default_tiers": (ref) => w.defaultTiers(fixture(ref)),
  "w.known_names": (ref) => w.knownNames(fixture(ref)),
  "w.start_tiers": (ref) => w.startTiers(fixture(ref)),
  "w.stack_info": (ref) => { const [d, s] = w.stackInfo(fixture(ref)); return [d, [...s].sort(py.cmpStr)]; },
  "w.unique_base_defaults": (ref) => w.uniqueBaseDefaults(fixture(ref)),
  "w.poe1_special_map_bases": (ref) => w.poe1SpecialMapBases(fixture(ref)),
  "w.universe": (game, hub, ref) => w.universe(game, fixture(hub), fixture(ref)),
  "w.type_category": (game, ty) => w.typeCategory(game, ty),
  "w.gear_sequence": (game, ref) => w.gearSequence(game, fixture(ref)).map((e) => ["copy", ...e]), // (the original tags each entry)
  "w.neversink_quest_lines": (ref) => w.neversinkQuestLines(fixture(ref)),
  "w.default_tier_lines": (ref) => w.defaultTierLines(fixture(ref)),
  "w.sound_requests": (cfg, game = null) => w.soundRequests(cfg, game),
  "w.gear_group_of": (game, ty) => w.gearGroupOf(game, ty),
  "w.equip_groups": (game) => w.equipGroups(game),
  "w.unique_entries": (ref) => w.uniqueEntries(fixture(ref)),
  "wl_embed.embed_lines": (cfg, game, version = "") => wlEmbed.embedLines(cfg, game, version),
  "wl_embed.embed": (text, cfg, game, version = "") => wlEmbed.embed(text, cfg, game, version),
  "wl_embed.extract": (text) => wlEmbed.extract(text),
  "wl_embed.classify": (text) => wlEmbed.classify(text),
  "wl_embed.classify_fixture": (ref) => wlEmbed.classify(fixture(ref)),
  "wl_embed.whitelist_part": (cfg, game) => wlEmbed.whitelistPart(cfg, game),
  "wl_import.version_of": (text) => wlImport.versionOf(text),
  "wl_import.guess_game": (text) => wlImport.guessGame(text),
  "wl_import.summarize_fixture": (ref) => summaryJson(wlImport.summarize(fixture(ref))),
  "trade_names.names_from_payload": (p) => tradeNames.namesFromPayload(p),
  "wl_model.convert_legacy": (fg, game) => WlModel.convertLegacy(fg, game),
};

function errorName(e: unknown): string {
  if (e instanceof py.PyError) return e.kind;
  return (e as Error)?.name ?? "Error";
}

async function runCall(caseId: string, a: any): Promise<any> {
  const fn = CALLS[a.name];
  if (!fn) throw new Error(`no TS call ${a.name}`);
  let r: any;
  try {
    const kw = a.kwargs;
    const args = [...(a.args ?? [])];
    // keyword arguments of the Python call: build_whitelist_section takes them as one object, the rest by position
    r = a.name === "filter_gen.build_whitelist_section" ? fn(args[0], args[1], args[2], kw ?? {}) : fn(...args);
  } catch (e) {
    return { error: errorName(e) };
  }
  return { result: compact(caseId, jsonable(r)) };
}

export async function runCase(c: Case): Promise<any> {
  try {
    switch (c.fn) {
      case "build_filter_text": return await runBuildFilterText(c.id, c.args);
      case "wl_model": return await runWlModel(c.id, c.args);
      case "open_text": return await runOpenText(c.id, c.args);
      case "call": return await runCall(c.id, c.args);
      default: throw new Error(`unknown fn ${c.fn}`);
    }
  } catch (e) {
    return { error: errorName(e) };
  }
}

/** JSON as a plain value (what readFileSync + JSON.parse of the golden gives) */
export const plain = (x: unknown): any => JSON.parse(JSON.stringify(x));
