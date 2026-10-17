/**
 * Python's `difflib.SequenceMatcher` and `difflib.get_close_matches`, line by line (CPython 3.12), because the fuzzy matches of
 * the mod / item name databases must pick the same candidate as the original. Sequences are strings compared by code point.
 */
import { cmpStr } from "./py.ts";

interface Match { a: number; b: number; size: number }

export class SequenceMatcher {
  private a: string[] = [];
  private b: string[] = [];
  private b2j = new Map<string, number[]>();
  private bjunk = new Set<string>();
  private fullbcount: Map<string, number> | null = null;
  private matchingBlocks: Match[] | null = null;

  constructor(private autojunk = true) {}

  setSeq1(a: string): void {
    this.a = Array.from(a);
    this.matchingBlocks = null;
  }

  setSeq2(b: string): void {
    this.b = Array.from(b);
    this.matchingBlocks = null;
    this.fullbcount = null;
    this.chainB();
  }

  private chainB(): void {
    const b = this.b;
    this.b2j = new Map();
    for (let i = 0; i < b.length; i++) {
      const elt = b[i];
      const idxs = this.b2j.get(elt);
      if (idxs) idxs.push(i);
      else this.b2j.set(elt, [i]);
    }
    this.bjunk = new Set();
    const n = b.length;
    if (this.autojunk && n >= 200) {
      const ntest = Math.floor(n / 100) + 1;
      const popular: string[] = [];
      for (const [elt, idxs] of this.b2j) if (idxs.length > ntest) popular.push(elt);
      for (const elt of popular) this.b2j.delete(elt);
    }
  }

  private findLongestMatch(alo: number, ahi: number, blo: number, bhi: number): Match {
    const { a, b, b2j, bjunk } = this;
    let besti = alo, bestj = blo, bestsize = 0;
    let j2len = new Map<number, number>();
    for (let i = alo; i < ahi; i++) {
      const newj2len = new Map<number, number>();
      for (const j of b2j.get(a[i]) ?? []) {
        if (j < blo) continue;
        if (j >= bhi) break;
        const k = (j2len.get(j - 1) ?? 0) + 1;
        newj2len.set(j, k);
        if (k > bestsize) {
          besti = i - k + 1;
          bestj = j - k + 1;
          bestsize = k;
        }
      }
      j2len = newj2len;
    }
    // extend the best match by equal elements on each end (no element is junk here; popular ones are only left out of b2j)
    while (besti > alo && bestj > blo && !bjunk.has(b[bestj - 1]) && a[besti - 1] === b[bestj - 1]) {
      besti--; bestj--; bestsize++;
    }
    while (besti + bestsize < ahi && bestj + bestsize < bhi && !bjunk.has(b[bestj + bestsize]) && a[besti + bestsize] === b[bestj + bestsize]) {
      bestsize++;
    }
    return { a: besti, b: bestj, size: bestsize };
  }

  getMatchingBlocks(): Match[] {
    if (this.matchingBlocks) return this.matchingBlocks;
    const la = this.a.length, lb = this.b.length;
    const queue: [number, number, number, number][] = [[0, la, 0, lb]];
    const blocks: Match[] = [];
    while (queue.length) {
      const [alo, ahi, blo, bhi] = queue.pop()!;
      const x = this.findLongestMatch(alo, ahi, blo, bhi);
      if (x.size) {
        blocks.push(x);
        if (alo < x.a && blo < x.b) queue.push([alo, x.a, blo, x.b]);
        if (x.a + x.size < ahi && x.b + x.size < bhi) queue.push([x.a + x.size, ahi, x.b + x.size, bhi]);
      }
    }
    blocks.sort((p, q) => p.a - q.a || p.b - q.b || p.size - q.size);
    // collapse adjacent blocks
    const out: Match[] = [];
    let i1 = 0, j1 = 0, k1 = 0;
    for (const m of blocks) {
      if (i1 + k1 === m.a && j1 + k1 === m.b) k1 += m.size;
      else {
        if (k1) out.push({ a: i1, b: j1, size: k1 });
        i1 = m.a; j1 = m.b; k1 = m.size;
      }
    }
    if (k1) out.push({ a: i1, b: j1, size: k1 });
    out.push({ a: la, b: lb, size: 0 });
    this.matchingBlocks = out;
    return out;
  }

  private static ratioOf(matches: number, length: number): number {
    return length ? (2.0 * matches) / length : 1.0;
  }

  ratio(): number {
    let matches = 0;
    for (const m of this.getMatchingBlocks()) matches += m.size;
    return SequenceMatcher.ratioOf(matches, this.a.length + this.b.length);
  }

  quickRatio(): number {
    if (!this.fullbcount) {
      this.fullbcount = new Map();
      for (const elt of this.b) this.fullbcount.set(elt, (this.fullbcount.get(elt) ?? 0) + 1);
    }
    const avail = new Map<string, number>();
    let matches = 0;
    for (const elt of this.a) {
      const numb = avail.has(elt) ? avail.get(elt)! : (this.fullbcount.get(elt) ?? 0);
      avail.set(elt, numb - 1);
      if (numb > 0) matches++;
    }
    return SequenceMatcher.ratioOf(matches, this.a.length + this.b.length);
  }

  realQuickRatio(): number {
    return SequenceMatcher.ratioOf(Math.min(this.a.length, this.b.length), this.a.length + this.b.length);
  }
}

/** `difflib.get_close_matches(word, possibilities, n, cutoff)` - best first; equal scores go to the larger string, like heapq.nlargest on (score, x). */
export function getCloseMatches(word: string, possibilities: Iterable<string>, n = 3, cutoff = 0.6): string[] {
  if (n <= 0) throw new Error(`n must be > 0: ${n}`);
  const s = new SequenceMatcher();
  s.setSeq2(word);
  const result: [number, string][] = [];
  for (const x of possibilities) {
    s.setSeq1(x);
    if (s.realQuickRatio() >= cutoff && s.quickRatio() >= cutoff && s.ratio() >= cutoff) result.push([s.ratio(), x]);
  }
  result.sort((p, q) => (q[0] !== p[0] ? q[0] - p[0] : cmpStr(q[1], p[1])));
  return result.slice(0, n).map((r) => r[1]);
}
