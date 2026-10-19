/** The settings window (F8): Game / Hotkeys / Advanced, like the original's; the price-mode keys are gone, the clipboard option is new. */
import "@poe/ui/src/style.css";
import "./checker.css";
import { $, debounce, h } from "@poe/ui/src/dom.ts";
import type { SettingsErrors, SettingsValues } from "../shared/api.ts";

const api = window.settings!;

const HOTKEYS: [keyof SettingsValues, string][] = [
  ["hotkey_scan", "Skill Reference (F4):"],
  ["hotkey_trade", "Trade Browser (F5):"],
  ["hotkey_settings", "Settings:"],
  ["hotkey_quit", "Quit:"],
];

async function main(): Promise<void> {
  const init = await api.init();
  const v: SettingsValues = { ...init.values };
  const errs = new Map<keyof SettingsValues, HTMLElement>();
  const inputs = new Map<keyof SettingsValues, HTMLInputElement | HTMLSelectElement>();

  const errLine = (key: keyof SettingsValues): HTMLElement => {
    const e = h("div", { class: "err", id: `err-${key}`, hidden: true });
    errs.set(key, e);
    return e;
  };
  const showErrors = (e: SettingsErrors): void => {
    for (const [key, line] of errs) {
      const msg = e[key] ?? "";
      line.textContent = msg;
      line.hidden = !msg;
      inputs.get(key)?.classList.toggle("bad", !!msg);
    }
  };
  const recheck = debounce(async () => showErrors(await api.check({ ...v })), 150);

  const select = (key: keyof SettingsValues, options: [string, string][]): HTMLSelectElement => {
    const s = h("select", { id: `f-${key}`, onchange: () => { (v as any)[key] = s.value; recheck(); } },
      ...options.map(([val, label]) => h("option", { value: val, selected: String(v[key]) === val }, label)));
    inputs.set(key, s);
    return s;
  };
  const check = (key: keyof SettingsValues, text: string): HTMLElement => {
    const box = h("input", { type: "checkbox", id: `f-${key}`, checked: !!v[key], onchange: () => { (v as any)[key] = box.checked; } });
    return h("label", { class: "full" }, box, " ", text);
  };
  const text = (key: keyof SettingsValues): HTMLInputElement => {
    const i = h("input", { type: "text", id: `f-${key}`, value: String(v[key]), size: 18, spellcheck: "false", oninput: () => { (v as any)[key] = i.value; recheck(); } });
    inputs.set(key, i);
    return i;
  };

  const game = h("div", { class: "set-grid" },
    h("label", { for: "f-game_version" }, "Game Version:"), select("game_version", [["poe2", "PoE 2"], ["poe1", "PoE 1"]]),
    check("auto_game", "Switch PoE 1 / PoE 2 by itself to the game that is in front"),
    check("auto_update", "Automatic update: download a newer version in the background"),
    h("div", { class: "set-note full" }, "(never installed unless you choose it: \"update now\" or \"update when the program is closed\"; off = it only tells you and gives a \"check for updates\" button)"),
    h("div", { class: "set-note full" }, "(F4 / F5 always use the game of the window they are pressed in; off = only the buttons / this setting choose)"),
    check("auto_league", "Auto-detect league on startup"),
    check("prefer_hardcore", "Prefer Hardcore league (HC)"),
    h("div", { class: "set-note full" }, "(League is selected in the main window)"),
    h("label", { for: "f-mod_badge_archetype" }, "Mod Badge archetype (F5 popup):"), select("mod_badge_archetype", init.archetypes.map((a) => [a, a])),
    check("f5_restore_clipboard", "F5: put my clipboard back after copying the item"),
    h("div", { class: "set-note full" }, "(off = the clipboard is emptied after F5, like the original program)"));

  const hot = h("div", { class: "set-grid" },
    ...HOTKEYS.flatMap(([key, label]) => [h("label", { for: `f-${key}` }, label), text(key), errLine(key)]),
    h("div", { class: "set-note full" }, "Format: F4  or  Ctrl+Alt+Q  etc. Keys the game uses (Ctrl+C / V / A / F, Ctrl+Enter, Home, Delete, Enter, arrows) and single letters are refused; two actions cannot share a key."),
    h("div", { class: "set-note full", id: "copy-keys-note" }, init.copyKeysNote));

  const adv = h("div", { class: "set-grid" },
    h("label", { for: "f-log_level" }, "Log Level:"), select("log_level", init.logLevels.map((l) => [l, l])),
    h("label", { for: "f-close_action" }, "Close button (X):"), select("close_action", [["minimize", "minimize"], ["exit", "exit"]]),
    h("div", { class: "set-note full", id: "tray-note" }, init.trayOk
      ? "(minimize = hide to the tray; exit = close the program)"
      : "⚠ The tray icon could not be made on this computer: the X button always closes the program."));

  const panes = [["Game", game], ["Hotkeys", hot], ["Advanced", adv]] as const;
  const tabs = h("div", { class: "tabs", role: "tablist" }, ...panes.map(([name], i) =>
    h("button", { type: "button", role: "tab", id: `tab-${name}`, "aria-selected": String(i === 0), onclick: () => select_tab(i) }, name)));
  const bodies = panes.map(([, el], i) => h("div", { class: "pane", id: `pane-${panes[i][0]}`, hidden: i !== 0 }, el));
  const select_tab = (i: number): void => {
    [...tabs.children].forEach((b, j) => b.setAttribute("aria-selected", String(i === j)));
    bodies.forEach((b, j) => { b.hidden = i !== j; });
  };

  const applyBtn = h("button", { type: "button", id: "btn-apply", onclick: async () => {
    const r = await api.apply({ ...v });
    if (!r.ok) {
      showErrors(r.errors);
      if (Object.keys(r.errors).some((k) => k.startsWith("hotkey_"))) select_tab(1);
    }
  } }, "Apply & Close");
  $("#root").replaceChildren(h("main", {}, tabs, ...bodies,
    h("div", { class: "set-foot" }, applyBtn, h("button", { type: "button", id: "btn-cancel", class: "secondary", onclick: () => api.cancel() }, "Cancel"))));
  document.title = `PoE Price & Trade Checker — Settings v${init.version}`;
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") api.cancel(); });
}

void main();
