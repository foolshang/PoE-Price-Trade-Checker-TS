/** The update strip (a line with the buttons of the player's choices) and the pieces other windows reuse. */
import { h } from "@poe/ui";
import type { AppUpdateApi, UpdateInfoState } from "./update_api.ts";
import { updateView } from "./update_view.ts";
import type { UpdateButtonId } from "./update_view.ts";

function act(api: AppUpdateApi, id: UpdateButtonId): void {
  if (id === "install-now") api.installNow();
  else if (id === "install-exit") api.installOnExit();
  else if (id === "cancel") api.cancel();
  else if (id === "retry") api.retry();
  else if (id === "open") api.openRelease();
  else api.check();
}

/** the text and the buttons of a state, into `box` (replacing what was there) */
export function fillUpdateControls(box: HTMLElement, s: UpdateInfoState, api: AppUpdateApi): void {
  const v = updateView(s);
  box.dataset.phase = s.phase;
  box.replaceChildren(
    h("span", { class: "update-text", style: { color: v.tone === "warn" ? "#e8b4a0" : "inherit" } }, v.text),
    ...v.buttons.map((b) => h("button", { type: "button", class: b.id === "cancel" ? "secondary" : "", "data-act": b.id, onclick: () => act(api, b.id) }, b.label)),
  );
}

/**
 * The strip at the top of the window (hidden while there is nothing to say) and the "check for updates" button (for the row of buttons).
 * `onState` is called with every state (the window may also want the version, for the details).
 */
export function createUpdateStrip(api: AppUpdateApi, onState?: (s: UpdateInfoState) => void): { strip: HTMLElement; checkButton: HTMLButtonElement } {
  const strip = h("div", { id: "update-bar", role: "status", hidden: true,
    style: { display: "flex", gap: "10px", alignItems: "center", justifyContent: "center", flexWrap: "wrap", padding: "5px 10px", margin: "0 0 8px",
      background: "#2f2a14", color: "#ecd98a", border: "1px solid #6a5a20", borderRadius: "4px", fontSize: "13px" } });
  const checkButton = h("button", { type: "button", id: "btn-update-check", class: "secondary", hidden: true, onclick: () => api.check() }, "เช็คอัปเดต");
  const render = (s: UpdateInfoState): void => {
    const v = updateView(s);
    strip.hidden = !v.text;
    fillUpdateControls(strip, s, api);
    checkButton.hidden = !v.check;
    checkButton.disabled = s.phase === "checking";
    onState?.(s);
  };
  api.onState(render);
  void api.get().then((s) => { if (s) render(s); });
  return { strip, checkButton };
}
