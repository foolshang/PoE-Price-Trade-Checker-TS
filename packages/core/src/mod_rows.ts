/**
 * Mods -> rows with a stat id. The lines under ONE { Modifier } header are one mod (a hybrid: GGG lists some of them as a single
 * entry with the lines joined by a line break). Like the hub, the whole block is matched first; only when it has no id each line is
 * looked up on its own.
 */
import type { ModDatabase } from "./mod_db.ts";
import { ModValue } from "./models.ts";

export interface ModRow { mod: ModValue; statId: string | null }

export function resolveRows(mods: ModValue[], modDb: Pick<ModDatabase, "findStatId">): ModRow[] {
  const rows: ModRow[] = [];
  for (let i = 0; i < mods.length;) {
    const first = mods[i];
    let j = i + 1;
    if (first.group >= 0) while (j < mods.length && mods[j].group === first.group && mods[j].mod_type === first.mod_type) j++;
    if (j - i > 1) {
      const block = mods.slice(i, j);
      const text = block.map((m) => m.text).join("\n");
      const statId = modDb.findStatId(text, first.mod_type);
      if (statId) {
        rows.push({ statId, mod: { ...first, text, values: block.flatMap((m) => m.values) } });
        i = j;
        continue;
      }
    }
    rows.push({ mod: first, statId: modDb.findStatId(first.text, first.mod_type) });
    i += 1;
  }
  return rows;
}
