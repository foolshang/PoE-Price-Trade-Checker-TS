/** Small DOM helpers shared by every part of the page. */

export const $ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document): T => root.querySelector(sel) as T;
export const $$ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document): T[] => [...root.querySelectorAll<T>(sel)];
export const clone = <T>(o: T): T => JSON.parse(JSON.stringify(o));
export const esc = (s: unknown): string =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export type Kid = Node | string | number | false | null | undefined | Kid[];
type Attrs = Record<string, any> | null | undefined;

/** h("div", {class: "x", onclick: fn, dataset: {a: 1}}, child, "text", ...) */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs?: Attrs, ...kids: Kid[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "dataset") Object.assign(el.dataset, v);
    else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
    else if (k === "value") (el as any).value = v;
    else if (k === "checked" || k === "disabled" || k === "hidden" || k === "selected") (el as any)[k] = !!v;
    else el.setAttribute(k, v === true ? "" : String(v));
  }
  for (const kid of kids.flat(Infinity as 1) as Kid[]) {
    if (kid === null || kid === undefined || kid === false) continue;
    el.append(typeof kid === "object" ? (kid as Node) : document.createTextNode(String(kid)));
  }
  return el;
}

export function debounce<A extends unknown[]>(fn: (...a: A) => void, ms = 120): (...a: A) => void {
  let t: ReturnType<typeof setTimeout> | undefined;
  return (...a: A) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
}

/** text with LF -> CRLF, the same line ends the game's own tools write on Windows */
export const toCrlf = (t: string): string => t.replace(/\r?\n/g, "\r\n");

export function saveBlob(bytes: Uint8Array, filename: string, mime?: string): void {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime || "application/octet-stream" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export function log(msg: string, tag = "info"): void {
  const box = $("#log");
  if (!box) return;
  const line = document.createElement("div");
  line.className = tag;
  line.textContent = msg;
  box.appendChild(line);
  box.scrollTop = box.scrollHeight;
}

/** a message list [[tag, text], ...] -> the Status */
export function logAll(msgs: [string, string][] | null | undefined): void {
  for (const [tag, text] of msgs ?? []) log(text, tag);
}

export const rgba = (c: number[] | null | undefined, fallback: string): string =>
  c ? `rgba(${c[0]},${c[1]},${c[2]},${(c[3] === undefined ? 255 : c[3]) / 255})` : fallback;
export const hex = (c: number[] | null | undefined): string =>
  "#" + (c || [0, 0, 0]).slice(0, 3).map((x) => Math.max(0, Math.min(255, x | 0)).toString(16).padStart(2, "0")).join("");
export const unhex = (s: string): number[] => [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16));
