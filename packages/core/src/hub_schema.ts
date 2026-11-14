/**
 * The schema_version of the hub files this program reads (SPEC.md of the Poe_Hub project: 8.1 prices, 8.1b index, 8.2 meta, 8.6 gems).
 * A file whose schema_version is not the one expected - or has none - is NOT read as if it were: the caller treats it as a file that could not
 * be loaded (same rule as aliases 8.12, skills 8.11 and passives 8.9, which check theirs where they are used).
 */
import { Log, noopLog } from "./py.ts";

export const PRICES_SCHEMA_VERSION = 2; // {game}/prices/latest.json, events/*.json, hardcore/latest.json (SPEC 8.1, 8.1a, 8.1c)
export const INDEX_SCHEMA_VERSION = 1; // {game}/prices/index.json (SPEC 8.1b)
export const META_SCHEMA_VERSION = 2; // {game}/meta/latest.json (SPEC 8.2)
export const GEMS_SCHEMA_VERSION = 1; // {game}/gems.json (SPEC 8.6)

/**
 * true when `data.schema_version` is `expected`. Otherwise warns (file, expected, found; "missing" when the field is absent) and returns false;
 * `then` says what the caller does instead (it ends the warning).
 */
export function checkSchema(data: unknown, expected: number, file: string, warn: Log = noopLog, then = "not used"): boolean {
  const got = data !== null && typeof data === "object" ? (data as Record<string, unknown>).schema_version : undefined;
  if (got === expected) return true;
  warn(`hub ${file}: schema_version ${got === undefined ? "missing" : JSON.stringify(got)} (expected ${expected}) - ${then}`, "warn");
  return false;
}

/** The gems payload when its schema is the one expected, else null (the caller then has no gem list). */
export function gemsPayload(data: unknown, file: string, warn: Log = noopLog): any | null {
  return checkSchema(data, GEMS_SCHEMA_VERSION, file, warn, "gem list left empty") ? data : null;
}
