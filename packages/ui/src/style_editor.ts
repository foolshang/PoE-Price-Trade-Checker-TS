/**
 * The style editor (colours with opacity, size, icon, effect, sound) - same fields as the desktop editor. One builder, two
 * uses: buildStyleEditor() makes the editor itself (the sub tabs of the Whitelist tab show it inline, every edit goes to
 * onChange(style) at once) and openStyleDialog() wraps it in the modal dialog (the quest (Q) style of the NeverSink tab).
 * The editor works on a copy of the style dict; the model decides what it stores.
 */
import { K } from "./api.ts";
import { $, clone, h, hex, rgba, unhex } from "./dom.ts";
import { sounds } from "./files.ts";

const COLOR_PARTS: [string, string][] = [["text", "ตัวอักษร"], ["border", "กรอบ"], ["bg", "พื้นหลัง"]];

type St = Record<string, any>;

export interface StyleEditorOpts {
  style: St;
  showSound?: boolean;
  /** the sound slot a picked file is kept in */
  soundLabel?: string;
  sample?: string;
  onChange?: (style: St) => void;
}

export interface StyleEditor {
  el: HTMLElement;
  get(): St;
  /** show another style (no onChange fired) */
  set(style: St): void;
}

export function buildStyleEditor(opts: StyleEditorOpts): StyleEditor {
  const KS = K.style;
  let st: St = clone(opts.style);
  const prevAlpha: Record<string, number> = {}; // part -> last non-zero opacity (restored by un-ticking "โปร่งใส")
  let on: Record<string, boolean> = {};
  const preview = h("div", { class: "style-preview" }, opts.sample || "ตัวอย่าง");
  const grid = h("div", { class: "style-grid" });
  let muted = false; // set() redraws the controls: no onChange while it runs

  const out = (): St => {
    const o = clone(st);
    for (const part of ["text", "border", "bg"]) o[part] = on[part] ? st[part] : null;
    o.size = on.size ? st.size : null;
    o.icon = on.icon ? st.icon : null;
    o.effect = on.effect ? st.effect : null;
    if (!opts.showSound) o.sound = { kind: "none", id: 1, file: "", volume: KS.default_volume };
    return o;
  };
  const refresh = (): void => {
    const bg = on.bg && st.bg ? rgba(st.bg, "#101010") : "#101010";
    preview.style.background = bg;
    preview.style.color = on.text && st.text ? rgba(st.text, "#c8c8c8") : "#c8c8c8";
    preview.style.borderColor = on.border && st.border ? rgba(st.border, bg) : "#555";
    preview.style.fontSize = (on.size && st.size ? Math.max(11, Math.min(26, st.size / 1.8)) : 15) + "px";
  };
  const touch = (): void => {
    refresh();
    if (!muted && opts.onChange) opts.onChange(out());
  };

  const build = (): void => {
    on = { text: !!st.text, border: !!st.border, bg: !!st.bg, size: st.size !== null && st.size !== undefined, icon: !!st.icon, effect: !!st.effect };
    const rows: HTMLElement[] = [];
    const row = (label: string, ...ctl: (HTMLElement | null)[]): void => {
      rows.push(h("label", { class: "l" }, label), h("div", { class: "ctl" }, ...ctl));
    };
    const tick = (part: string): HTMLElement => h("input", { type: "checkbox", checked: on[part], "aria-label": "ใช้ส่วนนี้",
      onchange: (e: Event) => { on[part] = (e.target as HTMLInputElement).checked; touch(); } });

    // colours + opacity
    for (const [part, label] of COLOR_PARTS) {
      if (!st[part]) st[part] = [255, 255, 255, 255];
      if (st[part].length < 4) st[part] = [...st[part].slice(0, 3), 255];
      prevAlpha[part] = st[part][3] > 0 ? st[part][3] : 255;
      const color = h("input", { type: "color", value: hex(st[part]), "aria-label": `สี${label}`,
        oninput: (e: Event) => { st[part] = [...unhex((e.target as HTMLInputElement).value), st[part][3]]; touch(); } });
      const num = h("input", { type: "number", min: 0, max: 255, value: st[part][3], "aria-label": `ความทึบ ${label}` });
      const rng = h("input", { type: "range", min: 0, max: 255, value: st[part][3], "aria-label": `แถบความทึบ ${label}` });
      const clear = h("input", { type: "checkbox", checked: st[part][3] === 0, "aria-label": `โปร่งใส ${label}` });
      const setAlpha = (raw: string | number): void => {
        const v = Math.max(0, Math.min(255, parseInt(String(raw), 10) || 0));
        st[part][3] = v;
        num.value = String(v);
        rng.value = String(v);
        clear.checked = v === 0;
        if (v > 0) prevAlpha[part] = v;
        touch();
      };
      num.addEventListener("input", () => setAlpha(num.value));
      rng.addEventListener("input", () => setAlpha(rng.value));
      clear.addEventListener("change", () => setAlpha(clear.checked ? 0 : prevAlpha[part]));
      row(label, tick(part), color,
        h("div", { class: "alpha" }, h("span", { class: "hint" }, "ความทึบ (255 = ทึบ, 0 = โปร่งใส)"), num, rng, h("label", {}, clear, " โปร่งใส")));
    }

    // size
    if (st.size === null || st.size === undefined) st.size = 40;
    const size = h("input", { type: "number", min: KS.font_min, max: KS.font_max, value: st.size, "aria-label": "ขนาดตัวอักษร",
      oninput: (e: Event) => { st.size = Math.max(KS.font_min, Math.min(KS.font_max, parseInt((e.target as HTMLInputElement).value, 10) || KS.font_min)); touch(); } });
    row("ขนาด", tick("size"), size, h("span", { class: "hint" }, `${KS.font_min}–${KS.font_max}`));

    // icon
    if (!st.icon) st.icon = { size: 0, color: "White", shape: "Circle" };
    const sel = (values: (string | number)[], cur: unknown, cb: (v: string) => void, label: string): HTMLElement =>
      h("select", { "aria-label": label, onchange: (e: Event) => { cb((e.target as HTMLSelectElement).value); touch(); } },
        values.map((v) => h("option", { value: v, selected: String(v) === String(cur) }, v)));
    row("ไอคอน", tick("icon"), sel([0, 1, 2], st.icon.size, (v) => { st.icon.size = +v; }, "ขนาดไอคอน"),
      sel(KS.colors, st.icon.color, (v) => { st.icon.color = v; }, "สีไอคอน"),
      sel(KS.shapes, st.icon.shape, (v) => { st.icon.shape = v; }, "รูปทรงไอคอน"), h("span", { class: "hint" }, "ขนาด · สี · รูปทรง"));

    // effect (beam)
    if (!st.effect) st.effect = { color: "White", temp: false };
    row("ลำแสง", tick("effect"), sel(KS.colors, st.effect.color, (v) => { st.effect.color = v; }, "สีลำแสง"),
      h("label", {}, h("input", { type: "checkbox", checked: st.effect.temp, "aria-label": "ลำแสงชั่วคราว",
        onchange: (e: Event) => { st.effect.temp = (e.target as HTMLInputElement).checked; touch(); } }), " ชั่วคราว (Temp)"));

    // sound
    if (opts.showSound) {
      const snd: St = st.sound || (st.sound = { kind: "none", id: 1, file: "", volume: KS.default_volume });
      const gameBox = h("span", { class: "ctl" });
      const fileBox = h("span", { class: "ctl" });
      const fileName = h("span", { class: "hint" }, snd.kind === "file" && snd.file ? snd.file : "ยังไม่ได้เลือกไฟล์");
      const vol = h("input", { type: "number", min: 0, max: KS.volume_max, value: snd.volume, "aria-label": "ระดับเสียง",
        oninput: (e: Event) => { snd.volume = Math.max(0, Math.min(KS.volume_max, parseInt((e.target as HTMLInputElement).value, 10) || 0)); touch(); } });
      const show = (): void => {
        gameBox.hidden = snd.kind !== "game";
        fileBox.hidden = snd.kind !== "file";
        vol.hidden = snd.kind === "none";
      };
      const kindSel = h("select", { "aria-label": "ชนิดเสียง", onchange: (e: Event) => { snd.kind = (e.target as HTMLSelectElement).value; show(); touch(); } },
        [["none", "ไม่ตั้ง (ใช้ของ NeverSink)"], ["game", "เสียงของเกม"], ["file", "ไฟล์ของฉัน (mp3/wav/ogg)"]]
          .map(([v, t]) => h("option", { value: v, selected: v === snd.kind }, t)));
      const file = h("input", { type: "file", accept: "audio/*,.mp3,.wav,.ogg", "aria-label": "เลือกไฟล์เสียง", onchange: async (e: Event) => {
        const f = (e.target as HTMLInputElement).files?.[0];
        if (!f) return;
        snd.file = await sounds.setFile(opts.soundLabel as string, f);
        snd.kind = "file";
        kindSel.value = "file";
        fileName.textContent = snd.file;
        show();
        touch();
      } });
      gameBox.append(sel(KS.sound_ids, snd.id, (v) => { snd.id = +v; }, "เสียงของเกม"), h("span", { class: "hint" }, "เสียงเกม"));
      fileBox.append(file, fileName);
      show();
      row("เสียง", kindSel, gameBox, fileBox, vol);
    }
    grid.replaceChildren(...rows, preview);
    refresh();
  };

  build();
  return {
    el: grid,
    get: out,
    set(style: St): void {
      st = clone(style);
      muted = true;
      try { build(); } finally { muted = false; }
    },
  };
}

export interface StyleDialogOpts extends StyleEditorOpts {
  title: string;
  hint?: string;
  clearText?: string;
  onSave: (style: St | null) => void | Promise<void>;
}

export function openStyleDialog(opts: StyleDialogOpts): void {
  const dlg = $<HTMLDialogElement>("#dlg-style");
  const ed = buildStyleEditor(opts);
  const finish = async (clear: boolean): Promise<void> => {
    dlg.close();
    await opts.onSave(clear ? null : ed.get());
  };
  const save = h("button", { type: "button", onclick: () => finish(false) }, "บันทึก");
  const cancel = h("button", { type: "button", class: "secondary", onclick: () => dlg.close() }, "ยกเลิก");
  const reset = h("button", { type: "button", class: "secondary", onclick: () => finish(true) }, opts.clearText || "รีเซ็ตเป็นค่า NeverSink");
  dlg.replaceChildren(...([h("h3", {}, opts.title), opts.hint ? h("p", { class: "hint" }, opts.hint) : null, ed.el, h("div", { class: "actions" }, save, cancel, reset)].filter(Boolean) as Node[]));
  dlg.showModal();
}
