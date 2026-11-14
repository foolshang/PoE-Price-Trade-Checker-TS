/**
 * Fetch data from poe-data-hub (prices, index, meta, passives, skills). Port of poe_price_trade/hub_client.py.
 * Schema reference: SPEC.md of the Poe_Hub project (sections 8.1, 8.1a/b/c, 8.2). The HTTP client is injected.
 */
import { INDEX_SCHEMA_VERSION, META_SCHEMA_VERSION, PRICES_SCHEMA_VERSION, checkSchema } from "./hub_schema.ts";
import { HttpError, HttpPort } from "./ports.ts";
import { Log, noopLog, truthy } from "./py.ts";

/** The ONE place the hub's address is written (the web page, the desktop guard and this client all read it). */
export const HUB_BASE_URL = "https://storage.googleapis.com/poe-data-hub";

/**
* Where the hub publishes the rendering aliases (RePoE wordings -> GGG stat, plus the stat groups): the public contract of SPEC.md 8.12.
* ONE place; the schema_version inside is checked by the loader (ModDatabase.loadAliases).
*/
export const renderingAliasesPath = (game: string): string => `${game}/aliases/latest.json`;


export const HEADERS: Record<string, string> = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "application/json",
};

export interface LeagueFiles {
  main: { league: string | null; path: string };
  hardcore: { league: string; path: string } | null;
  events: { league: string; path: string }[];
}

export class HubClient {
  constructor(private http: HttpPort, private warn: Log = noopLog) {}

  private async get(path: string): Promise<any> {
    const url = `${HUB_BASE_URL}/${path}`;
    try {
      return JSON.parse(await this.http.getText(url, HEADERS));
    } catch (e) {
      if (e instanceof HttpError) throw new Error(`hub HTTP ${e.status}: ${url}`);
      throw new Error(`hub fetch failed (${url}): ${(e as Error).message}`);
    }
  }

  /** a hub-relative path fetched as it is (e.g. 'poe2/prices/latest.json'); throws on failure and on a schema_version that is not PRICES_SCHEMA_VERSION */
  async getPrices(path: string): Promise<any> {
    const data = await this.get(path);
    if (!checkSchema(data, PRICES_SCHEMA_VERSION, path, this.warn, "treated as not loaded")) throw new Error(`hub schema mismatch: ${path}`);
    return data;
  }

  private async soft(path: string, what: string, game: string, schema?: number): Promise<any | null> {
    try {
      const data = await this.get(path);
      if (schema !== undefined && !checkSchema(data, schema, path, this.warn, "treated as not loaded")) return null;
      return data;
    } catch (e) {
      this.warn(`hub ${what} fetch failed (${game}): ${(e as Error).message}`, "warn");
      return null;
    }
  }

  /** {game}/prices/index.json - null when the hub is unreachable or the index does not exist yet. */
  getIndex(game: string): Promise<any | null> {
    return this.soft(`${game}/prices/index.json`, "index", game, INDEX_SCHEMA_VERSION);
  }
  /** {game}/meta/latest.json - null on any failure (SPEC 8.2). */
  getMeta(game: string): Promise<any | null> {
    return this.soft(`${game}/meta/latest.json`, "meta", game, META_SCHEMA_VERSION);
  }
  getPassives(game: string): Promise<any | null> {
    return this.soft(`${game}/passives/latest.json`, "passives", game);
  }
  getSkillsIndex(game: string): Promise<any | null> {
    return this.soft(`${game}/skills/index.json`, "skills index", game);
  }
  getSkillFile(path: string): Promise<any | null> {
    return this.soft(path, "skill file", path);
  }
  getSkillsDictionary(game: string): Promise<any | null> {
    return this.soft(`${game}/skills/dictionary.json`, "skills dictionary", game);
  }

  /** Reshape index.json into the league -> file routing table a consumer needs. */
  async getLeagueFiles(game: string): Promise<LeagueFiles> {
    const index = await this.getIndex(game);
    if (truthy(index)) {
      const main = truthy(index.main) ? index.main : {};
      const mainPath = truthy(main.path) ? main.path : `${game}/prices/latest.json`;
      const hc = index.hardcore;
      const events = (Array.isArray(index.events) ? index.events : [])
        .filter((e: any) => truthy(e.league) && truthy(e.path))
        .map((e: any) => ({ league: e.league, path: e.path }));
      return {
        main: { league: main.league === undefined ? null : main.league, path: mainPath },
        hardcore: truthy(hc) && truthy(hc.league) && truthy(hc.path) ? { league: hc.league, path: hc.path } : null,
        events,
      };
    }
    const latestPath = `${game}/prices/latest.json`;
    let leagueName: string | null;
    try {
      const latest = await this.getPrices(latestPath);
      leagueName = latest.league === undefined ? null : latest.league;
    } catch (e) {
      this.warn(`hub latest.json fallback fetch failed (${game}): ${(e as Error).message}`, "warn");
      leagueName = null;
    }
    return { main: { league: leagueName, path: latestPath }, hardcore: null, events: [] };
  }
}
