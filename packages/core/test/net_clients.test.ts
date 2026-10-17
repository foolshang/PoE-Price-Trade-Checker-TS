/** hub_client league routing / chaos value (test_hub_client.py) and the NeverSink fetch + cache (test_neversink_source.py) */
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { NodeFs } from "../../node/src/nodefs.ts";
import { HttpError, HttpPort, hubClient, neversinkSource } from "../src/index.ts";

const fsx = new NodeFs({ eol: "lf" });
const tmp = (): string => mkdtempSync(path.join(os.tmpdir(), "poe-ts-"));

/** HttpPort whose answers come from a function of the url */
const http = (f: (url: string) => string | Error): HttpPort & { urls: string[] } => {
  const urls: string[] = [];
  return {
    urls,
    async getText(url: string): Promise<string> {
      urls.push(url);
      const r = f(url);
      if (r instanceof Error) throw r;
      return r;
    },
  };
};
const DOWN = http(() => new Error("network down"));

// ------------------------------------------------------------------------------------------------ hub_client

const index = (over: Record<string, any> = {}) => ({
  schema_version: 1, generated_at: "2026-07-13T15:32:25Z",
  main: { league: "Mirage", path: "poe1/prices/latest.json", generated_at: "2026-07-13T15:30:41Z" }, events: [],
  hardcore: { league: "Hardcore Mirage", path: "poe1/prices/hardcore/latest.json", generated_at: "2026-07-13T15:32:21Z" }, ...over,
});

describe("hub_client", () => {
  it("get_league_files with hardcore and an event", async () => {
    const idx = index({ events: [{ league: "Ancestors", path: "poe1/prices/events/ancestors.json", generated_at: "2026-07-13T15:31:33Z" }] });
    const result = await new hubClient.HubClient(http(() => JSON.stringify(idx))).getLeagueFiles("poe1");
    expect(result.main).toEqual({ league: "Mirage", path: "poe1/prices/latest.json" });
    expect(result.hardcore).toEqual({ league: "Hardcore Mirage", path: "poe1/prices/hardcore/latest.json" });
    expect(result.events).toEqual([{ league: "Ancestors", path: "poe1/prices/events/ancestors.json" }]);
  });

  it("a null hardcore falls back to null", async () => {
    const result = await new hubClient.HubClient(http(() => JSON.stringify(index({ hardcore: null })))).getLeagueFiles("poe2");
    expect(result.hardcore).toBeNull();
    expect(result.main.league).toBe("Mirage");
  });

  it("an unavailable index falls back to the latest.json league field", async () => {
    const h = http((url) => {
      if (url.endsWith("index.json")) return new HttpError(404, url);
      expect(url.endsWith("poe2/prices/latest.json")).toBe(true);
      return JSON.stringify({ schema_version: 2, league: "Runes of Aldur", currency: [], items: [] });
    });
    const result = await new hubClient.HubClient(h).getLeagueFiles("poe2");
    expect(result.main).toEqual({ league: "Runes of Aldur", path: "poe2/prices/latest.json" });
    expect(result.hardcore).toBeNull();
    expect(result.events).toEqual([]);
  });

  it("totally unreachable returns a null league", async () => {
    const result = await new hubClient.HubClient(DOWN).getLeagueFiles("poe1");
    expect(result.main.league).toBeNull();
    expect(result.hardcore).toBeNull();
    expect(result.events).toEqual([]);
  });

  it("get_index returns null on failure, not a throw", async () => expect(await new hubClient.HubClient(DOWN).getIndex("poe1")).toBeNull());

  it("get_prices fetches the exact path", async () => {
    const h = http(() => JSON.stringify({ league: "Mirage" }));
    const data = await new hubClient.HubClient(h).getPrices("poe1/prices/hardcore/latest.json");
    expect(h.urls).toEqual(["https://storage.googleapis.com/poe-data-hub/poe1/prices/hardcore/latest.json"]);
    expect(data.league).toBe("Mirage");
  });

  it("a hub HTTP error says so", async () => {
    await expect(new hubClient.HubClient(http((u) => new HttpError(404, u))).getPrices("x.json")).rejects.toThrow("hub HTTP 404");
  });

});

// ------------------------------------------------------------------------------------------------ neversink_source

const env = (h: HttpPort, nowMs = () => Date.now()) => ({ fs: fsx, http: h, nowMs });
const ago = (hours: number): string => new Date(Date.now() - hours * 3600_000).toISOString();

describe("neversink_source", () => {
  it("totally unreachable returns nothing", async () => {
    expect(await neversinkSource.fetchBaseFilter("poe2", 2, tmp(), env(DOWN))).toEqual([null, null]);
  });

  it("get_latest_tag parses tag_name", async () => {
    expect(await neversinkSource.getLatestTag("poe2", { http: http(() => JSON.stringify({ tag_name: "0.10.3", assets: [] })) })).toBe("0.10.3");
  });

  it("get_latest_tag of an unknown game is null", async () => expect(await neversinkSource.getLatestTag("poe3", { http: DOWN })).toBeNull());
  it("get_latest_tag on a network failure is null", async () => expect(await neversinkSource.getLatestTag("poe1", { http: DOWN })).toBeNull());

  it("downloads and caches", async () => {
    const t = tmp();
    const h = http((url) => (url.includes("api.github.com") ? JSON.stringify({ tag_name: "1.0.0" }) : 'Show\n    BaseType == "Chaos Orb"\n'));
    const [text, tag] = await neversinkSource.fetchBaseFilter("poe2", 2, t, env(h));
    expect(tag).toBe("1.0.0");
    expect(text).toContain("Chaos Orb");
    expect(existsSync(path.join(t, "neversink", "poe2", "1.0.0_2.filter"))).toBe(true);
  });

  it("skips the GitHub check within a day", async () => {
    const t = tmp();
    const dir = path.join(t, "neversink", "poe2");
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "last_check.json"), JSON.stringify({ tag: "1.0.0", checked_at: new Date().toISOString() }));
    writeFileSync(path.join(dir, "1.0.0_2.filter"), "cached text");
    const h = http(() => new Error("must not be called"));
    const [text, tag] = await neversinkSource.fetchBaseFilter("poe2", 2, t, env(h));
    expect(h.urls).toEqual([]);
    expect(text).toBe("cached text");
    expect(tag).toBe("1.0.0");
  });

  it("force bypasses the daily cache", async () => {
    const t = tmp();
    const dir = path.join(t, "neversink", "poe2");
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "last_check.json"), JSON.stringify({ tag: "1.0.0", checked_at: new Date().toISOString() }));
    writeFileSync(path.join(dir, "1.0.0_2.filter"), "old text");
    const h = http((url) => (url.includes("api.github.com") ? JSON.stringify({ tag_name: "2.0.0" }) : "new text"));
    const [text, tag] = await neversinkSource.fetchBaseFilter("poe2", 2, t, env(h), true);
    expect(tag).toBe("2.0.0");
    expect(text).toBe("new text");
    expect(readFileSync(path.join(dir, "last_check.json"), "utf-8")).toMatch(/"checked_at": "\d{4}-\d\d-\d\dT[\d:.]+\+00:00"/); // like Python's isoformat()
  });

  it("falls back to the disk cache on a network failure", async () => {
    const t = tmp();
    const dir = path.join(t, "neversink", "poe1");
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "last_check.json"), JSON.stringify({ tag: "8.19.2", checked_at: ago(48) }));
    writeFileSync(path.join(dir, "8.19.2_2.filter"), "previously cached");
    const [text, tag] = await neversinkSource.fetchBaseFilter("poe1", 2, t, env(DOWN));
    expect(text).toBe("previously cached");
    expect(tag).toBe("8.19.2");
  });

  it("with no known tag it takes any cached file of that strictness (the latest by name)", async () => {
    const t = tmp();
    const dir = path.join(t, "neversink", "poe1");
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "8.1.0_2.filter"), "older");
    writeFileSync(path.join(dir, "8.9.0_2.filter"), "newer by name");
    writeFileSync(path.join(dir, "9.0.0_3.filter"), "other strictness");
    const [text, tag] = await neversinkSource.fetchBaseFilter("poe1", 2, t, env(DOWN));
    expect([text, tag]).toEqual(["newer by name", "8.9.0"]);
  });
});
