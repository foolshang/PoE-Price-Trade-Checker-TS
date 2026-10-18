// The checks before anything is published (the release workflow runs this; a failure = nothing is released):
//   node tools/check-release.mjs v1.0.0
//  - the tag == the version in package.json (the single source; the apps' own package.json files stay 0.0.0)
//  - both CHANGELOGs have a section for the tag
//  - a real release (no "-" in the tag) has the public README ready (release/README_public.md)
//  - every file is there, with a sane size, and the .yml of each app names this version and the real sha512 / size of its Setup
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { sectionFor } from "../packages/desktop/src/changelog.ts";

const tag = process.argv[2] || "";
const root = path.resolve(import.meta.dirname, "..");
const problems = [];
const bad = (m) => problems.push(m);
if (!/^v\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(tag)) { console.error(`'${tag}' is not a release tag (v1.2.3 or v1.2.3-rc.1)`); process.exit(2); }
const v = tag.slice(1);

const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf-8")).version;
if (pkg !== v) bad(`tag ${tag} does not match package.json version ${pkg}`);
for (const f of ["apps/checker/CHANGELOG.md", "apps/filtergen/CHANGELOG.md"]) {
  if (!sectionFor(fs.readFileSync(path.join(root, f), "utf-8"), tag)) bad(`${f} has no section for ${tag}`);
}
if (!v.includes("-") && !fs.existsSync(path.join(root, "release", "README_public.md"))) bad("release/README_public.md is missing (a real release updates the public README)");

const MB = 1024 * 1024;
const apps = [
  { dir: "dist", prefix: "PoE-Filter-Generator-TS", yml: "latest.yml" },
  { dir: "dist-checker", prefix: "PoE-Price-Trade-Checker-TS", yml: "latest.yml" },
];
for (const a of apps) {
  const at = (n) => path.join(root, a.dir, n);
  const setup = `${a.prefix}-Setup-${v}.exe`;
  const want = [[setup, 40 * MB, 400 * MB], [`${setup}.blockmap`, 1, 20 * MB], [`${a.prefix}-Portable-${v}.zip`, 40 * MB, 500 * MB], [a.yml, 100, 10_000]];
  for (const [n, min, max] of want) {
    if (!fs.existsSync(at(n))) { bad(`missing ${a.dir}/${n}`); continue; }
    const size = fs.statSync(at(n)).size;
    console.log(`${a.dir}/${n}  ${(size / MB).toFixed(1)} MB`);
    if (size < min || size > max) bad(`${a.dir}/${n} has an odd size (${size} bytes)`);
  }
  if (fs.existsSync(at(a.yml)) && fs.existsSync(at(setup))) {
    const yml = fs.readFileSync(at(a.yml), "utf-8");
    const ver = /^version: (.+)$/m.exec(yml)?.[1]?.trim();
    const sum = /^sha512: (.+)$/m.exec(yml)?.[1]?.trim();
    const size = Number(/^\s+size: (\d+)$/m.exec(yml)?.[1]);
    if (ver !== v) bad(`${a.dir}/${a.yml} says version ${ver}, the tag is ${v}`);
    if (!yml.includes(setup)) bad(`${a.dir}/${a.yml} does not name ${setup}`);
    const real = crypto.createHash("sha512").update(fs.readFileSync(at(setup))).digest("base64");
    if (sum !== real) bad(`${a.dir}/${a.yml}: sha512 does not match ${setup}`);
    if (size !== fs.statSync(at(setup)).size) bad(`${a.dir}/${a.yml}: size does not match ${setup}`);
  }
}
if (problems.length) {
  for (const p of problems) console.error(`::error::${p}`);
  process.exit(1);
}
console.log(`release check for ${tag}: all good`);
