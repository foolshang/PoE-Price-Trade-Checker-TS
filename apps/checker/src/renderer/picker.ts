/** The F5 popup: the mods of the item to tick, with min / max, before the trade page opens (the original's ModPickerWindow). */
import "@poe/ui/src/style.css";
import "./checker.css";
import { $, h } from "@poe/ui/src/dom.ts";
import type { PickerFilter, PickerInit } from "../shared/api.ts";
import { defaultChecked, pickerRowText } from "../shared/picker_text.ts";

const api = window.picker!;

function build(data: PickerInit): void {
  const rows: { box: HTMLInputElement | null; min: HTMLInputElement; max: HTMLInputElement }[] = [];
  const body = h("div", { id: "rows" });
  data.rows.forEach((r, i) => {
    const box = h("input", { type: "checkbox", id: `row-${i}`, checked: defaultChecked(r), disabled: !r.searchable });
    const min = h("input", { type: "text", class: "num", "aria-label": "min", id: `min-${i}`, disabled: !r.searchable, value: r.searchable ? r.min : "" });
    const max = h("input", { type: "text", class: "num", "aria-label": "max", id: `max-${i}`, disabled: !r.searchable });
    const affix = r.affix === "prefix" ? "P" : r.affix === "suffix" ? "S" : " ";
    body.append(h("div", { class: "p-row", "data-row": i },
      h("span", { class: "p-badge", style: r.badge ? { color: r.badge } : undefined }, r.badge ? "●" : ""),
      h("span", { class: "p-ps" }, affix + (r.arrow ?? " ")),
      h("label", { class: r.searchable ? (r.money ? "money" : "") : "off" }, box, h("span", {}, pickerRowText(r))),
      min, max));
    rows.push({ box, min, max });
  });
  const setAll = (v: boolean): void => rows.forEach((r, i) => { if (data.rows[i].searchable && r.box) r.box.checked = v; });
  const search = (): void => {
    const filters: PickerFilter[] = [];
    rows.forEach((r, i) => {
      if (data.rows[i].searchable && r.box?.checked) filters.push({ row: i, min: r.min.value.trim(), max: r.max.value.trim() });
    });
    api.search(filters);
  };
  $("#root").replaceChildren(
    h("div", { class: "p-head" }, data.head),
    h("div", { class: "p-sub" }, data.sub),
    ...(data.summary ? [h("div", { class: "p-summary" }, data.summary)] : []),
    body,
    h("div", { class: "p-sel" },
      h("button", { type: "button", id: "btn-all", onclick: () => setAll(true) }, "เลือกทั้งหมด"),
      h("button", { type: "button", id: "btn-none", onclick: () => setAll(false) }, "ไม่เลือกเลย")),
    h("div", { class: "p-actions" },
      h("button", { type: "button", id: "btn-search", onclick: search }, "🔎 ค้นหา  (Enter)"),
      h("button", { type: "button", id: "btn-cancel", class: "secondary", onclick: () => api.cancel() }, "ยกเลิก  (Esc)")));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") api.cancel();
    else if (e.key === "Enter") search();
  });
  requestAnimationFrame(() => {
    const r = document.body.getBoundingClientRect();
    api.ready({ width: Math.ceil(r.width), height: Math.ceil(r.height) });
  });
}

api.onInit(build);
