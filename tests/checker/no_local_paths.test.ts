// What ships inside the programs must not carry this machine's paths or names: comments are bundled too.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const BAD = /[A-Z]:\\(Users|Projects)\\|\bWinai\b|ghp_[A-Za-z0-9]|gho_[A-Za-z0-9]|github_pat_/;

function sources(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === "out" || e.name === "dist" || e.name.startsWith(".")) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) sources(p, out);
    else if (/\.(ts|cjs|mjs|css|html|md)$/.test(e.name) && e.name !== "CHANGELOG.md") out.push(p);
  }
  return out;
}

describe("the program sources", () => {
  it("name no local path, person or token (packages/*/src, apps/*/src)", () => {
    const hits: string[] = [];
    for (const group of ["packages", "apps"]) {
      for (const d of fs.readdirSync(path.join(ROOT, group))) {
        const src = path.join(ROOT, group, d, "src");
        if (!fs.existsSync(src)) continue;
        for (const f of sources(src)) if (BAD.test(fs.readFileSync(f, "utf-8"))) hits.push(path.relative(ROOT, f));
      }
    }
    expect(hits).toEqual([]);
  });
});
