/**
 * Mod text -> stat id (packages/core/src/stat_match.ts):
 *  1 hubOnly: the hub's ModNormalizer rules, value for value, on a corpus of 120,000 (kind, text) pairs made by
 *    tools/stat-match/gen_hub_golden.py from the hub's own code - proves the port;
 *  2 the program's matching (the hub's rules + RePoE veto) differs from the hub on a short, pinned list of texts;
 *  3 against RePoE as the ground truth: a text may stay without an id, it must never get a WRONG one.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { AliasIndex } from "../../packages/core/src/rendering_aliases.ts";
import { StatMatcher } from "../../packages/core/src/stat_match.ts";
import { flattenStats } from "../../packages/core/src/mod_db.ts";

const FIX = path.resolve(import.meta.dirname, "fixtures", "stat_match");
const load = (name: string): any => JSON.parse(gunzipSync(readFileSync(path.join(FIX, name))).toString("utf-8"));
const NL = String.fromCharCode(10);

function matcherFor(game: string, withAliases: boolean): StatMatcher {
  const m = new StatMatcher();
  m.build(flattenStats(load(`stats_${game}.json.gz`)));
  if (withAliases) m.setAliases(new AliasIndex(load(`aliases_${game}.json.gz`)));
  return m;
}

type Hit = [string, string, number[]];

/** the hub's ModNormalizer.normalize: the whole block first, then line by line when every line maps */
function normalizeLikeHub(m: StatMatcher, rawText: string, kind: string, hubOnly: boolean): Hit[] {
  const text = rawText.replace(/^\n+|\n+$/g, "");
  if (!text) return [];
  const whole = m.match(text, kind, hubOnly);
  if (whole) return [[whole.statId, whole.template, whole.values]];
  const lines = text.split(NL);
  if (lines.length > 1) {
    const parts = lines.map((l) => m.match(l, kind, hubOnly));
    if (parts.every((p) => p !== null)) return parts.map((p) => [p!.statId, p!.template, p!.values]);
  }
  return [];
}

/** a template with every number collapsed, to compare wordings */
const skeleton = (t: string | undefined): string => (t ?? "(none)").replace(/[+-]?(?:\d+(?:\.\d+)?|#)/g, "#");

for (const game of ["poe1", "poe2"]) {
  describe(`stat matching ${game}`, () => {
    it("hubOnly: the hub's answer for every text of the corpus (stat id, template and values)", () => {
      const m = matcherFor(game, true);
      const corpus: [string, string, Hit[]][] = load(`corpus_${game}.json.gz`);
      const bad: string[] = [];
      let mapped = 0;
      for (const [kind, text, want] of corpus) {
        const got = normalizeLikeHub(m, text, kind, true);
        if (want.length) mapped++;
        if (JSON.stringify(got) !== JSON.stringify(want)) bad.push(`[${kind}] ${JSON.stringify(text)}${NL}   hub: ${JSON.stringify(want)}${NL}   new: ${JSON.stringify(got)}`);
      }
      expect(corpus.length).toBeGreaterThan(50000);
      expect(mapped).toBeGreaterThan(10000);
      expect(bad.slice(0, 8).join(NL)).toBe("");
    });

    it("the program's matching differs from the hub on a pinned, short list (RePoE vetoes a rule)", () => {
      const m = matcherFor(game, true);
      const corpus: [string, string, Hit[]][] = load(`corpus_${game}.json.gz`);
      const diff: string[] = [];
      for (const [kind, text, want] of corpus) {
        const got = normalizeLikeHub(m, text, kind, false);
        if (JSON.stringify(got.map((h) => h[0])) !== JSON.stringify(want.map((h) => h[0]))) {
          diff.push(`[${kind}] ${JSON.stringify(text)}: hub ${want.map((h) => h[0]).join(",") || "-"} -> ${got.map((h) => h[0]).join(",") || "-"}`);
        }
      }
      console.log(`[stat-match ${game}] ${diff.length} of the ${corpus.length} corpus texts differ from the hub:${NL}${diff.slice(0, 40).join(NL)}`);
      expect(diff.length).toBeLessThanOrEqual(game === "poe1" ? 60 : 5);
    });

    it.each([["without the aliases (hub rules only)", false, true], ["the program's matching, with the hub's aliases", true, false]] as const)("RePoE ground truth, %s", (name, withAliases, hubOnly) => {
      const m = matcherFor(game, withAliases);
      const truth: [string, string, string[]][] = load(`truth_${game}.json.gz`);
      let right = 0, same = 0, notFound = 0;
      const wrong: string[] = [];
      for (const [kind, text, nums] of truth) {
        const r = m.match(text, kind, hubOnly);
        if (r === null) { notFound++; continue; }
        if (nums.includes(r.statId.slice(r.statId.lastIndexOf("_") + 1))) { right++; continue; }
        // another id of the SAME template text (GGG's indexable_* ids next to the numeric ones): the same stat searched by another name
        if (nums.some((n) => skeleton(m.templateOfId(kind, `${kind}.stat_${n}`)) === skeleton(r.template))) { same++; continue; }
        wrong.push(`[${kind}] ${JSON.stringify(text)} -> ${r.statId} (${r.rule}) ${JSON.stringify(r.template)}; RePoE: ${nums.join(",")}`);
      }
      console.log(`[stat-match ${game} ${name}] truth ${truth.length}: right ${right}, same wording other id ${same}, no id ${notFound}, WRONG ${wrong.length}${NL}${wrong.join(NL)}`);
      // the hub rules alone are wrong 3 times in poe1 (documented above); the program's matching must be at 0
      if (!hubOnly) expect(wrong.join(NL)).toBe("");
      else expect(wrong.length).toBeLessThanOrEqual(game === "poe1" ? 3 : 0);
    });
  });
}
