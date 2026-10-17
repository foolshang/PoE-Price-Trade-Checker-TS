/**
 * Parity with the ORIGINAL Python program: the same cases (tests/parity/cases) run through the TypeScript core must give
 * exactly what the original gave (tests/parity/golden, made by tools/parity/gen_golden.py). Texts are compared by sha256
 * (every byte); a difference prints the first differing line of the text when the full golden text is at hand.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { Case, ROOT, Sink, plain, runCase } from "./runner.ts";

const CASES = path.join(ROOT, "tests", "parity", "cases");
const GOLDEN = path.join(ROOT, "tests", "parity", "golden");
const CACHE = path.join(ROOT, ".parity-cache", "texts");

function goldenText(key: string): string | null {
  const f = key.replaceAll("/", "__") + ".txt";
  if (existsSync(path.join(CACHE, f))) return readFileSync(path.join(CACHE, f), "utf-8");
  if (existsSync(path.join(GOLDEN, "texts", f + ".gz"))) return gunzipSync(readFileSync(path.join(GOLDEN, "texts", f + ".gz"))).toString("utf-8");
  return null;
}

/** every {$text} in `a` that differs from `b`, as "<path>" */
function textDiffs(a: any, b: any, at = ""): string[] {
  if (a && typeof a === "object" && "$text" in a) return !b || b.$text !== a.$text ? [at] : [];
  if (Array.isArray(a) && Array.isArray(b)) return a.flatMap((x, i) => textDiffs(x, b[i], `${at}[${i}]`));
  if (a && typeof a === "object" && b && typeof b === "object") return Object.keys(a).flatMap((k) => textDiffs(a[k], b[k], `${at}.${k}`));
  return [];
}

function firstDiff(want: string, got: string): string {
  const a = want.split("\n"), b = got.split("\n");
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i] !== b[i]) return `line ${i + 1}:\n  original: ${JSON.stringify(a[i])}\n  new:      ${JSON.stringify(b[i])}`;
  }
  return "same lines (differs in line endings or trailing bytes)";
}

for (const file of readdirSync(CASES).filter((f) => f.endsWith(".json")).sort()) {
  const group = file.replace(/\.json$/, "");
  const cases: Case[] = JSON.parse(readFileSync(path.join(CASES, file), "utf-8"));
  const golden: Record<string, any> = JSON.parse(readFileSync(path.join(GOLDEN, file), "utf-8"));
  describe(`parity ${group}`, () => {
    it("has a golden for every case", () => {
      expect(cases.map((c) => c.id).sort()).toEqual(Object.keys(golden).sort());
    });
    it.each(cases.map((c) => [c.id, c] as const))("%s", async (_id, c) => {
      Sink.texts = new Map();
      const out = plain(await runCase(c));
      const want = golden[c.id];
      try {
        expect(out).toEqual(want);
      } catch (e) {
        const diffs = textDiffs(out, want);
        let hint = "";
        for (const d of diffs.slice(0, 3)) {
          const m = /^(?:\.[\w$]+|\[\d+\])*$/.test(d) ? d : d;
          hint += `\ntext at ${m || "(root)"} differs`;
          const key = [...Sink.texts.keys()].find((k) => k.startsWith(c.id + "."));
          const orig = key ? goldenText(key) : null;
          if (key && orig !== null) hint += `\n${key}: ${firstDiff(orig, Sink.texts.get(key)!)}`;
        }
        if (hint) (e as Error).message += `\n${hint}`;
        throw e;
      }
    });
  });
}
