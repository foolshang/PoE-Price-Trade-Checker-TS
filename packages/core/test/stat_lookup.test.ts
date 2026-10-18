import { describe, expect, it } from "vitest";
import { HttpError } from "../src/ports.ts";
import type { FsPort } from "../src/ports.ts";
import { ModBadgeDB } from "../src/mod_badge.ts";
import { ModDatabase, cleanModText } from "../src/mod_db.ts";
import { PROFILES } from "../src/profiles.ts";
import { ALIAS_SCHEMA_VERSION } from "../src/rendering_aliases.ts";

const STATS = [
  { id: "explicit.stat_3299347043", text: "+# to maximum Life", type: "explicit" },
  { id: "explicit.stat_1", text: "#% increased Spark Duration", type: "explicit" },
  { id: "explicit.stat_2", text: "#% increased Duration", type: "explicit" },
  { id: "explicit.stat_3", text: "#% increased maximum Energy Shield", type: "explicit" },
  { id: "explicit.stat_4", text: "#% increased Energy Shield", type: "explicit" },
  { id: "implicit.stat_3299347043", text: "+# to maximum Life", type: "implicit" },
  { id: "rune.stat_9", text: "#% increased Curse Magnitudes", type: "rune" },
];

function memFs(): FsPort & { files: Map<string, string> } {
  const files = new Map<string, string>();
  return {
    files,
    join: (...p: string[]) => p.join("/"), basename: (p: string) => p.split("/").pop()!,
    exists: async (p: string) => files.has(p), isFile: async (p: string) => files.has(p), isDir: async () => false,
    readText: async (p: string) => files.get(p)!, writeText: async (p: string, t: string) => { files.set(p, t); }, mkdirp: async () => {},
    listDir: async () => [], mtimeSec: async () => 0, sha256: async () => "", copyFile: async () => {},
  } as never;
}

function makeDb(opts: { aliasesFromHub?: unknown; hubDown?: boolean; bundled?: unknown; now?: () => number; warn?: (m: string) => void } = {}) {
  const fs = memFs();
  const requests: string[] = [];
  const http = {
    getText: async (url: string): Promise<string> => {
      requests.push(url);
      if (url.includes("rendering_aliases")) {
        if (opts.hubDown || opts.aliasesFromHub === undefined) throw new HttpError(404, url);
        return JSON.stringify(opts.aliasesFromHub);
      }
      return JSON.stringify({ result: [...new Set(STATS.map((s) => s.type))].map((t) => ({ id: t, entries: STATS.filter((s) => s.type === t).map(({ id, text }) => ({ id, text })) })) });
    },
  };
  const env = {
    fs, http, cacheDir: "/cache", nowMs: opts.now ?? (() => 1_000_000), warn: opts.warn,
    bundledAliases: opts.bundled === undefined ? undefined : async () => opts.bundled as never,
  };
  const db = new ModDatabase(PROFILES.poe2, env as never);
  return { db, fs, requests };
}

describe("finding a stat id never guesses", () => {
  it("exact wording, with numbers and signs; the cases the old fuzzy match got wrong are now without an id", async () => {
    const { db } = makeDb();
    await db.load();
    expect(db.findStatId("+47 to maximum Life", "explicit")).toBe("explicit.stat_3299347043");
    expect(db.findStatId("+47 to maximum Life", "implicit")).toBe("implicit.stat_3299347043");
    expect(db.findStatId("12% increased Duration", "explicit")).toBe("explicit.stat_2");
    expect(db.findStatId("14% reduced Duration", "explicit")).toBe("explicit.stat_2"); // reduced <-> increased (a negative roll)
    // the original's difflib matched these to a similar-looking stat
    expect(db.findStatId("12% increased Poison Duration", "explicit")).toBeNull();
    expect(db.findStatId("12% less Duration", "explicit")).toBeNull();
    expect(db.findStatId("+47 to maximun Life", "explicit")).toBeNull(); // a typo
    expect(db.findStatId("+47 TO MAXIMUM LIFE", "explicit")).toBeNull();
    // a typed line is looked up in its own group only
    expect(db.findStatId("+47 to maximum Life", "rune")).toBeNull();
    expect(db.findStatId("8% increased Curse Magnitudes", "rune")).toBe("rune.stat_9");
    // an unknown type: the groups in turn
    expect(db.findStatId("8% increased Curse Magnitudes", null)).toBe("rune.stat_9");
    expect(db.findStatId("+47 to maximum Life", null)).toBe("explicit.stat_3299347043");
  });

  it("the roll ranges and the tag the game prints on a copied line are removed first - nothing else", () => {
    expect(cleanModText("+47(42-49) to maximum Life")).toBe("+47 to maximum Life");
    expect(cleanModText("Adds 14(13-16) to 24(22-27) Physical Damage")).toBe("Adds 14 to 24 Physical Damage");
    expect(cleanModText("12(10-13)% increased Attack Speed (crafted)")).toBe("12% increased Attack Speed");
    expect(cleanModText("+25% to Global Critical Strike Multiplier (implicit)")).toBe("+25% to Global Critical Strike Multiplier");
    expect(cleanModText("30% increased Movement Speed (enchant)")).toBe("30% increased Movement Speed");
    expect(cleanModText("Gain 1(1-2) Charge (Local)")).toBe("Gain 1 Charge (Local)"); // (Local) is a table suffix, not a tag of the game's copy
    expect(cleanModText("Adds 5 to 12 Fire Damage")).toBe("Adds 5 to 12 Fire Damage");
  });

  it("a line without a stat id is written to the log once", async () => {
    const lines: string[] = [];
    const { db } = makeDb({ warn: (m) => lines.push(m) });
    await db.load();
    for (let i = 0; i < 5; i++) db.findStatId("Some text nobody lists", "explicit");
    db.findStatId("Another one", "explicit");
    expect(lines.filter((l) => l.includes("without a stat id"))).toEqual([
      "mod without a stat id [explicit]: Some text nobody lists", "mod without a stat id [explicit]: Another one",
    ]);
  });
});

describe("the hub's rendering aliases", () => {
  const aliases = (): unknown => ({
    schema_version: ALIAS_SCHEMA_VERSION, game: "poe2", deprecated: [],
    aliases: [{ x: "Spark lasts {0} second", n: "1", k: ["explicit"], p: [0], ng: [false], dv: [1], sg: [1], c: [[1, 1]], iv: null, dep: false }],
  });

  it("from the hub: used and cached; the next start (hub down) uses the cache; no cache -> the bundled copy; nothing at all -> no aliases, no crash", async () => {
    const now = 1_000_000;
    const a = makeDb({ aliasesFromHub: aliases(), now: () => now });
    await a.db.load();
    expect(a.db.aliasSource).toBe("hub");
    expect(a.db.aliasCount()).toBe(1);
    expect(a.db.findStatId("Spark lasts 1 second", "explicit")).toBe("explicit.stat_1");
    expect(a.fs.files.has("/cache/rendering_aliases_poe2.json")).toBe(true);

    // a later start, the hub down: the cached copy (older than a day is still used when the fetch fails)
    const b = makeDb({ hubDown: true, now: () => now + 10 * 86400 * 1000 });
    for (const [k, v] of a.fs.files) b.fs.files.set(k, v);
    b.fs.files.set("/cache/stats_poe2.json", JSON.stringify({ fetched_at: new Date(now + 9 * 86400 * 1000).toISOString().replace("Z", ""), stats: STATS }));
    await b.db.load();
    expect(b.db.aliasSource).toBe("cache");
    expect(b.db.findStatId("Spark lasts 1 second", "explicit")).toBe("explicit.stat_1");

    const c = makeDb({ hubDown: true, bundled: aliases() });
    await c.db.load();
    expect(c.db.aliasSource).toBe("bundled");

    const d = makeDb({ hubDown: true });
    await d.db.load();
    expect(d.db.aliasSource).toBe("none");
    expect(d.db.aliasCount()).toBe(0);
    expect(d.db.findStatId("+47 to maximum Life", "explicit")).toBe("explicit.stat_3299347043"); // the table alone still works
  });

  it("a wrong schema_version is not used; the hub is asked at most once an hour (load() runs on every F5)", async () => {
    let now = 5_000_000;
    const { db, requests } = makeDb({ aliasesFromHub: { ...(aliases() as object), schema_version: 99 }, now: () => now });
    await db.load();
    expect(db.aliasSource).toBe("none");
    const asked = () => requests.filter((u) => u.includes("rendering_aliases")).length;
    expect(asked()).toBe(1);
    await db.load();
    await db.load();
    expect(asked()).toBe(1);
    now += 3600 * 1000 + 1;
    await db.load();
    expect(asked()).toBe(2);
  });
});

describe("the badge: no data is not the same as not ranked", () => {
  function badge(): ModBadgeDB {
    const b = new ModBadgeDB({ fs: memFs(), hub: null as never, cacheDir: null, configDir: null, nowMs: () => 0 });
    b.index({
      mods: [
        { slot: "ring", archetype: "all", stat_id: "explicit.stat_1", rank_in_slot: 1, usage_pct: 80 },
        { slot: "ring", archetype: "all", stat_id: "explicit.stat_2", rank_in_slot: 90, usage_pct: 1 },
        { slot: "ring", archetype: "all", stat_id: "explicit.stat_main", rank_in_slot: 2, usage_pct: 70 },
      ],
      stat_dictionary: [],
    });
    return b;
  }
  const meta = { tagsForTemplate: () => [] } as never;

  it("states", () => {
    const b = badge();
    expect(b.badgeState(null, "ring", "all", meta)).toBe("nodata");
    expect(b.badgeState("explicit.stat_77", "ring", "all", meta)).toBe("norow");
    expect(b.badgeState("explicit.stat_2", "ring", "all", meta)).toBe("plain");
    expect(b.badgeState("explicit.stat_1", "ring", "all", meta)).toBe("red");
  });

  it("stat_aliases: a sibling id finds the row of its main id; a missing field or a strange shape is fine", () => {
    const b = badge();
    expect(b.badgeState("explicit.stat_sibling", "ring", "all", meta)).toBe("norow");
    b.setStatAliases({ "explicit.stat_sibling": "explicit.stat_main" });
    expect(b.statAliasCount()).toBe(1);
    expect(b.badgeState("explicit.stat_sibling", "ring", "all", meta)).toBe("red");
    b.setStatAliases([["explicit.stat_sibling", "explicit.stat_main"], { alias: "explicit.stat_x", main: "explicit.stat_1" }, 5, null]);
    expect(b.statAliasCount()).toBe(2);
    b.setStatAliases(null);
    expect(b.statAliasCount()).toBe(0);
    b.setStatAliases("garbage");
    expect(b.statAliasCount()).toBe(0);
  });
});
