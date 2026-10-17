/** The F4 window: type a skill, pick it, see the mods per slot and the passives for a level bracket (the original's SkillRefWindow). */
import "@poe/ui/src/style.css";
import "./checker.css";
import { $, h } from "@poe/ui/src/dom.ts";
import type { SkillDetail, SkillHit } from "../shared/api.ts";

const api = window.skillRef!;
const MAX_SUGGESTIONS = 8;
const THIN_POPULATION = 50; // a bracket with fewer builds is still shown, with an honest caption

const fmtNum = (v: number): string => (Number.isInteger(v) ? v.toFixed(0) : v.toFixed(1));
const bracketKey = (b: string): number => {
  const n = parseInt(b.split("-", 1)[0], 10);
  return Number.isNaN(n) ? 0 : n;
};

let hits: SkillHit[] = [];
let detail: SkillDetail | null = null;
let currentBracket = "";
let slotTab = "";
let searchSeq = 0;

const el = {
  input: h("input", { type: "text", id: "skill-input", autocomplete: "off", spellcheck: "false", "aria-label": "Skill", style: { width: "22em" } }),
  suggest: h("ul", { class: "s-suggest", id: "suggest", hidden: true }),
  brackets: h("div", { class: "s-brackets", id: "brackets" }),
  pop: h("div", { class: "s-pop", id: "population" }),
  label: h("div", { class: "s-note", id: "table-label" }, "พิมพ์ชื่อสกิลแล้วเลือกจาก dropdown"),
  tabs: h("div", { class: "s-tabs", id: "slot-tabs" }),
  mods: h("div", { class: "s-mods", id: "mods" }),
  pass: h("div", { class: "s-pass", id: "passives" }),
};

function fit(first = false): void {
  requestAnimationFrame(() => {
    const r = document.body.getBoundingClientRect();
    const size = { width: Math.ceil(r.width), height: Math.ceil(r.height) };
    if (first) api.ready(size);
    else api.resize(size);
  });
}

async function onType(): Promise<void> {
  const prefix = el.input.value;
  const seq = ++searchSeq;
  if (!prefix.trim()) {
    hits = [];
  } else {
    const found = await api.search(prefix);
    if (seq !== searchSeq) return; // a newer keystroke has answered
    hits = found.slice(0, MAX_SUGGESTIONS);
  }
  el.suggest.hidden = !hits.length;
  el.suggest.replaceChildren(...hits.map((s, i) => h("li", { "data-i": i, onclick: () => void select(s) }, `${s.skill}  [${s.skillType}]`)));
  fit();
}

function clearResult(message: string): void {
  detail = null;
  el.brackets.replaceChildren();
  el.pop.textContent = "";
  el.pop.className = "s-pop";
  el.tabs.replaceChildren();
  el.mods.replaceChildren();
  el.pass.replaceChildren();
  el.label.textContent = message;
}

async function onEnter(): Promise<void> {
  const typed = el.input.value.trim();
  const found = await api.search(typed);
  if (found.length) await select(found[0]);
  else if (typed) {
    el.suggest.hidden = true;
    clearResult(`ไม่พบสกิลชื่อ "${typed}" — ลองพิมพ์ใหม่หรือเลือกจาก dropdown`);
    fit();
  }
}

async function select(skill: SkillHit): Promise<void> {
  el.input.value = skill.skill;
  el.suggest.hidden = true;
  const d = await api.select(skill.skillType, skill.skill);
  if (!d) return;
  detail = d;
  const brackets = [...new Set([...Object.keys(d.mods), ...Object.keys(d.passives), ...Object.keys(d.populations)])].sort((a, b) => bracketKey(a) - bracketKey(b));
  if (!brackets.length) {
    clearResult(`ไม่พบข้อมูล mod/passive สำหรับ ${skill.skill} (อาจโหลดจาก hub ไม่สำเร็จ)`);
    fit();
    return;
  }
  el.brackets.replaceChildren(...brackets.map((b) => h("button", { type: "button", "data-bracket": b, "aria-pressed": "false", onclick: () => pickBracket(b) }, b)));
  pickBracket(brackets.includes("90-100") ? "90-100" : brackets[brackets.length - 1]);
}

function pickBracket(bracket: string): void {
  if (!detail) return;
  currentBracket = bracket;
  for (const b of el.brackets.querySelectorAll("button")) b.setAttribute("aria-pressed", String((b as HTMLElement).dataset.bracket === bracket));
  const population = detail.populations[bracket];
  if (population === undefined) {
    el.pop.textContent = `ฐาน: ${bracket} = ไม่ทราบจำนวน`;
    el.pop.className = "s-pop";
  } else {
    const thin = population < THIN_POPULATION;
    el.pop.textContent = `ฐาน: ${bracket} = ${population} คน` + (thin ? "  (ข้อมูลน้อย)" : "");
    el.pop.className = "s-pop" + (thin ? " thin" : "");
  }
  renderMods(bracket);
  renderPassives(bracket);
  fit();
}

function renderMods(bracket: string): void {
  const slots = detail?.mods[bracket] ?? {};
  const names = Object.keys(slots).sort();
  el.tabs.replaceChildren();
  el.mods.replaceChildren();
  if (!names.length) {
    el.label.textContent = `ไม่มีข้อมูล mod สำหรับ bracket ${bracket}`;
    return;
  }
  el.label.textContent = "Mod แนะนำต่อ slot:";
  slotTab = names.includes(slotTab) ? slotTab : names[0];
  el.tabs.replaceChildren(...names.map((s) => h("button", { type: "button", "data-slot": s, "aria-pressed": "false", onclick: () => pickSlot(s) }, s.charAt(0).toUpperCase() + s.slice(1).toLowerCase())));
  pickSlot(slotTab);
}

function pickSlot(slot: string): void {
  if (!detail) return;
  slotTab = slot;
  for (const b of el.tabs.querySelectorAll("button")) b.setAttribute("aria-pressed", String((b as HTMLElement).dataset.slot === slot));
  el.mods.replaceChildren(...(detail.mods[currentBracket]?.[slot] ?? []).map((m) =>
    h("div", { class: "s-mod" }, h("span", { class: "t" }, m.text), h("span", { class: "u" }, `${m.usagePct.toFixed(0)}%`),
      h("span", { class: "r" }, m.valueMin !== null && m.valueMax !== null ? `${fmtNum(m.valueMin)}–${fmtNum(m.valueMax)}` : ""))));
  fit();
}

function renderPassives(bracket: string): void {
  const rows = detail?.passives[bracket] ?? [];
  el.pass.replaceChildren(...(rows.length
    ? rows.map((p) => h("div", { class: "s-mod" }, h("span", { class: "t" }, p.keypassive), h("span", { class: "u" }, `${p.usagePct.toFixed(0)}%`)))
    : [h("div", { class: "s-note" }, "ไม่มีข้อมูล passive สำหรับ bracket นี้")]));
}

async function main(): Promise<void> {
  const { available } = await api.init();
  $("#root").replaceChildren(
    h("div", { class: "s-title" }, "Skill Mod Reference"),
    ...(available ? [] : [h("div", { class: "s-warn", id: "unavailable" }, "⚠ โหลดข้อมูลจาก hub ไม่สำเร็จ — ลองปิดแล้วเปิดใหม่")]),
    h("div", { class: "s-search" }, h("label", {}, "Skill:"), el.input),
    el.suggest, el.brackets, el.pop,
    h("div", { class: "s-body" }, el.label, el.tabs, el.mods, h("div", { class: "s-label" }, "Passive"), el.pass),
    h("div", { class: "s-actions" }, h("button", { type: "button", id: "btn-close", class: "secondary", onclick: () => api.close() }, "ปิด  (Esc)")));
  el.input.addEventListener("input", () => void onType());
  el.input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") void onEnter();
    else if (e.key === "ArrowDown" && !el.suggest.hidden) {
      e.preventDefault();
      (el.suggest.firstElementChild as HTMLElement | null)?.classList.add("sel");
      (el.suggest.firstElementChild as HTMLElement | null)?.focus();
    }
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") api.close();
  });
  el.input.focus();
  fit(true);
}

void main();
