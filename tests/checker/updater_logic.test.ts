import { describe, expect, it } from "vitest";
import { bannerText, decideOffer, firstLine, isNoReleases, isPrerelease, onceWithin } from "../../packages/desktop/src/updater_logic.ts";

describe("what the updater does with an offered release", () => {
  it.each([["1.0.0", true], ["1.0.0-beta.3", false], ["2.1.0-rc.1", false], ["1.2.3", true]])("%s is stable: %s", (v, stable) => {
    expect(!isPrerelease(v)).toBe(stable);
  });
  it("a stable copy skips every pre-release and takes the stable ones", () => {
    expect(decideOffer("1.0.0", "1.1.0-beta.1", "installer")).toBe("skip-prerelease");
    expect(decideOffer("1.0.0", "1.1.0-rc.2", "manual")).toBe("skip-prerelease");
    expect(decideOffer("1.0.0", "1.0.1", "installer")).toBe("download");
  });
  it("a beta copy follows the betas (and the stable releases)", () => {
    expect(decideOffer("1.0.0-beta.4", "1.0.0-beta.5", "installer")).toBe("download");
    expect(decideOffer("1.0.0-beta.4", "1.0.0", "installer")).toBe("download");
  });
  it("the zip copy is only told, never downloads", () => {
    expect(decideOffer("1.0.0", "1.0.1", "manual")).toBe("manual");
    expect(decideOffer("1.0.0-beta.4", "1.0.0-beta.5", "manual")).toBe("manual");
  });
});

describe("the words of the banner", () => {
  it("says something only when there is something to say", () => {
    expect(bannerText({ kind: "idle" })).toBe("");
    expect(bannerText({ kind: "error", message: "x" })).toBe("");
    expect(bannerText({ kind: "downloading", version: "1.2.0", percent: 40 })).toBe("มีรุ่นใหม่ v1.2.0 กำลังดาวน์โหลดเบื้องหลัง… 40%");
    expect(bannerText({ kind: "ready", version: "1.2.0" })).toBe("มีรุ่นใหม่ v1.2.0 ติดตั้งเมื่อปิดโปรแกรม");
    expect(bannerText({ kind: "manual", version: "1.2.0", url: "u" })).toContain("zip");
  });
});

describe("how a failed check is written to the log", () => {
  it("one line: the first line of the message, no stack; 'no published versions' is recognised", () => {
    const e = new Error("No published versions on GitHub\n    at newError (x.js:1:1)\n    at y");
    expect(firstLine(e)).toBe("No published versions on GitHub");
    expect(firstLine("plain text")).toBe("plain text");
    expect(firstLine(null)).toBe("null");
    expect(isNoReleases(firstLine(e))).toBe(true);
    expect(isNoReleases("HTTP 404")).toBe(false);
  });

  it("the same failure reported three ways (logger, 'error' event, rejected check) is written once; a different one, or a later one, again", () => {
    let now = 1000;
    const once = onceWithin(2000, () => now);
    expect(once("check:a")).toBe(true);
    expect(once("check:a")).toBe(false);
    now += 500;
    expect(once("check:a")).toBe(false);
    expect(once("check:b")).toBe(true);
    now += 5000;
    expect(once("check:b")).toBe(true);
  });
});
