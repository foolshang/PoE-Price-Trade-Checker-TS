"""What the ORIGINAL does for an F5 on a fixture item - for the end-to-end tests of the desktop app (tests/checker).

    python -B tools/parity/f5_expect.py '{"text": "it:poe2_rare_gloves", "game": "poe2", "league": "Mirage", "filters": [[0, "40", ""], ...]}'

Prints JSON: kind, the rows / summary / badges of the popup, the url of a search with the boxes ticked as the popup starts
(`url_default`) and the url for `filters` ([[row, min text, max text], ...] = the ticked rows with what was typed).
"""
import json
import sys

sys.dont_write_bytecode = True
sys.path.insert(0, __file__.rsplit("\\", 1)[0] if "\\" in __file__ else __file__.rsplit("/", 1)[0])
import oldlib  # noqa: E402


def _use_new_stat_ids() -> None:
    """The original guesses stat ids with difflib; the Checker does not (packages/core/src/stat_match.ts). So that the original stays a fair
    oracle for everything ELSE (tiers, summary, badges, the url), its stat id lookup answers from tests/parity/fixtures/new_stat_ids.json:
    what the new matching gives for every mod line of every fixture item (made and checked by tests/parity/new_stat_ids.test.ts)."""
    from poe_price_trade import mod_badge, mod_db  # noqa: PLC0415

    table = json.loads((oldlib.FIX / "new_stat_ids.json").read_text(encoding="utf-8"))

    def find_stat_id(self, text, typ=None, threshold=0.75):
        key = f"{self._profile.game_version}\x01{typ or ''}\x01{text}"
        if key not in table:
            raise KeyError(f"no stat id in new_stat_ids.json for {key!r} (run: RETIRE_WRITE=1 npx vitest run tests/parity/new_stat_ids.test.ts)")
        return table[key]

    mod_db.ModDatabase.find_stat_id = find_stat_id
    # the original's badge also guesses from the hub's dictionary (difflib 0.85): the Checker does not
    mod_badge.ModBadgeDB.resolve_stat_id = lambda self, text, typ, db: db.find_stat_id(text, typ)


def main() -> None:
    a = json.loads(sys.argv[1])
    _use_new_stat_ids()
    game, league, ref = a["game"], a.get("league", ""), a["text"]
    res = oldlib.RUNNERS["f5"]("x", {"text": ref, "game": game, "league": league, "cfg": a.get("cfg") or {}})
    out = {"kind": res["kind"]}
    if res["kind"] == "url":
        out["url"] = res["url"]
    if res["kind"] == "picker":
        rows = res["rows"]
        out.update({"rows": [{"text": m["text"], "mod_type": m["mod_type"], "value": m["value"], "sid": sid, "tier": m["tier"], "group": m["group"],
                              "total": (res["annos"].get(str(m["group"])) or {}).get("total", 0), "money": bool((res["annos"].get(str(m["group"])) or {}).get("money"))} for m, sid in rows],
                    "summary": res["summary"], "badge_colors": res["badge_colors"], "roll_arrows": res["roll_arrows"], "affixes": res["affixes"]})

        def build(filters):
            return oldlib.CALLS["trade_url.build"](ref, game, league, True, filters)

        default = []
        for m, sid in rows:
            if sid and m["mod_type"] in ("explicit", "implicit"):
                v = m["value"]
                default.append([sid, float(f"{v:g}") if v is not None else None, None])
        out["url_default"] = build(default)
        if a.get("filters") is not None:
            picked = []
            for idx, lo, hi in a["filters"]:
                sid = rows[idx][1]
                pf = lambda t: float(t) if str(t).strip() else None  # noqa: E731
                picked.append([sid, pf(lo), pf(hi)])
            out["url_for"] = build(picked)
    print(json.dumps(out, ensure_ascii=True))


main()
