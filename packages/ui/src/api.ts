/**
 * What web/glue.py was for the Pyodide page, without Pyodide: the page's state (a `WlModel`, the same class the desktop
 * window uses) and the entry points the UI calls. No filter logic lives here; the messages come from wl_session, so the
 * page says what the desktop window says. Everything is typed objects now (the Python side passed JSON strings).
 */
import { WlModel, filterCore, filterGen, filterStyle, wlEmbed, wlModel, wlSession, py } from "@poe/core";
import { zipSync } from "fflate";

type Cfg = Record<string, any>;
export type Msg = [string, string];

declare const __APP_VERSION__: string;
/** recorded in the embedded settings; the page shows it too (bug reports) */
export const APP_VERSION = "web-" + (typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "dev");

/** the values the UI needs to draw its controls */
export const K = {
  categories: filterGen.WHITELIST_CATEGORIES,
  gem_uncut: filterGen.WHITELIST_GEM_UNCUT,
  levels: filterCore.LEVELS,
  tiers: [...wlModel.TIER_CHOICES],
  all_tiers: [...wlModel.ALL_CHOICES],
  rarities: [...wlModel.RARITIES],
  style: {
    colors: filterStyle.COLORS, shapes: filterStyle.SHAPES, sound_ids: filterStyle.SOUND_IDS, font_min: filterStyle.FONT_MIN,
    font_max: filterStyle.FONT_MAX, volume_max: filterStyle.VOLUME_MAX, default_volume: filterStyle.DEFAULT_VOLUME,
    default_quest: filterStyle.defaultQuestStyle(),
  },
  default_names: { tier: filterCore.DEFAULT_TIER_NAME, whitelist: filterCore.DEFAULT_WHITELIST_NAME },
};

export interface RowsResult {
  loading: boolean;
  rows: wlModel.Row[];
  info: { count?: number; changed?: number; cat_tier?: string | null; flask?: boolean; equip?: boolean };
  warn?: string[];
  flask?: ReturnType<WlModel["flaskRows"]>;
  equip?: ReturnType<WlModel["equipGroups"]>;
}

export interface GenerateResult {
  status: "ok" | "none" | "error" | "ask";
  message?: string;
  conflicts?: { name: string; new_name: string }[];
  mode?: string;
  text?: string;
  count?: number;
  base_tag?: string | null;
  sounds?: Record<string, string>;
  copies?: [string, string][];
}

const intOrOne = (v: unknown): number => Math.max(1, py.intOr(py.truthy(v) ? v : 1, 1));
const tierOrNull = (t: unknown): string | null => (typeof t === "string" && wlModel.ALL_CHOICES.includes(t) ? t : null);

export class WebApi {
  game = "poe2";
  model: WlModel = new WlModel("poe2");
  data: [any, string, Set<string>] | null = null;

  // ---------------------------------------------------------------------------------------------- urls / names
  nsLatestUrl = (game: string): string => filterCore.neversinkLatestApiUrl(game);
  nsFileUrl = (game: string, tag: string, strictness: number): string => filterCore.neversinkFileUrl(game, tag, strictness);

  validateName(name: string): { name: string; error: string } {
    const [n, err] = filterCore.validateFilterName(name);
    return { name: n, error: err ?? "" };
  }

  /** Autocomplete list for poe1 (same filtering as the desktop window). */
  gemNames(gemsPayload: any): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const g of (gemsPayload && py.truthy(gemsPayload.gems) ? gemsPayload.gems : []) as any[]) {
      const nm = py.pyStrip(py.truthy(g.display_name) ? g.display_name : "");
      if (!nm || nm === "..." || seen.has(nm.toLowerCase())) continue;
      seen.add(nm.toLowerCase());
      out.push(nm);
    }
    return py.sortedStr(out);
  }

  /** The file name the game can play (a "#" or ";" becomes "_"). */
  safeName = (name: string): string => filterCore.safeSoundName(name)[0];

  // ---------------------------------------------------------------------------------------------- the whitelist model

  /**
   * A fresh model from the saved settings (an old-style whitelist config is converted, like the desktop window).
   * `moved` = the old sound slot -> its new NeverSink-tab slot (the page copies the file).
   */
  wlInit(game: string, cfg: Cfg): { updates: Cfg; notes: string[]; moved: Record<string, string> } {
    const fg: Cfg = structuredClone(cfg ?? {});
    const [updates, notes] = WlModel.convertLegacy(fg, game);
    Object.assign(fg, updates);
    let moved: Record<string, string> = {};
    // sounds: a saved config with sound_s / sound_a / sound_b becomes sound_1 / 2 / 3 (NeverSink tab) and the tier sounds of
    // the Whitelist tab, once
    if (fg.sound_format !== filterCore.SOUND_FORMAT) {
      moved = Object.fromEntries([["S", "1"], ["A", "2"], ["B", "3"]].filter(([t]) => py.truthy(fg[`sound_${t.toLowerCase()}`])));
      const [migrated] = filterCore.migrateSounds(fg);
      for (const k of ["sound_format", "sound_1", "sound_2", "sound_3", "wl_tier_style", "sound_s", "sound_a", "sound_b", "sound_c"]) {
        updates[k] = py.has(migrated, k) ? migrated[k] : "";
      }
    }
    this.game = game;
    this.model = WlModel.fromConfig(fg, game);
    this.data = null;
    return { updates, notes, moved };
  }

  /** The item lists arrived: give them to the model. Returns the messages for the Status. */
  wlLoad(hub: any, baseText: string | null, names: Iterable<string> | null): Msg[] {
    this.data = [hub ?? null, baseText || "", new Set(names ?? [])];
    this.model.setData(this.data[0], this.data[1], this.data[2]);
    return wlSession.dataLoadedMessages(this.model, baseText || "");
  }

  /** Every wl_* / whitelist_* key of the model (merge into the saved config before generating / saving). */
  wlConfig(): Cfg {
    return this.model.toConfig({});
  }

  wlCategories(): { id: string; label: string }[] {
    return this.model.categories().map(([id, label]) => ({ id, label }));
  }

  wlRows(cat: string, query = ""): RowsResult {
    const m = this.model;
    if (!m.loaded) return { loading: true, rows: [], info: {} };
    const rows = m.rows(cat, query);
    const out: RowsResult = {
      loading: false, rows,
      info: { count: rows.length, changed: m.changedCount(cat), cat_tier: m.categoryTier(cat), flask: cat === wlModel.FLASK_CATEGORY, equip: cat === wlModel.EQUIP_CATEGORY },
      warn: py.sortedStr(new Set(rows.map((r) => r.note).filter((n) => n))),
    };
    if (cat === wlModel.FLASK_CATEGORY) out.flask = m.flaskRows(); // no list: the Flask / Charm (Tincture) rows with their controls
    if (cat === wlModel.EQUIP_CATEGORY) out.equip = m.equipGroups(); // no list: classes by group, each with its own controls
    return out;
  }

  /** One edit of the model (what the desktop panel's buttons do). The page re-reads the rows afterwards. */
  wlDo(action: string, a: Record<string, any> = {}): void {
    const m = this.model;
    const cat: string = a.cat ?? "";
    switch (action) {
      case "toggle": m.toggleRow(cat, a.key, a.active); break;
      case "move": for (const k of a.keys) m.setRow(cat, k, a.tier); break; // selected rows -> the active tier
      case "reset_rows": for (const k of a.keys) m.resetRow(cat, k); break;
      case "set_category": m.setCategory(cat, a.tier); break;
      case "reset_category": m.resetCategory(cat); break;
      case "set_stack": { // only names that can stack
        const ok = new Set(m.rows(cat).filter((r) => r.stackable).map((r) => r.key));
        m.setStack((a.keys as string[]).filter((k) => ok.has(k)), intOrOne(a.n));
        break;
      }
      case "set_tier_stack": m.setTierStack(a.tier, intOrOne(a.n)); break;
      case "set_flask_custom": m.setFlaskCustom(a.row, !!a.custom); break; // Flask / Charm (Tincture) row: default <-> set myself
      case "set_flask_rarity": m.setFlaskRarity(a.row, a.rarity, tierOrNull(a.tier)); break;
      case "set_equip_custom": m.setEquipCustom(a.cls, !!a.custom); break; // equipment class row: default <-> set myself
      case "set_equip_rarity": m.setEquipRarity(a.cls, a.rarity, tierOrNull(a.tier)); break;
      case "set_equip_group": m.setEquipGroup(a.group, a.rarity, tierOrNull(a.tier)); break; // one rarity of every class of the group
      default: throw new Error("unknown action " + action);
    }
  }

  wlStyle(label: string): { effective: filterStyle.Style; base: filterStyle.Style } {
    return { effective: this.model.effectiveStyle(label), base: this.model.baseStyle(label) };
  }
  wlSetStyle(label: string, style: unknown): void {
    this.model.setStyleFromEditor(label, style);
  }
  wlClearStyle(label: string): void {
    this.model.setStyle(label, null);
  }

  wlParts() {
    const m = this.model;
    return {
      gold: m.gold, gold_min: m.gold_min, map_on: m.map_on, map_tier: m.map_tier, map_rarity: m.map_rarity, gem_uncut: { ...m.gem_uncut },
      gem_names: [...m.gem_names], gem_tier: m.gem_tier, custom: m.custom.map((e) => ({ ...e, rarities: [...e.rarities] })), tier_stack: { ...m.tier_stack },
      game: m.game, gem_uncut_bases: filterGen.WHITELIST_GEM_UNCUT[m.game] ?? [], unique_conflicts: m.uniqueConflicts(),
    };
  }

  /** The 'ส่วนแยก' fields (same coercions as the desktop panel). */
  wlSetParts(p: Record<string, any>): void {
    const m = this.model;
    if ("gold" in p) m.gold = !!p.gold;
    if ("gold_min" in p) m.gold_min = Math.max(0, py.intOr(py.truthy(p.gold_min) ? p.gold_min : 0, 0));
    if ("map_on" in p) m.map_on = !!p.map_on;
    if ("map_tier" in p) m.map_tier = Math.max(1, Math.min(16, py.intOr(py.truthy(p.map_tier) ? p.map_tier : 1, 1)));
    if ("map_rarity" in p) m.map_rarity = wlModel.RARITIES.includes(p.map_rarity) ? p.map_rarity : "Normal";
    if ("gem_tier" in p) m.gem_tier = tierOrNull(p.gem_tier) ?? "B";
    if ("gem_uncut" in p) {
      const out: Record<string, number> = {};
      for (const [base, lv] of Object.entries(p.gem_uncut ?? {})) out[String(base)] = Math.max(1, py.intOr(py.truthy(lv) ? lv : 1, 1));
      m.gem_uncut = out;
    }
    if ("gem_names" in p) m.gem_names = (p.gem_names as unknown[]).filter((n) => py.truthy(n)).map(String);
  }

  wlCustomAdd(name: string, rarities: string[], tier: string): void {
    const nm = py.pyStrip(name || "");
    const m = this.model;
    if (nm && !m.custom.some((e) => e.name.toLowerCase() === nm.toLowerCase())) {
      const have = new Set(rarities);
      const rs = wlModel.RARITIES.filter((r) => have.has(r));
      m.custom.push({ name: nm, rarities: rs.length ? rs : ["Normal"], tier: tierOrNull(tier) ?? "B" });
    }
  }
  wlCustomRemove(index: number): void {
    if (index >= 0 && index < this.model.custom.length) this.model.custom.splice(index, 1);
  }

  /** "whitelist" (made by the Whitelist tab - the tab can open and edit it) | "tier" (the NeverSink tab's) | "other" */
  filterKind(head: string): "whitelist" | "tier" | "other" {
    const hd = (head || "").slice(0, 600);
    if (hd.includes(wlEmbed.WL_HEADER)) return "whitelist";
    if (hd.includes(wlEmbed.TIER_HEADER_START)) return "tier";
    return "other";
  }

  /**
   * Open the text of a whitelist filter file (settings embedded, or an older file read back block by block).
   * `folderFiles` = the names of the files next to it (when the page can see that folder). On success the model is
   * replaced; the page applies `cfg` and the sound names it gets back.
   */
  wlOpen(text: string, filename: string, folderFiles: string[]): { ok: boolean; messages: Msg[]; name: string; sounds: Record<string, string>; kind: string; app: string; cfg: Cfg } {
    const files = new Set(folderFiles);
    const out = wlSession.openText(text, filename, this.game, this.model, this.data, { soundFile: (name) => (files.has(name) ? name : null) });
    if (out.ok) this.model = out.model!;
    return { ok: out.ok, messages: out.messages, name: out.name, sounds: out.sounds, kind: out.kind, app: out.app, cfg: out.ok ? out.model!.toConfig({}) : {} };
  }

  // ---------------------------------------------------------------------------------------------- generate / files

  /**
   * Build the filter text. Nothing is copied here (the page owns the sound files): the sound planner decides the
   * destination names exactly like the desktop one does - the file's own name, "#" / ";" become "_", a name already in the
   * folder with other content asks (overwrite / keep -> "-2"), the same content is reused - and records which sounds must be
   * written. `existing` = {file name: content hash or null} of the game folder when the page can see it, else {} (a zip: every
   * name is new). `hashes` = content hash per label.
   */
  async generate(o: {
    cfg: Cfg; game: string; hub: any; baseText: string | null; baseTag: string | null; log: (m: string, t?: string) => void;
    hashes?: Record<string, string>; names?: Iterable<string> | null; existing?: Record<string, string | null> | null; decisions?: Record<string, string>;
  }): Promise<GenerateResult> {
    const hashes = o.hashes ?? {};
    const decisions = o.decisions ?? {};
    const used: Record<string, string> = {};
    const conflicts: { name: string; new_name: string }[] = [];
    const copies: [string, string][] = [];
    const copySoundsFn: filterCore.CopySounds = (soundMap) => {
      const requests: [string, string, string][] = Object.entries(soundMap ?? {}).filter(([, src]) => py.truthy(src))
        .map(([label, src]) => { const nm = src.split(/[\\/]/).pop()!; return [label, nm, hashes[label] || nm]; });
      const decide: filterCore.Decide = (name, newName) => {
        conflicts.push({ name, new_name: newName });
        return decisions[name] ?? "keep";
      };
      const [dest, cps, msgs] = filterCore.resolveSoundPlan(filterCore.planSoundFiles(requests, o.existing ?? {}), decide);
      for (const m of msgs) o.log(m, "info");
      Object.assign(used, dest);
      copies.push(...cps);
      return dest;
    };
    let res, text: string;
    try {
      res = await filterCore.buildFilterText(o.cfg, o.game, {
        hubData: o.hub ?? null, baseText: o.baseText || null, baseTag: o.baseTag || null, extraNames: o.names ?? null, copySoundsFn,
        appVersion: APP_VERSION, log: o.log,
      });
      if (res === null) return { status: "none" };
      text = filterCore.composeFilterBody(res.generated_section, res.base_text);
    } catch (e) {
      if (e instanceof py.PyError && e.kind === "ValueError") return { status: "error", message: e.message };
      throw e;
    }
    const undecided = conflicts.filter((c) => !(c.name in decisions));
    if (undecided.length) return { status: "ask", conflicts: undecided };
    return { status: "ok", mode: res.mode, text, count: res.count, base_tag: res.base_tag, sounds: used, copies };
  }

  /** <filter name>.filter + the sound files, ready to unpack into the game's filter folder. */
  makeZip(filterText: string, filterName: string, sounds: Record<string, Uint8Array>): Uint8Array {
    const files: Record<string, Uint8Array> = { [filterName + ".filter"]: new TextEncoder().encode(filterText) };
    for (const [name, bytes] of Object.entries(sounds)) files[name] = bytes;
    return zipSync(files, { level: 6 });
  }
}

