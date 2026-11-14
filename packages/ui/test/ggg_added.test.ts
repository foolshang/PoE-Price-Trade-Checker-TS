/**
 * The real item names the page loads and the names it adds from GGG's item list (data.ts getNames): the snapshot shipped with the page
 * (format 2 or the old list), the desktop's live list (with or without groups), neither.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { gggNames } from "@poe/core";
import { getNames } from "../src/data.ts";
import { HttpResult, setPlatform } from "../src/platform.ts";

const filler = (n: number): string[] => Array.from({ length: n }, (_, i) => `Filler Armour ${i}`); // (the check wants >= 500 names)
const baseGroups = { currency: ["Chaos Orb", "Old Thing"], armour: filler(600) };
const snapshot = (assigned: Record<string, string> = {}): string => gggNames.snapshotJson(baseGroups, assigned);

const serve = (body: string | null): void => {
  vi.stubGlobal("fetch", async () => (body === null ? { ok: false, status: 404, text: async () => "" } : { ok: true, status: 200, text: async () => body }));
};
const platform = (live: { names: string[]; groups: Record<string, string[]> | null } | null | Error): void => {
  setPlatform({
    kind: "web",
    async getText(): Promise<HttpResult> { return { ok: false, status: 0, text: "" }; },
    ...(live === null ? {} : { getNames: async () => { if (live instanceof Error) throw live; return live; } }),
  });
};
afterEach(() => { vi.unstubAllGlobals(); platform(null); });

describe("getNames", () => {
  it("web page: the snapshot (format 2) gives the names and what the rules add (+ what the snapshot recorded)", async () => {
    serve(gggNames.snapshotJson({ ...baseGroups, card: ["The Doctor"], map: ["Foo Scarab"] }, { "Old Thing": "Currency" }));
    platform(null);
    const r = await getNames("poe1");
    expect(r!.from).toBe("snapshot");
    expect(r!.names).toContain("Chaos Orb");
    expect(r!.added).toEqual({ "The Doctor": "DivinationCard", "Foo Scarab": "Scarab", "Old Thing": "Currency" });
  });

  it("the OLD snapshot (a list of names): the names for the check, nothing added", async () => {
    serve(JSON.stringify(["Chaos Orb", "The Doctor", ...filler(600)]));
    platform(null);
    const r = await getNames("poe1");
    expect(r!.from).toBe("snapshot");
    expect(r!.added).toEqual({});
  });

  it("desktop: GGG's live groups against the shipped snapshot: a name the snapshot lacks is new, one it has is old", async () => {
    serve(snapshot());
    const groups = { currency: ["Chaos Orb", "Old Thing", "Brand New Thing", "Fresh Oil"], armour: filler(600) };
    platform({ names: Object.values(groups).flat(), groups });
    const r = await getNames("poe1");
    expect(r!.from).toBe("live");
    expect(r!.added).toEqual({ "Brand New Thing": "Currency", "Fresh Oil": "Oil" });
  });

  it("desktop with a cache of the old form (no groups): the shipped snapshot's own groups are used", async () => {
    serve(gggNames.snapshotJson({ ...baseGroups, card: ["The Doctor"] }, {}));
    platform({ names: ["Chaos Orb", ...filler(600)], groups: null });
    const r = await getNames("poe1");
    expect(r!.from).toBe("live");
    expect(r!.added).toEqual({ "The Doctor": "DivinationCard" });
  });

  it("desktop with no snapshot to compare with: only the rules (nothing counts as new)", async () => {
    serve(null);
    const groups = { currency: ["Fresh Oil", "Brand New Thing"], armour: filler(600) };
    platform({ names: Object.values(groups).flat(), groups });
    const r = await getNames("poe1");
    expect(r!.from).toBe("live");
    expect(r!.added).toEqual({ "Fresh Oil": "Oil" });
  });

  it("live list too short or failing: the snapshot; nothing at all: null", async () => {
    serve(snapshot());
    platform({ names: ["a", "b"], groups: {} });
    expect((await getNames("poe1"))!.from).toBe("snapshot");
    platform(new Error("ipc"));
    expect((await getNames("poe1"))!.from).toBe("snapshot");
    serve(null);
    expect(await getNames("poe1")).toBeNull();
    serve("not json");
    expect(await getNames("poe1")).toBeNull();
  });
});
