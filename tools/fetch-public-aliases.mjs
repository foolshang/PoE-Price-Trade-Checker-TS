// Replaces the alias snapshots that ship with the Checker (apps/checker/resources/rendering_aliases_<game>.json) with the hub's PUBLIC file
// {game}/aliases/latest.json (Poe_Hub SPEC.md 8.12). Refuses a file that is not schema_version 1 or lacks the fields of the contract.
//   node tools/fetch-public-aliases.mjs            both games
//   node tools/fetch-public-aliases.mjs poe1       one game
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE = "https://storage.googleapis.com/poe-data-hub";
const games = process.argv.slice(2).length ? process.argv.slice(2) : ["poe1", "poe2"];

let failed = false;
for (const game of games) {
  const url = `${BASE}/${game}/aliases/latest.json`;
  const res = await fetch(url, { headers: { "User-Agent": "PoEPriceTradeChecker-build/1.0" } });
  if (!res.ok) {
    console.error(`${game}: HTTP ${res.status} ${url} - snapshot unchanged`);
    failed = true;
    continue;
  }
  const doc = await res.json();
  const ok = doc && doc.schema_version === 1 && doc.game === game && Array.isArray(doc.aliases) && Array.isArray(doc.stat_groups) &&
    doc.stat_aliases && typeof doc.stat_aliases === "object" && Array.isArray(doc.deprecated_trade_ids) && typeof doc.generated_at === "string";
  if (!ok) {
    console.error(`${game}: not the contract of SPEC.md 8.12 (schema_version ${doc?.schema_version}) - snapshot unchanged`);
    failed = true;
    continue;
  }
  fs.writeFileSync(path.join(ROOT, "apps", "checker", "resources", `rendering_aliases_${game}.json`), JSON.stringify(doc), "utf-8");
  console.log(`${game}: ${doc.aliases.length} aliases, ${doc.stat_groups.length} stat groups, ${Object.keys(doc.stat_aliases).length} stat_aliases, generated_at ${doc.generated_at}`);
}
process.exit(failed ? 1 : 0);
