// What an end-to-end test that needs something built or installed does when it is not there: FAIL, with the reason.
// A skip is allowed only when asked for (E2E_ALLOW_SKIP=1), and it is printed.
import fs from "node:fs";
import path from "node:path";

export const allowSkip = process.env.E2E_ALLOW_SKIP === "1";

/** The installed Checker: PFG_CHECKER_EXE if set, else the normal per-user install path. { path, reason } - path is null when not found. */
export function installedChecker() {
  const set = process.env.PFG_CHECKER_EXE;
  if (set) return fs.existsSync(set) ? { path: set, reason: "" } : { path: null, reason: `PFG_CHECKER_EXE points to ${set}, which does not exist` };
  const local = process.env.LOCALAPPDATA;
  const def = local ? path.join(local, "Programs", "PoE-Price-Trade-Checker-TS", "PoE-Price-Trade-Checker-TS.exe") : "";
  if (def && fs.existsSync(def)) return { path: def, reason: "" };
  return { path: null, reason: `the installed Checker was not found at ${def || "%LOCALAPPDATA%\\Programs\\PoE-Price-Trade-Checker-TS"} (install it with: npm run checker:swap, or set PFG_CHECKER_EXE)` };
}

/**
 * needs = [{ ok, reason }]. Returns { skip, problems }: use `describe.skipIf(skip)` and, inside, `it("is available", () => { if (problems) throw })`
 * - or `failIfMissing(problems)` in a beforeAll - so that a missing piece is a red test with the reason, never a silent skip.
 */
export function requirements(needs) {
  const missing = needs.filter((n) => !n.ok).map((n) => n.reason);
  if (missing.length && allowSkip) console.warn(`[e2e] SKIPPED (E2E_ALLOW_SKIP=1): ${missing.join("; ")}`);
  return { skip: missing.length > 0 && allowSkip, problems: missing.length && !allowSkip ? missing.join("; ") : "" };
}

export function failIfMissing(problems) {
  if (problems) throw new Error(`required by this test but missing: ${problems}`);
}
