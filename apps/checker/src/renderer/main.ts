/** The main window of the Checker: game, league, the Status and the buttons that open the settings and the filter page. */
import "@poe/ui/src/style.css";
import "./checker.css";
import { $, h, log } from "@poe/ui/src/dom.ts";
import type { GameId, Hotkeys } from "../shared/api.ts";

const api = window.checker!;

function fillLeagues(select: HTMLSelectElement, leagues: string[], picked: string): void {
  select.replaceChildren(...leagues.map((l) => h("option", { value: l, selected: l === picked }, l)));
  if (picked && !leagues.includes(picked)) select.append(h("option", { value: picked, selected: true }, picked));
  select.value = picked;
}

async function main(): Promise<void> {
  const init = await api.init();
  document.title = `PoE Price & Trade Checker (TypeScript) v${init.version}`;
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
  root.replaceChildren(h("main", {},
    h("header", { class: "top" },
      h("h1", {}, "PoE Price & Trade Checker ", h("small", { id: "ver", class: "muted", title: "ใช้ตอนแจ้งบั๊ก" }, `เวอร์ชัน ${init.version}`)),
      h("div", { class: "game-toggle", role: "radiogroup", "aria-label": "เกม" }, gameBtns)),
    h("div", { class: "row" }, h("label", { class: "l", for: "league" }, "League:"), league,
      h("button", { type: "button", id: "btn-leagues", class: "secondary", onclick: () => api.refreshLeagues() }, "Refresh Leagues")),
    h("div", { class: "row" },
      h("button", { type: "button", id: "btn-settings", onclick: () => api.openSettings() }, `Settings (${init.hotkeys.settings})`),
      h("button", { type: "button", id: "btn-filter", onclick: () => api.openFilter() }, "Filter Generator")),
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
}

void main();
