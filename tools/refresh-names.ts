/**
 * The guard of `npm run names:refresh` (tools/refresh-names-main.ts): a fresh names list replaces the shipped snapshot
 * only when it did not shrink by more than 20%.
 */
export const MAX_SHRINK = 0.8;

/** True when a fresh list may replace the shipped one: not empty, and not smaller than 80% of what is shipped. */
export function mayWrite(fresh: number, shipped: number): boolean {
  return fresh > 0 && !(shipped > 0 && fresh < shipped * MAX_SHRINK);
}
