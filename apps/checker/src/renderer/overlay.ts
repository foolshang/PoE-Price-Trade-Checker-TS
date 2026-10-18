/**
 * The message over the game (the original's PriceOverlay.show_message): one label - Segoe UI 10 bold, the colour of the message, a black
 * shadow one pixel down and right, a #1A1A1A box 2 pixels around it - on a transparent window that takes no clicks and no focus.
 */
import { h } from "@poe/ui/src/dom.ts";

const api = window.overlay!;

api.onShow((text, color) => {
  const label = h("div", { class: "ov-label", style: { color } }, h("span", { class: "ov-shadow" }, text), h("span", { class: "ov-text" }, text));
  document.getElementById("root")!.replaceChildren(label);
  requestAnimationFrame(() => {
    const r = label.getBoundingClientRect();
    api.ready({ width: Math.ceil(r.width), height: Math.ceil(r.height) });
  });
});
