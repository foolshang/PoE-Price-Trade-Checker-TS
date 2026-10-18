import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { notesToText, parseChangelog, sectionFor } from "../../packages/desktop/src/changelog.ts";
import type { UpdateInfoState } from "../../packages/desktop/src/update_api.ts";
import { updateView } from "../../packages/desktop/src/update_view.ts";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const version = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf-8")).version as string;

describe("changelog", () => {
  const text = "# title\n\nintro\n\n## 1.2.0 - 2026-02-01\n\n- new\n- newer\n\n## [1.1.0-beta.2] - 2026-01-01\n\n- beta\n\n## v1.0.0\nfirst\n";
  it("parses the sections, newest first, in file order", () => {
    expect(parseChangelog(text)).toEqual([
      { version: "1.2.0", date: "2026-02-01", body: "- new\n- newer" },
      { version: "1.1.0-beta.2", date: "2026-01-01", body: "- beta" },
      { version: "1.0.0", date: "", body: "first" },
    ]);
  });
  it("finds the section of a tag (with or without v); null when there is none", () => {
    expect(sectionFor(text, "v1.2.0")).toBe("- new\n- newer");
    expect(sectionFor(text, "1.1.0-beta.2")).toBe("- beta");
    expect(sectionFor(text, "v9.9.9")).toBeNull();
  });
  it.each(["checker", "filtergen"])("the real CHANGELOG of %s has a section for the version being built", (app) => {
    const file = path.join(ROOT, "apps", app, "CHANGELOG.md");
    const body = sectionFor(fs.readFileSync(file, "utf-8"), version);
    expect(body, `${file} has no "## ${version} - date" section`).toBeTruthy();
    const entries = parseChangelog(fs.readFileSync(file, "utf-8"));
    expect(entries.every((e) => /^\d{4}-\d\d-\d\d$/.test(e.date))).toBe(true);
  });
  it("release notes: markdown stays, the HTML of a release page becomes text, a list is joined", () => {
    expect(notesToText("- a\n- b")).toBe("- a\n- b");
    expect(notesToText("<h2>v1</h2><ul><li>one &amp; two</li><li>three</li></ul><p>x &lt;y&gt;</p>")).toBe("v1\n\n- one & two\n- three\nx <y>");
    expect(notesToText([{ version: "1", note: "<p>a</p>" }, { version: "2", note: "b" }])).toBe("a\n\nb");
    expect(notesToText(null)).toBe("");
  });
});

const base: UpdateInfoState = { phase: "idle", auto: false, exitPending: false, installNow: false, mode: "installer", userCheck: false, upToDate: false };
const ids = (s: Partial<UpdateInfoState>) => updateView({ ...base, ...s }).buttons.map((b) => b.id);

describe("what the update strip offers", () => {
  it("not an installed program (dev): nothing", () => {
    expect(updateView({ ...base, mode: "off", phase: "available", version: "2.0.0" })).toMatchObject({ text: "", buttons: [], check: false });
  });
  it("automatic update off: a 'check' button, no strip; automatic on: no check button", () => {
    expect(updateView(base)).toMatchObject({ text: "", check: true });
    expect(updateView({ ...base, auto: true })).toMatchObject({ text: "", check: false });
  });
  it("a newer version is found: update now / update when closed", () => {
    expect(ids({ phase: "available", version: "2.0.0" })).toEqual(["install-now", "install-exit"]);
    expect(updateView({ ...base, phase: "available", version: "2.0.0" }).check).toBe(false);
  });
  it("downloading: the choices stay open until one is made; then only 'cancel'", () => {
    expect(ids({ phase: "downloading", version: "2.0.0", percent: 40 })).toEqual(["install-now", "install-exit"]);
    expect(updateView({ ...base, phase: "downloading", version: "2.0.0", percent: 40, exitPending: true })).toMatchObject({ buttons: [{ id: "cancel" }] });
    expect(updateView({ ...base, phase: "downloading", version: "2.0.0", percent: 40, installNow: true }).text).toContain("ทันทีที่โหลดเสร็จ");
    expect(updateView({ ...base, phase: "downloading", version: "2.0.0", percent: 40 }).text).toContain("40%");
  });
  it("downloaded: choose; after 'when closed' the strip says so and offers cancel (and update now)", () => {
    expect(ids({ phase: "ready", version: "2.0.0" })).toEqual(["install-now", "install-exit"]);
    const v = updateView({ ...base, phase: "ready", version: "2.0.0", exitPending: true });
    expect(v.text).toContain("จะอัปเดตตอนปิดโปรแกรม");
    expect(v.buttons.map((b) => b.id)).toEqual(["install-now", "cancel"]);
  });
  it("a download that fails says why and can be tried again; a check that fails by itself is silent", () => {
    const v = updateView({ ...base, phase: "error", failed: "download", version: "2.0.0", message: "ECONNRESET" });
    expect(v.text).toContain("ECONNRESET");
    expect(v.buttons.map((b) => b.id)).toEqual(["retry"]);
    expect(updateView({ ...base, phase: "error", failed: "check", message: "net::ERR" }).text).toBe("");
    expect(updateView({ ...base, phase: "error", failed: "check", message: "net::ERR", userCheck: true }).text).toContain("net::ERR");
  });
  it("the player asked and there is nothing new: it is said", () => {
    expect(updateView({ ...base, userCheck: true, upToDate: true }).text).toBe("เป็นรุ่นล่าสุดแล้ว");
    expect(updateView({ ...base, phase: "checking", userCheck: true }).text).toContain("กำลังเช็ค");
  });
  it("the zip copy: the update button opens the download page", () => {
    const v = updateView({ ...base, mode: "manual", phase: "manual", version: "2.0.0", url: "https://x" });
    expect(v.buttons.map((b) => b.id)).toEqual(["open"]);
    expect(updateView({ ...base, mode: "manual", auto: true }).check).toBe(true); // (the zip has no automatic update: it can always be asked)
  });
});
