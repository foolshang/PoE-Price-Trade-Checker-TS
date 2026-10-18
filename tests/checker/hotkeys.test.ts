import { describe, expect, it } from "vitest";
import { checkHotkeys, forbiddenReason, parseHotkey } from "../../apps/checker/src/main/hotkeys.ts";

const ok = (t: string) => { const p = parseHotkey(t); if (!p.ok) throw new Error(p.reason); return p.hotkey; };

describe("hotkey text", () => {
  it.each([
    ["F4", "F4", "F4"], ["f5", "F5", "F5"], ["Ctrl+Alt+Q", "Ctrl+Alt+Q", "Ctrl+Alt+Q"], ["alt + ctrl + q", "Ctrl+Alt+Q", "Ctrl+Alt+Q"],
    ["control+shift+f9", "Ctrl+Shift+F9", "Ctrl+Shift+F9"], ["Win+F2", "Win+F2", "Super+F2"], ["Ctrl+Insert", "Ctrl+Insert", "Ctrl+Insert"],
    ["ctrl+esc", "Ctrl+Esc", "Ctrl+Escape"], ["F24", "F24", "F24"],
  ])("%j -> %s (Electron: %s)", (t, canonical, accelerator) => {
    const h = ok(t);
    expect(h.canonical).toBe(canonical);
    expect(h.accelerator).toBe(accelerator);
  });
  it.each(["", "   ", "Ctrl+", "+F4", "Ctrl+Alt", "Ctrl+Ctrl+Q", "Q+W", "Ctrl+Banana", "F25", "F0", "Ctrl++Q"])("%j is not a hotkey", (t) => {
    expect(parseHotkey(t).ok).toBe(false);
  });
  it("not a string", () => {
    expect(parseHotkey(undefined).ok).toBe(false);
    expect(parseHotkey(5).ok).toBe(false);
  });
});

describe("keys the game and the text boxes use are refused", () => {
  it.each(["Ctrl+C", "ctrl+v", "Ctrl+A", "Ctrl+F", "Ctrl+Enter", "Home", "Delete", "Enter", "Up", "Down", "Left", "Right", "Ctrl+Home", "Shift+Delete", "Q", "5", "Space", "Tab"])("%s", (t) => {
    expect(forbiddenReason(ok(t))).toBeTruthy();
  });
  it.each(["F4", "F8", "Ctrl+Alt+Q", "Ctrl+Shift+C", "Alt+C", "Ctrl+Insert", "Ctrl+F5", "Shift+F2", "Alt+Q"])("%s is fine", (t) => {
    expect(forbiddenReason(ok(t))).toBeNull();
  });
});

const L = { scan: "Scan", trade: "Trade", settings: "Settings", quit: "Quit" };
const order = ["scan", "trade", "settings", "quit"] as const;
describe("a set of hotkeys", () => {
  it("the defaults pass", () => {
    expect(checkHotkeys({ values: { scan: "F4", trade: "F5", settings: "F8", quit: "Ctrl+Alt+Q" }, order: [...order], labels: L })).toEqual({});
  });
  it("a duplicate (however it is spelled) is named against the first one", () => {
    const e = checkHotkeys({ values: { scan: "F4", trade: "f4", settings: "F8", quit: "alt+ctrl+q" }, order: [...order], labels: L });
    expect(Object.keys(e)).toEqual(["trade"]);
    expect(e.trade).toContain("ซ้ำกับปุ่ม \"Scan\"");
  });
  it("each problem lands on its own field", () => {
    const e = checkHotkeys({ values: { scan: "Ctrl+C", trade: "nope", settings: "F8", quit: "F8" }, order: [...order], labels: L });
    expect(Object.keys(e).sort()).toEqual(["quit", "scan", "trade"]);
  });
});
