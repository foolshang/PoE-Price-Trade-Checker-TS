/**
 * Whitelist tab model (no UI): what the player has changed, how it maps to config keys, and the rows the item list
 * shows. Port of poe_price_trade/wl_model.py. Everything about tiers is delegated to filter_whitelist - the list shows
 * exactly what the generator will write, never a second opinion.
 *
 * Only changes are stored. See the Python module docstring for the config keys (wl_item_tier_<g>, wl_cat_tier_<g>, ...).
 */
import * as filterCore from "./filter_core.ts";
import * as filterGen from "./filter_gen.ts";
import * as filterStyle from "./filter_style.ts";
import * as w from "./filter_whitelist.ts";
import { cmpTuple, get, has, intOr, isDict, pyInt, pyStrip, sortedBy, sortedStr, truthy, PyError } from "./py.ts";

type Cfg = Record<string, any>;

export const TIER_CHOICES = w.TIERS as readonly string[]; // the shown tiers (S A B C): each has a style, a stack minimum, a sound
export const ALL_CHOICES = w.ALL_TIERS; // ... and D, hidden
export const HIDE = w.HIDE_TIER;
export const TABLET_CATEGORY = w.TABLET_CATEGORY;
export const FLASK_CATEGORY = w.FLASK_CATEGORY;
export const EQUIP_CATEGORY = w.EQUIP_CATEGORY;
export const UNIQUE = w.UNIQUE_CATEGORY;
export const STYLE_LABELS = ["S", "A", "B", "C", "G", "Tablet", "Map", "Gem"];
export const RARITIES = ["Normal", "Magic", "Rare", "Unique"];
export const DEFAULT_CUSTOM_TIER = "B"; // a row set "myself" starts every rarity at B (NeverSink is the "default" mode, not a choice)
const AUTO_NOTE = "ช่อง \"ตาม NeverSink\" ของแถวที่ตั้งค่าเอง (Flask/Charm/Tincture หรืออุปกรณ์ตาม class) ถูกแปลงเป็น B แล้ว " +
  "— ถ้าต้องการ NeverSink ให้เลือก \"ค่าเริ่มต้น\" ของแถวนั้น";
const hiddenNote = (n: number): string => `tier C เดิม (ซ่อน) ${n} ค่า ถูกแปลงเป็น D (ซ่อน) แล้ว — tier C ใหม่คือ tier ที่โชว์ด้วยสไตล์ของตัวเอง ` +
  "(จางกว่า B) · S/A/B ที่ตั้งไว้คงเดิม";
const RARE_NOTE = "ข้ามค่า Rare ของ Flask / Charm / Tincture ที่เคยตั้งไว้ (ในเกมของพวกนี้ไม่มี Rare — " +
  "ใช้ block ของ NeverSink ตามเดิม)";

const count = (v: unknown): number => Math.max(1, intOr(v, 1));
const inAll = (t: unknown): boolean => typeof t === "string" && ALL_CHOICES.includes(t);
const orEmpty = (v: unknown): Record<string, any> => (truthy(v) ? (v as Record<string, any>) : {});
const pop = (o: Record<string, any>, k: string): any => {
  if (!has(o, k)) return undefined;
  const v = o[k];
  delete o[k];
  return v;
};

export interface Row {
  key: string; // what the setters take (item name / unique name / class / group id)
  label: string; // text shown
  tier: string; // effective S / A / B / C / D / T
  default: string; // NeverSink's starting tier for this row
  user_set: boolean; // the player changed it (item / unique / class / block level)
  note: string; // warning / hint shown next to the row
  stackable: boolean; // the name can stack (a minimum stack size applies)
  stack: number; // the stack size needed to show it (1 = every one)
  stack_set: boolean; // the player set this name's own minimum
}

const mkRow = (key: string, label: string, tier: string, dflt: string, userSet: boolean, extra: Partial<Row> = {}): Row =>
  ({ key, label, tier, default: dflt, user_set: userSet, note: "", stackable: false, stack: 1, stack_set: false, ...extra });

/** A config written before tier D has no `wl_tier_format`, and its C is the hidden tier: every C becomes D, once. */
export function migrateHidden(fg: Cfg, game: string): [Cfg, number] {
  if (fg.wl_tier_format === w.TIER_FORMAT) return [fg, 0];
  const out: Cfg = { ...fg };
  let n = 0;
  const conv = (v: any): any => {
    if (v === "C") {
      n++;
      return HIDE;
    }
    return v;
  };
  const tiersOf = (d: any): any => {
    if (!isDict(d)) return d;
    const r: Cfg = {};
    for (const [k, v] of Object.entries(d)) r[k] = conv(v);
    return r;
  };
  for (const key of [`wl_item_tier_${game}`, `wl_cat_tier_${game}`, `wl_unique_tier_${game}`, `wl_block_tier_${game}`, `wl_gear_tier_${game}`]) {
    if (isDict(fg[key])) out[key] = tiersOf(fg[key]);
  }
  for (const key of [`wl_rarity_rows_${game}`, `wl_equip_rows_${game}`]) {
    const raw = fg[key];
    if (isDict(raw)) {
      const rows: Cfg = {};
      for (const [rid, rowIn] of Object.entries(raw)) {
        let row: any = rowIn;
        if (isDict(row) && isDict(row.tiers)) row = { ...row, tiers: tiersOf(row.tiers) };
        rows[rid] = row;
      }
      out[key] = rows;
    }
  }
  const legacy = fg[`wl_rarity_tier_${game}`];
  if (isDict(legacy)) {
    const r: Cfg = {};
    for (const [k, v] of Object.entries(legacy)) r[k] = isDict(v) ? tiersOf(v) : v;
    out[`wl_rarity_tier_${game}`] = r;
  }
  if (fg.whitelist_gem_tier === "C") out.whitelist_gem_tier = conv("C");
  const custom = fg[`whitelist_custom_${game}`];
  if (Array.isArray(custom)) {
    out[`whitelist_custom_${game}`] = custom.map((e) => (isDict(e) ? { ...e, tier: conv(has(e, "tier") ? e.tier : null) } : e));
  }
  return [out, n];
}

/** A row set "myself" has a tier (S / A / B / C / D) for every rarity: the missing ones start at B. */
function fillCustom(row: Cfg, choices: string[]): void {
  if (truthy(row.custom)) for (const r of choices) if (!has(row.tiers, r)) row.tiers[r] = DEFAULT_CUSTOM_TIER;
}

export class WlModel {
  game: string;
  item_tier: Cfg = {};
  cat_tier: Cfg = {};
  unique_tier: Cfg = {};
  block_tier: Cfg = {};
  rarity_rows: Cfg = {}; // {"Flask"|"Charm": {"custom": bool, "tiers": {Normal|Magic|Rare: S|A|B|C|D}}}
  equip_rows: Cfg = {}; // {class: {"custom": bool, "tiers": {...}}}
  tier_stack: Record<string, number> = {};
  item_stack: Record<string, number> = {};
  tier_style: Cfg = {};
  gold = false;
  gold_min = 0;
  map_on = false;
  map_tier = 1;
  map_rarity = "Normal";
  gem_uncut: Record<string, number> = {};
  gem_names: string[] = [];
  gem_tier = "B";
  custom: { name: string; rarities: string[]; tier: string }[] = []; // [{"name", "rarities", "tier"}]
  // data (set_data)
  hub: any = null;
  base_text = "";
  extra_names: Set<string> = new Set();
  _names = new Map<string, string>();
  _defaults = new Map<string, string>();
  _stackDefaults = new Map<string, [number, string]>();
  _stackable = new Set<string>();
  _entries: [string, string][] = [];
  _uniqueDefaults = new Map<string, string>();
  _defaultLines: Record<string, string[]> = {};
  private _loaded = false;
  /** the lists (category ids) the settings were written with; null = a file / config from before this was recorded */
  known_lists: string[] | null = null;
  private _settlePending = false;
  private _notes: string[] = [];

  constructor(game: string) {
    this.game = game;
  }

  // ------------------------------------------------------------------ data

  get loaded(): boolean {
    return this._loaded;
  }

  setData(hub: any, baseText: string, extraNames: Iterable<string> | null = null): void {
    this.hub = hub;
    this.base_text = baseText || "";
    this.extra_names = new Set(extraNames ?? []);
    this._names = w.universe(this.game, hub, this.base_text);
    [this._defaults, this._stackDefaults] = w.startTiers(this.base_text);
    this._stackable = w.stackInfo(this.base_text)[1];
    this._uniqueDefaults = w.uniqueBaseDefaults(this.base_text);
    const real = new Set([...w.knownNames(this.base_text), ...this.extra_names]);
    this._entries = w.uniqueEntries(hub).filter(([, b]) => real.has(b) && !w.badName(b));
    this._defaultLines = this.base_text ? w.defaultTierLines(this.base_text) : {};
    this._loaded = true;
    if (this._settlePending) this._settle();
  }

  // ------------------------------------------------------------------ lists newer than the settings

  /** Every list the tab offers (the category ids). */
  listsNow(): string[] {
    return this.categories().map(([c]) => c);
  }

  /** The lists that appeared after v0.10.2: the name categories. */
  private _newListIds(): string[] {
    return (w.NAMED_CATEGORIES[this.game] ?? []).map(([c]) => c);
  }

  /** [store, key] of what the player's setting for a list is made of. */
  private _listRows(lst: string): [Cfg, string][] {
    return this._namesOf(lst).map((n) => [this.item_tier, n]);
  }

  /** True when every row of the list is hidden (D; by its own tier or the whole category's). */
  private _listIsAllC(lst: string): boolean {
    const rows = this._listRows(lst);
    const whole = get(this.cat_tier, lst) === HIDE;
    return rows.length > 0 && rows.every(([st, k]) => get(st, k) === HIDE || (whole && !has(st, k)));
  }

  private _clearList(lst: string): void {
    for (const [st, k] of this._listRows(lst)) delete st[k];
    delete this.cat_tier[lst];
    for (const n of this._namesOf(lst)) delete this.item_stack[n];
  }

  /** Lists newer than the settings hold values the player never chose (see the Python docstring). */
  private _settle(): void {
    this._settlePending = false;
    const fresh: string[] = [];
    for (const lst of this._newListIds()) {
      if (this.known_lists !== null) {
        if (this.known_lists.includes(lst) || !this.listsNow().includes(lst)) continue;
      } else if (!this._listIsAllC(lst)) continue;
      this._clearList(lst);
      fresh.push(lst);
    }
    this.known_lists = this.listsNow();
    if (fresh.length) {
      const labels = new Map(this.categories());
      const names = fresh.map((c) => labels.get(c) || c);
      this._notes.push("หมวดที่ไฟล์/ค่าที่เปิดมายังไม่มี หรือซ่อน (D) ทั้งหมวดที่โปรแกรมเติมให้เอง ใช้ค่าเริ่มต้น" +
        "ของ NeverSink แทน: " + names.join(", "));
    }
  }

  /** Remember which lists the settings were written with; the check runs when the data is (or already is) loaded. */
  adoptKnownLists(known: unknown): void {
    this.known_lists = Array.isArray(known) ? [...known] : null;
    this._settlePending = true;
    if (this._loaded) this._settle();
  }

  takeNotes(): string[] {
    const out = this._notes;
    this._notes = [];
    return out;
  }

  // ------------------------------------------------------------------ config

  /** The config dict the generator reads - exactly what toConfig writes. */
  cfg(): Cfg {
    return this.toConfig({});
  }

  static fromConfig(fgIn: Cfg, game: string): WlModel {
    const m = new WlModel(game);
    const g = game;
    const [fg0, hiddenN] = migrateHidden(fgIn, g);
    if (hiddenN) m._notes.push(hiddenNote(hiddenN));
    const [fg, soundNotes] = filterCore.migrateSounds(fg0); // the S / A / B files of the NeverSink tab -> tier sounds
    m._notes.push(...soundNotes);
    m.item_tier = { ...orEmpty(fg[`wl_item_tier_${g}`]) };
    m.cat_tier = { ...orEmpty(fg[`wl_cat_tier_${g}`]) };
    m.unique_tier = { ...orEmpty(fg[`wl_unique_tier_${g}`]) };
    m.block_tier = { ...orEmpty(fg[`wl_block_tier_${g}`]) };
    m.rarity_rows = WlModel._readRarityRows(fg[`wl_rarity_rows_${g}`], g);
    m.equip_rows = WlModel._readEquipRows(fg[`wl_equip_rows_${g}`], g);
    const missing = (rows: Cfg, choices: string[]): boolean =>
      Object.values(rows).some((r: any) => truthy(r.custom) && choices.some((x) => !has(r.tiers, x)));
    if (missing(m.rarity_rows, w.RARITY_CHOICES) || missing(m.equip_rows, w.EQUIP_CHOICES)) {
      m._notes.push(AUTO_NOTE); // an old "set myself" row with a rarity left on NeverSink
    }
    for (const r of Object.values(m.rarity_rows)) fillCustom(r, w.RARITY_CHOICES);
    for (const r of Object.values(m.equip_rows)) fillCustom(r, w.EQUIP_CHOICES);
    if (Object.values(orEmpty(fg[`wl_rarity_rows_${g}`])).some((r: any) => isDict(r) && has(orEmpty(r.tiers), w.RARITY_REMOVED))) {
      m._notes.push(RARE_NOTE);
    }
    m.tier_stack = {};
    for (const [k, v] of Object.entries(orEmpty(fg.wl_tier_stack))) {
      const n = count(v);
      if (TIER_CHOICES.includes(k) && n > 1) m.tier_stack[k] = n;
    }
    m.item_stack = {};
    for (const [k, v] of Object.entries(orEmpty(fg[`wl_item_stack_${g}`]))) m.item_stack[String(k)] = count(v);
    delete m.cat_tier[w.GEAR_CATEGORY]; // the old "all equipment" tier: gear is NeverSink's blocks now
    m.tier_style = {};
    for (const [k, v] of Object.entries(orEmpty(fg.wl_tier_style))) {
      if (STYLE_LABELS.includes(k) && isDict(v)) m.tier_style[k] = filterStyle.normalizeStyle(v);
    }
    m.gold = truthy(fg.whitelist_gold);
    m.gold_min = Math.max(0, intOr(truthy(fg.whitelist_gold_min) ? fg.whitelist_gold_min : 0, 0));
    m._dropRemovedSettings(fg);
    m.known_lists = Array.isArray(fg[`wl_lists_${g}`]) ? fg[`wl_lists_${g}`] : null;
    m._settlePending = true;
    m.map_on = truthy(fg.wl_map_on);
    m.map_tier = Math.max(1, Math.min(16, intOr(truthy(fg.wl_map_tier_min) ? fg.wl_map_tier_min : 1, 1)));
    m.map_rarity = RARITIES.includes(fg.wl_map_rarity_min) ? fg.wl_map_rarity_min : "Normal";
    m.gem_uncut = {};
    for (const [b, lv] of Object.entries(orEmpty(fg[`whitelist_gem_uncut_${g}`]))) {
      const isInt = typeof lv === "number" ? Number.isInteger(lv) : typeof lv === "boolean" || (typeof lv === "string" && /^[0-9]+$/.test(lv));
      if (isInt) m.gem_uncut[String(b)] = Math.max(1, pyInt(lv));
    }
    m.gem_names = (Array.isArray(fg[`whitelist_gem_names_${g}`]) ? fg[`whitelist_gem_names_${g}`] : []).filter((n: unknown) => truthy(n)).map(String);
    m.gem_tier = inAll(fg.whitelist_gem_tier) ? fg.whitelist_gem_tier : "B";
    m.custom = [];
    for (const e of (Array.isArray(fg[`whitelist_custom_${g}`]) ? fg[`whitelist_custom_${g}`] : [])) {
      if (typeof e === "string") m.custom.push({ name: e, rarities: [...RARITIES], tier: "B" });
      else if (isDict(e) && truthy(e.name)) {
        const have = new Set(Array.isArray(e.rarities) ? e.rarities : []);
        const rs = RARITIES.filter((r) => have.has(r));
        m.custom.push({ name: e.name, rarities: rs.length ? rs : ["Normal"], tier: inAll(e.tier) ? e.tier : "B" });
      }
    }
    return m;
  }

  private static _readRarityRows(raw: unknown, game: string): Cfg {
    const ids = new Set(w.rarityRows(game).map(([rid]) => rid));
    const out: Cfg = {};
    for (const [rid, row] of Object.entries(orEmpty(raw))) {
      if (!ids.has(rid) || !isDict(row)) continue;
      const tiers: Cfg = {};
      for (const [r, t] of Object.entries(orEmpty(row.tiers))) if (w.RARITY_CHOICES.includes(r) && inAll(t)) tiers[r] = t;
      if (Object.keys(tiers).length || truthy(row.custom)) out[rid] = { custom: truthy(row.custom), tiers };
    }
    return out;
  }

  private static _readEquipRows(raw: unknown, game: string): Cfg {
    const ids = new Set(w.equipClasses(game));
    const out: Cfg = {};
    for (const [cid, row] of Object.entries(orEmpty(raw))) {
      if (!ids.has(cid) || !isDict(row)) continue;
      const tiers: Cfg = {};
      for (const [r, t] of Object.entries(orEmpty(row.tiers))) if (w.EQUIP_CHOICES.includes(r) && inAll(t)) tiers[r] = t;
      if (Object.keys(tiers).length || truthy(row.custom)) out[cid] = { custom: truthy(row.custom), tiers };
    }
    return out;
  }

  /** Settings of categories the tab no longer has are dropped once, with a note; old Flask / Charm rarity values become "set myself" rows. */
  private _dropRemovedSettings(fg: Cfg): void {
    const g = this.game;
    const removed: string[] = [];
    const names: Record<string, string> = {};
    for (const [gid, n] of w.GEAR_GROUPS[g] ?? []) names[gid] = n;
    const cut = Object.keys(names);
    for (const gid of cut) {
      if (pop(this.cat_tier, w.gearCat(gid)) !== undefined) removed.push(gid !== w.FLASK_GROUP ? names[gid] : "Flask / Charm (ทั้งหมวด)");
    }
    for (const key of Object.keys(this.block_tier)) {
      const gid = w.gearGroupOf(g, key.split("|")[0]);
      if (gid !== null && cut.includes(gid)) {
        delete this.block_tier[key];
        const label = gid !== w.FLASK_GROUP ? get(names, gid, gid)! : "Flask / Charm (ราย block)";
        if (!removed.includes(label)) removed.push(label);
      }
    }
    if (truthy(fg[`wl_class_tier_${g}`])) removed.push("กุญแจ/ของพิเศษ (class)");
    const legacy = truthy(fg[`wl_rarity_tier_${g}`]) ? fg[`wl_rarity_tier_${g}`] : {};
    if (isDict(legacy)) {
      if (truthy(legacy["gear:jewel"])) removed.push("Jewel (rarity)");
      const oldFlask = legacy["gear:flask"];
      if (isDict(oldFlask) && Object.keys(oldFlask).length && !Object.keys(this.rarity_rows).length) {
        const tiers: Cfg = {};
        for (const [r, t] of Object.entries(oldFlask)) if (w.RARITY_CHOICES.includes(r) && inAll(t)) tiers[r] = t;
        if (has(oldFlask, w.RARITY_REMOVED)) this._notes.push(RARE_NOTE);
        if (Object.keys(tiers).length) {
          for (const [rid] of w.rarityRows(g)) { // the old box covered flasks and charms together
            this.rarity_rows[rid] = { custom: true, tiers: { ...tiers } };
            if (w.RARITY_CHOICES.some((x) => !has(tiers, x)) && !this._notes.includes(AUTO_NOTE)) this._notes.push(AUTO_NOTE);
            fillCustom(this.rarity_rows[rid], w.RARITY_CHOICES);
          }
          this._notes.push("rarity ของ Flask/Charm เดิมถูกแปลงเป็น \"ตั้งค่าเอง\" พร้อมค่าเดิมแล้ว");
        }
      }
    }
    if (removed.length) this._notes.push("ข้ามค่าที่เคยตั้งของหมวดที่ตัดออกแล้ว (ใช้ NeverSink แทน): " + removed.join(", "));
  }

  toConfig(fg: Cfg): Cfg {
    const g = this.game;
    fg.wl_v2 = true;
    fg.wl_tier_format = w.TIER_FORMAT;
    fg.sound_format = filterCore.SOUND_FORMAT;
    for (const k of ["sound_s", "sound_a", "sound_b", "sound_c"]) delete fg[k]; // now sound_1 .. sound_3 (NeverSink tab) / tier styles
    fg[`wl_item_tier_${g}`] = { ...this.item_tier };
    fg[`wl_cat_tier_${g}`] = { ...this.cat_tier };
    delete fg[`wl_class_tier_${g}`]; // special classes are NeverSink's blocks now
    delete fg[`wl_rarity_tier_${g}`]; // old jewel / flask rarity: see wl_rarity_rows
    fg[`wl_unique_tier_${g}`] = { ...this.unique_tier };
    delete fg[`wl_gear_tier_${g}`]; // folded into wl_cat_tier_<g>["gear:<id>"]
    fg[`wl_block_tier_${g}`] = { ...this.block_tier };
    const rowsOut = (rows: Cfg): Cfg => {
      const o: Cfg = {};
      for (const [r, v] of Object.entries(rows)) if (truthy(v.custom) || truthy(v.tiers)) o[r] = { custom: truthy(v.custom), tiers: { ...orEmpty(v.tiers) } };
      return o;
    };
    fg[`wl_rarity_rows_${g}`] = rowsOut(this.rarity_rows);
    fg[`wl_equip_rows_${g}`] = rowsOut(this.equip_rows);
    const lists = this._loaded ? this.listsNow() : this.known_lists; // unknown stays unknown (not written)
    if (lists === null) delete fg[`wl_lists_${g}`];
    else fg[`wl_lists_${g}`] = lists;
    fg.wl_tier_stack = { ...this.tier_stack };
    fg[`wl_item_stack_${g}`] = { ...this.item_stack };
    const styles: Cfg = {};
    for (const [k, v] of Object.entries(this.tier_style)) if (truthy(v) && !filterStyle.isEmpty(v)) styles[k] = structuredClone(v);
    fg.wl_tier_style = styles;
    fg.whitelist_gold = !!this.gold;
    fg.whitelist_gold_min = Math.trunc(this.gold_min);
    fg.wl_map_on = !!this.map_on;
    fg.wl_map_tier_min = Math.trunc(this.map_tier);
    fg.wl_map_rarity_min = this.map_rarity;
    if (truthy(filterGen.WHITELIST_GEM_UNCUT[g])) fg[`whitelist_gem_uncut_${g}`] = { ...this.gem_uncut };
    else fg[`whitelist_gem_names_${g}`] = [...this.gem_names];
    fg.whitelist_gem_tier = this.gem_tier;
    fg[`whitelist_custom_${g}`] = this.custom.map((e) => ({ name: e.name, rarities: [...e.rarities], tier: e.tier }));
    return fg;
  }

  // ------------------------------------------------------------------ categories

  /** [id, label] in the order the list offers them. */
  categories(): [string, string][] {
    const out: [string, string][] = (filterGen.WHITELIST_CATEGORIES[this.game] ?? []).map((c) => [c, c]);
    for (const [c] of w.NAMED_CATEGORIES[this.game] ?? []) out.push([c, c]); // Runegraft, Vial, Corpse ...
    out.push([w.OTHER_CATEGORY, "อื่นๆ (NeverSink จัด tier ให้)"]);
    out.push([UNIQUE, "Unique"]);
    if (this.game === "poe2") out.push([TABLET_CATEGORY, "Tablet"]);
    if (w.rarityRows(this.game).length) out.push([FLASK_CATEGORY, w.FLASK_LABEL[this.game]]);
    if (w.equipClasses(this.game).length) out.push([EQUIP_CATEGORY, w.EQUIP_LABEL]);
    return out;
  }

  private _namesOf(cat: string): string[] {
    const tab = (n: string): boolean => w.isTablet(this.game, n);
    if (cat === TABLET_CATEGORY) return sortedStr([...this._names.keys()].filter(tab));
    return sortedStr([...this._names].filter(([n, c]) => c === cat && !tab(n)).map(([n]) => n));
  }

  private _resolved(): Map<string, string> {
    return w.resolveTiers(this.game, this.cfg(), this._names, this._defaults);
  }

  defaultOf(name: string): string {
    if (w.isTablet(this.game, name)) return w.TABLET_DEFAULT;
    return this._defaults.get(name) || "B";
  }

  // ------------------------------------------------------------------ rows

  rows(cat: string, query = ""): Row[] {
    const q = pyStrip(query || "").toLowerCase();
    const out: Row[] = [];
    if (cat === FLASK_CATEGORY || cat === EQUIP_CATEGORY) return out; // no list: rows with their own controls
    if (cat === UNIQUE) {
      const [, conflicts] = w.resolveUniqueTiers(this.game, this.cfg(), this._entries, this._uniqueDefaults);
      const clash = new Set(conflicts.map(([b]) => b));
      const user = this.unique_tier;
      const whole = inAll(get(this.cat_tier, UNIQUE)) ? get(this.cat_tier, UNIQUE) : null;
      for (const [name, base] of sortedBy(this._entries, (e) => [e[0].toLowerCase(), e[1]])) {
        const label = `${name} (${base})`;
        if (q && !label.toLowerCase().includes(q)) continue;
        const dflt = this._uniqueDefaults.get(base) || "B";
        const tier = inAll(get(user, name)) ? get(user, name) : (whole || dflt);
        const note = clash.has(base) ? "⚠ ฐานเดียวกันตั้ง tier ต่างกัน — ใช้ tier สูงสุด" : "";
        out.push(mkRow(name, label, tier, dflt, has(user, name), { note }));
      }
      return out;
    }
    const tiers = this._resolved();
    const mins = w.stackMinimums(this.cfg(), this.game, tiers, this._stackDefaults, this._stackable);
    for (const name of this._namesOf(cat)) {
      if (q && !name.toLowerCase().includes(q)) continue;
      out.push(mkRow(name, name, tiers.get(name)!, this.defaultOf(name), has(this.item_tier, name),
        { stackable: this._stackable.has(name), stack: mins.get(name) ?? 1, stack_set: has(this.item_stack, name) }));
    }
    return out;
  }

  uniqueConflicts(): [string, Record<string, string>][] {
    return w.resolveUniqueTiers(this.game, this.cfg(), this._entries, this._uniqueDefaults)[1];
  }

  // ------------------------------------------------------------------ setters

  private _store(cat: string): Cfg {
    return cat === UNIQUE ? this.unique_tier : this.item_tier;
  }

  setRow(cat: string, key: string, tier: string): void {
    if (inAll(tier)) this._store(cat)[key] = tier;
  }

  resetRow(cat: string, key: string): void {
    delete this._store(cat)[key];
    delete this.item_stack[key];
  }

  /** The player's own stack minimum for these names (1 = show every one, whatever NeverSink says). */
  setStack(keys: Iterable<string>, n: number): void {
    for (const k of keys) this.item_stack[k] = Math.max(1, pyInt(n));
  }

  hasFlask(): boolean {
    return w.rarityRows(this.game).length > 0;
  }

  /** [{"id", "label", "custom", "tiers": {Normal|Magic: tier}}] of the Flask / Charm category. */
  flaskRows(): { id: string; label: string; custom: boolean; tiers: Record<string, string> }[] {
    return w.rarityRows(this.game).map(([rid, label]) => {
      const row = orEmpty(get(this.rarity_rows, rid));
      const tiers = orEmpty(row.tiers);
      const t: Record<string, string> = {};
      for (const r of w.RARITY_CHOICES) t[r] = inAll(get(tiers, r)) ? get(tiers, r)! : DEFAULT_CUSTOM_TIER;
      return { id: rid, label, custom: truthy(row.custom), tiers: t };
    });
  }

  /** Default <-> set myself. Going back to the default keeps the values (not written) for the way back. */
  setFlaskCustom(rowId: string, custom: boolean): void {
    if (!w.rarityRows(this.game).some(([r]) => r === rowId)) return;
    if (!has(this.rarity_rows, rowId)) this.rarity_rows[rowId] = { custom: false, tiers: {} };
    const row = this.rarity_rows[rowId];
    row.custom = !!custom;
    fillCustom(row, w.RARITY_CHOICES);
    if (!row.custom && !Object.keys(row.tiers).length) delete this.rarity_rows[rowId];
  }

  setFlaskRarity(rowId: string, rarity: string, tier: string | null): void {
    if (!w.rarityRows(this.game).some(([r]) => r === rowId) || !w.RARITY_CHOICES.includes(rarity)) return;
    if (!inAll(tier)) return;
    if (!has(this.rarity_rows, rowId)) this.rarity_rows[rowId] = { custom: true, tiers: {} };
    const row = this.rarity_rows[rowId];
    row.tiers[rarity] = tier;
    row.custom = true;
    fillCustom(row, w.RARITY_CHOICES);
  }

  // ---- equipment by class (EQUIP_CATEGORY)

  hasEquip(): boolean {
    return w.equipClasses(this.game).length > 0;
  }

  /** [{"id", "label", "classes": [{"id", "label", "custom", "tiers": {Normal|Magic|Rare: tier}}]}] in display order. */
  equipGroups(): { id: string; label: string; classes: { id: string; label: string; custom: boolean; tiers: Record<string, string> }[] }[] {
    return w.equipGroups(this.game).map(([gid, gname, classes]) => ({
      id: gid,
      label: gname,
      classes: classes.map((c) => {
        const row = orEmpty(get(this.equip_rows, c));
        const tiers = orEmpty(row.tiers);
        const t: Record<string, string> = {};
        for (const r of w.EQUIP_CHOICES) t[r] = inAll(get(tiers, r)) ? get(tiers, r)! : DEFAULT_CUSTOM_TIER;
        return { id: c, label: w.equipLabel(c), custom: truthy(row.custom), tiers: t };
      }),
    }));
  }

  setEquipCustom(clsId: string, custom: boolean): void {
    if (!w.equipClasses(this.game).includes(clsId)) return;
    if (!has(this.equip_rows, clsId)) this.equip_rows[clsId] = { custom: false, tiers: {} };
    const row = this.equip_rows[clsId];
    row.custom = !!custom;
    fillCustom(row, w.EQUIP_CHOICES);
    if (!row.custom && !Object.keys(row.tiers).length) delete this.equip_rows[clsId];
  }

  setEquipRarity(clsId: string, rarity: string, tier: string | null): void {
    if (!w.equipClasses(this.game).includes(clsId) || !w.EQUIP_CHOICES.includes(rarity)) return;
    if (!inAll(tier)) return;
    if (!has(this.equip_rows, clsId)) this.equip_rows[clsId] = { custom: true, tiers: {} };
    const row = this.equip_rows[clsId];
    row.tiers[rarity] = tier;
    row.custom = true;
    fillCustom(row, w.EQUIP_CHOICES);
  }

  /** One rarity of every class of the group at once; tier null = every row of the group back to the default. */
  setEquipGroup(groupId: string, rarity: string, tier: string | null): void {
    const hit = w.equipGroups(this.game).find(([g]) => g === groupId);
    for (const c of hit ? hit[2] : []) {
      if (tier === null) this.setEquipCustom(c, false);
      else this.setEquipRarity(c, rarity, tier);
    }
  }

  setTierStack(tier: string, n: number): void {
    if (TIER_CHOICES.includes(tier)) {
      if (pyInt(n) > 1) this.tier_stack[tier] = pyInt(n);
      else delete this.tier_stack[tier];
    }
  }

  /** Tick = into the active tier, untick = D (hidden). */
  toggleRow(cat: string, key: string, active: string): void {
    const row = this.rows(cat).find((r) => r.key === key);
    if (row === undefined) return;
    this.setRow(cat, key, row.tier !== HIDE ? HIDE : active);
  }

  /** Every row of the category to `tier`; rows the player set one by one are cleared. */
  setCategory(cat: string, tier: string): void {
    if (!inAll(tier)) return;
    if (cat === UNIQUE) {
      this.cat_tier[cat] = tier;
      for (const k of Object.keys(this._store(cat))) delete this._store(cat)[k];
    } else if (cat === FLASK_CATEGORY || cat === EQUIP_CATEGORY) {
      return; // nothing to tier as a whole: the rows have their own controls
    } else if (cat === TABLET_CATEGORY) {
      for (const n of this._namesOf(cat)) this.item_tier[n] = tier;
    } else {
      this.cat_tier[cat] = tier;
      for (const n of this._namesOf(cat)) delete this.item_tier[n];
    }
  }

  /** Back to NeverSink's values for the whole category. */
  resetCategory(cat: string): void {
    if (cat === UNIQUE) {
      delete this.cat_tier[cat];
      for (const k of Object.keys(this._store(cat))) delete this._store(cat)[k];
    } else if (cat === FLASK_CATEGORY) {
      for (const k of Object.keys(this.rarity_rows)) delete this.rarity_rows[k];
    } else if (cat === EQUIP_CATEGORY) {
      for (const k of Object.keys(this.equip_rows)) delete this.equip_rows[k];
    } else {
      delete this.cat_tier[cat];
      for (const n of this._namesOf(cat)) {
        delete this.item_tier[n];
        delete this.item_stack[n];
      }
    }
  }

  categoryTier(cat: string): string | null {
    return inAll(get(this.cat_tier, cat)) ? get(this.cat_tier, cat)! : null;
  }

  /** How many rows of the category differ from the starting values (list header hint). */
  changedCount(cat: string): number {
    const n = this.rows(cat).filter((r) => r.user_set).length;
    if (cat === FLASK_CATEGORY) return Object.values(this.rarity_rows).filter((v) => truthy(v.custom)).length;
    if (cat === EQUIP_CATEGORY) return Object.values(this.equip_rows).filter((v) => truthy(v.custom)).length;
    return n + (this.categoryTier(cat) ? 1 : 0);
  }

  // ------------------------------------------------------------------ styles

  /** NeverSink's own look of a tier (or our preset for G / Tablet / Map). Gem: the look of the tier the gems are in. */
  baseStyle(label: string): filterStyle.Style {
    if (label === "Gem") return this.effectiveStyle(TIER_CHOICES.includes(this.gem_tier) ? this.gem_tier : "B");
    const defaultLines = get(this._defaultLines, label);
    return truthy(defaultLines) ? filterStyle.linesToStyle(defaultLines) : filterStyle.normalizeStyle(get(filterStyle.DEFAULT_STYLES, label));
  }

  /** The base look with the player's changes on top. */
  effectiveStyle(label: string): filterStyle.Style {
    return filterStyle.mergeStyles(this.baseStyle(label), get(this.tier_style, label));
  }

  /** Keep only what differs from the base look (see the Python docstring). */
  setStyleFromEditor(label: string, style: unknown): void {
    const base = this.baseStyle(label), nw = filterStyle.normalizeStyle(style);
    const out: Cfg = {};
    const off: string[] = [];
    for (const k of ["text", "border", "bg", "size", "icon", "effect"]) {
      if (nw[k] === null) {
        if (base[k] !== null) off.push(k);
      } else if (!deepEqual(nw[k], base[k])) out[k] = nw[k];
    }
    if (nw.sound.kind === "none") {
      if (base.sound.kind !== "none") off.push("sound");
    } else if (!deepEqual(nw.sound, base.sound)) out.sound = nw.sound;
    if (off.length) out.off = off;
    this.setStyle(label, Object.keys(out).length ? out : null);
  }

  setStyle(label: string, style: unknown): void {
    if (style === null || style === undefined || filterStyle.isEmpty(style)) delete this.tier_style[label];
    else this.tier_style[label] = filterStyle.normalizeStyle(style);
  }

  // ------------------------------------------------------------------ legacy

  static legacyPresent(fg: Cfg, game: string): boolean {
    return [`whitelist_cats_${game}`, `whitelist_cat_exclude_${game}`, "whitelist_unique_all"].some((k) => has(fg, k));
  }

  /** [updates, notes]: the old "show these categories / these names only" settings as wl_* keys. */
  static convertLegacy(fg: Cfg, game: string): [Cfg, string[]] {
    if (truthy(fg[`wl_converted_${game}`]) || !WlModel.legacyPresent(fg, game)) return [{}, []];
    if ([`wl_cat_tier_${game}`, `wl_item_tier_${game}`, `wl_gear_tier_${game}`, `wl_block_tier_${game}`].some((k) => has(fg, k))) {
      return [{ [`wl_converted_${game}`]: true }, []];
    }
    const cats = new Set<string>(truthy(fg[`whitelist_cats_${game}`]) ? fg[`whitelist_cats_${game}`] : []);
    const catTier: Cfg = {};
    for (const c of filterGen.WHITELIST_CATEGORIES[game] ?? []) if (!cats.has(c)) catTier[c] = HIDE;
    catTier[w.OTHER_CATEGORY] = HIDE; // the old whitelist never showed these
    const itemTier: Cfg = {};
    for (const [c, names] of Object.entries(orEmpty(fg[`whitelist_cat_exclude_${game}`]))) {
      if (cats.has(c)) for (const n of (truthy(names) ? names : []) as unknown[]) itemTier[String(n)] = HIDE;
    }
    if (!truthy(fg.whitelist_unique_all)) catTier[UNIQUE] = HIDE;
    if (game === "poe2" && !cats.has("Fragment")) catTier[TABLET_CATEGORY] = HIDE;
    const updates: Cfg = { [`wl_cat_tier_${game}`]: catTier, [`wl_item_tier_${game}`]: itemTier, [`wl_converted_${game}`]: true,
      wl_tier_format: w.TIER_FORMAT };
    const notes = ["แปลง whitelist เดิมเข้าแบบใหม่แล้ว: หมวดที่ไม่ได้ติ๊ก = tier D (ซ่อน), ชื่อที่เอาออก = D, " +
      "อุปกรณ์ทั้งหมวด = D เหมือนเดิม (ค่าเดิมไม่ถูกลบ)",
      "แปลงไม่ได้ตรงตัว: ชื่อที่ NeverSink ซ่อน (tier D) จะยังซ่อนต่อ แม้เคยติ๊กทั้งหมวด, " +
      "map/waystone กลับเป็นโชว์ตามเกม (ตั้งใหม่ในส่วนแยก)"];
    return [updates, notes];
  }

  // ------------------------------------------------------------------ build

  build(questText = "", soundNames: Record<string, string> | null = null): w.WhitelistResult {
    return w.buildWhitelistFilter(this.game, this.cfg(), this.base_text, this.hub, questText, soundNames, this.extra_names);
  }
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a as object), kb = Object.keys(b as object);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => deepEqual((a as any)[k], (b as any)[k]));
}

export { cmpTuple, PyError };
