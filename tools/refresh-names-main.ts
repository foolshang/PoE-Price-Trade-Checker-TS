/**
 * Refresh the names snapshot the web page and both desktop apps ship (apps/web/public/data/trade_names_<game>.json) from GGG's
 * trade data.
 *
 *     npm run names:refresh
 *
 * The page cannot call GGG's API itself (no CORS), so it uses this snapshot. The snapshot holds the names per GGG group
 * (format 2; `assigned` stays empty: nothing assigns categories any more). The names are only the real-name check of the
 * whitelist; they are never added to its lists. Run it before a release; it refuses to write a list that shrank by more than 20%.
 */
import fs from "node:fs";
import path from "node:path";
import { tradeNames, tradeSnapshot } from "../packages/core/src/index.ts";
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
    const groups = tradeSnapshot.groupsFromPayload(await res.json());
    const count = tradeSnapshot.namesOfGroups(groups).size;
    const file = path.join(outDir, `trade_names_${game}.json`);
    let prev: tradeSnapshot.Loaded | null = null;
    try {
      prev = fs.existsSync(file) ? tradeSnapshot.parseSnapshot(JSON.parse(fs.readFileSync(file, "utf-8"))) : null;
    } catch { /* unreadable: treated as no snapshot */ }
    const shipped = prev ? prev.names.size : 0;
    if (!mayWrite(count, shipped)) {
      console.log(`${game}: got ${count} names (had ${shipped}) - not written`);
      code = 1;
      continue;
    }
    fs.writeFileSync(file, tradeSnapshot.snapshotJson(groups, {}), "utf-8");
    console.log(`${game}: ${count} names (had ${shipped})`);
  }
  return code;
}

process.exit(await main());
