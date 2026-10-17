// dist\PoE-Filter-Generator-TS-Setup-<version>.exe (one-click installer for the current user) from the build output of apps/filtergen:
//   npm run desktop:pack      (= electron-vite build, then this)
// The version of the exe is the one of the root package.json (single source, CLAUDE.md rule 4).
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const version = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf-8")).version;
const cwd = path.join(root, "apps", "filtergen");
const r = spawnSync("npx", ["electron-builder", "--config", "electron-builder.yml", "--win", "nsis", "--x64", `-c.extraMetadata.version=${version}`,
  "-c.extraMetadata.name=PoE-Filter-Generator-TS"], // (the install folder is named after the package name),
  { cwd, stdio: "inherit", shell: true });
if (r.status !== 0) process.exit(r.status ?? 1);
const exe = path.join(root, "dist", `PoE-Filter-Generator-TS-Setup-${version}.exe`);
console.log(`built ${exe} (${(fs.statSync(exe).size / 1048576).toFixed(1)} MB) v${version}`);
