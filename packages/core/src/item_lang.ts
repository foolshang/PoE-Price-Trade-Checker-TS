/**
 * Which language a copied item text is in. The first line of an item copied in the game starts with the localized "Item Class: "; an
 * uncut skill gem has no item class, so its first line is the localized "Rarity: " (a few languages keep the English word there, which
 * cannot be told from English: such a text is taken as English).
 * The table is the game's own wording (the strings of each language client); this module and its use are our own code.
 */

export type ItemLang = "en" | "ru" | "fr" | "de" | "pt" | "es" | "th" | "ko" | "zh-Hant" | "zh-Hans" | "ja";

interface Lead { lang: ItemLang; itemClass: string; rarity: string }

const LEADS: Lead[] = [
  { lang: "en", itemClass: "Item Class: ", rarity: "Rarity: " },
  { lang: "ru", itemClass: "Класс предмета: ", rarity: "Редкость: " },
  { lang: "fr", itemClass: "Classe d'objet: ", rarity: "Rareté: " },
  { lang: "de", itemClass: "Gegenstandsklasse: ", rarity: "Seltenheit: " },
  { lang: "pt", itemClass: "Classe do Item: ", rarity: "Raridade: " },
  { lang: "es", itemClass: "Clase de objeto: ", rarity: "Rareza: " },
  { lang: "th", itemClass: "ชนิดไอเทม: ", rarity: "Rarity: " },
  { lang: "ko", itemClass: "아이템 종류: ", rarity: "아이템 희귀도: " },
  { lang: "zh-Hant", itemClass: "物品種類: ", rarity: "稀有度: " },
  { lang: "zh-Hans", itemClass: "物品类别: ", rarity: "Rarity: " },
  { lang: "ja", itemClass: "アイテムクラス: ", rarity: "レアリティ: " },
];

/** The language of an item text, or null when the text does not start like an item of any language. */
export function detectItemLanguage(text: string): ItemLang | null {
  const t = text.replace(/^﻿/, "");
  for (const l of LEADS) if (t.startsWith(l.itemClass)) return l.lang;
  for (const l of LEADS) if (t.startsWith(l.rarity)) return l.lang === "th" || l.lang === "zh-Hans" ? "en" : l.lang;
  return null;
}

/** The text is an item copied from the game (in any language). */
export const looksLikeItemText = (text: string): boolean => detectItemLanguage(text) !== null;

/** Does the copy carry the `{ ... Modifier ... }` headers of the detailed format? */
export const hasModifierHeaders = (text: string): boolean => /^\{[^\n]*\bModifier\b[^\n]*\}\s*$/m.test(text);
