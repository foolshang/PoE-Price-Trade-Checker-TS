/**
 * The update banner: one line at the top of a window - "a newer version exists" and what to do about it. It appears only when
 * there is something to say (downloading / ready / the zip copy); a failed check says nothing here (it is in the log).
 * Never closes the program by itself: "restart to update" is a button the player clicks.
 */
import { h } from "@poe/ui";
import type { UpdateState } from "./updater_api.ts";
import { bannerText } from "./updater_logic.ts";

export function mountUpdateBanner(): void {
  const api = window.updater;
  if (!api || document.getElementById("update-banner")) return;
  const text = h("span", { id: "update-text" });
  const act = h("button", { type: "button", id: "update-action" });
  const bar = h("div", { id: "update-banner", role: "status", hidden: true,
    style: { position: "sticky", top: "0", zIndex: "50", display: "flex", gap: "10px", alignItems: "center", justifyContent: "center", flexWrap: "wrap",
      padding: "5px 10px", background: "#2f2a14", color: "#ecd98a", borderBottom: "1px solid #6a5a20", fontSize: "13px" } }, text, act);
  const render = (s: UpdateState): void => {
    const t = bannerText(s);
    bar.hidden = !t;
    bar.dataset.kind = s.kind;
    text.textContent = t;
    act.hidden = s.kind === "downloading" || !t;
    if (s.kind === "ready") {
      act.textContent = "รีสตาร์ทเพื่ออัปเดต";
      act.onclick = () => api.install();
    } else if (s.kind === "manual") {
      act.textContent = "เปิดหน้าดาวน์โหลด";
      act.onclick = () => api.openRelease();
    }
  };
  document.body.prepend(bar);
  api.onState(render);
  void api.get().then(render);
}
