/**
 * The NeverSink base filter as the programs fetch it: packages/ui/src/data.ts fetchBase + nsLatestTag (GitHub tag, raw file, cache in the
 * page's store). Same cases the core-side fetchBaseFilter had (test_neversink_source.py), run on the code that is really used.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { StoreBackend, setStoreBackend } from "../src/storage.ts";
import { HttpResult, setPlatform } from "../src/platform.ts";
import { fetchBase, nsLast, nsLatestTag } from "../src/data.ts";

const mem = new Map<string, string>();
const backend: StoreBackend = {
  get: (k) => (mem.has(k) ? mem.get(k)! : null),
  set: (k, v) => { mem.set(k, v); return true; },
  del: (k) => { mem.delete(k); },
  keys: () => [...mem.keys()],
};

let urls: string[] = [];
type Answer = (url: string) => string | Error;
const net = (answer: Answer): void => {
  urls = [];
  setPlatform({
    kind: "web",
    async getText(url: string): Promise<HttpResult> {
      urls.push(url);
      const a = answer(url);
      if (a instanceof Error) throw a;
      return { ok: true, status: 200, text: a };
    },
  });
};
const DOWN: Answer = () => new Error("offline");
const hoursAgo = (h: number): string => new Date(Date.now() - h * 3600_000).toISOString();
const textKey = (g: string, tag: string, s: number): string => `poeFilterGen.ns.text.${g}|${tag}|${s}`;
const lastKey = (g: string): string => `poeFilterGen.ns.last.${g}`;

beforeEach(() => {
  mem.clear();
  setStoreBackend(backend);
});

describe("NeverSink base filter (ui/data.ts)", () => {
  it("totally unreachable returns nothing", async () => {
    net(DOWN);
    expect(await fetchBase("poe2", 2, false)).toEqual([null, null]);
  });

  it("the latest tag is tag_name; an unknown game or a failure is null", async () => {
    net(() => JSON.stringify({ tag_name: "0.10.3", assets: [] }));
    expect(await nsLatestTag("poe2")).toBe("0.10.3");
    net(DOWN);
    expect(await nsLatestTag("poe3")).toBeNull();
    expect(await nsLatestTag("poe1")).toBeNull();
  });

  it("downloads and caches", async () => {
    net((url) => (url.includes("api.github.com") ? JSON.stringify({ tag_name: "1.0.0" }) : 'Show\n    BaseType == "Chaos Orb"\n'));
    const [text, tag] = await fetchBase("poe2", 2, false);
    expect(tag).toBe("1.0.0");
    expect(text).toContain("Chaos Orb");
    expect(mem.get(textKey("poe2", "1.0.0", 2))).toBe(text);
    expect(nsLast("poe2").tag).toBe("1.0.0");
  });

  it("skips the GitHub check within a day", async () => {
    mem.set(lastKey("poe2"), JSON.stringify({ tag: "1.0.0", checked_at: new Date().toISOString() }));
    mem.set(textKey("poe2", "1.0.0", 2), "cached text");
    net(() => new Error("must not be called"));
    expect(await fetchBase("poe2", 2, false)).toEqual(["cached text", "1.0.0"]);
    expect(urls).toEqual([]);
  });

  it("force bypasses the daily cache", async () => {
    mem.set(lastKey("poe2"), JSON.stringify({ tag: "1.0.0", checked_at: new Date().toISOString() }));
    mem.set(textKey("poe2", "1.0.0", 2), "old text");
    net((url) => (url.includes("api.github.com") ? JSON.stringify({ tag_name: "2.0.0" }) : "new text"));
    expect(await fetchBase("poe2", 2, true)).toEqual(["new text", "2.0.0"]);
    expect(JSON.parse(mem.get(lastKey("poe2"))!).tag).toBe("2.0.0");
    expect(Number.isNaN(Date.parse(JSON.parse(mem.get(lastKey("poe2"))!).checked_at))).toBe(false);
    expect(mem.has(textKey("poe2", "1.0.0", 2))).toBe(false); // a newer tag replaces the older text
  });

  it("falls back to the cache on a network failure", async () => {
    mem.set(lastKey("poe1"), JSON.stringify({ tag: "8.19.2", checked_at: hoursAgo(48) }));
    mem.set(textKey("poe1", "8.19.2", 2), "previously cached");
    net(DOWN);
    expect(await fetchBase("poe1", 2, false)).toEqual(["previously cached", "8.19.2"]);
  });

  it("with no known tag it takes any cached text of that strictness (the latest by name)", async () => {
    mem.set(textKey("poe1", "8.1.0", 2), "older");
    mem.set(textKey("poe1", "8.9.0", 2), "newer by name");
    mem.set(textKey("poe1", "9.0.0", 3), "other strictness");
    net(DOWN);
    expect(await fetchBase("poe1", 2, false)).toEqual(["newer by name", "8.9.0"]);
  });
});
