/** The main window of the Checker: game, league, About, the update strip, the Status and the buttons that open the settings and the filter page. */
import "@poe/ui/src/style.css";
import "./checker.css";
import { openAbout } from "@poe/desktop/about";
import { openModal } from "@poe/desktop/modal";
import { createUpdateStrip, fillUpdateControls } from "@poe/desktop/update-ui";
import type { UpdateInfoState } from "@poe/desktop/update-api";
import { $, h, log } from "@poe/ui/src/dom.ts";
import changelog from "../../CHANGELOG.md?raw";
import type { Details, GameId, Hotkeys } from "../shared/api.ts";

const api = window.checker!;
const REPO_URL = "https://github.com/foolshang/PoE-Price-Trade-Checker-TS";

function fillLeagues(select: HTMLSelectElement, leagues: string[], picked: string): void {
  select.replaceChildren(...leagues.map((l) => h("option", { value: l, selected: l === picked }, l)));
  if (picked && !leagues.includes(picked)) select.append(h("option", { value: picked, selected: true }, picked));
  select.value = picked;
}

/** everything that waited while the player was away: what the newer version brings (with the buttons to update) and the NeverSink message */
function showDetails(d: Details, version: string): void {
  const kids: Node[] = [];
  if (d.update) {
    const controls = h("div", { id: "details-update-controls", style: { display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap", margin: "4px 0 8px" } });
    kids.push(h("section", { id: "details-update" },
      h("strong", {}, `มีรุ่นใหม่ v${d.update.version}`), h("span", { class: "muted" }, ` (ตอนนี้ใช้ v${version})`),
      h("pre", { style: { whiteSpace: "pre-wrap", margin: "4px 0", fontFamily: "inherit", fontSize: "13px", lineHeight: "1.45" } }, d.update.notes || "ดูรายละเอียดที่หน้า release"),
      controls));
    const au = window.appUpdate;
    if (au) {
      const render = (s: UpdateInfoState): void => { if (controls.isConnected) fillUpdateControls(controls, s, au); };
      au.onState(render);
      void au.get().then((s) => { if (s) render(s); });
    }
  }
  if (d.neversink) {
    kids.push(h("section", { id: "details-neversink", style: { marginTop: "8px" } }, h("strong", {}, "NeverSink"), h("pre", { style: { whiteSpace: "pre-wrap", margin: "4px 0", fontFamily: "inherit", fontSize: "13px" } }, d.neversink)));
  }
  openModal({ id: "details-window", title: "มีเรื่องใหม่", body: kids });
}

async function main(): Promise<void> {
  const init = await api.init();
  document.title = `PoE Price & Trade Checker v${init.version}`;
  const root = $("#root");
  let game: GameId = init.game;
  const league = h("select", { id: "league", "aria-label": "League", onchange: () => api.setLeague(league.value) });
  const gameBtns = (["poe1", "poe2"] as const).map((g) =>
    h("button", { type: "button", id: `game-${g}`, "data-game": g, "aria-pressed": String(g === game), onclick: () => {
      if (g === game) return;
      game = g;
      for (const b of gameBtns) b.setAttribute("aria-pressed", String(b.dataset.game === g));
      api.setGame(g);
    } }, g === "poe1" ? "PoE 1" : "PoE 2"));
  const legendText = (hk: Hotkeys): string => `${hk.scan} Skill Reference  |  ${hk.trade} Trade browser  |  ${hk.settings} Settings  |  ${hk.quit} Quit`;
  let newer: { version?: string; notes?: string } | null = null;
  const about = h("button", { type: "button", id: "btn-about", class: "secondary",
    onclick: () => void openAbout({ name: "PoE Price & Trade Checker", version: init.version, changelog, repoUrl: REPO_URL, newer: async () => newer }) }, "About");
  const strip = window.appUpdate
    ? createUpdateStrip(window.appUpdate, (s) => { newer = s.version && ["available", "downloading", "ready", "manual"].includes(s.phase) ? { version: s.version, notes: s.notes } : null; })
    : null;
  root.replaceChildren(h("main", {},
    h("header", { class: "top" },
      h("h1", {}, "PoE Price & Trade Checker ", h("small", { id: "ver", class: "muted", title: "ใช้ตอนแจ้งบั๊ก" }, `เวอร์ชัน ${init.version}`))),
    strip?.strip,
    h("div", { class: "row" }, h("div", { class: "game-toggle", role: "radiogroup", "aria-label": "เกม" }, gameBtns),
      h("label", { class: "l", for: "league" }, "League:"), league,
      h("button", { type: "button", id: "btn-leagues", class: "secondary", onclick: () => api.refreshLeagues() }, "Refresh Leagues"), about),
    h("div", { class: "row" },
      h("button", { type: "button", id: "btn-settings", onclick: () => api.openSettings() }, `Settings (${init.hotkeys.settings})`),
      h("button", { type: "button", id: "btn-filter", onclick: () => api.openFilter() }, "Filter Generator"),
      strip?.checkButton),
    h("label", { class: "section" }, "Status"),
    h("div", { id: "log", class: "log", "aria-live": "polite" }),
    h("p", { class: "hint legend", id: "legend" }, legendText(init.hotkeys))));
  fillLeagues(league, init.leagues, init.league);
  for (const [text, tag] of init.log) log(text, tag);
  api.onLog((text, tag) => log(text, tag));
  api.onLeagues((leagues, picked) => fillLeagues(league, leagues, picked));
  api.onGame((g) => {
    game = g;
    for (const b of gameBtns) b.setAttribute("aria-pressed", String(b.dataset.game === g));
  });
  api.onHotkeys((hk) => {
    $("#legend").textContent = legendText(hk);
    $("#btn-settings").textContent = `Settings (${hk.settings})`;
  });
  api.onDetails((d) => showDetails(d, init.version));
}

void main();
