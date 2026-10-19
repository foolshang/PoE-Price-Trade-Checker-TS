import { promises as fsp } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { advancedKeyFromIni, copyChord, keyName, parseBinding, readAdvancedKey, VK } from "../../apps/checker/src/main/game_keys.ts";
import { copyItemText } from "../../apps/checker/src/main/item_copy.ts";

describe("the game's 'show advanced item descriptions' key", () => {
  it.each([
    ["18", [18]], ["82 2", [17, 82]], ["83 1", [16, 83]], ["67 3", [18, 67]], ["  17  ", [17]], ["119", [119]],
  ])("%j -> %j", (v, keys) => expect(parseBinding(v)).toEqual(keys));
  it.each(["0", "", "abc", "18 9", "18 2 1", "300", "-5", "1.5", "0 2"])("%j is not a usable binding", (v) => expect(parseBinding(v)).toBeNull());

  const INI = (extra: string) => `﻿[DISPLAY]\r\nshow_advanced_item_descriptions=99\r\n[ACTION_KEYS]\r\nweapon_swap=88\r\n${extra}\r\nzoom_in=33\r\n[OTHER]\r\nshow_advanced_item_descriptions=77\r\n`;
  it("reads [ACTION_KEYS] only (a BOM, CRLF and same-named keys in other sections are fine)", () => {
    expect(advancedKeyFromIni(INI("show_advanced_item_descriptions=18"))).toEqual([18]);
    expect(advancedKeyFromIni(INI("show_advanced_item_descriptions = 82 2"))).toEqual([17, 82]);
    expect(advancedKeyFromIni(INI("show_advanced_item_descriptions=0"))).toBeNull();
    expect(advancedKeyFromIni(INI("# nothing"))).toBeNull();
    expect(advancedKeyFromIni("")).toBeNull();
  });

  it("the file: found, missing, unbound", async () => {
    const docs = await fsp.mkdtemp(path.join(os.tmpdir(), "pfg-docs-"));
    const missing = await readAdvancedKey(docs);
    expect(missing).toMatchObject({ keys: [VK.ALT], source: "default" });
    expect(missing.note).toContain("อ่านไฟล์ตั้งค่าของ PoE2 ไม่ได้");
    const dir = path.join(docs, "My Games", "Path of Exile 2");
    await fsp.mkdir(dir, { recursive: true });
    await fsp.writeFile(path.join(dir, "poe2_production_Config.ini"), INI2("show_advanced_item_descriptions=69"));
    expect(await readAdvancedKey(docs)).toEqual({ keys: [69], source: "ini", note: "" });
    await fsp.writeFile(path.join(dir, "poe2_production_Config.ini"), INI2("show_advanced_item_descriptions=0"));
    const unbound = await readAdvancedKey(docs);
    expect(unbound).toMatchObject({ keys: [VK.ALT], source: "default" });
    expect(unbound.note).toContain("ไม่พบปุ่ม");
  });
  const INI2 = (line: string) => `[ACTION_KEYS]\n${line}\n`;

  it("the chord: PoE1 Ctrl; PoE2 Ctrl + the key (once), names", () => {
    expect(copyChord("poe1", [18])).toEqual([VK.CTRL]);
    expect(copyChord("poe2", [VK.ALT])).toEqual([VK.CTRL, VK.ALT]);
    expect(copyChord("poe2", [VK.CTRL])).toEqual([VK.CTRL]);
    expect(copyChord("poe2", [VK.CTRL, 82])).toEqual([VK.CTRL, 82]);
    expect(copyChord("poe2", [VK.SHIFT, 69])).toEqual([VK.CTRL, VK.SHIFT, 69]);
    expect([VK.CTRL, VK.ALT, 69, 119, 200].map(keyName)).toEqual(["Ctrl", "Alt", "E", "F8", "VK200"]);
  });
});

// ---------------------------------------------------------------------------------------------- clipboard handling
const ITEM = "Item Class: Rings\nRarity: Rare\nX\nY";
function fake(opts: { initial: string; image?: object; arrivesAfter?: number; itemText?: string }) {
  const state = { text: opts.initial, image: (opts.image ?? null) as object | null, writes: [] as string[], restored: [] as unknown[], polls: 0, sent: 0 };
  const deps = {
    snapshot: async () => ({ text: state.text, image: state.image }),
    restore: async (s: { text: string; image: object | null }) => { state.restored.push(s); state.text = s.text; state.image = s.image; },
    writeText: async (t: string) => { state.writes.push(t); state.text = t; },
    readText: async () => { state.polls++; if (opts.arrivesAfter !== undefined && state.polls > opts.arrivesAfter) state.text = opts.itemText ?? ITEM; return state.text; },
    send: async () => { state.sent++; return { sent: 4, total: 4, blocked: false, gapMs: 10, before: [], after: [], events: "" }; },
    sleep: async () => {},
  };
  return { state, deps };
}

describe("copyItemText keeps the player's clipboard", () => {
  it("success: the item is read, the player's text comes back; it was not emptied first", async () => {
    const { state, deps } = fake({ initial: "my password", arrivesAfter: 2 });
    const r = await copyItemText(deps, { restore: true });
    expect(r.text).toBe(ITEM);
    expect(r.lang).toBe("en");
    expect(state.text).toBe("my password");
    expect(state.writes).toEqual([]);
    expect(state.sent).toBe(1);
  });
  it("time out: nothing arrives, the player's text is still put back", async () => {
    const { state, deps } = fake({ initial: "keep me" });
    const r = await copyItemText(deps, { restore: true, pollMs: 50, limitMs: 1200 });
    expect(r.text).toBe("");
    expect(state.polls).toBe(24);
    expect(state.text).toBe("keep me");
  });
  it("an old item text on the clipboard is emptied first (so the new one is recognised) and not brought back", async () => {
    const { state, deps } = fake({ initial: "Item Class: Boots\nRarity: Magic\nOld", arrivesAfter: 1, itemText: "Item Class: Belts\nRarity: Rare\nNew\nB" });
    const r = await copyItemText(deps, { restore: true });
    expect(r.text).toContain("New");
    expect(state.writes[0]).toBe("");
    expect(state.text).toBe("");
  });
  it("restore off: the clipboard is emptied at the end, like the original program", async () => {
    const { state, deps } = fake({ initial: "mine", arrivesAfter: 0 });
    const r = await copyItemText(deps, { restore: false });
    expect(r.text).toBe(ITEM);
    expect(state.text).toBe("");
    expect(r.restored).toBe(false);
  });
  it("a picture on the clipboard is put back too", async () => {
    const { state, deps } = fake({ initial: "", image: { picture: true }, arrivesAfter: 1 });
    await copyItemText(deps, { restore: true });
    expect(state.image).toEqual({ picture: true });
  });
  it("an item of another language is returned as such (the app says it is English only)", async () => {
    const { deps } = fake({ initial: "", arrivesAfter: 0, itemText: "ชนิดไอเทม: แหวน\nRarity: Rare" });
    const r = await copyItemText(deps, { restore: true });
    expect(r.lang).toBe("th");
  });
});
