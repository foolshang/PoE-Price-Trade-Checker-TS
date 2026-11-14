/** GGG's item names (the real-name check): the bare list of 1.0.0, and the format-2 object an earlier 1.0.1 build left in the cache. */
import { describe, expect, it } from "vitest";
import { tradeNames } from "../src/index.ts";
import type { FsPort, HttpPort } from "../src/ports.ts";

const many = (n: number): string[] => Array.from({ length: n }, (_, i) => `Name ${i}`);
const payload = (names: string[]): string => JSON.stringify({ result: [{ id: "currency", entries: names.map((type) => ({ type })) }] });

function env(files: Record<string, { text: string; mtime: number }>, http: () => string, now = 1_000_000_000) {
  const written: Record<string, string> = {};
  const fs = {
    join: (...p: string[]) => p.join("/"),
    exists: async (p: string) => p in files,
    readText: async (p: string) => files[p].text,
    writeText: async (p: string, t: string) => { written[p] = t; files[p] = { text: t, mtime: now }; },
    mkdirp: async () => {},
    mtimeSec: async (p: string) => files[p].mtime,
  } as unknown as FsPort;
  const calls: string[] = [];
  const h: HttpPort = { getText: async (u) => { calls.push(u); return http(); } };
  return { e: { fs, http: h, now: () => now }, written, calls };
}
const FILE = "c/trade_items_poe1.json";
const DAY = 86400;

describe("parseNameList", () => {
  it("a bare list (1.0.0)", () => expect([...tradeNames.parseNameList(["b", "a", "a", "", 5])!].sort()).toEqual(["a", "b"]));
  it("format 2: the names of every group (an earlier 1.0.1 cache)", () => {
    expect([...tradeNames.parseNameList({ format: 2, groups: { currency: ["x", "y"], card: ["y", "z"] }, assigned: { x: "Currency" } })!].sort()).toEqual(["x", "y", "z"]);
  });
  it.each([[null], [{}], [{ format: 3, groups: {} }], [{ format: 2 }], [[]], [{ format: 2, groups: {} }], ["text"]])("%j is not a names file", (raw) => expect(tradeNames.parseNameList(raw)).toBeNull());
});

describe("getNames and the cache", () => {
  const live = many(600);
  it("no cache: GGG's payload, written as the bare list of 1.0.0", async () => {
    const { e, written, calls } = env({}, () => payload(live));
    const names = await tradeNames.getNames("poe1", "c", e);
    expect(names.size).toBe(600);
    expect(calls).toHaveLength(1);
    expect(JSON.parse(written[FILE])).toEqual([...live].sort());
  });
  it("a fresh format-2 cache is read without a request and does not crash", async () => {
    const f2 = JSON.stringify({ format: 2, groups: { currency: live.slice(0, 400), map: live.slice(300) }, assigned: {} });
    const { e, calls, written } = env({ [FILE]: { text: f2, mtime: 1_000_000_000 - DAY } }, () => { throw new Error("no request expected"); });
    expect((await tradeNames.getNames("poe1", "c", e)).size).toBe(600);
    expect(calls).toHaveLength(0);
    expect(written).toEqual({});
  });
  it("a due format-2 cache is replaced by the bare list from GGG", async () => {
    const f2 = JSON.stringify({ format: 2, groups: { currency: ["old"] }, assigned: {} });
    const { e, written } = env({ [FILE]: { text: f2, mtime: 1_000_000_000 - 8 * DAY } }, () => payload(live));
    expect((await tradeNames.getNames("poe1", "c", e)).size).toBe(600);
    expect(Array.isArray(JSON.parse(written[FILE]))).toBe(true);
  });
  it("GGG down: the due cache of either form still gives its names, and is not deleted or rewritten", async () => {
    for (const text of [JSON.stringify(live), JSON.stringify({ format: 2, groups: { currency: live }, assigned: {} })]) {
      const { e, written } = env({ [FILE]: { text, mtime: 1_000_000_000 - 8 * DAY } }, () => { throw new Error("down"); });
      expect((await tradeNames.getNames("poe1", "c", e)).size).toBe(600);
      expect(written).toEqual({});
    }
  });
  it("a cache that is not JSON: no crash, GGG's list is used", async () => {
    const { e } = env({ [FILE]: { text: "{{{", mtime: 1_000_000_000 } }, () => payload(live));
    expect((await tradeNames.getNames("poe1", "c", e)).size).toBe(600);
  });
});
