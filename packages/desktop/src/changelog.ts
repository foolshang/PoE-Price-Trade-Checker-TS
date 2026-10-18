/**
 * The changelog of a program: one CHANGELOG.md per app (Thai), one "## <version> - <date>" section per release. The same file is
 *  - built into the program (the About window reads it, no network needed),
 *  - the text of the GitHub release page (tools/release-notes.mjs cuts the section of the tag),
 * so the release text is written in one place. Pure functions, no Electron.
 */
export interface ChangelogEntry {
  version: string;
  date: string;
  /** the lines under the heading, trimmed */
  body: string;
}

/** "## 1.0.0-beta.14 - 2026-10-18" (also "## [1.0.0] - date", "## v1.0.0"): newest first, as in the file. */
export function parseChangelog(text: string): ChangelogEntry[] {
  const out: ChangelogEntry[] = [];
  let cur: { version: string; date: string; lines: string[] } | null = null;
  for (const line of text.replace(/^﻿/, "").split(/\r?\n/)) {
    const m = /^##\s+\[?v?([0-9][^\]\s]*)\]?(?:\s*[-–—]\s*(\S.*))?\s*$/.exec(line);
    if (m) {
      if (cur) out.push({ version: cur.version, date: cur.date, body: cur.lines.join("\n").trim() });
      cur = { version: m[1], date: (m[2] ?? "").trim(), lines: [] };
    } else if (cur) cur.lines.push(line);
  }
  if (cur) out.push({ version: cur.version, date: cur.date, body: cur.lines.join("\n").trim() });
  return out;
}

/** The body of one version ("1.0.0" or "v1.0.0"), or null when the changelog has no section for it. */
export function sectionFor(text: string, version: string): string | null {
  const v = version.replace(/^v/, "");
  return parseChangelog(text).find((e) => e.version === v)?.body ?? null;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/** release notes as the updater gives them (markdown text, or the HTML of the release page, or a list of those) -> plain text */
export function notesToText(notes: unknown): string {
  if (!notes) return "";
  if (Array.isArray(notes)) return notes.map((n) => notesToText((n as { note?: unknown })?.note ?? n)).filter(Boolean).join("\n\n");
  if (typeof notes !== "string") return "";
  let t = notes;
  if (/<\/?[a-z][^>]*>/i.test(t)) {
    t = t
      .replace(/<\s*li[^>]*>/gi, "\n- ")
      .replace(/<\s*(br|\/p|\/h[1-6]|\/ul|\/ol|\/div)[^>]*>/gi, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (_m, e: string) => {
        if (e[0] === "#") {
          const code = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
          return Number.isFinite(code) ? String.fromCodePoint(code) : "";
        }
        return ENTITIES[e.toLowerCase()] ?? "";
      });
  }
  return t.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, 8000);
}
