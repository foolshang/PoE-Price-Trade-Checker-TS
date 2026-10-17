import { describe, expect, it } from "vitest";
import {
  cleanHeaders, collectSoundPaths, enforceGameDirs, isAllowedName, isAllowedUrl, isExternalLink, isInside, looksLikeSoundPath,
} from "../../apps/filtergen/src/main/guard.ts";

describe("file names the page may use", () => {
  it.each(["poe-checker.filter", "My Filter.FILTER", "sound one.mp3", "a.wav", "x.ogg", "ไทย.filter"])("allows %s", (n) => {
    expect(isAllowedName(n)).toBe(true);
  });
  it.each([
    "", ".", "..", "..\\x.filter", "../x.filter", "a/b.filter", "a\\b.filter", "C:\\x.filter", "C:x.filter", "x.exe", "x.filter.exe", "x", ".filter ",
    "x.filter.", "con.filter", "NUL.mp3", "a:b.filter", "a*.filter", "a?.mp3", "tab\t.filter", "x".repeat(300) + ".filter", "\\\\server\\share\\x.filter",
  ])("refuses %j", (n) => {
    expect(isAllowedName(n)).toBe(false);
  });
  it("refuses what is not a string", () => {
    for (const v of [null, undefined, 5, {}, [], ["a.filter"]]) expect(isAllowedName(v)).toBe(false);
  });
});

describe("addresses the page may read", () => {
  it.each([
    "https://storage.googleapis.com/poe-data-hub/poe1/prices/latest.json",
    "https://storage.googleapis.com/poe-data-hub/poe2/gems.json",
    "https://api.github.com/repos/NeverSinkDev/NeverSink-Filter/releases/latest",
    "https://raw.githubusercontent.com/NeverSinkDev/NeverSink-Filter-for-PoE2/0.10.4a/NeverSink%27s%20filter%20-%202-SEMI-STRICT.filter",
  ])("allows %s", (u) => {
    expect(isAllowedUrl(u)).toBe(true);
  });
  it.each([
    "http://storage.googleapis.com/poe-data-hub/poe1/prices/latest.json", "https://storage.googleapis.com/other-bucket/x.json",
    "https://storage.googleapis.com/poe-data-hub/../other/x.json", "https://storage.googleapis.com/poe-data-hub/%2e%2e/other/x",
    "https://api.github.com/repos/torvalds/linux/releases/latest", "https://api.github.com.evil.com/repos/NeverSinkDev/x",
    "https://evil.com/?https://api.github.com/repos/NeverSinkDev/x", "https://user:pw@api.github.com/repos/NeverSinkDev/x",
    "https://api.github.com:8443/repos/NeverSinkDev/x", "file:///C:/Windows/win.ini", "https://example.com/", "javascript:alert(1)", "not a url", "",
  ])("refuses %s", (u) => {
    expect(isAllowedUrl(u)).toBe(false);
  });
  it("passes on only the Accept header", () => {
    expect(cleanHeaders({ Accept: "application/json", Cookie: "x", Authorization: "y", "X-Other": "z" })).toEqual({ Accept: "application/json" });
    expect(cleanHeaders(null)).toEqual({});
  });
});

describe("links and the protocol root", () => {
  it("only web addresses go to the browser", () => {
    expect(isExternalLink("https://example.com/x")).toBe(true);
    expect(isExternalLink("http://example.com")).toBe(true);
    for (const u of ["file:///C:/x", "javascript:alert(1)", "app://local/index.html", "ms-msdt:/x", "nope"]) expect(isExternalLink(u)).toBe(false);
  });
  it("isInside keeps the app:// protocol in its folder", () => {
    expect(isInside("C:\\app\\renderer", "C:\\app\\renderer\\index.html")).toBe(true);
    expect(isInside("C:\\app\\renderer", "C:\\app\\renderer\\assets\\a.js")).toBe(true);
    expect(isInside("C:\\app\\renderer", "C:\\app\\renderer\\..\\main\\index.cjs")).toBe(false);
    expect(isInside("C:\\app\\renderer", "C:\\Windows\\win.ini")).toBe(false);
    expect(isInside("C:\\app\\renderer", "C:\\app\\renderer")).toBe(false);
  });
});

describe("the original's sound paths in the config", () => {
  it("finds exactly the strings that are paths of sound files", () => {
    expect(looksLikeSoundPath("C:\\Users\\x\\a.mp3")).toBe(true);
    expect(looksLikeSoundPath("a.mp3")).toBe(false);
    expect(looksLikeSoundPath("C:\\Users\\x\\secret.txt")).toBe(false);
    const got = collectSoundPaths({ sound_1: "C:\\s\\a.mp3", sound_2: "b.mp3", wl_tier_style: { S: { sound: { kind: "file", file: "D:/s/c.wav" } } }, note: "C:\\x\\y.txt" });
    expect([...got].sort()).toEqual(["C:\\s\\a.mp3", "D:/s/c.wav"]);
  });
});

describe("game_dir settings the page may keep", () => {
  it("keeps the approved folder, clears on request, puts back anything else", () => {
    const approved: Record<string, string> = { poe1: "D:\\mine", poe2: "" };
    expect(enforceGameDirs({ game_dir_poe1: "D:\\mine", game_dir_poe2: "" }, approved)).toEqual({ game_dir_poe1: "D:\\mine", game_dir_poe2: "" });
    expect(enforceGameDirs({ game_dir_poe1: "C:\\Windows", game_dir_poe2: "C:\\evil" }, approved)).toEqual({ game_dir_poe1: "D:\\mine", game_dir_poe2: "" });
    expect(approved).toEqual({ poe1: "D:\\mine", poe2: "" });
    expect(enforceGameDirs({ game_dir_poe1: "" }, approved).game_dir_poe1).toBe("");
    expect(approved.poe1).toBe("");
    expect(enforceGameDirs({ other: 1 }, { poe1: "", poe2: "" })).toEqual({ other: 1 });
  });
});
