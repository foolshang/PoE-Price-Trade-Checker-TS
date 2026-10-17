import { describe, expect, it } from "vitest";
import { SequenceMatcher, getCloseMatches } from "../src/difflib.ts";
import { PyFloat, dumps } from "../src/py.ts";
import { pyFloatParse, pyFormatG, pyQuote, pyRound, pySum } from "../src/pyextra.ts";

describe("Python semantics used by the item code", () => {
  it("round(x, n) rounds the exact value, a tie to even", () => {
    expect(pyRound(0.125, 2)).toBe(0.12);
    expect(pyRound(0.375, 2)).toBe(0.38);
    expect(pyRound(2.675, 2)).toBe(2.67);
    expect(pyRound(73.60000000000001, 2)).toBe(73.6);
    expect(pyRound(2.5, 0)).toBe(2);
    expect(pyRound(-0.5, 0)).toBe(-0);
    expect(pyRound(1e22, 2)).toBe(1e22);
  });
  it("f'{x:g}'", () => {
    expect(pyFormatG(40)).toBe("40");
    expect(pyFormatG(12.5)).toBe("12.5");
    expect(pyFormatG(1234567)).toBe("1.23457e+06");
    expect(pyFormatG(0.00001)).toBe("1e-05");
    expect(pyFormatG(100000)).toBe("100000");
  });
  it("float(text)", () => {
    expect(pyFloatParse(" 2.5 ")).toBe(2.5);
    expect(pyFloatParse("1_000")).toBe(1000);
    expect(pyFloatParse("١٢")).toBe(12);
    expect(pyFloatParse("-Infinity")).toBe(-Infinity);
    expect(() => pyFloatParse("1,5")).toThrow();
    expect(() => pyFloatParse("")).toThrow();
  });
  it("urllib.parse.quote", () => {
    expect(pyQuote("a b/c")).toBe("a%20b/c");
    expect(pyQuote("a b/c", "")).toBe("a%20b%2Fc");
    expect(pyQuote("!'()*~")).toBe("%21%27%28%29%2A~");
    expect(pyQuote("標")).toBe("%E6%A8%99");
  });
  it("sum() of floats is compensated", () => {
    expect(pySum([0.1, 0.2, 0.3])).toBe(0.6);
    expect(pySum(Array(10).fill(0.1))).toBe(1.0);
  });
  it("a whole-number float prints as 40.0 in json", () => {
    expect(dumps({ v: new PyFloat(40) }, { separators: [",", ":"] })).toBe('{"v":40.0}');
    expect(dumps({ v: new PyFloat(1e16) }, { separators: [",", ":"] })).toBe('{"v":1e+16}');
    expect(dumps({ v: new PyFloat(0.5) })).toBe('{"v": 0.5}');
  });
  it("difflib: ratio and get_close_matches (ties go to the larger string)", () => {
    const m = new SequenceMatcher();
    m.setSeq2("bcde");
    m.setSeq1("abcd");
    expect(m.ratio()).toBe(0.75);
    expect(getCloseMatches("appel", ["ape", "apple", "peach", "puppy"], 3, 0.6)).toEqual(["apple", "ape"]);
    expect(getCloseMatches("ab", ["ac", "ad"], 1, 0.3)).toEqual(["ad"]);
  });
});
