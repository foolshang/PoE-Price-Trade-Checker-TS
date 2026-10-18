// The one-click installer AND the zip (no install) of an app, from its build output:
//   node tools/pack.mjs filtergen     -> dist\PoE-Filter-Generator-TS-Setup-<version>.exe
//   node tools/pack.mjs checker       -> dist-checker\PoE-Price-Trade-Checker-TS-Setup-<version>.exe
// (npm run desktop:pack / checker:pack build first). The version of the installer is the one of the root package.json (single source).
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const APPS = {
  filtergen: { dir: "dist", name: "PoE-Filter-Generator-TS" },
  checker: { dir: "dist-checker", name: "PoE-Price-Trade-Checker-TS" },
};
const app = process.argv[2];
if (!APPS[app]) throw new Error(`usage: node tools/pack.mjs <${Object.keys(APPS).join("|")}>`);
const root = path.resolve(import.meta.dirname, "..");
const version = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf-8")).version;
const cwd = path.join(root, "apps", app);
const r = spawnSync("npx", ["electron-builder", "--config", "electron-builder.yml", "--win", "nsis", "zip", "--x64", "--publish", "never", `-c.extraMetadata.version=${version}`,
  `-c.extraMetadata.name=${APPS[app].name}`], { cwd, stdio: "inherit", shell: true }); // (the install folder is named after the package name)
if (r.status !== 0) process.exit(r.status ?? 1);
const exe = path.join(root, APPS[app].dir, `${APPS[app].name}-Setup-${version}.exe`);
console.log(`built ${exe} (${(fs.statSync(exe).size / 1048576).toFixed(1)} MB) v${version}`);
const zip = path.join(root, APPS[app].dir, `${APPS[app].name}-Portable-${version}.zip`);
if (fs.existsSync(zip)) console.log(`built ${zip} (${(fs.statSync(zip).size / 1048576).toFixed(1)} MB)`);
const feed = path.join(root, APPS[app].dir, "latest.yml");
console.log(fs.existsSync(feed) ? `update feed file: ${feed}` : `WARNING: no ${path.basename(feed)} was written`);
