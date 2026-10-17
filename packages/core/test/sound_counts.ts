import * as filterGen from "../src/filter_gen.ts";

/** {PlayAlertSound id: number of Show blocks that play it} of a NeverSink filter (a check on the sound rewrite, not product code). */
export function soundBlockCounts(baseText: string): Record<string, number> {
  const lines = baseText.split("\n");
  const out = new Map<string, number>();
  for (const b of filterGen.parseBlocks(lines)) {
    if (b.blockType !== "Show") continue;
    const i = filterGen.soundIdOf(lines.slice(b.start + 1, b.end));
    if (i !== null) out.set(i, (out.get(i) ?? 0) + 1);
  }
  return Object.fromEntries(out);
}
