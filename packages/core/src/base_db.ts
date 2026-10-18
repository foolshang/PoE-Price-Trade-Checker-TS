/**
 * Resolve a raw item base / unique name from clipboard text into the trade site's canonical English name, so small wording
 * differences (a quality prefix like "Superior", odd spelling) do not silently produce a search with zero results.
 * Port of poe_price_trade/base_db.py. Two indexes: _type (base / div card / gem / currency / beast) and _name (unique / specific);
 * lookup order: exact -> strip a quality prefix -> fuzzy (difflib, cutoff 0.85). Fetched from GGG's trade items endpoint, cached 7 days.
 */
import { getCloseMatches } from "./difflib.ts";
import { GameProfile } from "./profiles.ts";
import { FsPort, HttpPort } from "./ports.ts";
import { Log, noopLog, truthy } from "./py.ts";
import { isoLocal, parseIso, pyIsAlnum } from "./pyextra.ts";

export const HEADERS: Record<string, string> = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
};
const CACHE_TTL_MS = 7 * 86400 * 1000;
const QUAL_PREFIX = ["superior ", "anomalous ", "divergent ", "phantasmal "];

export const norm = (s: string): string => Array.from(s.toLowerCase()).filter(pyIsAlnum).join("");

function stripQual(s: string): string {
  const low = s.toLowerCase();
  for (const p of QUAL_PREFIX) if (low.startsWith(p)) return s.slice(p.length);
  return s;
}

export interface DbEnv {
  fs: FsPort;
  http: HttpPort;
  /** folder of the cache files (null = no disk cache) */
  cacheDir: string | null;
  nowMs: () => number;
  warn?: Log;
  /** the rendering aliases that ship with the program (the last resort when the hub file was never fetched) */
  bundledAliases?: (game: string) => Promise<unknown | null>;
}

export class BaseDB {
  private type = new Map<string, string>(); // norm -> canonical (base / div card / gem / currency / beast)
  private name = new Map<string, string>(); // norm -> canonical (unique / specific name)
  private loaded = false;

  constructor(private profile: GameProfile, private env: DbEnv) {}

  async load(force = false): Promise<void> {
    if (this.loaded && !force) return;
    let data: any = force ? null : await this.loadCache();
    if (data === null) data = await this.fetch();
    if (truthy(data)) this.build(data);
    this.loaded = true;
  }

  private cachePath(): string | null {
    return this.env.cacheDir === null ? null : this.env.fs.join(this.env.cacheDir, `items_${this.profile.game_version}.json`);
  }

  private async loadCache(): Promise<any | null> {
    const path = this.cachePath();
    if (path === null || !(await this.env.fs.exists(path))) return null;
    try {
      const cached = JSON.parse(await this.env.fs.readText(path));
      const at = parseIso(cached.fetched_at);
      if (Number.isNaN(at)) throw new Error("bad fetched_at");
      if (this.env.nowMs() - at > CACHE_TTL_MS) return null;
      return cached.data;
    } catch (e) {
      (this.env.warn ?? noopLog)(`base_db: cache read failed: ${(e as Error).message}`, "warn");
      return null;
    }
  }

  private async fetch(): Promise<any | null> {
    if (!this.profile.trade_items_url) return null;
    try {
      const data = JSON.parse(await this.env.http.getText(this.profile.trade_items_url, HEADERS));
      await this.saveCache(data);
      return data;
    } catch (e) {
      (this.env.warn ?? noopLog)(`base_db: fetch ล้มเหลว — จะใช้ชื่อดิบแทน (${(e as Error).message})`, "warn");
      return null;
    }
  }

  private async saveCache(data: unknown): Promise<void> {
    const path = this.cachePath();
    if (path === null) return;
    try {
      await this.env.fs.mkdirp(this.env.cacheDir!);
      await this.env.fs.writeText(path, JSON.stringify({ fetched_at: isoLocal(this.env.nowMs()), data }));
    } catch (e) {
      (this.env.warn ?? noopLog)(`base_db: cache write failed: ${(e as Error).message}`, "warn");
    }
  }

  /** GGG: {"result":[{"label":..,"entries":[{"type":"..","name":"..?"}]}]} */
  build(data: any): void {
    this.type = new Map();
    this.name = new Map();
    for (const group of truthy(data.result) ? data.result : []) {
      for (const e of truthy(group.entries) ? group.entries : []) {
        const t = e.type;
        if (truthy(t)) this.type.set(norm(t), t);
        const n = e.name; // only unique / specific items have one
        if (truthy(n)) this.name.set(norm(n), n);
      }
    }
  }

  private lookup(raw: string, idx: Map<string, string>): string {
    if (!raw || !idx.size) return raw;
    const n = norm(raw);
    if (idx.has(n)) return idx.get(n)!; // 1 exact ("Exceptional Verisium" is not cut)
    const stripped = stripQual(raw); // 2 without the quality prefix
    if (stripped !== raw) {
      const ns = norm(stripped);
      if (idx.has(ns)) return idx.get(ns)!;
    }
    const m = getCloseMatches(n, idx.keys(), 1, 0.85); // 3 fuzzy
    return m.length ? idx.get(m[0])! : raw;
  }

  /** base / div card / gem / currency / beast -> canonical */
  resolveType(raw: string): string {
    return this.lookup(raw, this.type);
  }

  /** unique / specific name -> canonical */
  resolveName(raw: string): string {
    return this.lookup(raw, this.name);
  }
}
