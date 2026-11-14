/** schema_version of the hub files read by the program: prices (+ index), meta, gems. Right / wrong / absent for each. */
import { describe, expect, it } from "vitest";
import { FsPort, HttpPort, hubClient, hubSchema, modBadge } from "../src/index.ts";

const memFs = (files: Record<string, string> = {}): FsPort & { files: Record<string, string> } => ({
  files,
  join: (...p: string[]) => p.join("/"), basename: (p: string) => p.split("/").pop()!,
  exists: async (p: string) => p in files, isFile: async (p: string) => p in files, isDir: async () => false,
  readText: async (p: string) => files[p], writeText: async (p: string, t: string) => { files[p] = t; }, mkdirp: async () => {},
  listDir: async () => [], mtimeSec: async () => 0, sha256: async () => "", copyFile: async () => {},
});

/** the hub answers each path with the given payload (a missing path = HTTP failure) */
const hubOf = (answers: Record<string, unknown>): HttpPort => ({
  async getText(url: string): Promise<string> {
    const p = url.replace(`${hubClient.HUB_BASE_URL}/`, "");
    if (!(p in answers)) throw new Error(`no such file ${p}`);
    return JSON.stringify(answers[p]);
  },
});
const warnings = (): { log: string[]; warn: (m: string, t?: string) => void } => {
  const log: string[] = [];
  return { log, warn: (m) => { log.push(m); } };
};

// the three cases of every file: the expected version / a different one / no field
const WRONG = 3;
const variants = (expected: number, body: Record<string, unknown>): [string, Record<string, unknown>][] => [
  ["right", { schema_version: expected, ...body }],
  ["wrong", { schema_version: WRONG, ...body }],
  ["absent", { ...body }],
];

describe("checkSchema", () => {
  it("names the file, the expected and the found version", () => {
    const w = warnings();
    expect(hubSchema.checkSchema({ schema_version: 7 }, 2, "poe1/meta/latest.json", w.warn, "not used")).toBe(false);
    expect(w.log).toEqual(["hub poe1/meta/latest.json: schema_version 7 (expected 2) - not used"]);
  });
  it("says 'missing' when there is no field, and is quiet when it matches", () => {
    const w = warnings();
    expect(hubSchema.checkSchema({}, 1, "x.json", w.warn)).toBe(false);
    expect(hubSchema.checkSchema(null, 1, "y.json", w.warn)).toBe(false);
    expect(hubSchema.checkSchema({ schema_version: 1 }, 1, "z.json", w.warn)).toBe(true);
    expect(w.log).toHaveLength(2);
    expect(w.log[0]).toContain("schema_version missing (expected 1)");
  });
  it("a number written as a string is not the version", () => {
    expect(hubSchema.checkSchema({ schema_version: "2" }, 2, "x.json")).toBe(false);
  });
});

describe("prices (latest.json, events, hardcore) - schema_version 2", () => {
  it.each(variants(2, { league: "Mirage", currency: [], items: [] }))("getPrices, %s", async (name, payload) => {
    const w = warnings();
    const hub = new hubClient.HubClient(hubOf({ "poe1/prices/latest.json": payload }), w.warn);
    if (name === "right") {
      expect((await hub.getPrices("poe1/prices/latest.json")).league).toBe("Mirage");
      expect(w.log).toEqual([]);
    } else {
      await expect(hub.getPrices("poe1/prices/latest.json")).rejects.toThrow("hub schema mismatch");
      expect(w.log).toHaveLength(1);
      expect(w.log[0]).toContain("poe1/prices/latest.json");
      expect(w.log[0]).toContain("(expected 2)");
      expect(w.log[0]).toContain(name === "wrong" ? `schema_version ${WRONG}` : "schema_version missing");
    }
  });
});

describe("prices/index.json - schema_version 1, falls back to latest.json", () => {
  const index = { generated_at: "t", main: { league: "Index League", path: "poe1/prices/latest.json" }, hardcore: null, events: [] };
  const latest = { schema_version: 2, league: "Latest League", items: [] };
  it.each(variants(1, index))("getLeagueFiles, index %s", async (name, payload) => {
    const w = warnings();
    const hub = new hubClient.HubClient(hubOf({ "poe1/prices/index.json": payload, "poe1/prices/latest.json": latest }), w.warn);
    const files = await hub.getLeagueFiles("poe1");
    expect(files.main.league).toBe(name === "right" ? "Index League" : "Latest League");
    expect(w.log.filter((m) => m.includes("index.json"))).toHaveLength(name === "right" ? 0 : 1);
  });
  it("index and latest.json both with a schema this code does not know: no league name, nothing thrown", async () => {
    const w = warnings();
    const hub = new hubClient.HubClient(hubOf({ "poe1/prices/index.json": { schema_version: 9, ...index }, "poe1/prices/latest.json": { schema_version: 9, league: "X" } }), w.warn);
    const files = await hub.getLeagueFiles("poe1");
    expect(files.main).toEqual({ league: null, path: "poe1/prices/latest.json" });
    expect(w.log.some((m) => m.includes("index.json"))).toBe(true);
  });
});

describe("meta/latest.json - schema_version 2", () => {
  const body = { generated_at: new Date().toISOString(), league: "L", mods: [{ slot: "helmet", archetype: "all", stat_id: "s.one", rank_in_slot: 1, usage_pct: 20 }], stat_dictionary: [] };
  const badge = (files: Record<string, string>, hub: hubClient.HubClient, w: ReturnType<typeof warnings>) =>
    new modBadge.ModBadgeDB({ fs: memFs(files), hub, cacheDir: "/c", configDir: null, nowMs: () => Date.now(), warn: w.warn });
  const cacheFile = "/c/mod_badge_meta_poe2.json";

  it.each(variants(2, body))("fresh from the hub, %s: used only when right; the disk cache is written only when right", async (name, payload) => {
    const w = warnings();
    const files: Record<string, string> = {};
    const db = badge(files, new hubClient.HubClient(hubOf({ "poe2/meta/latest.json": payload }), w.warn), w);
    await db.load("poe2");
    expect(db.available()).toBe(name === "right");
    expect(cacheFile in files).toBe(name === "right");
    expect(w.log.some((m) => m.includes("poe2/meta/latest.json") && m.includes("(expected 2)"))).toBe(name !== "right");
  });

  it("a wrong schema from the hub falls back to the valid disk cache and leaves it as it was", async () => {
    const w = warnings();
    const stale = JSON.stringify({ schema_version: 2, ...body, generated_at: "2020-01-01T00:00:00Z" });
    const files = { [cacheFile]: stale };
    const db = badge(files, new hubClient.HubClient(hubOf({ "poe2/meta/latest.json": { schema_version: WRONG, ...body } }), w.warn), w);
    await db.load("poe2");
    expect(db.available()).toBe(true);
    expect(files[cacheFile]).toBe(stale);
  });

  it.each([["wrong", { schema_version: WRONG, ...body }], ["absent", { ...body }]])("a disk cache with %s schema is not used, and not overwritten by a bad download", async (_n, cached) => {
    const w = warnings();
    const old = JSON.stringify(cached);
    const files = { [cacheFile]: old };
    const db = badge(files, new hubClient.HubClient(hubOf({ "poe2/meta/latest.json": { schema_version: WRONG, ...body } }), w.warn), w);
    await db.load("poe2");
    expect(db.available()).toBe(false);
    expect(files[cacheFile]).toBe(old);
    expect(w.log.some((m) => m.includes("(disk cache)"))).toBe(true);
  });

  it("a disk cache with a wrong schema is replaced by a good download", async () => {
    const w = warnings();
    const files = { [cacheFile]: JSON.stringify({ schema_version: WRONG, ...body, generated_at: "2020-01-01T00:00:00Z" }) };
    const db = badge(files, new hubClient.HubClient(hubOf({ "poe2/meta/latest.json": { schema_version: 2, ...body } }), w.warn), w);
    await db.load("poe2");
    expect(db.available()).toBe(true);
    expect(JSON.parse(files[cacheFile]).schema_version).toBe(2);
  });
});

describe("gems.json - schema_version 1, an empty list when it is not", () => {
  const gems = { generated_at: "t", gems: [{ name: "Fireball" }] };
  it.each(variants(1, gems))("gemsPayload, %s", (name, payload) => {
    const w = warnings();
    const got = hubSchema.gemsPayload(payload, "poe1/gems.json", w.warn);
    expect(got !== null).toBe(name === "right");
    expect(w.log).toHaveLength(name === "right" ? 0 : 1);
    if (name !== "right") expect(w.log[0]).toContain("poe1/gems.json: schema_version");
    if (name !== "right") expect(w.log[0]).toContain("(expected 1)");
  });
});
