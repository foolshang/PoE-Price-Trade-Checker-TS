import { describe, expect, it } from "vitest";
import { gameOfWindow, isPoeClient, onFront } from "../../apps/checker/src/main/game_detect.ts";

const w = (exePath: string, title = "", cls = "") => ({ exePath, title, cls });
const STEAM = "C:\\Program Files (x86)\\Steam\\steamapps\\common";

describe("which game a window is", () => {
  it.each([
    // the same exe names in both games: the folder decides (standalone, Steam, Epic)
    [`${STEAM}\\Path of Exile\\PathOfExile_x64Steam.exe`, "poe1"],
    [`${STEAM}\\Path of Exile 2\\PathOfExile_x64Steam.exe`, "poe2"],
    [`${STEAM}\\Path of Exile 2\\PathOfExileSteam.exe`, "poe2"],
    ["C:\\Program Files (x86)\\Grinding Gear Games\\Path of Exile\\PathOfExile_x64.exe", "poe1"],
    ["C:\\Program Files (x86)\\Grinding Gear Games\\Path of Exile 2\\PathOfExile.exe", "poe2"],
    ["D:\\Games\\PathOfExile2\\PathOfExile_x64.exe", "poe2"],
    ["D:\\Epic\\Path of Exile\\PathOfExile_x64EGS.exe", "poe1"],
    ["D:/Games/Path of Exile 2/PathOfExile_x64.exe", "poe2"],
  ])("%s -> %s", (exe, game) => {
    expect(gameOfWindow(w(exe))).toBe(game);
  });
  it("a renamed folder: the title decides", () => {
    expect(gameOfWindow(w("D:\\Games\\x\\PathOfExile_x64.exe", "Path of Exile 2"))).toBe("poe2");
    expect(gameOfWindow(w("D:\\Games\\x\\PathOfExile_x64.exe", "Path of Exile"))).toBe("poe1");
    expect(gameOfWindow(w("D:\\Games\\x\\PathOfExile_x64.exe", "something else"))).toBeNull();
  });
  it("the program path can be unreadable: the window class says it is the game, the title which", () => {
    expect(gameOfWindow(w("", "Path of Exile 2", "POEWindowClass"))).toBe("poe2");
    expect(gameOfWindow(w("", "Path of Exile", "POEWindowClass"))).toBe("poe1");
  });
  it("other programs are not a game, whatever their folder or title says", () => {
    expect(gameOfWindow(w("C:\\Program Files\\Google\\Chrome\\chrome.exe", "Path of Exile 2 - wiki"))).toBeNull();
    expect(gameOfWindow(w("D:\\Path of Exile 2 notes\\notepad.exe", "Path of Exile 2"))).toBeNull();
    expect(gameOfWindow(w("C:\\x\\PoE-Price-Trade-Checker-TS.exe", "PoE Price & Trade Checker"))).toBeNull();
    expect(isPoeClient(w("C:\\Windows\\explorer.exe"))).toBe(false);
    expect(gameOfWindow(w(""))).toBeNull();
  });
});

describe("what to do when the window in front changes", () => {
  it("a game comes to the front: switch (the first time, and when it is the other one)", () => {
    expect(onFront("poe1", null)).toEqual({ switchTo: "poe1", lastFront: "poe1" });
    expect(onFront("poe2", "poe1")).toEqual({ switchTo: "poe2", lastFront: "poe2" });
  });
  it("the same game as last time: no switch, so a choice by hand stays until the OTHER game comes to the front", () => {
    expect(onFront("poe2", "poe2")).toEqual({ switchTo: null, lastFront: "poe2" });
  });
  it("no game in front: nothing changes", () => {
    expect(onFront(null, "poe1")).toEqual({ switchTo: null, lastFront: "poe1" });
    expect(onFront(null, null)).toEqual({ switchTo: null, lastFront: null });
  });
});
