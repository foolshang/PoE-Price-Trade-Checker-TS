/** hub_client league routing / chaos value (test_hub_client.py) and the NeverSink release tag (test_neversink_source.py; the base filter fetch is tested in packages/ui/test) */
import { describe, expect, it } from "vitest";
import { HttpError, HttpPort, hubClient, neversinkSource } from "../src/index.ts";


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
    const h = http(() => JSON.stringify({ schema_version: 2, league: "Mirage" }));
    const data = await new hubClient.HubClient(h).getPrices("poe1/prices/hardcore/latest.json");
    expect(h.urls).toEqual(["https://storage.googleapis.com/poe-data-hub/poe1/prices/hardcore/latest.json"]);
    expect(data.league).toBe("Mirage");
  });

  it("a hub HTTP error says so", async () => {
    await expect(new hubClient.HubClient(http((u) => new HttpError(404, u))).getPrices("x.json")).rejects.toThrow("hub HTTP 404");
  });

});

// ------------------------------------------------------------------------------------------------ neversink_source

describe("neversink_source", () => {
  // the base filter fetch and its cache are tested where they live: packages/ui/test/neversink_fetch.test.ts
  it("get_latest_tag parses tag_name", async () => {
    expect(await neversinkSource.getLatestTag("poe2", { http: http(() => JSON.stringify({ tag_name: "0.10.3", assets: [] })) })).toBe("0.10.3");
  });

  it("get_latest_tag of an unknown game is null", async () => expect(await neversinkSource.getLatestTag("poe3", { http: DOWN })).toBeNull());
  it("get_latest_tag on a network failure is null", async () => expect(await neversinkSource.getLatestTag("poe1", { http: DOWN })).toBeNull());
});
