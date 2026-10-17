/**
 * The Whitelist tab: pick a tier, then its style (shown right there, no pop-up), then the sub tabs: items / categories,
 * Gold, Map / Waystone, Tablet (poe2), Gem, typed names - the same flow as the desktop panel. Gold / Map / Tablet / Gem each
 * show their own style editor (colours, opacity, size, icon, beam, sound) in their sub tab. All state lives in the WlModel
 * (via WebApi); this file only draws it and forwards clicks.
 */
import type { RowsResult } from "./api.ts";
import { K } from "./api.ts";
import { getGemNames } from "./data.ts";
import { debounce, esc, h } from "./dom.ts";
import { S, Ctx } from "./state.ts";
import { buildStyleEditor, StyleEditor } from "./style_editor.ts";

const EQUIP_GROUP_AUTO = "ทั้งกลุ่ม…";
const EQUIP_GROUP_DEFAULT = "ค่าเริ่มต้น";
const RARITY_WARNING = "ตั้ง D = ซ่อนทุกชิ้นของ rarity นั้น รวมตัวที่ mod ดีในหมวดอื่นด้วย";
const ABBR: Record<string, string> = { Normal: "N", Magic: "M", Rare: "R", Unique: "U" };
const TIERS_5 = ["S", "A", "B", "C", "D"];

type Parts = ReturnType<typeof S.api.wlParts>;

export const tabWl = {
  active: "", cat: "", query: "", selected: new Set<string>(), lastIdx: -1, rows: [] as RowsResult["rows"], parts: null as Parts | null,
  subtab: "items", equipGroup: "",
  ctx: null as unknown as Ctx,
  name: null as unknown as HTMLInputElement,
  openInput: null as unknown as HTMLInputElement,
  openBtn: null as unknown as HTMLElement,
  tierBtns: {} as Record<string, HTMLElement>,
  hint: null as unknown as HTMLElement,
  tierStyleBox: null as unknown as HTMLElement,
  tierEditor: null as StyleEditor | null,
  tierStack: null as unknown as HTMLInputElement,
  catSel: null as unknown as HTMLSelectElement,
  search: null as unknown as HTMLInputElement,
  info: null as unknown as HTMLElement,
  flaskBox: null as unknown as HTMLElement,
  equipBox: null as unknown as HTMLElement,
  equipTabs: null as unknown as HTMLElement,
  table: null as unknown as HTMLTableSectionElement,
  listWrap: null as unknown as HTMLElement,
  warn: null as unknown as HTMLElement,
  actBtns: [] as HTMLButtonElement[],
  itemStack: null as unknown as HTMLInputElement,
  itemStackBtn: null as unknown as HTMLButtonElement,
  itemsPane: null as unknown as HTMLElement,
  listBox: null as unknown as HTMLElement,
  subBar: null as unknown as HTMLElement,
  partsBox: null as unknown as HTMLElement,
  subBtns: {} as Record<string, HTMLElement>,
  subPanes: {} as Record<string, HTMLElement>,
  partEditors: {} as Record<string, { ed: StyleEditor; box: HTMLElement; look: () => any }>,

  mount(pane: HTMLElement, ctx: Ctx): void {
    this.ctx = ctx;
    this.name = h("input", { type: "text", class: "grow", "aria-label": "ชื่อ filter", oninput: () => ctx.changed() });
    this.openInput = h("input", { type: "file", accept: ".filter,.txt", hidden: true, id: "open-filter-input",
      onchange: async (e: Event) => {
        const t = e.target as HTMLInputElement;
        const f = t.files?.[0];
        t.value = "";
        if (f) await ctx.openFile(f);
      } });
    this.openBtn = h("button", { type: "button", id: "btn-open", class: "secondary", onclick: () => ctx.openFilter(() => this.openInput.click()) }, "เปิด filter…");

    // 1) tier
    const tierBox = h("span", { class: "tier-btns" });
    for (const t of ["S", "A", "B", "C"]) {
      const b = h("button", { type: "button", "data-t": t, "aria-pressed": "false", onclick: () => this.pickTier(t) }, t);
      this.tierBtns[t] = b;
      tierBox.append(b);
    }
    this.hint = h("span", { class: "warnline" }, "ยังไม่ได้เลือก — ส่วนอื่นยังกดไม่ได้");
    // 2) the tier's style, inline (rebuilt for the picked tier: its sound file is kept in that tier's slot)
    this.tierStyleBox = h("div", { id: "tier-style", class: "style-box", hidden: true });
    // stack of the tier
    this.tierStack = h("input", { type: "number", min: 1, value: 1, "aria-label": "โชว์เมื่อจำนวน ≥ (tier)", oninput: () => this.applyTierStack() });

    // items sub pane
    this.catSel = h("select", { "aria-label": "หมวด", onchange: () => { this.cat = this.catSel.value; this.selected.clear(); this.refreshList(); } });
    this.search = h("input", { type: "search", placeholder: "ค้นหา…", "aria-label": "ค้นหา",
      oninput: debounce(() => { this.query = this.search.value; this.refreshList(); }, 150) });
    this.info = h("div", { class: "hint" });
    // the "Flask / Charm" (Tincture) category: no list, one box per row - default = NeverSink's blocks, or set myself
    this.flaskBox = h("div", { id: "flask-box", hidden: true });
    // equipment by class: groups (weapon / armour / jewellery / other), one row per class, scrolls
    this.equipBox = h("div", { id: "equip-box", hidden: true });
    this.table = h("tbody");
    this.listWrap = h("div", { class: "list-wrap", id: "item-list" },
      h("table", { class: "items" }, h("thead", {}, h("tr", {}, h("th", {}, "ชื่อ (คลิกช่อง = ติ๊ก/เอาออก)"), h("th", { style: { textAlign: "center" } }, "tier"), h("th", {}, ""))), this.table));
    this.table.addEventListener("click", (e) => this.onRowClick(e));
    this.warn = h("div", { class: "warnline" });
    this.actBtns = [
      h("button", { type: "button", class: "secondary", id: "btn-cat-tier", onclick: () => this.doCat(this.active) }, "ทั้งหมวด → tier นี้"),
      h("button", { type: "button", class: "secondary", id: "btn-cat-d", onclick: () => this.doCat("D") }, "ทั้งหมวด → D (ซ่อน)"),
      h("button", { type: "button", class: "secondary", id: "btn-move", onclick: () => this.doMove() }, "ย้ายที่เลือก → tier นี้"),
      h("button", { type: "button", class: "secondary", id: "btn-reset-sel", onclick: () => this.doReset(false) }, "รีเซ็ตที่เลือกเป็นค่า NeverSink"),
      h("button", { type: "button", class: "secondary", id: "btn-reset-cat", onclick: () => this.doReset(true) }, "รีเซ็ตทั้งหมวด"),
    ];
    this.itemStack = h("input", { type: "number", min: 1, value: 1, "aria-label": "จำนวนขั้นต่ำของที่เลือก" });
    this.itemStackBtn = h("button", { type: "button", class: "secondary", id: "btn-item-stack", onclick: () => this.doItemStack() }, "ตั้งที่เลือก");
    this.listBox = h("div", { id: "list-box" }, this.listWrap, this.warn,
      h("div", { class: "bar" }, this.actBtns.slice(0, 3)), h("div", { class: "bar" }, this.actBtns.slice(3)),
      h("div", { class: "row" }, h("label", {}, "จำนวนขั้นต่ำของที่เลือก ≥"), this.itemStack, this.itemStackBtn, h("span", { class: "hint" }, "(1 = โชว์ทุกชิ้น)")));
    this.itemsPane = h("div", { class: "subpane", id: "pane-sub-items" },
      h("div", { class: "row" }, this.catSel, this.search), this.info, this.flaskBox, this.equipBox, this.listBox);
    // the other sub tabs are built in drawParts (they depend on the game)
    this.subBar = h("div", { class: "subtabs", role: "tablist" });
    this.partsBox = h("div", { id: "parts-box" });
    const btnGen = h("button", { type: "button", id: "btn-generate-wl", onclick: () => ctx.generate("whitelist", false) }, "Generate Now");
    const btnReload = h("button", { type: "button", class: "secondary", id: "btn-reload", onclick: () => ctx.reloadLists() }, "โหลดรายการใหม่");

    pane.replaceChildren(
      h("div", { class: "row" }, h("label", { class: "l" }, "ชื่อ filter:"), this.name, h("span", { class: "hint" }, ".filter"), this.openBtn, this.openInput),
      h("div", { class: "row" }, h("label", { class: "l" }, "1) เลือก tier:"), tierBox, this.hint),
      h("div", { class: "row top" }, h("label", { class: "l" }, "2) สไตล์ของ tier:"), this.tierStyleBox),
      h("div", { class: "row" }, h("label", { class: "l" }, "โชว์เมื่อจำนวน ≥"), this.tierStack,
        h("span", { class: "hint" }, "(1 = โชว์ทุกชิ้น · ใช้กับของที่ stack ได้ · ค่ารายชิ้นที่สูงกว่าชนะ)")),
      this.subBar, this.itemsPane, this.partsBox,
      h("div", { class: "actions center" }, btnGen, btnReload));
    this.drawSubBar("poe2");
    this.refreshEnabled();
  },

  // ---------------------------------------------------------------- loading / refreshing
  load(cfg: Record<string, any>): void {
    this.name.value = cfg.filter_name_whitelist || K.default_names.whitelist;
  },
  collect(cfg: Record<string, any>): Record<string, any> {
    cfg.filter_name_whitelist = this.name.value.trim() || K.default_names.whitelist;
    return cfg;
  },
  /** after the model (re)started or got its lists / a file was opened: redraw everything from the model */
  reload(): void {
    const cats = S.api.wlCategories();
    this.catSel.replaceChildren(...cats.map((c) => h("option", { value: c.id }, c.label)));
    if (!cats.some((c) => c.id === this.cat)) this.cat = cats.length ? cats[0].id : "";
    this.catSel.value = this.cat;
    this.selected.clear();
    this.parts = S.api.wlParts();
    this.drawParts();
    this.onTierPicked();
    this.refreshList();
  },
  setLoading(on: boolean): void {
    if (on) this.info.textContent = "กำลังโหลดรายการ… (hub + NeverSink)";
  },
  showSub(which: string): void {
    this.subtab = which;
    this.itemsPane.hidden = which !== "items";
    for (const [k, el] of Object.entries(this.subPanes)) el.hidden = k !== which;
    for (const [k, b] of Object.entries(this.subBtns)) b.setAttribute("aria-selected", String(k === which));
  },
  /** the sub tab buttons: items, Gold, Map / Waystone, Tablet (poe2 only), Gem, typed names */
  drawSubBar(game: string): void {
    const names: [string, string][] = [["items", "ไอเท็ม / หมวด"], ["gold", "Gold"], ["map", game === "poe2" ? "Waystone" : "Map"]];
    if (game === "poe2") names.push(["tablet", "Tablet"]);
    names.push(["gem", "Gem"], ["custom", "พิมพ์เอง"]);
    this.subBtns = {};
    this.subBar.replaceChildren(...names.map(([k, text]) => {
      const b = h("button", { type: "button", role: "tab", id: `subtab-${k}`, "aria-selected": String(k === this.subtab), onclick: () => this.showSub(k) }, text);
      this.subBtns[k] = b;
      return b;
    }));
    if (!(this.subtab in this.subBtns)) this.subtab = "items";
  },

  // ---------------------------------------------------------------- tier + style
  pickTier(t: string): void {
    this.active = t;
    this.onTierPicked();
  },
  onTierPicked(): void {
    for (const [t, b] of Object.entries(this.tierBtns)) b.setAttribute("aria-pressed", String(t === this.active));
    this.refreshEnabled();
    this.refreshPreview();
    if (this.active && this.parts) this.tierStack.value = String(this.parts.tier_stack[this.active] || 1);
    else this.tierStack.value = "1";
    this.refreshList();
  },
  refreshEnabled(): void {
    const on = !!this.active;
    for (const el of [this.catSel, this.search, this.tierStack, this.itemStack, this.itemStackBtn, ...this.actBtns] as (HTMLInputElement | HTMLSelectElement | HTMLButtonElement)[]) el.disabled = !on;
    this.hint.textContent = on ? "" : "ยังไม่ได้เลือก — ส่วนอื่นยังกดไม่ได้";
    this.listWrap.classList.toggle("disabled", !on);
    this.tierStyleBox.hidden = !on;
  },
  /** An inline editor of the model's look for one label. Every edit goes to the model at once (no save button). */
  styleEditor(label: string, sample: string) {
    const look = (): any => S.api.wlStyle(label).effective;
    const ed = buildStyleEditor({
      style: look(), showSound: true, soundLabel: label, sample,
      onChange: (style) => { S.api.wlSetStyle(label, style); this.ctx.changed(); },
    });
    const reset = h("button", { type: "button", class: "secondary", id: `btn-style-reset-${label}`,
      onclick: () => { S.api.wlClearStyle(label); ed.set(look()); this.ctx.changed(); } }, "รีเซ็ตเป็นค่า NeverSink");
    const box = h("div", { class: "style-box", "data-style": label }, ed.el, reset);
    return { ed, box, look };
  },
  refreshPreview(): void {
    const t = this.active;
    if (!t) {
      this.tierEditor = null;
      this.tierStyleBox.replaceChildren();
      return;
    }
    const made = this.styleEditor(t, `ตัวอย่าง ${t}`);
    this.tierEditor = made.ed;
    made.box.id = "tier-style-editor";
    this.tierStyleBox.replaceChildren(made.box);
  },
  applyTierStack(): void {
    if (!this.active) return;
    S.api.wlDo("set_tier_stack", { tier: this.active, n: parseInt(this.tierStack.value, 10) || 1 });
    this.refreshList();
    this.ctx.changed();
  },

  // ---------------------------------------------------------------- the list
  refreshList(): void {
    if (!this.cat) return;
    const res = S.api.wlRows(this.cat, this.query);
    if (res.loading) {
      this.info.textContent = "กำลังโหลดรายการ… (hub + NeverSink)";
      this.table.replaceChildren();
      return;
    }
    if (res.info.flask) { this.drawFlask(res); return; }
    if (res.info.equip) { this.drawEquip(res); return; }
    this.rows = res.rows;
    const valid = new Set(res.rows.map((r) => r.key));
    for (const k of [...this.selected]) if (!valid.has(k)) this.selected.delete(k);
    const out: string[] = [];
    for (const r of res.rows) {
      const on = r.tier !== "D";
      let tierText = on ? (r.tier === "T" ? "Tablet" : r.tier) : "D";
      if (on && r.stack > 1) tierText += ` ≥${r.stack}`;
      const mark = r.user_set || r.stack_set ? "● ตั้งเอง" : "";
      out.push(`<tr data-key="${esc(r.key)}" data-tier="${r.tier}"${this.selected.has(r.key) ? ' class="sel"' : ""}>` +
        `<td class="name"><label><input type="checkbox"${on ? " checked" : ""}${this.active ? "" : " disabled"} aria-label="โชว์"><span class="txt">${esc(r.label)}</span></label></td>` +
        `<td class="tier">${esc(tierText)}</td><td class="mark">${mark}</td></tr>`);
    }
    this.table.innerHTML = out.join("");
    const inf = res.info;
    let text = `${inf.count} แถว · ตั้งเองแล้ว ${inf.changed}`;
    if (inf.cat_tier) text += ` · ทั้งหมวด = ${inf.cat_tier}`;
    this.info.textContent = text;
    this.warn.textContent = (res.warn || []).join("\n");
    this.listBox.hidden = false;
    this.flaskBox.hidden = true;
    this.equipBox.hidden = true;
  },
  drawEquip(res: RowsResult): void {
    const keep = this.equipBox.scrollTop;
    this.listBox.hidden = true;
    this.flaskBox.hidden = true;
    this.equipBox.hidden = false;
    this.info.textContent = res.info.changed ? `ตั้งค่าเองแล้ว ${res.info.changed} class` : "ตั้งค่าเองแล้ว ไม่มี — ใช้ NeverSink ทั้งหมด";
    const groups = res.equip!.filter((g) => g.classes.length); // a group with no class in this game has no tab
    if (!groups.some((g) => g.id === this.equipGroup)) this.equipGroup = groups.length ? groups[0].id : "";
    const panes = groups.map((g) => {
      // "set the whole group": one select per rarity (same width), each fills every row of the group
      const head = h("div", { class: "equip-head" }, h("span", { class: "t" }, "ตั้งทั้งกลุ่ม"),
        h("div", { class: "tier-grid" }, ...["Normal", "Magic", "Rare"].map((r) => {
          const s = h("select", { "aria-label": `${g.label} ตั้งทั้งกลุ่ม ${r}`, onchange: () => {
            if (s.value === EQUIP_GROUP_AUTO) return;
            this.edit("set_equip_group", { group: g.id, rarity: r, tier: s.value === EQUIP_GROUP_DEFAULT ? null : s.value });
          } }, [EQUIP_GROUP_AUTO, EQUIP_GROUP_DEFAULT, ...TIERS_5].map((v) => h("option", { value: v }, v)));
          return h("label", {}, r, s);
        })));
      const rows = g.classes.map((c) => {
        const mode = (val: string, text: string) => h("label", { class: "radio" }, h("input", { type: "radio", name: `equip-${c.id}`, value: val,
          checked: (c.custom ? "custom" : "default") === val, "aria-label": `${c.label} ${text}`,
          onchange: () => this.edit("set_equip_custom", { cls: c.id, custom: val === "custom" }) }), " " + text);
        const sels = ["Normal", "Magic", "Rare"].map((r) => {
          const s: HTMLSelectElement = h("select", { "aria-label": `${c.label} rarity ${r}`, disabled: !c.custom,
            onchange: () => this.edit("set_equip_rarity", { cls: c.id, rarity: r, tier: s.value }) },
            TIERS_5.map((v) => h("option", { value: v, selected: v === (c.tiers[r] || "B") }, v)));
          return h("label", {}, r, s);
        });
        return h("div", { class: "equip-row", "data-class": c.id },
          h("span", { class: "cls" }, c.label),
          h("div", { class: "equip-modes" }, mode("default", "ค่าเริ่มต้น"), mode("custom", "ตั้งค่าเอง")),
          h("div", { class: "tier-grid" }, ...sels));
      });
      return h("div", { class: "equip-group", id: `equip-pane-${g.id}`, "data-group": g.id, hidden: g.id !== this.equipGroup }, head, ...rows);
    });
    const tabs = h("div", { class: "subtabs equip-tabs", role: "tablist" }, ...groups.map((g) =>
      h("button", { type: "button", role: "tab", id: `equip-tab-${g.id}`, "aria-selected": String(g.id === this.equipGroup),
        onclick: () => { this.equipGroup = g.id; this.drawEquipSelection(); } }, g.label)));
    this.equipTabs = tabs;
    this.equipBox.replaceChildren(h("div", { class: "hint" },
      "ค่าเริ่มต้น = block ของ NeverSink · ตั้งค่าเอง = ทุก rarity เป็น S/A/B/C/D (เริ่มที่ B) ชนะทุกชิ้นของ class+rarity นั้น รวมของดีที่ NeverSink จัดไว้ · D = ซ่อนทั้งหมด · Unique ตั้งที่หมวด Unique · Flask/Charm/Tincture มีหมวดของตัวเอง"),
    tabs, ...panes);
    this.equipBox.scrollTop = keep;
  },
  /** show the pane of the picked equipment group (no redraw: nothing changed) */
  drawEquipSelection(): void {
    for (const b of this.equipTabs.querySelectorAll("button")) b.setAttribute("aria-selected", String(b.id === `equip-tab-${this.equipGroup}`));
    for (const p of this.equipBox.querySelectorAll<HTMLElement>(".equip-group")) p.hidden = p.dataset.group !== this.equipGroup;
  },
  drawFlask(res: RowsResult): void {
    this.listBox.hidden = true;
    this.equipBox.hidden = true;
    this.flaskBox.hidden = false;
    this.info.textContent = res.info.changed ? `ตั้งค่าเองแล้ว ${res.info.changed} แถว` : "ตั้งค่าเองแล้ว ไม่มี — ใช้ NeverSink ทั้งหมด";
    const boxes = res.flask!.map((fr) => {
      const mode = (val: string, text: string) => h("label", { class: "radio" }, h("input", { type: "radio", name: `flask-${fr.id}`, value: val,
        checked: (fr.custom ? "custom" : "default") === val, "aria-label": `${fr.label} ${text}`,
        onchange: () => this.edit("set_flask_custom", { row: fr.id, custom: val === "custom" }) }), " " + text);
      const sels = h("div", { class: "tier-grid two" }, ...["Normal", "Magic"].map((r) => {
        const s: HTMLSelectElement = h("select", { "aria-label": `${fr.label} rarity ${r}`, onchange: () => this.edit("set_flask_rarity", { row: fr.id, rarity: r, tier: s.value }) },
          TIERS_5.map((v) => h("option", { value: v, selected: v === (fr.tiers[r] || "B") }, v)));
        return h("label", {}, r, s);
      }));
      return h("div", { class: "rarity-box", "data-row": fr.id },
        h("div", { class: "t" }, fr.label),
        h("div", { class: "radios" }, mode("default", "ค่าเริ่มต้น (block ของ NeverSink ทั้งหมดของแถวนี้)"), mode("custom", "ตั้งค่าเอง")),
        fr.custom ? sels : null,
        fr.custom ? h("div", { class: "warnline rarity-warning" }, RARITY_WARNING) : null);
    });
    this.flaskBox.replaceChildren(...boxes, h("div", { class: "hint" }, 'Unique ตั้งที่หมวด Unique · แถวที่เป็น "ค่าเริ่มต้น" ใช้ block ของ NeverSink ตามเดิม'));
  },
  onRowClick(e: MouseEvent): void {
    const target = e.target as HTMLElement;
    const tr = target.closest<HTMLElement>("tr[data-key]");
    if (!tr) return;
    const key = tr.dataset.key as string;
    if (target.matches("input[type=checkbox]")) {
      e.preventDefault();
      if (!this.active) return;
      S.api.wlDo("toggle", { cat: this.cat, key, active: this.active });
      this.refreshList();
      this.ctx.changed();
      return;
    }
    if (!this.active) return;
    const idx = this.rows.findIndex((r) => r.key === key);
    if (e.shiftKey && this.lastIdx >= 0) {
      const [a, b] = [Math.min(idx, this.lastIdx), Math.max(idx, this.lastIdx)];
      for (let i = a; i <= b; i++) this.selected.add(this.rows[i].key);
    } else if (e.ctrlKey || e.metaKey) {
      if (this.selected.has(key)) this.selected.delete(key);
      else this.selected.add(key);
      this.lastIdx = idx;
    } else {
      this.selected = new Set([key]);
      this.lastIdx = idx;
    }
    for (const t of Array.from(this.table.rows)) t.classList.toggle("sel", this.selected.has(t.dataset.key as string));
  },
  edit(action: string, args: Record<string, any>): void {
    S.api.wlDo(action, { cat: this.cat, ...args });
    this.refreshList();
    this.ctx.changed();
  },
  doCat(tier: string): void { if (tier) this.edit("set_category", { tier }); },
  doMove(): void { if (this.active) this.edit("move", { keys: [...this.selected], tier: this.active }); },
  doReset(whole: boolean): void {
    if (whole) this.edit("reset_category", {});
    else this.edit("reset_rows", { keys: [...this.selected] });
  },
  doItemStack(): void { this.edit("set_stack", { keys: [...this.selected], n: parseInt(this.itemStack.value, 10) || 1 }); },

  // ---------------------------------------------------------------- parts ("ส่วนแยก")
  setParts(patch: Record<string, any>): void {
    Object.assign(this.parts as object, patch);
    S.api.wlSetParts(patch);
    this.ctx.changed();
  },
  drawParts(): void {
    const p = this.parts as Parts;
    const game = p.game;
    const num = (value: number, onInput: (v: string) => void, w = "5em", min = 0, max: number | undefined, label: string) =>
      h("input", { type: "number", min, max, value, style: { width: w }, "aria-label": label, oninput: (e: Event) => onInput((e.target as HTMLInputElement).value) });
    const chk = (checked: boolean, label: string, cb: (v: boolean) => void, id: string) =>
      h("label", {}, h("input", { type: "checkbox", checked, id, onchange: (e: Event) => cb((e.target as HTMLInputElement).checked) }), " " + label);
    const sel = (values: string[], cur: string, cb: (v: string) => void) =>
      h("select", { onchange: (e: Event) => cb((e.target as HTMLSelectElement).value) }, values.map((v) => h("option", { value: v, selected: v === cur }, v)));
    const mapName = game === "poe2" ? "Waystone" : "Map";
    const panes: Record<string, HTMLElement> = {};
    const pane = (key: string, ...kids: (Node | string | null)[]): void => {
      panes[key] = h("div", { class: "subpane", id: `pane-sub-${key}`, hidden: true }, ...kids);
    };
    this.partEditors = {};
    const styled = (label: string, sample: string): HTMLElement => {
      const m = this.styleEditor(label, sample);
      this.partEditors[label] = m;
      return m.box;
    };

    pane("gold", h("div", { class: "row" }, chk(p.gold, "Gold", (v) => this.setParts({ gold: v }), "chk-gold"), h("label", {}, "จำนวน ≥"),
      num(p.gold_min, (v) => this.setParts({ gold_min: v }), "6em", 0, undefined, "จำนวนขั้นต่ำของ Gold")),
      h("div", { class: "hint" }, "(ไม่ติ๊ก = โชว์ตามเกม)"), styled("G", "Gold"));
    pane("map", h("div", { class: "row" }, chk(p.map_on, `${mapName} (ต้องผ่านทั้ง 2 เงื่อนไข)`, (v) => this.setParts({ map_on: v }), "chk-map")),
      h("div", { class: "row" }, h("label", {}, "tier ≥"), num(p.map_tier, (v) => this.setParts({ map_tier: v }), "4em", 1, 16, "tier ขั้นต่ำของ map"),
        h("label", {}, "rarity ≥"), sel(K.rarities, p.map_rarity, (v) => this.setParts({ map_rarity: v }))),
      h("div", { class: "hint" }, "(ไม่ติ๊ก = โชว์ตามเกม · poe1: map พิเศษผ่านเสมอ)"), styled("Map", mapName));
    if (game === "poe2") {
      pane("tablet", h("div", { class: "hint" }, "Tablet โชว์เสมอ ยกเว้นตั้ง tier รายชิ้น (หมวด Tablet ที่แท็บไอเท็ม / หมวด)"), styled("Tablet", "Tablet"));
    }
    // gems
    const gem = h("div", { class: "box" }, h("h4", {}, "Gem"));
    gem.append(h("div", { class: "row" }, h("label", {}, "tier"), sel(K.all_tiers, p.gem_tier, (v) => {
      this.setParts({ gem_tier: v });
      const m = this.partEditors.Gem;
      if (m) m.ed.set(m.look()); // the Gem look follows the tier picked for the gems
    })));
    if (p.gem_uncut_bases.length) {
      const gemRows: [string, HTMLInputElement, HTMLInputElement][] = [];
      for (const base of p.gem_uncut_bases) {
        const lv = h("input", { type: "number", min: 1, value: p.gem_uncut[base] || 1, style: { width: "4.5em" } });
        const cb = h("input", { type: "checkbox", checked: base in p.gem_uncut });
        const upd = (): void => {
          const m: Record<string, number> = {};
          gemRows.forEach(([b, c, l]) => { if (c.checked) m[b] = parseInt(l.value, 10) || 1; });
          this.setParts({ gem_uncut: m });
        };
        cb.addEventListener("change", upd);
        lv.addEventListener("input", upd);
        gemRows.push([base, cb, lv]);
        gem.append(h("div", { class: "row" }, h("label", {}, cb, " " + base), h("label", {}, "level ≥"), lv));
      }
    } else {
      const input = h("input", { type: "text", list: "gem-datalist", placeholder: "ชื่อ gem", "aria-label": "ชื่อ gem", id: "gem-input" });
      const dl = h("datalist", { id: "gem-datalist" });
      getGemNames(game).then((names) => dl.replaceChildren(...names.map((n) => h("option", { value: n }))));
      const chips = h("ul", { class: "chips", id: "gem-chips" });
      const draw = (): void => chips.replaceChildren(...(this.parts as Parts).gem_names.map((n, i) => h("li", {}, n,
        h("button", { type: "button", "aria-label": `ลบ ${n}`, onclick: () => {
          (this.parts as Parts).gem_names.splice(i, 1);
          this.setParts({ gem_names: (this.parts as Parts).gem_names });
          draw();
        } }, "×"))));
      const add = (): void => {
        const nm = input.value.trim();
        const names = (this.parts as Parts).gem_names;
        if (nm && !names.some((x) => x.toLowerCase() === nm.toLowerCase())) {
          names.push(nm);
          this.setParts({ gem_names: names });
          draw();
        }
        input.value = "";
      };
      input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); add(); } });
      gem.append(h("div", { class: "row" }, input, dl, h("button", { type: "button", class: "secondary", id: "gem-add", onclick: add }, "เพิ่ม")), chips);
      draw();
    }
    pane("gem", gem, h("div", { class: "hint" }, "สไตล์ของ Gem = สไตล์ของ tier ที่เลือกข้างบน (แก้ตรงนี้ = เปลี่ยนเฉพาะ Gem)"), styled("Gem", "Gem"));
    // typed names
    const cust = h("div", { class: "box" }, h("h4", {}, "พิมพ์ชื่อเอง (contains)"));
    const cName = h("input", { type: "text", placeholder: "เช่น heavy belt", "aria-label": "ชื่อที่พิมพ์เอง", id: "custom-input" });
    const cTier = h("select", { "aria-label": "tier ของชื่อที่พิมพ์" }, K.all_tiers.map((t) => h("option", { value: t, selected: t === "B" }, t)));
    const rarChecks = K.rarities.map((r) => h("label", {}, h("input", { type: "checkbox", checked: true, value: r }), " " + r));
    const list = h("ul", { class: "chips", id: "custom-chips" });
    const drawC = (): void => list.replaceChildren(...(this.parts as Parts).custom.map((e, i) => h("li", {}, `${e.name}  [${e.rarities.map((r) => ABBR[r]).join("/")}] → ${e.tier}`,
      h("button", { type: "button", "aria-label": `ลบ ${e.name}`, onclick: () => {
        S.api.wlCustomRemove(i);
        this.parts = S.api.wlParts();
        drawC();
        this.ctx.changed();
      } }, "×"))));
    const addC = (): void => {
      const rs = rarChecks.map((l) => l.firstChild as HTMLInputElement).filter((c) => c.checked).map((c) => c.value);
      S.api.wlCustomAdd(cName.value, rs, cTier.value);
      cName.value = "";
      this.parts = S.api.wlParts();
      drawC();
      this.ctx.changed();
    };
    cName.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); addC(); } });
    cust.append(h("div", { class: "row" }, cName, cTier, h("button", { type: "button", class: "secondary", id: "custom-add", onclick: addC }, "เพิ่ม")),
      h("div", { class: "row" }, ...rarChecks), list);
    drawC();
    pane("custom", cust);
    this.subPanes = panes;
    this.drawSubBar(game);
    this.partsBox.replaceChildren(...Object.values(panes));
    this.showSub(this.subtab);
  },
};
