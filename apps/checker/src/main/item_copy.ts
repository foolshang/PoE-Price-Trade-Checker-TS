/**
 * Make the game copy the item under the mouse and read it from the clipboard - without losing what the player had on the clipboard.
 * Before: the clipboard is remembered; it is emptied only when it holds an item text (so a new one can be told from the old one).
 * After the item arrived (or the time ran out): the player's clipboard is put back (when `restore`; otherwise the clipboard is emptied,
 * like the original program did). The key presses and the clipboard are injected (the app gives the real ones).
 */
import { itemLang } from "@poe/core";
import type { SendResult } from "./native.ts";

export interface ClipSnapshot { text: string; image: unknown | null }

export interface CopyDeps {
  snapshot(): Promise<ClipSnapshot>;
  restore(s: ClipSnapshot): Promise<void>;
  writeText(t: string): Promise<void>;
  readText(): Promise<string>;
  /** press the keys that make the game copy the item */
  send(): Promise<SendResult>;
  sleep(ms: number): Promise<void>;
}

export interface CopyResult {
  /** the item text ("" when none arrived in time) */
  text: string;
  lang: itemLang.ItemLang | null;
  sent: SendResult;
  restored: boolean;
}

export const POLL_MS = 50;
export const LIMIT_MS = 1200; // the game gets this long to put the item on the clipboard

export async function copyItemText(deps: CopyDeps, opts: { restore: boolean; pollMs?: number; limitMs?: number }): Promise<CopyResult> {
  const pollMs = opts.pollMs ?? POLL_MS, limitMs = opts.limitMs ?? LIMIT_MS;
  const before = await deps.snapshot();
  let keep = before;
  if (itemLang.looksLikeItemText(before.text)) { // an old item text: gone, so that the new one is recognised
    keep = { text: "", image: null };
    await deps.writeText("");
  }
  const sent = await deps.send();
  let text = "";
  for (let waited = 0; waited < limitMs; waited += pollMs) {
    await deps.sleep(pollMs);
    const cur = (await deps.readText()) || "";
    if (itemLang.looksLikeItemText(cur)) {
      text = cur;
      break;
    }
  }
  if (opts.restore) await deps.restore(keep);
  else await deps.writeText("");
  return { text, lang: text ? itemLang.detectItemLanguage(text) : null, sent, restored: opts.restore };
}
