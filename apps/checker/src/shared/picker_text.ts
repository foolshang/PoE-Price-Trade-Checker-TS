/** The line of a row of the F5 popup, as the original's ModPickerWindow wrote it. */
import type { PickerRowData } from "./api.ts";

const MAX_TEXT = 56; // longer mod texts are cut
const TYPE_TAG: Record<string, string> = {
  implicit: "[imp] ", desecrated: "[des] ", rune: "[rune] ", enchant: "[ench] ", fractured: "[frac] ",
};

export function pickerRowText(row: PickerRowData): string {
  let tierBadge = "";
  if (row.tier) tierBadge = row.total ? `[T${row.tier}/${row.total}] ` : `[T${row.tier}] `;
  const text0 = (row.money ? "💰 " : "") + tierBadge + (TYPE_TAG[row.modType] ?? "") + row.text;
  const cps = Array.from(text0);
  const text = cps.length > MAX_TEXT ? cps.slice(0, MAX_TEXT - 1).join("") + "…" : text0;
  return row.searchable ? text : text + "  (ไม่พบ id)";
}

/** the box is ticked from the start: a searchable explicit / implicit mod (like the search in the game; desecrated is not) */
export const defaultChecked = (row: PickerRowData): boolean => row.searchable && (row.modType === "explicit" || row.modType === "implicit");
