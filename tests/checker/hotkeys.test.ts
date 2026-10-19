import { describe, expect, it } from "vitest";
import { checkHotkeys, copyChordHotkeys, forbiddenReason, parseHotkey } from "../../apps/checker/src/main/hotkeys.ts";
import { advancedKeyFromIni, copyChord, keyName } from "../../apps/checker/src/main/game_keys.ts";

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

describe("hotkeys the program presses itself (the copy chord of F5)", () => {
  const reservedFor = (ini: string | null) => {
    const adv = ini === null ? [0x12] : advancedKeyFromIni(["[ACTION_KEYS]", "show_advanced_item_descriptions=" + ini].join(String.fromCharCode(10)))!;
    const names = (vks: number[]) => vks.map(keyName);
    return [...copyChordHotkeys(names(copyChord("poe1", [])), "PoE1"), ...copyChordHotkeys(names(copyChord("poe2", adv)), "PoE2")];
  };
  const fields = (v: Record<string, string>, reserved: ReturnType<typeof reservedFor>) =>
    checkHotkeys({ values: v, order: Object.keys(v), labels: Object.fromEntries(Object.keys(v).map((k) => [k, k])) as never, reserved });

  it("the default (Alt): Ctrl+C and Ctrl+Alt+C are the program's own; any other key is free", () => {
    const r = reservedFor(null);
    expect(r.map((x) => x.canonical).sort()).toEqual(["Ctrl+Alt+C", "Ctrl+C"]);
    const e = fields({ a: "Ctrl+Alt+C", b: "Alt+C", c: "Ctrl+Alt+Q" }, r);
    expect(e.a).toMatch(/Ctrl\+Alt\+C.*โปรแกรมกดเอง/);
    expect(e.b).toBeUndefined();
    expect(e.c).toBeUndefined();
  });

  it("the key the game's ini names: Shift (1 = Shift is the modifier of key 16?) / a letter / a letter with Ctrl", () => {
    // 16 = Shift as the key itself: the chord Ctrl+Shift+C
    expect(reservedFor("16").map((x) => x.canonical).sort()).toEqual(["Ctrl+C", "Ctrl+Shift+C"]);
    // 82 = R: pressing Ctrl then R already makes Ctrl+R
    expect(reservedFor("82").map((x) => x.canonical).sort()).toEqual(["Ctrl+C", "Ctrl+R"]);
    // 82 with modifier 2 (Ctrl): the same
    expect(reservedFor("82 2").map((x) => x.canonical).sort()).toEqual(["Ctrl+C", "Ctrl+R"]);
    // 82 with modifier 3 (Alt): Alt is not in the chord (only Ctrl + the ini's listed keys)... the listed keys are [Alt, R]
    expect(reservedFor("82 3").map((x) => x.canonical).sort()).toEqual(["Ctrl+Alt+R", "Ctrl+C"]);
    const e = fields({ a: "Ctrl+R", b: "Ctrl+Alt+C" }, reservedFor("82"));
    expect(e.a).toMatch(/Ctrl\+R/);
    expect(e.b).toBeUndefined(); // (with R as the advanced key, Ctrl+Alt+C is free)
  });

  it("without reserved hotkeys nothing changes", () => {
    expect(fields({ a: "Ctrl+Alt+C" }, [])).toEqual({});
  });
});
