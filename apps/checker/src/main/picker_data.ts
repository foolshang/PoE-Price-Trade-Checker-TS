/** What the F5 popup shows for a prepared item: the texts of the original's ModPickerWindow (poe_price_trade/mod_picker.py), without the widgets. */
import { pyextra } from "@poe/core";
import type { f5 } from "@poe/core";
import type { PickerInit, PickerRowData } from "../shared/api.ts";

type Prepared = Extract<f5.F5Result, { kind: "picker" }>;

export function pickerInit(r: Prepared): PickerInit {
  const head = r.item.item_name || r.item.base_type || "?";
  const sub = r.item.rarity + (r.item.base_type && r.item.base_type !== head ? `  ·  ${r.item.base_type}` : "");
  const rows: PickerRowData[] = r.rows.map(({ mod, statId }, i) => {
    const anno = r.annos[mod.group];
    return {
      text: mod.text, modType: mod.mod_type || "explicit", searchable: !!statId,
      min: statId && mod.value !== null ? pyextra.pyFormatG(mod.value) : "",
      badge: r.badge_colors[i] ?? null, badgeNote: r.badge_notes[i] ?? null, arrow: r.roll_arrows[i] ?? null, affix: r.affixes[i] ?? "",
      tier: anno?.tier ?? 0, total: anno?.total ?? 0, money: !!anno?.money,
    };
  });
  return { head, sub, summary: r.summary, rows };
}
