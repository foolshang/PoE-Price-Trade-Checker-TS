/**
 * Refresh the names snapshot the web page ships (apps/web/public/data/trade_names_<game>.json) from GGG's trade data.
 *
 *     npm run names:refresh
 *
 * The page cannot call GGG's API itself (no CORS), so it uses the hub's `<game>/trade_names.json` when that exists and this
 * snapshot otherwise. Run it before a web release; it refuses to write a list that shrank by more than 20%.
 */
import fs from "node:fs";
import path from "node:path";
import { py, tradeNames } from "../packages/core/src/index.ts";
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
    const names = [...tradeNames.namesFromPayload(await res.json())].sort(py.cmpStr);
    const file = path.join(outDir, `trade_names_${game}.json`);
    const shipped = fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, "utf-8")) as string[]).length : 0;
    if (!mayWrite(names.length, shipped)) {
      console.log(`${game}: got ${names.length} names (had ${shipped}) - not written`);
      code = 1;
      continue;
    }
    fs.writeFileSync(file, JSON.stringify(names), "utf-8");
    console.log(`${game}: ${names.length} names (had ${shipped})`);
  }
  return code;
}

process.exit(await main());
