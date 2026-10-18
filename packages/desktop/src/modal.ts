/**
 * A small window inside the program window: a title, a close cross, a body. It closes with the cross, with Esc, and when the
 * player clicks anywhere outside the program window (the window loses the focus). One at a time.
 */
import { h } from "@poe/ui";

let current: { close(): void } | null = null;

export interface ModalOptions {
  id: string;
  title: string;
  body: Node | Node[];
  onClose?: () => void;
}

export function openModal(o: ModalOptions): { close(): void; el: HTMLElement; body: HTMLElement } {
  current?.close();
  const body = h("div", { class: "modal-body", style: { overflowY: "auto", maxHeight: "calc(100vh - 150px)", paddingRight: "4px" } }, ...(Array.isArray(o.body) ? o.body : [o.body]));
  const x = h("button", { type: "button", class: "modal-x secondary", "aria-label": "ปิด", title: "ปิด", style: { padding: "0 9px", fontSize: "18px", lineHeight: "1.3" } }, "×");
  const box = h("div", { role: "dialog", "aria-label": o.title, style: {
    background: "#23242a", color: "#e6e6e6", border: "1px solid #4a4d57", borderRadius: "8px", padding: "12px 14px", width: "min(560px, calc(100vw - 32px))",
    boxShadow: "0 8px 30px rgba(0,0,0,.6)" } },
  h("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px", marginBottom: "8px" } }, h("strong", {}, o.title), x), body);
  const el = h("div", { id: o.id, class: "modal-back", style: { position: "fixed", inset: "0", background: "rgba(0,0,0,.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: "100" } }, box);
  let closed = false;
  const handle = { close: (): void => close() };
  const onKey = (e: KeyboardEvent): void => { if (e.key === "Escape") close(); };
  function close(): void {
    if (closed) return;
    closed = true;
    window.removeEventListener("blur", close);
    window.removeEventListener("keydown", onKey);
    el.remove();
    if (current === handle) current = null;
    o.onClose?.();
  }
  x.addEventListener("click", close);
  window.addEventListener("blur", close);
  window.addEventListener("keydown", onKey);
  document.body.append(el);
  current = handle;
  return { close, el, body };
}
