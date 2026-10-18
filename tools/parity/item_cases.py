"""Cases of the item pipeline (F5 / F4); see item_calls.py for what each call runs on the original."""
from __future__ import annotations
import gzip
import json
import random
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
FIX = ROOT / "tests" / "parity" / "fixtures"
GAMES = ("poe1", "poe2")


def _snap(name):
    with gzip.open(FIX / name, "rt", encoding="utf-8") as fh:
        return json.load(fh)


def _case(group, name, fn, args):
    return {"id": f"{group}/{name}", "fn": fn, "args": args}


def _call(group, name, call, *args, **kwargs):
    a = {"name": call, "args": list(args)}
    if kwargs:
        a["kwargs"] = kwargs
    return _case(group, name, "call", a)


ITEMS = sorted(p.stem for p in (FIX / "items").glob("*.txt"))
LEAGUES = ["Mirage", "Hardcore Mirage", "Runes of Aldur", "HC Fate/of the Vaal", "Düsseldorf Ünï", "A&B=C?#%", "", "標準 League"]


def item_cases() -> dict:
    rnd = random.Random(20261018)
    stats = {g: _snap(f"gstats_{g}.json.gz") for g in GAMES}
    explicit = {g: [s for s in stats[g] if s["type"] == "explicit"] for g in GAMES}
    items_payload = {g: _snap(f"gitems_{g}.json.gz") for g in GAMES}

    parse, urls, f5, texts = [], [], [], []
    for it in ITEMS:
        for g in GAMES:
            parse.append(_call("parse", f"{it}-{g}", "item_parser.parse_item", f"it:{it}", g))
    for i, it in enumerate(ITEMS):
        for g in GAMES:
            lg = LEAGUES[(i + (g == "poe2")) % len(LEAGUES)]
            urls.append(_call("url", f"{it}-{g}-base", "trade_url.build", f"it:{it}", g, lg, True))
            urls.append(_call("url", f"{it}-{g}-nobase", "trade_url.build", f"it:{it}", g, LEAGUES[(i + 3) % len(LEAGUES)], False))
    # the filters a picker sends: whole numbers, decimals, only min, only max, nothing, an entry without an id, 40 stats
    for g in GAMES:
        sids = [s["id"] for s in explicit[g][:60]]
        variants = {
            "min_max": [[sids[0], 40, 60]],
            "decimals": [[sids[1], 12.5, 99.99], [sids[2], None, None]],
            "only_min": [[sids[3], 3, None]],
            "only_max": [[sids[4], None, 1e-05]],
            "none": [],
            "no_id": [[None, None, None], ["", None, None], [sids[5], None, None]],
            "many": [[s, k, None] for k, s in enumerate(sids[:40])],
            "big": [[sids[6], 12345678901234567.0, 0.1]],
        }
        for rare in ("poe2_rare_gloves", "poe1_rare_body", "poe2_rare_bow", "poe2_magic_boots", "poe1_unique_dying_sun", "poe2_rare_unidentified", "poe2_rare_ring"):
            for vn, v in variants.items():
                urls.append(_call("url", f"custom-{rare}-{g}-{vn}", "trade_url.build", f"it:{rare}", g, "Mirage", True, v))
        for pct in (0.5, 0.8, 1.0, 0.333):
            urls.append(_call("url", f"minpct-{g}-{pct}", "trade_url.build", "it:poe2_rare_gloves", g, "Standard", True, None, pct))
    configs = [{}, {"f5_mod_picker": False}, {"mod_badge_archetype": "all"}]
    archs = sorted({m["archetype"] for g in GAMES for m in _snap(f"hub_meta_{g}.json.gz")["mods"]})
    for it in ITEMS:
        for g in GAMES:
            for j, cfg in enumerate(configs):
                f5.append(_case("f5", f"{it}-{g}-c{j}", "f5", {"text": f"it:{it}", "game": g, "league": "Mirage", "cfg": cfg}))
            for a in archs[:6]:
                if it.startswith(("poe2_rare", "poe1_rare", "poe2_shield", "poe1_jewel", "poe2_jewel")):
                    f5.append(_case("f5", f"{it}-{g}-arch-{a}", "f5", {"text": f"it:{it}", "game": g, "league": "Standard", "cfg": {"mod_badge_archetype": a}}))
    texts.append(_case("f5", "inline-empty", "f5", {"text": "", "game": "poe2"}))
    texts.append(_case("f5", "inline-hello", "f5", {"text": "hello", "game": "poe1"}))

    # mod lines: what the items hold + typos / case / numbers
    mod_lines = ["+92 to maximum Life", "+47(42-49) to maximum Life", "40(39-42)% increased Armour", "Adds 6 to 12 Fire damage to Attacks", "Adds 6(5-8) to 12(10-15) Fire damage to Attacks",
                 "+36(36-40)% to Fire Resistance", "13(11-13)% increased Attack Speed", "+3(2-4) to Level of all Projectile Skills", "99(92-100)% increased Armour and Evasion",
                 "56(56-60)% reduced Shock duration on you", "+30 to Strength", "10% increased Rarity of Items found", "Regenerate 31.6 Life per second", "", "   ", "totally unknown mod text 123",
                 "+# to maximum Life", "# to maximum life", "+12 TO MAXIMUM LIFE", "+92 to maximun Life", "+92 to maximum Lfe", "increased armor", "+1٠ to maximum Life", "% increased Damage", "Gain 5% of Damage as Extra Fire Damage"]
    mod_lines += [s["text"].replace("#", str(rnd.randint(2, 99))) for s in rnd.sample(explicit["poe1"], min(25, len(explicit["poe1"])))]
    mod_lines += [s["text"].replace("#", str(rnd.randint(2, 99))) for s in rnd.sample(explicit["poe2"], min(25, len(explicit["poe2"])))]
    mod_lines += [t[:-2] if len(t) > 6 else t for t in rnd.sample(mod_lines[:25], min(8, len(mod_lines[:25])))]
    modq = []
    for k, text in enumerate(mod_lines):
        for g in GAMES:
            for typ in (None, "explicit", "implicit", "desecrated", "rune", "fractured", "enchant"):
                if typ is None or (k + (g == "poe2")) % 3 == 0:
                    modq.append(_call("modfind", f"{k}-{g}-{typ}", "mod_db.find", g, text, typ))
        modq.append(_call("modfind", f"{k}-norm", "mod_db.normalize", text))
        modq.append(_call("modfind", f"{k}-poe2-thr", "mod_db.find", "poe2", text, "explicit", 0.9))

    # base / unique names
    basecases = []
    for g in GAMES:
        entries = [e for grp in items_payload[g]["result"] for e in grp["entries"]]
        types = [e["type"] for e in entries if e.get("type")]
        names = [e["name"] for e in entries if e.get("name")]
        picks = rnd.sample(types, min(30, len(types))) + ["Fortress Sabatons", "Gold Ring", "Chaos Orb", "Divine Orb", "Knightly Mitts", "Ashen Staff", "Exceptional Verisium"]
        raws = []
        for t in picks:
            raws += [t, "Superior " + t, "Anomalous " + t, t.lower(), t + " x", t[:-1], "  " + t]
        raws += ["", "zzzz", "Legend's Fortress Sabatons of Grounding", "Superior", "superior "]
        for k, raw in enumerate(raws):
            basecases.append(_call("base", f"type-{g}-{k}", "base_db.resolve_type", g, raw))
        for k, n in enumerate(rnd.sample(names, min(25, len(names))) + ["Ventor's Gamble", "Dying Sun", "nothing here"]):
            for raw in (n, n.lower(), n + "s"):
                basecases.append(_call("base", f"name-{g}-{k}-{len(raw)}", "base_db.resolve_name", g, raw))

    # meta
    meta = []
    metas = {g: _snap(f"mod_meta_{g}.json.gz") for g in GAMES}
    for g in GAMES:
        bases = list(metas[g]["bases"])
        for b in rnd.sample(bases, min(20, len(bases))):
            meta.append(_call("meta", f"rb-{g}-{len(meta)}", "meta_db.resolve_base", g, f"Legend's {b} of Grounding"))
            meta.append(_call("meta", f"rb2-{g}-{len(meta)}", "meta_db.resolve_base", g, b))
        meta += [_call("meta", f"rb-none-{g}", "meta_db.resolve_base", g, "Boots of Nothing"), _call("meta", f"rb-empty-{g}", "meta_db.resolve_base", g, "")]
        for b in rnd.sample(bases, min(12, len(bases))):
            fams = metas[g]["tagsets"].get(str(metas[g]["bases"][b].get("ts")), [])
            for f in fams[:3]:
                for tier in (0, 1, 2, len(f["tiers"]), len(f["tiers"]) + 1, -1):
                    meta.append(_call("meta", f"tr-{g}-{len(meta)}", "meta_db.tier_range", g, b, f["text"].replace("#", "5"), tier))
        for t in ("+47(42-49) to maximum Life", "40(39-42)% increased Armour", "Adds 6(5-8) to 12(10-15) Fire damage", "", "x"):
            meta.append(_call("meta", f"norm-{len(meta)}", "meta_db.norm", t))
        tmpls = sorted({f["text"] for fams in metas[g]["tagsets"].values() for f in fams})
        for t in rnd.sample(tmpls, min(15, len(tmpls))) + ["nothing"]:
            meta.append(_call("meta", f"tags-{g}-{len(meta)}", "meta_db.tags_for_template", g, t))
    for it in ITEMS:
        for g in GAMES:
            meta.append(_call("meta", f"annotate-{it}-{g}", "meta_db.annotate", f"it:{it}", g))

    # badge
    badge = []
    classes = ["Helmets", "Helmet", "Body Armours", "Gloves", "Boots", "Belts", "Rings", "Amulets", "Quivers", "Foci", "Shields", "Bucklers", "Charms", "Life Flasks", "Mana Flasks",
               "Bows", "Wands", "Sceptres", "Jewels", "Jewel", "Currency", "Skill Gems", "Waystones", "", "Maps"]
    bases_ = ["Emerald", "Cobalt Jewel", "Large Cluster Jewel", "Murderous Eye Jewel", "Small Cluster Jewel", "Medium Cluster Jewel", "Iron Hat", "", "Jewel", "Ruby", "Timeless Jewel"]
    for c in classes:
        for b in bases_[:3] + ([] if c not in ("Jewels", "Jewel") else bases_):
            badge.append(_call("badge", f"slot-{len(badge)}", "mod_badge.slot_for_item", c, b))
        for g in GAMES:
            badge.append(_call("badge", f"cap-{len(badge)}", "mod_badge.affix_cap", c, g))
    for vals, rng in (([5], [[1, 10]]), ([1], [[1, 10]]), ([10], [[1, 10]]), ([2.5, 7], [[1, 3], [5, 9]]), ([5], []), ([], [[1, 2]]), ([5], [[3, 3]]), ([5], None),
                      ([8, 1], [[1, 10]]), ([0.1, 0.2, 0.3], [[0, 1], [0, 1], [0, 1]]), ([7.5], [[0, 10]]), ([2.5], [[0, 10]]), ([2.4999], [[0, 10]])):
        for pct in (0.25, 0.1, 0.5):
            badge.append(_call("badge", f"arrow-{len(badge)}", "mod_badge.tier_roll_arrow", vals, rng, pct))
    for g in GAMES:
        slots = sorted({m["slot"] for m in _snap(f"hub_meta_{g}.json.gz")["mods"]})
        for s in slots[:12]:
            for a in ("all", archs[0], archs[-1], "nonexistent"):
                badge.append(_call("badge", f"colors-{g}-{s}-{a}", "mod_badge.colors", g, s, a))
        badge.append(_call("badge", f"tmpl-{g}", "mod_badge.build_template_index", g))
        for k, line in enumerate(mod_lines[:50]):
            badge.append(_call("badge", f"resolve-{g}-{k}", "mod_badge.resolve", g, line, "explicit"))
        rows = _snap(f"hub_meta_{g}.json.gz")["mods"]
        for r in rnd.sample(rows, min(25, len(rows))):
            for vals in ([r.get("value_min") or 1], [(r.get("value_min") or 0) + 0.01], [r.get("value_max") or 9], [1, 2], []):
                badge.append(_call("badge", f"fb-{g}-{len(badge)}", "mod_badge.fallback_arrow", g, r["stat_id"], r["slot"], r["archetype"], vals))

    # skill reference
    skill = []
    for g in GAMES:
        fx = _snap(f"hub_skills_{g}.json.gz")
        names = [s["skill"] for s in fx["index"]["skills"]]
        prefixes = ["", " ", "fire", "FIRE", "ball", "a", "zz", "wolf", "herald", "minion", "spell", "attack", "aura", "de", "of the", "*", "(", "1"] + [n[:3] for n in rnd.sample(names, min(12, len(names)))] + [n.lower() for n in rnd.sample(names, min(10, len(names)))]
        skill.append(_call("skill", f"count-{g}", "skill_ref.count", g))
        for k, p in enumerate(prefixes):
            skill.append(_call("skill", f"search-{g}-{k}", "skill_ref.search", g, p))
        by_path = {s["path"]: s for s in fx["index"]["skills"] if s.get("path")}
        skill.append(_call("skill", f"files-{g}", "skill_ref.files", g))
        for path in fx["files"]:
            s = by_path[path]
            skill.append(_call("skill", f"mods-{g}-{s['slug']}", "skill_ref.mods", g, s["skill_type"], s["skill"]))
        for s in fx["index"]["skills"][:25]:
            skill.append(_call("skill", f"meta-{g}-{s['slug']}", "skill_ref.meta", g, s["skill_type"], s["skill"]))
            skill.append(_call("skill", f"pas-{g}-{s['slug']}", "skill_ref.passives", g, s["skill_type"], s["skill"]))
        skill.append(_call("skill", f"nofile-{g}", "skill_ref.mods", g, "main", "No Such Skill"))
        for which in ("index", "dictionary", "passives"):
            skill.append(_call("skill", f"schema-{g}-{which}", "skill_ref.schema", g, which))

    # leagues
    league = []
    for g in GAMES:
        for shape in ("real", "no_hc", "no_events", "no_main", "dup", "down", "down_nolatest"):
            league.append(_call("league", f"files-{g}-{shape}", "hub_client.get_league_files", g, shape))
            for auto in (True, False):
                for phc in (True, False):
                    for cur in ("", "Mirage", _snap(f"hub_league_index_{g}.json.gz")["main"]["league"], "Hardcore " + _snap(f"hub_league_index_{g}.json.gz")["main"]["league"]):
                        league.append(_call("league", f"choose-{g}-{shape}-{auto}-{phc}-{len(cur)}", "app.choose_league", g, shape, auto, phc, cur))

    # python behaviours
    pyb = []
    for x in (0.5, 1.5, 2.5, 0.125, 0.375, 2.675, 73.60000000000001, 1e-5, 12345.6789, -0.5, -2.5, 0.0, 99.995, 1.005, 5e-324, 1e22, 0.1 * 3, 40 * 0.8, 92.0 * 0.8, 47 * 0.8, 36.5 * 0.8, 0.285 * 100):
        for n in (0, 1, 2, 3):
            pyb.append(_call("pyb", f"round-{len(pyb)}", "py.round", x, n))
        pyb.append(_call("pyb", f"g-{len(pyb)}", "py.format_g", x))
        pyb.append(_call("pyb", f"jf-{len(pyb)}", "py.json_float", x))
    for x in (1234567.0, 123456.0, 1e6, 0.0001, 0.00001, 12.0, 0.1, 100000.0, 1e-7, 123456789.123, -3.0, 1e15, 1e16, 1e17, 1.5e300):
        pyb.append(_call("pyb", f"g-{len(pyb)}", "py.format_g", x))
        pyb.append(_call("pyb", f"jf-{len(pyb)}", "py.json_float", x))
    for s in ("1", " 2.5 ", "-3", "+4.", ".5", "1e3", "1E-2", "1_000", "1__0", "_1", "inf", "-Infinity", "nan", "abc", "", "1.2.3", "0x10", "١٢", "١٫٥", "1,5", "--1", "5e", "e5", "+.e1"):
        pyb.append(_call("pyb", f"float-{len(pyb)}", "py.float", s))
    for xs in ([0.1] * 10, [0.1, 0.2, 0.3], [1e100, 1.0, -1e100], [0.5, 0.25, 0.125], [1, 2, 3], [], [0.3333333333333333] * 3, [0.1] * 3, [1e16, 1.5, 1.5, 1.5, 1.5], [2.5, 7.1, 3.3, 9.9, 0.1]):
        pyb.append(_call("pyb", f"sum-{len(pyb)}", "py.sum", xs))
    for s in ("abc", "a b", "a/b", "a&b=c?d#e", "100%", "~-_.", "!'()*", "ä ö ü", "標準", "😀", "{\"a\":[1,2]}", "", "A+B", "x\ny", "a:b@c"):
        pyb.append(_call("pyb", f"quote-{len(pyb)}", "py.quote", s))
        pyb.append(_call("pyb", f"quote0-{len(pyb)}", "py.quote", s, ""))
        pyb.append(_call("pyb", f"quote1-{len(pyb)}", "py.quote", s, "/:"))
    words = ["maximum life", "to maximum life", "increased attack speed", "armour", "abcd", "abcdefgh", "", "a", "aaaaaaaaaaaaaaaa", "ab" * 120]
    poss = ["to maximum life", "maximum life", "maximum lif", "increased attack speed", "attack speed", "armour and evasion", "aaaaaaaa", "a", "abab", "ab" * 110, "b" * 5, "baab", "xabcdefgh", "abcdefg", "ABCD"]
    for w_ in words:
        for n, cut in ((1, 0.6), (3, 0.6), (1, 0.85), (5, 0.3), (2, 0.0)):
            pyb.append(_call("pyb", f"cm-{len(pyb)}", "py.close_matches", w_, poss, n, cut))
    for a_, b_ in (("abcd", "bcde"), ("", ""), ("a", ""), ("abc", "abc"), ("ab" * 120, "ba" * 120), ("the quick brown fox", "the quick red fox"), ("日本語", "日本"), ("😀a", "a😀"), ("aaa", "aa"), ("abab", "baba")):
        pyb.append(_call("pyb", f"ratio-{len(pyb)}", "py.ratio", a_, b_))

    from mod_meta_cases import mod_meta_cases
    groups = {"parse": parse, "url": urls, "f5": f5 + texts, "modfind": modq, "base": basecases, "meta": meta, "badge": badge, "skill": skill, "league": league, "pyb": pyb, "modmeta": mod_meta_cases()}
    out = {}
    for k, cases in groups.items():
        seen: dict = {}
        for c in cases:  # ids must be unique (two cases may differ only in their arguments)
            n = seen.get(c["id"], 0)
            seen[c["id"]] = n + 1
            if n:
                c["id"] = f"{c['id']}~{n}"
        out[f"item-{k}"] = cases
    return out
