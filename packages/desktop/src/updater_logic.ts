/** The decisions of the updater that need no Electron (so they are tested on their own). */
import type { UpdateState } from "./updater_api.ts";

/** A version with a "-" (1.0.0-beta.3) is a pre-release. */
export const isPrerelease = (v: string): boolean => v.includes("-");

export type Offer = "skip-prerelease" | "manual" | "download";

/**
 * What to do with a release the feed offers: a pre-release is only for copies that are pre-releases themselves (the testers follow the
 * betas; everyone else waits for the real release); a copy the installer did not make (the zip) can only be told.
 */
export function decideOffer(current: string, offered: string, mode: "installer" | "manual"): Offer {
  if (isPrerelease(offered) && !isPrerelease(current)) return "skip-prerelease";
  return mode === "manual" ? "manual" : "download";
}

/** The line of the update banner ('' = no banner). */
export function bannerText(s: UpdateState): string {
  if (s.kind === "downloading") return `มีรุ่นใหม่ v${s.version} กำลังดาวน์โหลดเบื้องหลัง… ${s.percent ?? 0}%`;
  if (s.kind === "ready") return `มีรุ่นใหม่ v${s.version} ติดตั้งเมื่อปิดโปรแกรม`;
  if (s.kind === "manual") return `มีรุ่นใหม่ v${s.version} — โปรแกรมนี้เป็นแบบ zip อัปเดตเองไม่ได้ โหลดรุ่นใหม่ได้ที่หน้า release`;
  return "";
}

/** The first line of an error's message (electron-updater errors carry a stack and sometimes a whole HTTP body). */
export const firstLine = (e: unknown): string => String((e as { message?: string } | null)?.message ?? e).split(/\r?\n/)[0].slice(0, 300);

/** GitHub has no release at all yet (a new repository): nothing is wrong, there is just nothing to offer. */
export const isNoReleases = (message: string): boolean => /No published versions on GitHub/i.test(message);

/** Logs one failure once: the library reports the same error through its logger, the "error" event and the rejected promise. */
export function onceWithin(ms: number, now: () => number = Date.now): (key: string) => boolean {
  let last = "", at = -Infinity;
  return (key) => {
    const t = now();
    const dup = key === last && t - at < ms;
    last = key;
    at = t;
    return !dup;
  };
}
