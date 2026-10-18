// The text of a GitHub release page = the section of the tag in the app's CHANGELOG.md (one file, written once):
//   node tools/release-notes.mjs checker v1.0.0-beta.15  [> notes.md]
// Exits with 1 (and says why) when the changelog has no section for that version: a release without notes is not made.
import fs from "node:fs";
import path from "node:path";
import { sectionFor } from "../packages/desktop/src/changelog.ts";

const [app, tag] = process.argv.slice(2);
const FILES = { checker: "apps/checker/CHANGELOG.md", filtergen: "apps/filtergen/CHANGELOG.md" };
if (!FILES[app] || !tag) {
  console.error("usage: node tools/release-notes.mjs <checker|filtergen> <tag, e.g. v1.0.0>");
  process.exit(2);
}
const root = path.resolve(import.meta.dirname, "..");
const body = sectionFor(fs.readFileSync(path.join(root, FILES[app]), "utf-8"), tag);
if (!body) {
  console.error(`${FILES[app]} has no section for ${tag}`);
  process.exit(1);
}
process.stdout.write(body + "\n");
