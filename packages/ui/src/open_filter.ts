/**
 * The "เปิด filter…" button. With the game's folder connected it lists the .filter files of that folder (each marked as
 * editable - made by the Whitelist tab - or not) and opens the one clicked; "เลือกไฟล์อื่น…" is showOpenFilePicker starting in
 * that folder. Without a folder for the game picked now it opens the folder picker at once (starting in Documents, the Status
 * says which folder to choose) and shows the list of what was picked. A browser without showDirectoryPicker (Firefox / Safari)
 * keeps the old way: showOpenFilePicker in Documents, or the plain file input. A folder permission that expired after a reload
 * is asked for again with one button before the list is shown.
 */
import { $, h } from "./dom.ts";
import { FS } from "./files.ts";
import { S } from "./state.ts";

const TYPES = [{ description: "Path of Exile filter", accept: { "text/plain": [".filter"] } }];
const KIND = {
  whitelist: { label: "เปิดแก้ได้ — สร้างจากแท็บ Whitelist", ok: true },
  tier: { label: "สร้างจากแท็บ NeverSink — เปิดแก้ไม่ได้", ok: false },
  other: { label: "ไม่ได้สร้างจากโปรแกรมนี้ — เปิดแก้ไม่ได้", ok: false },
};

const w = window as any;
const canPick = (): boolean => typeof w.showOpenFilePicker === "function";
const aborted = (e: any): boolean => !!e && e.name === "AbortError";

/** the plain file picker, started in `startIn` ("documents" or the game folder's handle) */
async function pickFile(startIn: unknown, id: string): Promise<File> {
  const [handle] = await w.showOpenFilePicker({ id, startIn, types: TYPES, multiple: false });
  return handle.getFile();
}

export interface OpenFilterOpts {
  game: string;
  openFile(file: File): Promise<void>;
  /** the plain input */
  fallback(): void;
  log(text: string, tag?: string): void;
  /** the folder picker with the name check; called straight from the click */
  chooseFolder(): Promise<boolean>;
  /** the folder to choose, for the Status */
  dirHint: string;
}

export async function openFilter(opts: OpenFilterOpts): Promise<void> {
  const { game, openFile, fallback, log } = opts;
  const id = `poe-open-${game}`;
  if (!canPick()) return fallback();
  const finish = async (file: File | null): Promise<void> => { if (file) await openFile(file); };
  const pick = async (startIn: unknown): Promise<void> => {
    try {
      await finish(await pickFile(startIn, id));
    } catch (e: any) {
      if (aborted(e)) return;
      log(`⚠ เปิดตัวเลือกไฟล์ไม่ได้: ${e.message || e}`, "warn");
      fallback();
    }
  };
  if (!FS.handle || FS.state === "none") {
    if (!FS.supported) return pick("documents"); // (no folder API: the old way)
    log(`ℹ เลือกโฟลเดอร์ ${opts.dirHint} ในหน้าต่างที่เปิดขึ้น แล้วรายการไฟล์จะขึ้นให้`, "info");
    if (!(await opts.chooseFolder())) return; // cancelled / not adopted
  }

  const dlg = $<HTMLDialogElement>("#dlg-open");
  const close = (): void => { if (dlg.open) dlg.close(); };
  const other = h("button", { type: "button", class: "secondary", id: "btn-open-other", onclick: async () => { close(); await pick(FS.handle); } }, "เลือกไฟล์อื่น…");
  const cancel = h("button", { type: "button", class: "secondary", id: "btn-open-close", onclick: close }, "ปิด");

  const draw = async (): Promise<void> => {
    if (FS.state !== "granted") { // the permission of the remembered folder expired: one button, then the list
      const grant = h("button", { type: "button", id: "btn-open-grant", onclick: async () => {
        try { await FS.grant(); } catch (e: any) { log(`⚠ ${e.message || e}`, "warn"); }
        await draw();
      } }, "ให้สิทธิ์โฟลเดอร์อีกครั้ง");
      dlg.replaceChildren(h("h3", {}, "เปิด filter"), h("p", {}, `ต้องยืนยันสิทธิ์โฟลเดอร์ "${FS.name}" อีกครั้งก่อนดูรายการไฟล์`),
        h("div", { class: "actions" }, grant, other, cancel));
      return;
    }
    let files: { name: string; size: number; head: string }[] = [];
    try { files = await FS.list(); } catch (e: any) { log(`⚠ อ่านรายการไฟล์ในโฟลเดอร์ไม่ได้: ${e.message || e}`, "warn"); }
    const rows = files.map((f) => ({ ...f, kind: S.api.filterKind(f.head) }));
    rows.sort((a, b) => (Number(KIND[b.kind].ok) - Number(KIND[a.kind].ok)) || a.name.localeCompare(b.name));
    const list = rows.length
      ? h("ul", { class: "open-list", id: "open-list" }, ...rows.map((f) => h("li", { "data-file": f.name, "data-kind": f.kind },
        h("span", { class: "nm" }, f.name),
        h("span", { class: KIND[f.kind].ok ? "ok-text" : "muted" }, KIND[f.kind].label),
        h("button", { type: "button", disabled: !KIND[f.kind].ok, "aria-label": `เปิด ${f.name}`,
          onclick: async () => {
            try {
              const file = await FS.getFile(f.name);
              close();
              await finish(file);
            } catch (e: any) { log(`⚠ เปิด ${f.name} ไม่ได้: ${e.message || e}`, "warn"); }
          } }, "เปิด"))))
      : h("p", { class: "muted" }, `ไม่มีไฟล์ .filter ในโฟลเดอร์ "${FS.name}"`);
    dlg.replaceChildren(h("h3", {}, `เปิด filter จากโฟลเดอร์ "${FS.name}"`), list, h("div", { class: "actions" }, other, cancel));
  };
  await draw();
  dlg.showModal();
}
