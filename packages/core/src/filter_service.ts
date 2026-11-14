/**
 * What the programs share around a generated filter: the text of a failed write and the NeverSink update check.
 * (Port of the small parts of poe_price_trade/filter_service.py that the programs use. The original's generate_filter() is not here: the programs make
 * a filter in the page, packages/ui/src/app.ts generate() + api.ts WebApi.generate, and write it through the desktop host.)
 */
import { ConfigLike } from "./ports.ts";
import { truthy } from "./py.ts";

// error codes Windows hands back when something refuses the write (Controlled Folder Access surfaces as EBADF / EACCES /
// ENOENT / EPERM depending on the caller, so the raw text alone is useless)
const BLOCKED_CODES = new Set(["EBADF", "EACCES", "ENOENT", "EPERM"]);

/** User-facing text for a failed filter write. */
export function writeFailMsg(err: unknown, outDir: string, exeName = "โปรแกรมนี้"): string {
  const code = (err as any)?.code;
  if (typeof code === "string" && BLOCKED_CODES.has(code)) {
    return `✗ เขียน filter ลงโฟลเดอร์ไม่ได้: ${outDir}\n` +
      `   Windows อาจบล็อกการเขียน (Controlled Folder Access / Ransomware protection) — ` +
      `อนุญาต ${exeName} ใน Windows Security → Ransomware protection ` +
      `หรือเลือก Game folder override เป็นโฟลเดอร์อื่น\n` +
      `   (${(err as Error).message})`;
  }
  return `✗ เขียน filter ไม่ได้: ${(err as Error).message}`;
}

/** null when there is nothing to do; else {old, new, auto}. */
export async function checkNeversinkUpdate(config: ConfigLike, gameVersion: string,
  getLatest: (game: string) => Promise<string | null>): Promise<{ old: string; new: string; auto: boolean } | null> {
  const fg: Record<string, any> = truthy(config.get("filter_gen", {})) ? config.get("filter_gen", {}) : {};
  const last = fg[`neversink_tag_${gameVersion}`];
  if (!truthy(last)) return null;
  const latest = await getLatest(gameVersion);
  if (!latest || latest === last) return null;
  return { old: last, new: latest, auto: truthy(fg.auto_regen_neversink) };
}

export function neversinkUpdateMessage(info: { old: string; new: string }, regenerated: boolean): string {
  if (regenerated) return `NeverSink อัปเดต ${info.old} → ${info.new} สร้าง filter ใหม่แล้ว`;
  return `NeverSink มีเวอร์ชันใหม่ ${info.new} (filter ปัจจุบันสร้างจาก ${info.old}) — กด Generate เพื่ออัปเดต`;
}
