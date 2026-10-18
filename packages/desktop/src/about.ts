/**
 * The About window of a program: name and version, the history of the updates (CHANGELOG.md, built into the program - readable without
 * a network), what the newer release says when the updater knows one, and the GitHub link. Opens inside the program window
 * (modal.ts: closes with the cross, Esc, or a click outside the program).
 */
import { h } from "@poe/ui";
import { parseChangelog } from "./changelog.ts";
import { openModal } from "./modal.ts";

export interface AboutOptions {
  name: string;
  version: string;
  /** the text of the program's CHANGELOG.md */
  changelog: string;
  repoUrl: string;
  /** the newer release the updater knows (not installed yet), if any */
  newer?: () => Promise<{ version?: string; notes?: string } | null | undefined>;
  /** more content (the Filter Generator puts "what the X button does" here) */
  extra?: () => Promise<Node | null> | Node | null;
}

const pre = { whiteSpace: "pre-wrap", margin: "2px 0 8px", fontFamily: "inherit", fontSize: "13px", lineHeight: "1.45" };

export async function openAbout(o: AboutOptions): Promise<void> {
  const newer = await Promise.resolve(o.newer?.()).catch(() => null);
  const extra = await Promise.resolve(o.extra?.()).catch(() => null);
  const kids: Node[] = [
    h("div", { style: { marginBottom: "6px" } }, h("strong", { style: { fontSize: "16px" } }, o.name), " ", h("span", { class: "muted", id: "about-version" }, `เวอร์ชัน ${o.version}`)),
    h("div", { style: { marginBottom: "8px" } }, "GitHub: ", h("a", { href: o.repoUrl, target: "_blank", rel: "noopener", id: "about-link" }, o.repoUrl.replace(/^https:\/\//, ""))),
  ];
  if (extra) kids.push(extra);
  if (newer?.version) {
    kids.push(h("section", { id: "about-newer", style: { border: "1px solid #6a5a20", background: "#2f2a14", borderRadius: "4px", padding: "6px 10px", margin: "0 0 10px" } },
      h("strong", {}, `รุ่นใหม่ v${newer.version} (ยังไม่ได้ติดตั้ง)`),
      h("pre", { style: pre }, newer.notes || "ดูรายละเอียดที่หน้า release")));
  }
  kids.push(h("h3", { style: { margin: "6px 0 4px", fontSize: "14px" } }, "ประวัติการอัปเดต"));
  const entries = parseChangelog(o.changelog);
  if (!entries.length) kids.push(h("div", { class: "muted" }, "(ยังไม่มีประวัติ)"));
  for (const e of entries) {
    const mine = e.version === o.version;
    kids.push(h("section", { class: "about-entry", "data-version": e.version },
      h("strong", {}, `v${e.version}`), e.date ? h("span", { class: "muted" }, ` · ${e.date}`) : null, mine ? h("span", { class: "muted" }, " · รุ่นที่ใช้อยู่") : null,
      h("pre", { style: pre }, e.body)));
  }
  openModal({ id: "about-window", title: `About — ${o.name}`, body: kids });
}

/** the About button for a window that has none of its own (the Filter Generator: next to the PoE 2 button) */
export function mountAboutButton(after: Element, o: AboutOptions): HTMLButtonElement {
  const b = h("button", { type: "button", id: "btn-about", class: "secondary", onclick: () => void openAbout(o), style: { marginLeft: "8px" } }, "About");
  after.after(b);
  return b;
}
