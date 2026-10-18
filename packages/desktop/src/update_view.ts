/** What the update strip of a window says and offers for a state - pure, so it is tested without a window. */
import type { UpdateInfoState } from "./update_api.ts";

export type UpdateButtonId = "install-now" | "install-exit" | "cancel" | "retry" | "open" | "check";
export interface UpdateButton { id: UpdateButtonId; label: string }
export interface UpdateView {
  /** '' = no strip */
  text: string;
  tone: "info" | "warn";
  buttons: UpdateButton[];
  /** the "check for updates" button: only when the player has not chosen automatic update (and nothing newer is known) */
  check: boolean;
}

const NOW: UpdateButton = { id: "install-now", label: "อัปเดตเลย" };
const EXIT: UpdateButton = { id: "install-exit", label: "อัปเดตตอนปิดโปรแกรม" };
const CANCEL: UpdateButton = { id: "cancel", label: "ยกเลิก" };

export function updateView(s: UpdateInfoState): UpdateView {
  const none: UpdateView = { text: "", tone: "info", buttons: [], check: false };
  if (s.mode === "off") return none;
  const v = s.version ? `v${s.version}` : "";
  const canCheck = !s.auto || s.mode === "manual";
  switch (s.phase) {
    case "manual":
      return { text: `มีรุ่นใหม่ ${v} — โปรแกรมนี้เป็นแบบ zip อัปเดตเองไม่ได้`, tone: "info", buttons: [{ id: "open", label: "อัปเดต (เปิดหน้าดาวน์โหลด)" }], check: false };
    case "available":
      return { text: `มีรุ่นใหม่ ${v}`, tone: "info", buttons: [NOW, EXIT], check: false };
    case "downloading": {
      const tail = s.installNow ? " — จะติดตั้งและเปิดใหม่ทันทีที่โหลดเสร็จ" : s.exitPending ? " — จะอัปเดตตอนปิดโปรแกรม" : "";
      return { text: `กำลังดาวน์โหลด ${v} ${s.percent ?? 0}%${tail}`, tone: "info", buttons: s.installNow || s.exitPending ? [CANCEL] : [NOW, EXIT], check: false };
    }
    case "ready":
      return s.exitPending
        ? { text: `${v} โหลดแล้ว — จะอัปเดตตอนปิดโปรแกรม`, tone: "info", buttons: [NOW, CANCEL], check: false }
        : { text: `${v} โหลดแล้ว พร้อมติดตั้ง`, tone: "info", buttons: [NOW, EXIT], check: false };
    case "error":
      if (s.failed === "download") return { text: `ดาวน์โหลด ${v} ไม่สำเร็จ: ${s.message ?? ""}`, tone: "warn", buttons: [{ id: "retry", label: "ลองใหม่" }], check: false };
      // a check that failed by itself is silent (the log has it); one the player asked for is answered
      return s.userCheck ? { text: `เช็คอัปเดตไม่สำเร็จ: ${s.message ?? ""}`, tone: "warn", buttons: [], check: canCheck } : { ...none, check: canCheck };
    case "checking":
      return { text: "กำลังเช็คอัปเดต…", tone: "info", buttons: [], check: false };
    default:
      return { text: s.userCheck && s.upToDate ? "เป็นรุ่นล่าสุดแล้ว" : "", tone: "info", buttons: [], check: canCheck };
  }
}
