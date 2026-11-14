// The hub's hardcore and event price files for the tests: the main fixture with one item taken out and one made-up item put in, so a test can tell
// which league's file a list came from. (The fixtures of tests/parity are not touched; the real files are shaped like the main one.)
export const HC_EXTRA = "Hardcore Test Orb";
export const EVENT_EXTRA = "Event Test Orb";

/** `mainText` = the main league's file (a JSON text); kind "hardcore" | "event". Returns { text, gone, extra }. */
export function leagueVariant(mainText, kind) {
  const d = JSON.parse(mainText);
  const gone = d.items[0].name; // a Currency item that only the main league has
  const extra = kind === "hardcore" ? HC_EXTRA : EVENT_EXTRA;
  d.items = [...d.items.slice(1), { name: extra, category: "Currency" }];
  d.league = kind === "hardcore" ? `Hardcore ${d.league ?? "League"}` : `Event ${d.league ?? "League"}`;
  return { text: JSON.stringify(d), gone, extra };
}

/** the hub path -> which file it is (null = not a league file) */
export function leagueKind(p) {
  if (p === "prices/hardcore/latest.json") return "hardcore";
  if (/^prices\/events\/[a-z0-9-]+\.json$/.test(p)) return "event";
  return null;
}
