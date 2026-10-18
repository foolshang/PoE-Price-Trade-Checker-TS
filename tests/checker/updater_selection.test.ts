// Which GitHub release electron-updater picks for a beta copy. The real GitHubProvider runs; only the two HTTP reads are replaced.
// What this pins down (found when the first test release was not seen by an installed beta):
//  - updater.channel must stay UNSET: electron-updater also uses it as the name of the pre-release line, so "latest" hid every pre-release
//  - a pre-release tag asks for <label>.yml first and falls back to latest.yml: the programs publish latest.yml
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { GitHubProvider } = require("electron-updater/out/providers/GitHubProvider.js");
const { SemVer } = require("semver");

const atom = (tags: string[]): string =>
  `<?xml version="1.0" encoding="UTF-8"?><feed xmlns="http://www.w3.org/2005/Atom">${tags
    .map((t) => `<entry><id>tag:github.com,2008:Repository/1/${t}</id><updated>2026-10-18T00:00:00Z</updated><link rel="alternate" type="text/html" href="https://github.com/o/r/releases/tag/${t}"/><title>${t}</title><content type="html"></content></entry>`)
    .join("")}</feed>`;
const yml = (t: string): string => `version: ${t.slice(1)}\nfiles:\n  - url: s.exe\n    sha512: AAAA\n    size: 1\npath: s.exe\nsha512: AAAA\nreleaseDate: '2026-10-18T00:00:00.000Z'\n`;

async function pick(current: string, tags: string[], channel: string | null): Promise<string> {
  const updater = { allowPrerelease: true, channel, currentVersion: new SemVer(current) };
  const executor = {
    // (a pre-release tag asks for beta.yml first, then falls back to latest.yml - which is what the programs publish)
    request: async (o: { path: string }) => {
      if (o.path.endsWith(".atom")) return atom(tags);
      const m = /\/download\/(v[^/]+)\/latest\.yml$/.exec(o.path);
      if (!m || !tags.includes(m[1])) throw new Error(`404 ${o.path}`);
      return yml(m[1]);
    },
  };
  const p = new GitHubProvider({ provider: "github", owner: "o", repo: "r", channel: "latest" }, updater, { platform: "win32", isUseMultipleRangeRequest: false, executor });
  return (await p.getLatestVersion()).version;
}

describe("which release a beta copy sees", () => {
  it("a newer beta (the channel left unset)", async () => {
    expect(await pick("1.0.0-beta.16", ["v1.0.0-beta.17", "v1.0.0-beta.16"], null)).toBe("1.0.0-beta.17");
  });

  it("a real release is seen from a beta copy", async () => {
    expect(await pick("1.0.0-beta.17", ["v1.0.0", "v1.0.0-beta.17"], null)).toBe("1.0.0");
  });

  it("the old setting (channel = the feed name) saw nothing at all", async () => {
    await expect(pick("1.0.0-beta.16", ["v1.0.0-beta.17"], "latest")).rejects.toThrow(/No published versions/);
  });

  it("a -rc.1 pre-release is seen too (its feed file is looked up as rc.yml, then latest.yml - the one the programs publish)", async () => {
    expect(await pick("1.0.0-beta.16", ["v1.0.0-rc.1", "v1.0.0-beta.16"], null)).toBe("1.0.0-rc.1");
  });

  it("an rc copy moves on to the real release", async () => {
    expect(await pick("1.0.0-rc.1", ["v1.0.0", "v1.0.0-rc.1"], null)).toBe("1.0.0");
  });
});
