/**
 * The NeverSink tab: NeverSink's own tiers (no prices): filter name, strictness, the quest (Q) style, the six numbered
 * sound files (sound 1 <- NeverSink's number 6, 2 <- 1, 3 <- 2, 4 <- 3, 5 <- 4, 6 <- 5), the NeverSink version in use,
 * Generate / Refresh NeverSink Base.
 */
import { K } from "./api.ts";
import { nsLast } from "./data.ts";
import { h } from "./dom.ts";
import { sounds } from "./files.ts";
import { platform } from "./platform.ts";
import { Ctx } from "./state.ts";
import { openStyleDialog } from "./style_editor.ts";

const isEmptyStyle = (s: any): boolean => !s || (!s.text && !s.border && !s.bg && !s.icon && !s.effect && (s.size === null || s.size === undefined) &&
  (!s.sound || s.sound.kind === "none"));
const NUMS = ["1", "2", "3", "4", "5", "6"];

export const tabNs = {
  ctx: null as unknown as Ctx,
  name: null as unknown as HTMLInputElement,
  strict: null as unknown as HTMLSelectElement,
  qLbl: null as unknown as HTMLElement,
  qBtn: null as unknown as HTMLElement,
  tag: null as unknown as HTMLElement,
  soundRows: {} as Record<string, { label: HTMLElement }>,

  mount(pane: HTMLElement, ctx: Ctx): void {
    this.ctx = ctx;
    this.name = h("input", { type: "text", class: "grow", "aria-label": "ชื่อ filter", oninput: () => ctx.changed() });
    this.strict = h("select", { "aria-label": "NeverSink Strictness", onchange: () => ctx.changed() },
      K.levels.map((l, i) => h("option", { value: i }, `${i} - ${l}`)));
    this.qLbl = h("span", { class: "hint" });
    this.qBtn = h("button", { type: "button", class: "secondary", onclick: () => this.editQ() }, "ตั้งสไตล์…");
    const soundRow = (n: string): HTMLElement => {
      const label = h("span", { class: "hint" });
      const file = h("input", { type: "file", accept: "audio/*,.mp3,.wav,.ogg", "aria-label": `ไฟล์เสียง ${n}`,
        onchange: async (e: Event) => {
          const f = (e.target as HTMLInputElement).files?.[0];
          if (f) {
            ctx.cfg[`sound_${n}`] = await sounds.setFile(n, f);
            this.refreshSounds();
            ctx.changed();
          }
        } });
      const clear = h("button", { type: "button", class: "secondary", "aria-label": `ล้างเสียง ${n}`, onclick: async () => {
        await sounds.clear(n);
        ctx.cfg[`sound_${n}`] = "";
        file.value = "";
        this.refreshSounds();
        ctx.changed();
      } }, "Clear");
      this.soundRows[n] = { label };
      return h("div", { class: "row" }, h("label", { class: "l" }, `เสียง ${n}`), label, file, clear);
    };
    this.tag = h("div", { class: "hint", id: "ns-tag" });
    const btnGen = h("button", { type: "button", id: "btn-generate-tier", onclick: () => ctx.generate("tier", false) }, "Generate Now");
    const btnRefresh = h("button", { type: "button", id: "btn-refresh", class: "secondary", onclick: () => ctx.generate("tier", true) }, "Refresh NeverSink Base");
    pane.replaceChildren(
      h("div", { class: "row" }, h("label", { class: "l" }, "ชื่อ filter:"), this.name, h("span", { class: "hint" }, ".filter")),
      h("div", { class: "row" }, h("label", { class: "l" }, "NeverSink Strictness:"), this.strict),
      h("div", { class: "row" }, h("label", { class: "l" }, "ของเควส (Q):"), this.qBtn, this.qLbl),
      h("div", { class: "section" }, "Alert sounds:"),
      ...NUMS.map(soundRow),
      this.tag,
      ...(platform().nsExtras?.(ctx.cfg, () => ctx.changed()) ?? []),
      h("div", { class: "actions" }, btnGen, btnRefresh));
  },

  load(cfg: Record<string, any>, game: string): void {
    this.name.value = cfg.filter_name_tier || K.default_names.tier;
    const s = cfg[`strictness_${game}`];
    this.strict.value = String(Number.isInteger(s) ? s : 2);
    this.refreshQ(cfg);
    this.refreshSounds();
    this.showTag(game);
  },

  collect(cfg: Record<string, any>, game: string): Record<string, any> {
    cfg[`strictness_${game}`] = parseInt(this.strict.value, 10);
    cfg.filter_name_tier = this.name.value.trim() || K.default_names.tier;
    return cfg;
  },

  refreshQ(cfg: Record<string, any>): void {
    const set = cfg.style_q && !isEmptyStyle(cfg.style_q);
    this.qLbl.textContent = set ? "ตั้งสไตล์เองแล้ว" : "ใช้ของ NeverSink";
    this.qLbl.style.color = set ? "var(--accent)" : "";
  },

  refreshSounds(): void {
    for (const n of NUMS) {
      const name = this.ctx.cfg[`sound_${n}`] || "";
      this.soundRows[n].label.textContent = name || "(ไม่ตั้ง — ใช้เสียงของ NeverSink)";
    }
  },

  showTag(game: string): void {
    const last = nsLast(game);
    this.tag.textContent = last.tag
      ? `NeverSink ที่ใช้: ${last.tag} (เช็คล่าสุด ${String(last.checked_at || "").slice(0, 16).replace("T", " ")}) — กด Refresh เพื่อดึงใหม่`
      : "NeverSink: ยังไม่เคยดึง — จะดึงตอนกด Generate";
  },

  editQ(): void {
    const ctx = this.ctx;
    openStyleDialog({
      title: "สไตล์ของเควส (Q)", style: ctx.cfg.style_q || K.style.default_quest, showSound: true, soundLabel: "Q",
      sample: "Quest Item", clearText: "ล้าง (ใช้ของ NeverSink)", hint: "ใช้ทั้ง 2 แท็บ · ของเควสโชว์เสมอ",
      onSave: async (style) => {
        ctx.cfg.style_q = style; // null = not set (NeverSink's own look); an emptied style is kept as is
        if (style === null) await sounds.clear("Q");
        this.refreshQ(ctx.cfg);
        ctx.changed();
      },
    });
  },
};
