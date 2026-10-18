/** The TypeScript twin of tools/parity/item_calls.py: the item pipeline (F5 / F4) run on the fixtures. */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import * as core from "../../packages/core/src/index.ts";
import { FIX } from "./runner.ts";

const { py, pyextra, difflib, itemParser, baseDb, modDb, metaDb, modBadge, tradeUrl, skillRef, f5, league: leagueMod, profiles, models } = core;
const { HubClient } = core.hubClient;
const { HttpError } = core;

const snapCache = new Map<string, any>();
const snap = (name: string): any => {
  if (!snapCache.has(name)) snapCache.set(name, JSON.parse(gunzipSync(readFileSync(path.join(FIX, name))).toString("utf-8")));
  return snapCache.get(name);
};
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));

export function itemText(ref: string): string {
  if (!ref.startsWith("it:")) throw new Error(`bad item ref ${ref}`);
  return readFileSync(path.join(FIX, "items", ref.slice(3) + ".txt"), "utf-8");
}

const dummyHttp = { getText: async (): Promise<string> => { throw new Error("no network in the parity runs"); } };
const memFs = (files: Record<string, string>): core.FsPort => ({
  join: (...p: string[]) => p.join("/"), basename: (p: string) => p.split("/").pop()!,
  exists: async (p: string) => p in files, isFile: async (p: string) => p in files, isDir: async () => false,
  readText: async (p: string) => files[p], writeText: async () => {}, mkdirp: async () => {}, listDir: async () => [],
  mtimeSec: async () => 0, sha256: async () => "", copyFile: async () => {},
});
const dbEnv = { fs: memFs({}), http: dummyHttp, cacheDir: null, nowMs: () => 0 };

const memo = new Map<string, any>();
const once = <T>(key: string, make: () => T): T => {
  if (!memo.has(key)) memo.set(key, make());
  return memo.get(key);
};

const statsDb = (g: string) => once(`stats-${g}`, () => {
  const db = new modDb.ModDatabase(profiles.PROFILES[g], dbEnv);
  db.buildIndex(snap(`gstats_${g}.json.gz`));
  db.load = async () => {};
  return db;
});
const baseDbOf = (g: string) => once(`base-${g}`, () => {
  const db = new baseDb.BaseDB(profiles.PROFILES[g], dbEnv);
  db.build(snap(`gitems_${g}.json.gz`));
  db.load = async () => {};
  return db;
});
const metaOf = async (g: string) => {
  const m = once(`meta-${g}`, () => new metaDb.MetaDB(g, { fs: memFs({ [`/m/mod_meta_${g}.json`]: JSON.stringify(snap(`mod_meta_${g}.json.gz`)) }), appDir: "/m" }));
  await m.load();
  return m;
};
const badgeOf = (g: string) => once(`badge-${g}`, () => {
  const b = new modBadge.ModBadgeDB({ fs: memFs({}), hub: null as any, cacheDir: null, configDir: null, nowMs: () => 0 });
  b.index(snap(`hub_meta_${g}.json.gz`));
  b.load = async () => {};
  return b;
});

/** the original's ModValue also carries stat_id / value_min / value_max, which nothing ever reads or sets: not converted, added back here to compare the whole record */
const legacyMod = (m: any): any => ({ stat_id: "", ...m, value_min: null, value_max: null });
const jsonable = (x: any): any => {
  const out = JSON.parse(py.dumps(x instanceof Map ? Object.fromEntries(x) : x));
  const fix = (v: any): void => {
    if (Array.isArray(v)) v.forEach(fix);
    else if (v && typeof v === "object") {
      if (Array.isArray(v.mods) && "mods_have_headers" in v) v.mods = v.mods.map(legacyMod);
      if ("mod_type" in v && "group" in v && "affix" in v && !("stat_id" in v)) Object.assign(v, legacyMod(v));
      Object.values(v).forEach(fix);
    }
  };
  fix(out);
  return out;
};

// ------------------------------------------------------------------------------------------------ skills / leagues over a fake hub

function fakeHub(files: Record<string, any>): InstanceType<typeof HubClient> {
  const http = {
    getText: async (url: string): Promise<string> => {
      const p = url.replace(core.hubClient.HUB_BASE_URL + "/", "");
      if (p in files && files[p] !== undefined) return JSON.stringify(files[p]);
      throw new HttpError(404, url);
    },
  };
  return new HubClient(http);
}
const skillHub = (g: string, fx: any) => fakeHub({
  [`${g}/skills/index.json`]: fx.index, [`${g}/skills/dictionary.json`]: fx.dictionary, [`${g}/passives/latest.json`]: fx.passives, ...fx.files,
});
async function skillDb(g: string, fx: any = snap(`hub_skills_${g}.json.gz`)): Promise<InstanceType<typeof skillRef.SkillRefDB>> {
  const db = new skillRef.SkillRefDB(g, skillHub(g, fx));
  await db.load();
  return db;
}
const skillMemo = new Map<string, Promise<any>>();
const skillOf = (g: string) => {
  if (!skillMemo.has(g)) skillMemo.set(g, skillDb(g));
  return skillMemo.get(g)!;
};

function leagueIndex(game: string, shape: string): any {
  const ix = clone(snap(`hub_league_index_${game}.json.gz`));
  if (shape === "no_hc") ix.hardcore = null;
  else if (shape === "no_events") ix.events = [];
  else if (shape === "no_main") ix.main = {};
  else if (shape === "dup") ix.events = [...ix.events, { league: ix.main.league, path: "dup/path.json" }];
  return ix;
}
async function leagueFiles(game: string, shape: string) {
  const files: Record<string, any> = {};
  if (shape === "down") files[`${game}/prices/latest.json`] = { league: "Fallback League" };
  else if (shape !== "down_nolatest") files[`${game}/prices/index.json`] = leagueIndex(game, shape);
  return fakeHub(files).getLeagueFiles(game);
}

// ------------------------------------------------------------------------------------------------ the F5 flow

async function runF5(a: any): Promise<any> {
  const game = a.game;
  const text = a.text.startsWith("it:") ? itemText(a.text) : a.text;
  const env = {
    game, league: a.league ?? "", profile: profiles.PROFILES[game], modDb: statsDb(game), baseDb: baseDbOf(game), modBadge: badgeOf(game),
    metaDb: await metaOf(game), cfg: a.cfg ?? {},
  };
  const r = await f5.prepareF5(text, env);
  if (r.kind === "unparsed") return { kind: "unparsed" };
  if (r.kind === "url") return { kind: "url", url: r.url, item: jsonable(r.item) };
  return {
    kind: "picker", item: jsonable(r.item), rows: r.rows.map((x) => [jsonable(x.mod), x.statId]), annos: jsonable(r.annos), summary: r.summary,
    badge_colors: r.badge_colors, roll_arrows: r.roll_arrows, affixes: r.affixes,
  };
}
export const runItemCase = (c: { fn: string; args: any }): Promise<any> | null => (c.fn === "f5" ? runF5(c.args) : null);

// ------------------------------------------------------------------------------------------------ calls

const floatOrText = (v: number): number | string => (Number.isFinite(v) ? v : py.pyFloatText(v));

export const ITEM_CALLS: Record<string, (...a: any[]) => any> = {
  "item_parser.parse_item": (ref, game) => { const it = itemParser.parseItem(itemText(ref), game); return it === null ? null : jsonable(it); },
  "item_parser.parse_text": (text, game) => { const it = itemParser.parseItem(text, game); return it === null ? null : jsonable(it); },
  "trade_url.build": (ref, game, league, baseOn = true, custom = null, minPct = 0.8) => {
    const it = itemParser.parseItem(itemText(ref), game);
    // [[id|null, min|null, max|null], ...] -> the filters a picker sends
    const filters = custom === null ? null : custom.map(([id, lo, hi]: [string | null, number | null, number | null]) => {
      const f: any = id === null ? {} : { id };
      f.disabled = false;
      const v: any = {};
      if (lo !== null) v.min = lo;
      if (hi !== null) v.max = hi;
      if (Object.keys(v).length) f.value = v;
      return f;
    });
    return it === null ? null : tradeUrl.buildTradeUrl(it, statsDb(game), league, profiles.PROFILES[game], minPct, filters, baseOn ? baseDbOf(game) : null);
  },
  "mod_db.find": (game, text, typ = null, threshold = 0.75) => statsDb(game).findStatId(text, typ, threshold),
  "mod_db.normalize": (text) => modDb.normalizeMod(text),
  "base_db.resolve_type": (game, raw) => baseDbOf(game).resolveType(raw),
  "base_db.resolve_name": (game, raw) => baseDbOf(game).resolveName(raw),

  "meta_db.norm": (t) => metaDb.norm(t),
  "meta_db.resolve_base": async (game, name) => (await metaOf(game)).resolveBase(name),
  "meta_db.tier_range": async (game, bt, text, tier) => (await metaOf(game)).tierRange(bt, text, tier),
  "meta_db.annotate": async (ref, game) => {
    const it = itemParser.parseItem(itemText(ref), game);
    if (it === null) return null;
    const m = await metaOf(game);
    if (it.rarity === models.Rarity.MAGIC && it.identified) it.base_type = m.resolveBase(it.base_type) || "";
    if (!it.mods_have_headers) m.inferAffixes(it);
    const ann = m.annotate(it);
    const cap = modBadge.affixCap(it.item_class, game);
    return { ann: jsonable(ann), summary: metaDb.MetaDB.summary(it, ann, cap, cap), item: jsonable(it) };
  },
  "meta_db.tags_for_template": async (game, t) => py.sortedStr((await metaOf(game)).tagsForTemplate(t)),

  "mod_badge.slot_for_item": (cls, bt) => modBadge.slotForItem(cls, bt),
  "mod_badge.affix_cap": (cls, game = "poe2") => modBadge.affixCap(cls, game),
  "mod_badge.tier_roll_arrow": (values, rng, pct = 0.25) => modBadge.tierRollArrow(values, rng, pct),
  "mod_badge.build_template_index": (game) => modBadge.buildTemplateIndex(snap(`hub_meta_${game}.json.gz`).stat_dictionary ?? []),
  "mod_badge.colors": async (game, slot, arch) => {
    const b = badgeOf(game) as any, m = await metaOf(game);
    const keys: [string, string, string][] = [...b.byKey.values()].map((r: any) => [r.slot ?? "", r.archetype ?? "", r.stat_id ?? ""]);
    keys.sort((x, y) => py.cmpTuple(x, y));
    const out: Record<string, any> = {};
    for (const [s, ar, sid] of keys) if (s === slot && ar === arch) out[sid] = [b.badgeColor(sid, slot, arch), b.tagColor(sid, slot, arch, m)];
    return out;
  },
  "mod_badge.resolve": (game, text, typ = null) => badgeOf(game).resolveStatId(text, typ, statsDb(game)),
  "mod_badge.fallback_arrow": (game, sid, slot, arch, values) => badgeOf(game).rollIndicatorFallback(sid, slot, arch, values),

  "skill_ref.search": async (game, prefix) => (await skillOf(game)).searchSkills(prefix).map((s: any) => [s.skill_type, s.skill, s.facet_count]).slice(0, 40),
  "skill_ref.count": async (game) => { const db = await skillOf(game); return [(db as any).skills.length, db.available()]; },
  "skill_ref.meta": async (game, t, s) => (await skillOf(game)).skillMeta(t, s),
  "skill_ref.mods": async (game, t, s) => (await skillOf(game)).modsForSkill(t, s),
  "skill_ref.passives": async (game, t, s) => (await skillOf(game)).passivesForSkill(t, s),
  "skill_ref.files": (game) => Object.keys(snap(`hub_skills_${game}.json.gz`).files).sort(py.cmpStr),
  "skill_ref.schema": async (game, which) => {
    const fx = clone(snap(`hub_skills_${game}.json.gz`));
    fx[which].schema_version = 99;
    const db = await skillDb(game, fx);
    const first = Object.keys(fx.files)[0];
    const skill = (db as any).skills.find((s: any) => s.path === first);
    return {
      n_skills: (db as any).skills.length, available: db.available(), dictionary: (db as any).dictionary.size, passive_keys: (db as any).passivesByKey.size,
      mods: skill === undefined ? null : await db.modsForSkill(skill.skill_type, skill.skill),
    };
  },

  "hub_client.get_league_files": (game, shape) => leagueFiles(game, shape),
  "app.choose_league": async (game, shape, auto, preferHc, current) => {
    const files = await leagueFiles(game, shape);
    const r = leagueMod.chooseLeague(files, { autoPick: auto, preferHc, current });
    const state: any = r.ok ? { values: r.leagues, picked: r.picked } : { loaded_cache: true };
    return { files, league_paths: Object.entries(r.leaguePaths), state, logs: r.logs };
  },

  "py.round": (x, n) => { const r = pyextra.pyRound(x, n); return r === 0 ? 0 : r; },
  "py.format_g": (x) => pyextra.pyFormatG(x),
  "py.float": (s) => floatOrText(pyextra.pyFloatParse(s)),
  "py.sum": (xs) => pyextra.pySum(xs),
  "py.quote": (s, safe = "/") => pyextra.pyQuote(s, safe),
  "py.close_matches": (word, poss, n = 1, cutoff = 0.6) => difflib.getCloseMatches(word, poss, n, cutoff),
  "py.ratio": (a, b) => { const m = new difflib.SequenceMatcher(); m.setSeq2(b); m.setSeq1(a); return m.ratio(); },
  "py.json_float": (x) => py.dumps({ v: new py.PyFloat(x) }, { separators: [",", ":"] }),

  "tools.build_mod_meta": (game, bases, mods) => {
    try {
      const { meta } = core.modMetaBuild.buildModMeta(game, bases, mods, "T");
      const text = core.modMetaBuild.serialize(meta);
      return { exit: 0, len: [...text].length, sha: createHash("sha256").update(text, "utf-8").digest("hex"), meta: JSON.parse(text) };
    } catch (e) {
      if (!(e instanceof core.modMetaBuild.ModMetaError)) throw e;
      return { exit: 1, errors: [`✗ validation ล้มเหลวสำหรับ --game ${game}:`, ...e.problems.map((p) => `  - ${p}`)] };
    }
  },
};
