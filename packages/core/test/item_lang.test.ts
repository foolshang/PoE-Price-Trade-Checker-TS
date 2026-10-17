import { describe, expect, it } from "vitest";
import { detectItemLanguage, hasModifierHeaders, looksLikeItemText } from "../src/item_lang.ts";

describe("item language", () => {
  it.each([
    ["Item Class: Rings\nRarity: Rare", "en"], ["Класс предмета: Кольца\nРедкость: Редкий", "ru"], ["Classe d'objet: Anneaux\nRareté: Rare", "fr"],
    ["Gegenstandsklasse: Ringe", "de"], ["Classe do Item: Anéis", "pt"], ["Clase de objeto: Anillos", "es"], ["ชนิดไอเทม: แหวน\nRarity: Rare", "th"],
    ["아이템 종류: 반지", "ko"], ["物品種類: 戒指", "zh-Hant"], ["物品类别: 戒指", "zh-Hans"], ["アイテムクラス: 指輪", "ja"],
  ])("%j is %s", (text, lang) => expect(detectItemLanguage(text)).toBe(lang));

  it("an uncut gem starts with the localized Rarity line; Thai / Simplified Chinese keep the English word, which reads as English", () => {
    expect(detectItemLanguage("Rarity: Gem\nUncut Skill Gem")).toBe("en");
    expect(detectItemLanguage("Редкость: Самоцвет")).toBe("ru");
    expect(detectItemLanguage("레어: x")).toBeNull();
    expect(detectItemLanguage("아이템 희귀도: 보석")).toBe("ko");
    expect(detectItemLanguage("稀有度: 寶石")).toBe("zh-Hant");
    expect(detectItemLanguage("レアリティ: ジェム")).toBe("ja");
  });
  it("other text is not an item; a BOM is ignored", () => {
    for (const t of ["", "hello", "item class: lower", " Item Class: leading space", "ITEM CLASS: x"]) expect(looksLikeItemText(t)).toBe(false);
    expect(detectItemLanguage("﻿Item Class: Rings")).toBe("en");
  });
  it("modifier headers", () => {
    expect(hasModifierHeaders('Item Class: Rings\n--------\n{ Prefix Modifier "X" (Tier: 1) }\n+1 to Life')).toBe(true);
    expect(hasModifierHeaders("Item Class: Rings\n--------\n+1 to Life (implicit)")).toBe(false);
    expect(hasModifierHeaders("{ Implicit Modifier }\r\n+1")).toBe(true);
  });
});
