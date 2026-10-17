/**
 * MetaDB - tier ladder + money-mod annotation (offline). Port of poe_price_trade/meta_db.py.
 * Reads mod_meta_{game}.json (built from the RePoE datamine by the original's tools/build_mod_meta.py) and, optionally, money_mods.json
 * (rules override). No meta file = the features are limited, silently. `load()` is async here (files go through the FsPort); call it
 * once before the other methods.
 */
import { FsPort } from "./ports.ts";
import { ParsedItem, ModValue } from "./models.ts";
import { Log, noopLog, pyStr, splitWs, truthy } from "./py.ts";
import { D } from "./pyextra.ts";

// the normalization must match build_mod_meta.py exactly: numbers / ranges / signs -> #. A roll range printed next to the value,
// like 40(39-42)%, is cut first - otherwise "##%" would not match the family.
const ROLL_RANGE = new RegExp(`\\(${D}+(?:\\.${D}+)?-${D}+(?:\\.${D}+)?\\)`, "gu");
const NUMISH = new RegExp(`[-+]?\\(?${D}+(?:\\.${D}+)?(?:-${D}+(?:\\.${D}+)?)?\\)?`, "gu");

export const norm = (t: string): string => splitWs(t.replace(ROLL_RANGE, "").replace(NUMISH, "#").toLowerCase()).join(" ");

export const WEAPON_CLASSES = new Set([
  "Bows", "Crossbows", "Wands", "Staves", "Quarterstaves", "Spears",
  "One Hand Maces", "Two Hand Maces", "Sceptres", "Flails",
  "One Hand Swords", "Two Hand Swords", "One Hand Axes", "Two Hand Axes",
  "Claws", "Daggers",
]);

export interface MoneyRule { contains?: string; classes?: "WEAPON" | string[] | null; max_tier?: number | null }

/** "contains" is compared with the normalized text (numbers = #). classes: null = every class, "WEAPON" = weapons, a list = those only. max_tier: the tier must be known and <= it. */
export const DEFAULT_MONEY: MoneyRule[] = [
  { contains: "movement speed", classes: ["Boots"], max_tier: 2 },
  { contains: "to level of all", classes: null, max_tier: null },
  { contains: "increased physical damage", classes: "WEAPON", max_tier: 2 },
  { contains: "adds # to # physical damage", classes: "WEAPON", max_tier: 2 },
  { contains: "increased attack speed", classes: "WEAPON", max_tier: 2 },
  { contains: "increased cast speed", classes: "WEAPON", max_tier: 2 },
  { contains: "increased spell damage", classes: "WEAPON", max_tier: 2 },
  { contains: "additional arrow", classes: null, max_tier: null },
  { contains: "additional projectile", classes: null, max_tier: null },
  { contains: "to maximum life", classes: null, max_tier: 2 },
  { contains: "to chaos resistance", classes: null, max_tier: null },
  { contains: "rarity of items found", classes: null, max_tier: null },
  { contains: "to spirit", classes: null, max_tier: null },
];

export interface Anno { tier: number; total: number; cap: number; money: boolean }

interface Tier { lvl: number; rng: number[][] }
interface Family { gen?: string; text: string; tiers: Tier[]; tags?: string[] }

const cpLen = (s: string): number => Array.from(s).length;

export interface MetaPlaces {
  fs: FsPort;
  /** the app folder: mod_meta_{game}.json / money_mods.json here win */
  appDir: string;
  /** a folder shipped with the program that holds mod_meta_{game}.json (used when the app folder has none) */
  bundledDir?: string | null;
  warn?: Log;
}

export class MetaDB {
  private meta: any = null;
  private money: MoneyRule[] = DEFAULT_MONEY;
  private isLoaded = false;
  private globalTagsCache: Map<string, Set<string>> | null = null;

  constructor(private gameVersion: string, private places: MetaPlaces) {}

  async load(): Promise<void> {
    if (this.isLoaded) return;
    this.isLoaded = true;
    const { fs, appDir, bundledDir } = this.places;
    const warn = this.places.warn ?? noopLog;
    const file = `mod_meta_${this.gameVersion}.json`;
    for (const dir of [appDir, bundledDir]) {
      if (!dir) continue;
      const path = fs.join(dir, file);
      if (!(await fs.exists(path))) continue;
      try {
        this.meta = JSON.parse(await fs.readText(path));
        break;
      } catch (e) {
        warn(`mod_meta load fail: ${(e as Error).message}`, "warn");
      }
    }
    const moneyPath = fs.join(appDir, "money_mods.json");
    if (await fs.exists(moneyPath)) {
      try {
        this.money = JSON.parse(await fs.readText(moneyPath));
      } catch (e) {
        warn(`money_mods load fail: ${(e as Error).message}`, "warn");
      }
    }
  }

  available(): boolean {
    return this.meta !== null;
  }

  /** The real base inside the name of a magic item: the longest base of the meta found as whole words ("Legend's Fortress Sabatons of Grounding" -> "Fortress Sabatons"); none / no meta -> null. */
  resolveBase(name: string): string | null {
    if (!this.meta || !name) return null;
    const padded = ` ${name} `;
    let best = "";
    let bestLen = 0;
    for (const base of Object.keys(this.meta.bases ?? {})) {
      const len = cpLen(base);
      if (len > bestLen && padded.includes(` ${base} `)) {
        best = base;
        bestLen = len;
      }
    }
    return best || null;
  }

  private families(baseType: string): Family[] | null {
    if (!this.meta) return null;
    const b = (this.meta.bases ?? {})[baseType];
    if (!truthy(b)) return null;
    const fams = (this.meta.tagsets ?? {})[pyStr(b.ts === undefined ? null : b.ts)];
    return fams === undefined ? null : fams;
  }

  /** RePoE roll range [[min,max],...] (one pair per value on the line) of the mod family at `tier` (1 = T1, like the game header "(Tier: N)"); null when it cannot be resolved. */
  tierRange(baseType: string, modText: string, tier: number): number[][] | null {
    if (!tier) return null;
    const fams = this.families(baseType);
    if (!fams || !fams.length) return null;
    const n = norm(modText);
    for (const f of fams) {
      if (f.text === n) {
        const tiers = f.tiers;
        return tier > 0 && tier <= tiers.length ? tiers[tier - 1].rng : null;
      }
    }
    return null;
  }

  /** Prefix / suffix for clipboard text with no { ... Modifier } header at all: each unclassified explicit mod is matched with the RePoE families of its base and takes their "gen". Mutates item.mods, recounts prefix_count / suffix_count. */
  inferAffixes(item: ParsedItem): void {
    const fams = this.families(item.base_type);
    if (!fams || !fams.length) return;
    const byText = new Map<string, string>();
    for (const f of fams) if (f.gen === "prefix" || f.gen === "suffix") byText.set(f.text, f.gen);
    for (const m of item.mods) {
      if (m.mod_type === "explicit" && !m.affix) {
        const gen = byText.get(norm(m.text));
        if (gen) m.affix = gen;
      }
    }
    item.prefix_count = item.mods.filter((m) => m.affix === "prefix").length;
    item.suffix_count = item.mods.filter((m) => m.affix === "suffix").length;
  }

  private globalTags(): Map<string, Set<string>> {
    if (this.globalTagsCache !== null) return this.globalTagsCache;
    const idx = new Map<string, Set<string>>();
    if (this.meta) {
      for (const fams of Object.values<Family[]>(this.meta.tagsets ?? {})) {
        for (const f of fams) {
          if (truthy(f.tags)) {
            let set = idx.get(f.text);
            if (!set) idx.set(f.text, (set = new Set()));
            for (const t of f.tags!) set.add(t);
          }
        }
      }
    }
    this.globalTagsCache = idx;
    return idx;
  }

  /** RePoE implicit_tags of a mod line given in normalized form ("#" for numbers, lowercase). */
  tagsForTemplate(normalizedTemplate: string): Set<string> {
    return this.globalTags().get(normalizedTemplate) ?? new Set();
  }

  /** {group_no: {tier, total, cap, money}} - a group is one header block */
  annotate(item: ParsedItem): Record<number, Anno> {
    const fams = this.families(item.base_type);
    const groups = new Map<number, ModValue[]>();
    for (const m of item.mods) {
      const list = groups.get(m.group);
      if (list) list.push(m);
      else groups.set(m.group, [m]);
    }
    const out: Record<number, Anno> = {};
    for (const [g, ms] of groups) {
      const modType = ms[0].mod_type;
      const text = ms.map((mm) => mm.text).join(" "); // hybrid -> one family
      const values = ms.flatMap((mm) => mm.values);
      let tier = ms[0].tier;
      let total = 0, cap = 0;
      // rune / enchant / implicit are not normal affixes: no tier ladder
      if (fams && fams.length && ["explicit", "desecrated", "fractured"].includes(modType)) {
        const n = norm(text);
        for (const f of fams) {
          if (f.text === n) {
            total = f.tiers.length;
            const usable = f.tiers.filter((t) => t.lvl <= item.item_level);
            cap = usable.length ? total - usable.length + 1 : 0;
            if (!tier) { // the header says nothing -> from the roll
              for (let i = 0; i < f.tiers.length; i++) {
                const t = f.tiers[i];
                if (t.lvl <= item.item_level && values.length === t.rng.length && values.every((v, k) => t.rng[k][0] <= v && v <= t.rng[k][1])) {
                  tier = i + 1;
                  break;
                }
              }
            }
            break;
          }
        }
      }
      out[g] = { tier, total, cap, money: this.isMoney(text, item.item_class, tier, modType) };
    }
    return out;
  }

  private isMoney(text: string, itemClass: string, tier: number, modType: string): boolean {
    if (modType === "rune" || modType === "enchant") return false;
    const n = norm(text);
    for (const rule of this.money) {
      const c = rule.classes;
      if (c === "WEAPON") {
        if (!WEAPON_CLASSES.has(itemClass)) continue;
      } else if (truthy(c) && !(c as string[]).includes(itemClass)) continue;
      if (!n.includes(rule.contains ?? "")) continue;
      const mt = rule.max_tier;
      if (mt !== null && mt !== undefined && (!tier || tier > mt)) continue;
      return true;
    }
    return false;
  }

  /** prefix_cap / suffix_cap: max affix slots of the item class (3/3 for gear, 1/1 for PoE2 jewels - the caller asks mod_badge.affixCap) */
  static summary(item: ParsedItem, ann: Record<number, Anno>, prefixCap = 3, suffixCap = 3): string {
    const vals = Object.values(ann);
    const money = vals.filter((i) => i.money).length;
    const t1 = vals.filter((i) => i.tier === 1).length;
    const parts: string[] = [];
    if (money) parts.push(`💰 mod เงิน ×${money}`);
    if (t1) parts.push(`T1 ×${t1}`);
    if (item.rarity === "Rare") parts.push(`Prefix ${item.prefix_count}/${prefixCap} · Suffix ${item.suffix_count}/${suffixCap}`);
    parts.push(`ilvl ${item.item_level}`);
    return parts.join("  ·  ");
  }
}
