/**
 * The league of the filter page's lists: the dropdown's options from the hub's index (leagues.ts), the answer of the index and of a league's file
 * (data.ts getLeagues / getHub): main, hardcore, event; the index failing; a path that is not there; the cache that never mixes leagues.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hubClient } from "@poe/core";
import { getHub, getLeagues } from "../src/data.ts";
import { chooseOption, isPricesPath, mainOnly, optionsFromFiles } from "../src/leagues.ts";
import { HttpResult, setPlatform } from "../src/platform.ts";

const INDEX = {
  schema_version: 1,
  main: { league: "Covens", path: "poe2/prices/latest.json" },
  hardcore: { league: "HC Covens", path: "poe2/prices/hardcore/latest.json" },
  events: [{ league: "Runes", path: "poe2/prices/events/runes.json" }, { league: "Other", path: "poe2/prices/events/other.json" }],
};
const files = (index: unknown = INDEX): hubClient.LeagueFiles => hubClient.leagueFilesFromIndex("poe2", index);

describe("options of the dropdown", () => {
  it("main, hardcore, then the events, each with its own file", () => {
    expect(optionsFromFiles("poe2", files()).map((o) => [o.label, o.path])).toEqual([
      ["Covens", "poe2/prices/latest.json"], ["HC Covens", "poe2/prices/hardcore/latest.json"],
      ["Runes", "poe2/prices/events/runes.json"], ["Other", "poe2/prices/events/other.json"]]);
  });
  it("no hardcore, no events: the main league only", () => {
    expect(optionsFromFiles("poe2", files({ schema_version: 1, main: INDEX.main, hardcore: null, events: [] }))).toHaveLength(1);
  });
  it("a main league without a name is 'ลีกหลัก'; a missing main path is latest.json", () => {
    const o = optionsFromFiles("poe2", files({ schema_version: 1, main: {} }));
    expect(o).toEqual([{ name: null, label: "ลีกหลัก", path: "poe2/prices/latest.json" }]);
  });
  it("a path that is not a prices file of this game is left out", () => {
    const bad = { schema_version: 1, main: INDEX.main, hardcore: { league: "X", path: "poe1/prices/hardcore/latest.json" },
      events: [{ league: "Y", path: "poe2/prices/../meta/latest.json" }, { league: "Z", path: "poe2/gems.json" }, { league: "Ok", path: "poe2/prices/events/ok.json" }] };
    expect(optionsFromFiles("poe2", files(bad)).map((o) => o.label)).toEqual(["Covens", "Ok"]);
  });
  it("one name once", () => {
    const dup = { schema_version: 1, main: INDEX.main, events: [{ league: "Covens", path: "poe2/prices/events/x.json" }] };
    expect(optionsFromFiles("poe2", files(dup))).toHaveLength(1);
  });
  it("isPricesPath", () => {
    expect(isPricesPath("poe1", "poe1/prices/latest.json")).toBe(true);
    for (const p of ["poe2/prices/latest.json", "poe1/prices/x.txt", "poe1/prices/../x.json", "poe1/prices/a b.json", 5, null]) expect(isPricesPath("poe1", p)).toBe(false);
  });
});

describe("which option", () => {
  const opts = optionsFromFiles("poe2", files());
  it("the league wanted, by name", () => expect(chooseOption(opts, "Runes")).toEqual({ option: opts[2], note: null }));
  it("nothing wanted: the main league, no note", () => expect(chooseOption(opts, null)).toEqual({ option: opts[0], note: null }));
  it("a league that is gone: the main league, and a note naming both", () => {
    const r = chooseOption(opts, "Old League");
    expect(r.option).toBe(opts[0]);
    expect(r.note).toContain("Old League");
    expect(r.note).toContain("Covens");
  });
});

// ------------------------------------------------------------------------------------------------ the hub's answers
type Answer = (url: string) => string | Error;
let urls: string[] = [];
const hub = (answer: Answer): void => {
  urls = [];
  setPlatform({
    kind: "web",
    async getText(url: string): Promise<HttpResult> {
      urls.push(url.replace(hubClient.HUB_BASE_URL, ""));
      const a = answer(url);
      if (a instanceof Error) throw a;
      return { ok: true, status: 200, text: a };
    },
  });
};
const prices = (league: string): string => JSON.stringify({ schema_version: 2, league, items: [{ name: league }] });

beforeEach(() => vi.useFakeTimers({ toFake: ["Date"] }));
afterEach(() => vi.useRealTimers());

describe("getLeagues (the index)", () => {
  // the cache of leagues is by game and lasts 5 minutes: each test uses a clock far from the others
  let t = Date.parse("2030-01-01T00:00:00Z");
  const at = (): void => { t += 3600_000; vi.setSystemTime(t); };

  it("reads the index: main / hardcore / events", async () => {
    at();
    hub(() => JSON.stringify(INDEX));
    const r = await getLeagues("poe2");
    expect(r.warning).toBeNull();
    expect(r.options.map((o) => o.label)).toEqual(["Covens", "HC Covens", "Runes", "Other"]);
    expect(urls).toEqual(["/poe2/prices/index.json"]);
  });
  it("is kept 5 minutes, then asked again", async () => {
    at();
    hub(() => JSON.stringify(INDEX));
    await getLeagues("poe2");
    t += 4 * 60_000; vi.setSystemTime(t);
    await getLeagues("poe2");
    expect(urls).toHaveLength(1);
    t += 2 * 60_000; vi.setSystemTime(t);
    await getLeagues("poe2");
    expect(urls).toHaveLength(2);
  });
  it("the index cannot be had: the main league only, and the warning says why", async () => {
    at();
    hub(() => new Error("offline"));
    const r = await getLeagues("poe1");
    expect(r.options).toEqual(mainOnly("poe1"));
    expect(r.warning).toContain("ใช้ลีกหลักอย่างเดียว");
    expect(r.warning).toContain("offline");
  });
  it("a failure is not kept: the next call asks again", async () => {
    at();
    hub(() => new Error("offline"));
    await getLeagues("poe1");
    hub(() => JSON.stringify({ ...INDEX, main: { league: "M1", path: "poe1/prices/latest.json" }, hardcore: null, events: [] }));
    const r = await getLeagues("poe1");
    expect(r.warning).toBeNull();
    expect(r.options.map((o) => o.label)).toEqual(["M1"]);
  });
  it.each([["a schema_version this program does not know", { ...INDEX, schema_version: 9 }], ["no schema_version", { main: INDEX.main }]])("%s: the main league only", async (_n, body) => {
    at();
    hub(() => JSON.stringify(body));
    const r = await getLeagues("poe2");
    expect(r.options).toEqual(mainOnly("poe2"));
    expect(r.warning).toContain("schema_version");
  });
  it("not JSON: the main league only", async () => {
    at();
    hub(() => "<html>");
    expect((await getLeagues("poe2")).options).toEqual(mainOnly("poe2"));
  });
  it("each game has its own list", async () => {
    at();
    hub((u) => (u.includes("/poe1/") ? JSON.stringify({ schema_version: 1, main: { league: "One", path: "poe1/prices/latest.json" } }) : JSON.stringify(INDEX)));
    expect((await getLeagues("poe1")).options.map((o) => o.label)).toEqual(["One"]);
    expect((await getLeagues("poe2")).options).toHaveLength(4);
  });
});

describe("getHub (a league's file)", () => {
  let t = Date.parse("2031-01-01T00:00:00Z");
  const at = (): void => { t += 3600_000; vi.setSystemTime(t); };
  const byPath = (u: string): string => prices(u.endsWith("hardcore/latest.json") ? "hardcore" : u.includes("/events/") ? "event" : "main");

  it("each league's file is its own: main, hardcore, event", async () => {
    at();
    hub(byPath);
    expect((await getHub("poe2")).league).toBe("main");
    expect((await getHub("poe2", "poe2/prices/hardcore/latest.json")).league).toBe("hardcore");
    expect((await getHub("poe2", "poe2/prices/events/runes.json")).league).toBe("event");
    expect(urls).toEqual(["/poe2/prices/latest.json", "/poe2/prices/hardcore/latest.json", "/poe2/prices/events/runes.json"]);
  });
  it("the cache is by path: switching back and forth never returns another league's data", async () => {
    at();
    hub(byPath);
    for (const p of ["poe2/prices/latest.json", "poe2/prices/hardcore/latest.json", "poe2/prices/latest.json", "poe2/prices/hardcore/latest.json"]) {
      expect((await getHub("poe2", p)).league).toBe(p.includes("hardcore") ? "hardcore" : "main");
    }
    expect(urls).toEqual(["/poe2/prices/latest.json", "/poe2/prices/hardcore/latest.json"]); // one request per file; the other two from the cache
  });
  it("is kept 5 minutes, then asked again", async () => {
    at();
    hub(byPath);
    await getHub("poe2", "poe2/prices/events/five.json");
    t += 4 * 60_000; vi.setSystemTime(t);
    await getHub("poe2", "poe2/prices/events/five.json");
    expect(urls).toHaveLength(1);
    t += 2 * 60_000; vi.setSystemTime(t);
    await getHub("poe2", "poe2/prices/events/five.json");
    expect(urls).toHaveLength(2);
  });
  it("a file that cannot be had throws (no list); it is not answered with another league's", async () => {
    at();
    hub((u) => (u.includes("hardcore") ? new Error("HTTP 404") : prices("main")));
    await expect(getHub("poe2", "poe2/prices/hardcore/latest.json")).rejects.toThrow("hub fetch failed");
    expect((await getHub("poe2")).league).toBe("main");
  });
  it("the schema guard covers every league's file", async () => {
    at();
    hub(() => JSON.stringify({ schema_version: 3, league: "x", items: [] }));
    for (const p of ["poe2/prices/latest.json", "poe2/prices/hardcore/latest.json", "poe2/prices/events/runes-old.json"]) {
      await expect(getHub("poe2", p)).rejects.toThrow("hub schema mismatch");
    }
    hub(() => JSON.stringify({ league: "x", items: [] }));
    await expect(getHub("poe2", "poe2/prices/events/no-schema.json")).rejects.toThrow("hub schema mismatch");
  });
  it("a path that is not a prices file of the game is refused before any request", async () => {
    at();
    hub(() => prices("x"));
    for (const p of ["poe1/prices/latest.json", "poe2/meta/latest.json", "poe2/prices/../meta/latest.json", "https://evil.example/x.json"]) {
      await expect(getHub("poe2", p)).rejects.toThrow("hub path not allowed");
    }
    expect(urls).toEqual([]);
  });
});
