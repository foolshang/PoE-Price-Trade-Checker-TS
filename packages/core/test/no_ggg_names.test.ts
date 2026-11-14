/**
 * GGG's item list is only the "second opinion" on names: a name that GGG lists but neither the hub nor NeverSink has must never be written
 * into a filter, however the player sets the tiers. (3.30: the removed Scarabs are still in GGG's trade data and the game rejects them:
 * "No base types found matching ...", and one unknown name makes it refuse the whole filter.)
 */
import { describe, expect, it } from "vitest";
import { filterGen, filterWhitelist as w } from "../src/index.ts";
import { data } from "./helpers.ts";

/** every name inside a `BaseType` line of the filter */
function baseTypeNames(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*BaseType\s*(?:==)?\s*(.*)$/);
    if (m) for (const q of m[1].matchAll(/"([^"]+)"/g)) out.push(q[1]);
  }
  return out;
}

describe.each(["poe1", "poe2"])("%s: a tier for every category writes only names of the hub or NeverSink", (game) => {
  const [hub, base] = data(game);
  // what GGG's list has on top: removed Scarabs, a fragment nobody knows, a card, a currency (all unknown to the hub and NeverSink)
  const invented = ["Zzz Test Scarab", "Zzz Test Scarab of Nothing", "Zzz Curio Primordial Fragment", "Zzz Test Breachstone", "Zzz The Invented Card", "Zzz Test Orb"];
  const cats: Record<string, string> = {};
  for (const c of filterGen.WHITELIST_CATEGORIES[game]) cats[c] = "B";
  const cfg = { [`wl_cat_tier_${game}`]: cats };

  it("the lists do not contain a GGG-only name", () => {
    const names = w.universe(game, hub, base);
    for (const n of invented) expect(names.has(n)).toBe(false);
  });

  it("Generate with every category on B: no invented GGG name in any BaseType line, and every name is of the hub or NeverSink", () => {
    const res = w.buildWhitelistFilter(game, cfg, base, hub, "", null, invented);
    const written = baseTypeNames(res.text);
    expect(written.length).toBeGreaterThan(500);
    for (const n of invented) expect(written).not.toContain(n);
    const fromBase = new Set([...base.matchAll(/"([^"]+)"/g)].map((m) => m[1]));
    const fromHub = new Set<string>();
    for (const it of filterGen.iterHubItems(hub)) fromHub.add(String(it.name ?? "").trim());
    // (unique bases come from the hub's unique items: their `base` field)
    const hubText = JSON.stringify(hub);
    const strangers = written.filter((n) => !fromBase.has(n) && !fromHub.has(n) && !hubText.includes(JSON.stringify(n)));
    expect(strangers).toEqual([]);
  });
});
