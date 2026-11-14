/**
 * Refresh the names snapshot the web page and both desktop apps ship (apps/web/public/data/trade_names_<game>.json) from GGG's
 * trade data.
 *
 *     npm run names:refresh
 *
 * The page cannot call GGG's API itself (no CORS), so it uses this snapshot. The snapshot holds the names per GGG group
 * (format 2) and `assigned`: the NEW names (not in the previous snapshot) that no category rule fits, with the main category of
 * their group; a name keeps that category in every later snapshot (see packages/core/src/ggg_names.ts). Run it before a
 * release; it refuses to write a list that shrank by more than 20%.
 */
import fs from "node:fs";
import path from "node:path";
import { gggNames, tradeNames } from "../packages/core/src/index.ts";
import { mayWrite } from "./refresh-names.ts";

async function main(): Promise<number> {
  const outDir = path.resolve("apps", "web", "public", "data"); // (run from the repo root, as npm does)
  fs.mkdirSync(outDir, { recursive: true });
  let code = 0;
  for (const [game, url] of Object.entries(tradeNames.URLS)) {
    const res = await fetch(url, { headers: tradeNames.HEADERS, signal: AbortSignal.timeout(20000) });
    if (!res.ok) {
      console.log(`${game}: HTTP ${res.status} - not written`);
      code = 1;
      continue;
    }
    const groups = gggNames.groupsFromPayload(await res.json());
    const count = gggNames.namesOfGroups(groups).size;
    const file = path.join(outDir, `trade_names_${game}.json`);
    let prev: gggNames.Loaded | null = null;
    try {
      prev = fs.existsSync(file) ? gggNames.parseSnapshot(JSON.parse(fs.readFileSync(file, "utf-8"))) : null;
    } catch { /* unreadable: treated as no snapshot */ }
    const shipped = prev ? prev.names.size : 0;
    if (!mayWrite(count, shipped)) {
      console.log(`${game}: got ${count} names (had ${shipped}) - not written`);
      code = 1;
      continue;
    }
    const assigned = gggNames.nextAssigned(game, groups, prev);
    fs.writeFileSync(file, gggNames.snapshotJson(groups, assigned), "utf-8");
    const fresh = Object.keys(assigned).filter((n) => !(prev?.snapshot?.assigned ?? {})[n]);
    console.log(`${game}: ${count} names (had ${shipped}); assigned ${Object.keys(assigned).length}, ${fresh.length} new: ${fresh.slice(0, 20).join(" | ")}`);
  }
  return code;
}

process.exit(await main());
