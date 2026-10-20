// Shared helpers of the desktop tests: a throw-away LOCALAPPDATA + Documents, launching the app (from the build output, or an
// installed program), and a network stub for the main process (it fetches, the page does not).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { _electron as electron } from "playwright";

export const ROOT = path.resolve(import.meta.dirname, "..", "..");
export const APP_DIR = path.join(ROOT, "apps", "filtergen");
export const CHECKER_DIR = path.join(ROOT, "apps", "checker");
export const FIXTURES = path.join(ROOT, "tests", "parity", "fixtures");

export function tmpdir(prefix = "pfg-") {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/** A sandbox: LOCALAPPDATA + Documents in a temp folder, so nothing of the real machine is read or written. */
export function sandbox() {
  const base = tmpdir("pfg-sbx-");
  const local = path.join(base, "Local");
  const docs = path.join(base, "Documents");
  fs.mkdirSync(local, { recursive: true });
  fs.mkdirSync(docs, { recursive: true });
  return { base, local, docs, configDir: path.join(local, "PoeFilterGenTS"), oldDir: path.join(local, "PoeFilterGen"), checkerDir: path.join(local, "PoePriceTradeTS"), checkerOldDir: path.join(local, "PoePriceTrade") };
}

/** Launch the app. `exe` = an unpacked exe (the packaged app); without it the build output runs under the electron of node_modules. */
export async function launch(sbx, { exe = process.env.PFG_EXE, extraEnv = {}, chromiumArgs = [], appDir = APP_DIR } = {}) {
  const env = { ...process.env, LOCALAPPDATA: sbx.local, POE_FILTERGEN_DOCUMENTS: sbx.docs, POE_CHECKER_DOCUMENTS: sbx.docs, POE_CHECKER_TEST: "1", POE_CHECKER_ANY_FRONT: "1", ...extraEnv }; // (ANY_FRONT: the tests press F4 / F5 over a plain window; a test of the "game in front" rule passes "")
  delete env.ELECTRON_RUN_AS_NODE;
  const opts = exe ? { executablePath: exe, args: [...chromiumArgs], env } : { args: [appDir, ...chromiumArgs], env };
  const app = await electron.launch(opts);
  const page = await app.firstWindow();
  return { app, page };
}

export const wait = (ms) => new Promise((r) => setTimeout(r, ms));
