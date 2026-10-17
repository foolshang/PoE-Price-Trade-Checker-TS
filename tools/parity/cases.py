"""Builds the parity cases (tests/parity/cases/*.json). Deterministic (seeded). Uses the ORIGINAL program only to look up
names and to compute the config a random model scenario ends with; the expected OUTPUTS come from gen_golden.py.
"""
from __future__ import annotations
import copy
import random

from oldlib import (WlModel, data, filter_core, filter_style, w, jsonable, apply_op)  # noqa: F401

GAMES = ("poe1", "poe2")
COLORS = filter_style.COLORS
SHAPES = filter_style.SHAPES
LABELS = ("S", "A", "B", "C", "G", "Tablet", "Map", "Gem")
TIERS5 = ("S", "A", "B", "C", "D")


def case(group: str, name: str, fn: str, args: dict, keep_text: bool = False) -> dict:
    return {"id": f"{group}/{name}", "fn": fn, "args": args, **({"keep_text": True} if keep_text else {})}


# ------------------------------------------------------------------------------------------------ tier mode (NeverSink tab)

def tier_cases() -> list:
    out = []
    sound_sets = {
        "none": {},
        "all6": {f"sound_{i}": f"C:/snd/s{i}.mp3" for i in range(1, 7)},
        "some": {"sound_1": "a.mp3", "sound_3": "b c.wav", "sound_6": "weird#name;x.ogg"},
        "same_file": {"sound_1": "same.mp3", "sound_2": "same.mp3"},
        "legacy_sabc": {"sound_s": "D:/x/boom.mp3", "sound_a": "D:/x/ding.mp3", "sound_b": "D:/x/b.mp3", "sound_c": "D:/x/c.mp3"},
        "legacy_mixed": {"sound_s": "old.mp3", "sound_1": "new.mp3"},
    }
    styles_q = {
        "noq": None,
        "q_color": {"text": [10, 200, 30, 255], "size": 40},
        "q_game_sound": {"text": [1, 2, 3], "sound": {"kind": "game", "id": 5, "volume": 150}, "icon": {"size": 1, "color": "Red", "shape": "Star"}},
        "q_file_sound": {"bg": [0, 0, 0], "sound": {"kind": "file", "file": "D:/q/quest.mp3", "volume": 200}, "effect": {"color": "Blue", "temp": True}},
        "q_empty": {},
    }
    for game in GAMES:
        for base in ("s2", "base"):
            for sk, sv in sound_sets.items():
                for qk, qv in styles_q.items():
                    if qk not in ("noq", "q_game_sound", "q_file_sound") and sk != "none":
                        continue
                    cfg = dict(sv)
                    if qv is not None:
                        cfg["style_q"] = qv
                    out.append(case("tier", f"{game}-{base}-{sk}-{qk}", "build_filter_text",
                                    {"game": game, "cfg": cfg, "base": f"fx:ns_{game}_{base}", "base_tag": "9.9.9"},
                                    keep_text=(base == "s2" and sk == "all6" and qk == "q_file_sound")))
        out.append(case("tier", f"{game}-nobase", "build_filter_text", {"game": game, "cfg": {"sound_1": "a.mp3"}, "base": None}))
        out.append(case("tier", f"{game}-nocopy", "build_filter_text",
                        {"game": game, "cfg": {"sound_1": "a.mp3"}, "base": f"fx:ns_{game}_s2", "sounds": None}))
    return out


# ------------------------------------------------------------------------------------------------ legacy whitelist (wl_v2 false)

def legacy_cases() -> list:
    out = []
    p1 = {
        "poe1": ["Currency", "Fragment", "Scarab", "DivinationCard"],
        "poe2": ["Currency", "Rune", "Omen", "Expedition"],
    }
    for game in GAMES:
        cats = p1[game]
        exclude = {cats[0]: ["Orb of Alchemy", "Chaos Orb", "Divine Orb"]}
        gem_uncut = {"Uncut Skill Gem": 12, "Uncut Spirit Gem": "5"} if game == "poe2" else {}
        variants = {
            "nothing": {"whitelist_enabled": True},
            "cats": {"whitelist_enabled": True, f"whitelist_cats_{game}": cats},
            "cats_exclude": {"whitelist_enabled": True, f"whitelist_cats_{game}": cats, f"whitelist_cat_exclude_{game}": exclude},
            "gold": {"whitelist_enabled": True, "whitelist_gold": True, "whitelist_gold_min": 100},
            "gold_nomin": {"whitelist_enabled": True, "whitelist_gold": True},
            "gold_badmin": {"whitelist_enabled": True, "whitelist_gold": True, "whitelist_gold_min": "x"},
            "unique_all": {"whitelist_enabled": True, "whitelist_unique_all": True},
            "custom": {"whitelist_enabled": True, f"whitelist_custom_{game}": [
                "plain name", {"name": " Spaced ", "rarities": ["Rare", "Magic"]}, {"name": "Uniq", "rarities": ["Unique"]},
                {"name": "", "rarities": []}, {"name": "BadR", "rarities": ["x"]}, 5, {"name": "All", "rarities": ["Normal", "Magic", "Rare", "Unique"]}]},
            "gems": {"whitelist_enabled": True, f"whitelist_gem_uncut_{game}": gem_uncut, f"whitelist_gem_names_{game}": ["Fireball", "Arc"]},
            "sounds": {"whitelist_enabled": True, f"whitelist_cats_{game}": cats[:2], "sound_1": "s.mp3", "sound_3": "u.mp3",
                       "style_q": {"text": [1, 2, 3], "sound": {"kind": "file", "file": "q.mp3"}}},
            "legacy_sounds": {"whitelist_enabled": True, "whitelist_gold": True, "sound_s": "S.mp3", "sound_a": "A.mp3"},
            "everything": {"whitelist_enabled": True, f"whitelist_cats_{game}": cats, "whitelist_gold": True, "whitelist_gold_min": 5,
                           "whitelist_unique_all": True, f"whitelist_custom_{game}": ["xyz"], f"whitelist_gem_names_{game}": ["Arc"],
                           f"whitelist_gem_uncut_{game}": gem_uncut},
        }
        for k, cfg in variants.items():
            for hub in ("fx:hub_" + game, None):
                if hub is None and k not in ("cats", "everything"):
                    continue
                out.append(case("legacy", f"{game}-{k}-{'hub' if hub else 'nohub'}", "build_filter_text",
                                {"game": game, "cfg": cfg, "hub": hub, "base": None}))
    return out


# ------------------------------------------------------------------------------------------------ whitelist model (hand written)

def hand_model_cases() -> list:
    out = []

    def add(name, game, cfg=None, ops=None, **kw):
        out.append(case("wlhand", f"{game}-{name}", "wl_model", {"game": game, "cfg": cfg or {}, "ops": ops or [], **kw}))

    for game in GAMES:
        add("empty", game)
        add("nodata", game, data=False)
        add("nobase", game, base=None)
        add("nohub", game, hub=None)
        add("nonames", game, names=False)
        add("gold_map_gem", game, {"whitelist_gold": True, "whitelist_gold_min": "7", "wl_map_on": True, "wl_map_tier_min": 99,
                                   "wl_map_rarity_min": "Rare", "whitelist_gem_tier": "A"})
        add("map_bad", game, {"wl_map_on": True, "wl_map_tier_min": "zz", "wl_map_rarity_min": "Bogus", "whitelist_gem_tier": "Q"})
        add("tier_format_old", game, {f"wl_item_tier_{game}": {"Chaos Orb": "C", "Divine Orb": "S", "Orb of Alchemy": "A"},
                                       f"wl_cat_tier_{game}": {"Currency": "C", "Fragment": "B"},
                                       f"wl_unique_tier_{game}": {"Headhunter": "C"},
                                       "whitelist_gem_tier": "C",
                                       f"whitelist_custom_{game}": [{"name": "foo", "rarities": ["Rare"], "tier": "C"}, "bar"]})
        add("tier_format_new", game, {"wl_tier_format": 2, f"wl_item_tier_{game}": {"Chaos Orb": "C", "Divine Orb": "D"}})
        add("legacy_rarity_tier", game, {"wl_tier_format": 2, f"wl_rarity_tier_{game}": {"gear:flask": {"Normal": "S", "Magic": "A", "Rare": "B"}, "gear:jewel": {"Rare": "S"}}})
        add("legacy_rarity_tier_c", game, {f"wl_rarity_tier_{game}": {"gear:flask": {"Normal": "C", "Magic": "A"}}})
        add("legacy_gear_tier", game, {"wl_tier_format": 2, f"wl_gear_tier_{game}": {"story": "S", "links": "D", "gems": "A"},
                                        f"wl_cat_tier_{game}": {"Gear": "A", "gear:flask": "S", "gear:story": "B"},
                                        f"wl_block_tier_{game}": {"leveling|t1|1": "S", "x|y|2": "A"},
                                        f"wl_class_tier_{game}": {"Vault Keys": "S"}})
        add("rarity_rows", game, {"wl_tier_format": 2, f"wl_rarity_rows_{game}": {
            "Flask": {"custom": True, "tiers": {"Normal": "S", "Magic": "D", "Rare": "A"}},
            "Charm": {"custom": True, "tiers": {"Magic": "A"}},
            "Tincture": {"custom": True, "tiers": {"Normal": "S"}},
            "Bogus": {"custom": True, "tiers": {}}, "X": 5}})
        add("rarity_rows_off", game, {"wl_tier_format": 2, f"wl_rarity_rows_{game}": {
            "Flask": {"custom": False, "tiers": {"Normal": "S"}}, "Charm": {"custom": False, "tiers": {}}}})
        eq = {"Bows": {"custom": True, "tiers": {"Rare": "S", "Magic": "D"}}, "Boots": {"custom": True, "tiers": {}},
              "Rings": {"custom": True, "tiers": {"Normal": "C", "Rare": "A"}}, "Wands": {"custom": False, "tiers": {"Rare": "A"}},
              "Nope": {"custom": True, "tiers": {"Rare": "A"}}, "Foci": {"custom": True, "tiers": {"Rare": "S"}},
              "Jewels": {"custom": True, "tiers": {"Normal": "D", "Magic": "D", "Rare": "S"}}}
        add("equip_rows", game, {"wl_tier_format": 2, f"wl_equip_rows_{game}": eq})
        add("stack", game, {"wl_tier_format": 2, "wl_tier_stack": {"S": 5, "A": "3", "B": 1, "C": "x", "Q": 4},
                            f"wl_item_stack_{game}": {"Chaos Orb": 10, "Divine Orb": "2", "Mirror of Kalandra": 0, "Foo": "bad"}})
        add("styles", game, {"wl_tier_format": 2, "wl_tier_style": {
            "S": {"text": [255, 0, 0], "size": 99, "sound": {"kind": "game", "id": 3, "volume": 120}},
            "A": {"border": [1, 2, 3, 4], "icon": {"size": 2, "color": "Cyan", "shape": "Moon"}, "off": ["sound", "text", "bogus"]},
            "B": {"effect": {"color": "Green", "temp": True}, "sound": {"kind": "file", "file": "b.mp3", "volume": 77}},
            "C": {"bg": [5, 5, 5], "text": "bad"}, "Zed": {"text": [1, 2, 3]}, "G": {"text": [9, 9, 9]},
            "Tablet": {"size": 20}, "Map": {"icon": {"size": 0, "color": "Red", "shape": "Cross"}}, "Gem": {"text": [0, 255, 0]}}},
            sound_names={"B": "b.mp3"})
        add("old_sounds", game, {"sound_s": "x/S.mp3", "sound_a": "y\\A.mp3", "sound_c": "C.wav", "wl_tier_style": {"A": {"sound": {"kind": "game", "id": 2}}}})
        add("custom_entries", game, {f"whitelist_custom_{game}": ["abc", {"name": "d", "rarities": ["Rare"], "tier": "S"},
                                                                   {"name": "e", "rarities": [], "tier": "D"}, {"nope": 1}, 7]})
        add("gem_uncut", game, {f"whitelist_gem_uncut_{game}": {"Uncut Skill Gem": 5, "Uncut Spirit Gem": "12", "Uncut Support Gem": "x", "Bogus": 3.5, "Other": True},
                                 f"whitelist_gem_names_{game}": ["Arc", "", "Fireball"], "whitelist_gem_tier": "S"})
        add("known_lists_none", game, {}, known_lists=None)
        add("known_lists_old", game, {f"wl_item_tier_{game}": {"Chaos Orb": "D"}}, known_lists=["Currency"])
        add("known_lists_cfg", game, {f"wl_lists_{game}": ["Currency", "Fragment"], f"wl_cat_tier_{game}": {"Runegraft": "D", "Vial": "D", "Relic": "D"}})
        add("hidden_new_lists", game, {f"wl_cat_tier_{game}": {"Runegraft": "D", "Vial": "D", "Corpse": "D", "Wombgift": "D", "Relic": "D", "gear:gems": "D"}})
        add("queries", game, {}, queries=[["Chaos", "Currency"], ["", "Unique"], ["a", w.OTHER_CATEGORY], ["zzz", "Currency"], [" CHAOS ", "Currency"]])
        # legacy conversion needs no data
        out.append(case("wlhand", f"{game}-convert_legacy", "call", {"name": "wl_model.convert_legacy", "args": [
            {f"whitelist_cats_{game}": ["Currency", "Fragment"], f"whitelist_cat_exclude_{game}": {"Currency": ["Chaos Orb", 5]}}, game]}))
    return out


# ------------------------------------------------------------------------------------------------ whitelist model (random)

def rand_style(rng: random.Random) -> dict:
    s: dict = {}
    for k in ("text", "border", "bg"):
        if rng.random() < 0.5:
            s[k] = [rng.randrange(-20, 300) for _ in range(rng.choice((3, 4)))]
    if rng.random() < 0.5:
        s["size"] = rng.choice((None, "", rng.randrange(5, 60), str(rng.randrange(18, 46)), "x"))
    if rng.random() < 0.4:
        s["icon"] = {"size": rng.randrange(-1, 5), "color": rng.choice(COLORS + ["Bogus"]), "shape": rng.choice(SHAPES)}
    if rng.random() < 0.3:
        s["effect"] = {"color": rng.choice(COLORS), "temp": rng.random() < 0.5}
    r = rng.random()
    if r < 0.3:
        s["sound"] = {"kind": "game", "id": rng.randrange(0, 20), "volume": rng.choice((0, 100, 300, 500, "x"))}
    elif r < 0.55:
        s["sound"] = {"kind": "file", "file": rng.choice(("a.mp3", "dir/b.wav", "weird#name.ogg", "")), "volume": rng.choice((100, 300))}
    if rng.random() < 0.2:
        s["off"] = rng.sample(["text", "border", "bg", "size", "icon", "effect", "sound", "bogus"], rng.randrange(1, 4))
    return s


def random_model_case(game: str, i: int) -> list:
    rng = random.Random(f"{game}-{i}")
    base_cfg: dict = {}
    if rng.random() < 0.3:
        base_cfg = {"wl_tier_format": 2}
    probe = WlModel.from_config(copy.deepcopy(base_cfg), game)
    probe.set_data(*data(game))
    cats = [c for c, _l in probe.categories()]
    list_cats = [c for c in cats if c not in (w.FLASK_CATEGORY, w.EQUIP_CATEGORY)]
    rows_of = {c: [r.key for r in probe.rows(c)] for c in list_cats}
    ops: list = []
    n = rng.choice((0, 1, 3, 6, 10, 18, 30))
    for _ in range(n):
        k = rng.random()
        cat = rng.choice(list_cats)
        keys = rows_of[cat]
        if k < 0.14:
            ops.append(["set_category", cat, rng.choice(TIERS5 + ("X",))])
        elif k < 0.3 and keys:
            ops.append(["set_row", cat, rng.choice(keys), rng.choice(TIERS5)])
        elif k < 0.36 and keys:
            ops.append(["reset_row", cat, rng.choice(keys)])
        elif k < 0.40:
            ops.append(["reset_category", rng.choice(cats)])
        elif k < 0.46 and keys:
            ops.append(["set_stack", rng.sample(keys, min(len(keys), rng.randrange(1, 4))), rng.choice((0, 1, 2, 5, 20))])
        elif k < 0.50:
            ops.append(["set_tier_stack", rng.choice(("S", "A", "B", "C", "D")), rng.choice((0, 1, 3, 10))])
        elif k < 0.54 and keys:
            ops.append(["toggle_row", cat, rng.choice(keys), rng.choice(("S", "A", "B", "C"))])
        elif k < 0.60:
            rid = rng.choice([r for r, _l, _c in w.rarity_rows(game)] + ["Bogus"])
            if rng.random() < 0.4:
                ops.append(["set_flask_custom", rid, rng.random() < 0.7])
            else:
                ops.append(["set_flask_rarity", rid, rng.choice(("Normal", "Magic", "Rare")), rng.choice(TIERS5 + (None,))])
        elif k < 0.68:
            classes = w.equip_classes(game) + ["Bogus"]
            cid = rng.choice(classes)
            r = rng.random()
            if r < 0.3:
                ops.append(["set_equip_custom", cid, rng.random() < 0.7])
            elif r < 0.8:
                ops.append(["set_equip_rarity", cid, rng.choice(("Normal", "Magic", "Rare", "Unique")), rng.choice(TIERS5 + (None,))])
            else:
                gid = rng.choice([g for g, _n, _c in w.equip_groups(game)] + ["bogus"])
                ops.append(["set_equip_group", gid, rng.choice(("Normal", "Magic", "Rare")), rng.choice(TIERS5 + (None,))])
        elif k < 0.80:
            lab = rng.choice(LABELS)
            if rng.random() < 0.7:
                ops.append(["set_style_from_editor", lab, rand_style(rng)])
            else:
                ops.append(["set_style", lab, rng.choice((None, {}, rand_style(rng)))])
        elif k < 0.84:
            ops.append(["$set", "gold", rng.random() < 0.5])
            ops.append(["$set", "gold_min", rng.choice((0, 1, 50, 1000))])
        elif k < 0.88:
            ops.append(["$set", "map_on", rng.random() < 0.6])
            ops.append(["$set", "map_tier", rng.choice((1, 5, 16, 20, 0))])
            ops.append(["$set", "map_rarity", rng.choice(("Normal", "Magic", "Rare", "Unique", "Bogus"))])
        elif k < 0.92:
            if w.filter_gen.WHITELIST_GEM_UNCUT.get(game):
                ops.append(["$set", "gem_uncut", {b: rng.choice((0, 1, 5, 12, 20)) for b in rng.sample(w.filter_gen.WHITELIST_GEM_UNCUT[game], rng.randrange(0, 4))}])
            else:
                ops.append(["$set", "gem_names", rng.sample(["Arc", "Fireball", "Frostbolt", "Spark", "Blade Vortex", "Zzz Not A Gem"], rng.randrange(0, 5))])
            ops.append(["$set", "gem_tier", rng.choice(TIERS5)])
        elif k < 0.97:
            customs = [{"name": rng.choice(("Spirit", "Ring", "abc", "Sacred Orb", "Divine")), "rarities": rng.sample(["Normal", "Magic", "Rare", "Unique"], rng.randrange(1, 5)),
                        "tier": rng.choice(TIERS5)} for _ in range(rng.randrange(0, 4))]
            ops.append(["$set", "custom", customs])
        else:
            ops.append(["set_category", w.TABLET_CATEGORY if game == "poe2" else "Unique", rng.choice(TIERS5)])
    sound_names = {lab: f"snd_{lab}.mp3" for lab in LABELS if rng.random() < 0.7}
    group = f"wlrand-{game}"
    out = [case(group, f"{i:03d}", "wl_model", {"game": game, "cfg": base_cfg, "ops": ops, "sound_names": sound_names,
                                                "quest_text": rng.choice(("", "# quest items\nShow\n    Class == \"Quest Items\"\n    SetFontSize 40\n"))},
                keep_text=(i == 0))]
    # the config this scenario ends with, built through the whole generator (embedded settings included)
    m = WlModel.from_config(copy.deepcopy(base_cfg), game)
    m.set_data(*data(game))
    for op in ops:
        apply_op(m, op)
    cfg = jsonable(m.cfg())
    cfg["whitelist_enabled"] = True
    cfg["wl_v2"] = True
    if rng.random() < 0.5:
        cfg["style_q"] = rand_style(rng)
    for k in ("sound_1", "sound_2"):
        if rng.random() < 0.2:
            cfg[k] = "x/y.mp3"
    out.append(case(group, f"{i:03d}-build", "build_filter_text",
                    {"game": game, "cfg": cfg, "hub": f"fx:hub_{game}", "base": f"fx:ns_{game}_s2", "names": f"fx:names_{game}", "version": "0.13.5"},
                    keep_text=(i == 1)))
    if i % 5 == 0:     # the file reads back: embedded settings -> a model
        out.append(case(group, f"{i:03d}-open", "open_text",
                        {"game": game, "text_from_build": {"game": game, "cfg": cfg, "hub": f"fx:hub_{game}", "base": f"fx:ns_{game}_s2",
                                                           "names": f"fx:names_{game}", "version": "0.13.5"},
                         "filename": "my filter.filter", "sound_files": []}))
    return out


# ------------------------------------------------------------------------------------------------ open / import of old files

def open_cases() -> list:
    out = []
    files = {"v1_poe1_checker_whitelist": "poe1", "v2_poe1_wl_sample": "poe1", "v2_poe2_bus": "poe2",
             "v2_poe2_checker_whitelist": "poe2", "v2_poe2_wl_sample": "poe2"}
    for name, g in files.items():
        for game in GAMES:
            for variant, extra in (("data", {}), ("nodata", {"with_data": False}),
                                   ("sounds", {"sound_files": ["boom.mp3", "ding.mp3", "a.mp3", "b.mp3", "q.mp3"]}),
                                   ("badname", {"filename": "bad:name.filter"}), ("current", {"current_cfg": {"wl_tier_format": 2, "wl_tier_style": {"S": {"text": [1, 2, 3]}}}})):
                out.append(case("open", f"{name}-as-{game}-{variant}", "open_text",
                                {"game": game, "text": f"fx:old_{name}", "filename": f"{name}.filter", **extra}, keep_text=(game == g and variant == "data")))
    # files that are not whitelist files / tier files
    for game in GAMES:
        out.append(case("open", f"tier-file-{game}", "open_text",
                        {"game": game, "text": f"fx:ns_{game}_s2", "filename": "n.filter"}))
        out.append(case("open", f"tier-ours-{game}", "open_text", {"game": game, "filename": "t.filter", "text_from_build": {
            "game": game, "cfg": {"sound_1": "a.mp3"}, "base": f"fx:ns_{game}_s2", "base_tag": "1"}}))
        for other in GAMES:
            out.append(case("open", f"roundtrip-{game}-in-{other}", "open_text", {"game": other, "filename": "r.filter", "text_from_build": {
                "game": game, "cfg": {"whitelist_enabled": True, "wl_v2": True, "wl_tier_format": 2}, "hub": f"fx:hub_{game}", "base": f"fx:ns_{game}_s2",
                "names": f"fx:names_{game}", "version": "0.13.5"}}))
    out.append(case("open", "empty", "open_text", {"game": "poe2", "text": "fx:old_v2_poe2_bus", "filename": ".filter"}))
    return out


def openmut_cases() -> list:
    """Old whitelist files with blocks dropped / reordered / retiered / cut: the importer must agree with the original on damaged input too."""
    out = []
    files = {"v1_poe1_checker_whitelist": "poe1", "v2_poe1_wl_sample": "poe1", "v2_poe2_bus": "poe2", "v2_poe2_checker_whitelist": "poe2", "v2_poe2_wl_sample": "poe2"}
    rng = random.Random("openmut")
    for name, game in files.items():
        for i in range(10):
            ops: list = []
            r = rng.random()
            if r < 0.6:
                ops.append(["drop", [rng.randrange(0, 400) for _ in range(rng.randrange(1, 8))]])
            if rng.random() < 0.35:
                ops.append(["perm", [rng.randrange(0, 400) for _ in range(rng.randrange(2, 30))]])
            if rng.random() < 0.4:
                a, b = rng.sample(["S", "A", "B", "C", "D"], 2)
                ops.append(["replace", f"# tier {a}", f"# tier {b}", rng.choice((1, 2, 100))])
            if rng.random() < 0.2:
                ops.append(["replace", "StackSize >= ", "StackSize >= 1", rng.choice((1, 3))])
            if rng.random() < 0.2:
                ops.append(["crlf"])
            if rng.random() < 0.15:
                ops.append(["truncate", rng.randrange(700, 9000)])
            if rng.random() < 0.15:
                ops.append(["append", "\n# tier S\nShow\n    BaseType == \"Chaos Orb\" \"Divine Orb\"\n    SetFontSize 20\n\nHide\n"])
            if not ops:
                ops.append(["replace", "Show", "Hide", 1])
            for g in (game, "poe1" if game == "poe2" else "poe2") if i % 5 == 0 else (game,):
                out.append(case("openmut", f"{name}-{i:02d}-as-{g}", "open_text",
                                {"game": g, "text": f"fx:old_{name}", "mutate": ops, "filename": f"{name}.filter",
                                 "sound_files": ["sound-S.mp3", "sound-A.mp3", "boom.mp3"] if i % 3 == 0 else []}))
    return out


# ------------------------------------------------------------------------------------------------ pure function calls

def call_cases() -> list:
    out = []
    n = [0]

    def c(name, *args, group="calls", **kwargs):
        n[0] += 1
        out.append(case(group, f"{n[0]:03d}-{name}", "call", {"name": name, "args": list(args), **({"kwargs": kwargs} if kwargs else {})}))

    # ---- styles
    for v in [None, {}, [], "x", 5, {"text": [1, 2, 3]}, {"text": [1, 2]}, {"text": [300, -5, 7, 9]}, {"text": ["a", 1, 2]}, {"text": [1.9, 2.1, 3.5]},
              {"text": [True, False, 7]}, {"size": 5}, {"size": 99}, {"size": "30"}, {"size": ""}, {"size": None}, {"size": "x"}, {"size": 18.7}, {"size": 17},
              {"icon": {"size": 1, "color": "Red", "shape": "Star"}}, {"icon": {"color": "Red", "shape": "Star"}}, {"icon": {"size": None, "color": "Red", "shape": "Star"}},
              {"icon": {"size": 9, "color": "Red", "shape": "Star"}}, {"icon": {"size": -2, "color": "Red", "shape": "Star"}}, {"icon": {"color": "Nope", "shape": "Star"}},
              {"icon": "x"}, {"effect": {"color": "Blue"}}, {"effect": {"color": "Blue", "temp": 1}}, {"effect": {"color": "Pink", "temp": ""}}, {"effect": {"color": "x"}},
              {"sound": {"kind": "game", "id": 5}}, {"sound": {"kind": "game", "id": 99}}, {"sound": {"kind": "game", "id": "7", "volume": "50"}},
              {"sound": {"kind": "game", "id": None}}, {"sound": {"kind": "game", "id": 3, "volume": None}}, {"sound": {"kind": "file", "file": "a.mp3", "volume": 301}},
              {"sound": {"kind": "file", "file": 5}}, {"sound": {"kind": "other"}}, {"sound": "x"}, {"off": ["sound", "text", "sound"]}, {"off": []}, {"off": ["x"]},
              {"off": "text"}, {"off": ("text",)}, {"unknown": 1, "text": [1, 2, 3, 4]}]:
        c("filter_style.normalize_style", v)
        c("filter_style.is_empty", v)
        c("filter_style.uses_sound_file", v)
        c("filter_style.style_lines", v)
        c("filter_style.style_lines", v, "My Sound.mp3")
        c("filter_style.style_lines", v, "x.mp3", "  ")
    for lines in [[], ["SetFontSize 40"], ["    SetTextColor 1 2 3", "PlayAlertSound 3", "PlayAlertSound 4 100", "PlayEffect Red Temp", "MinimapIcon 1 Red Star"],
                  ["SetFontSize", "SetFontSize x", "SetTextColor 1 2", "PlayEffect", "MinimapIcon 1 Red", "unknown 1", "", "   "],
                  ["SetBorderColor 1 2 3 4", "SetBackgroundColor 5 6 7", "PlayAlertSound x", "PlayEffect Blue", "MinimapIcon 2 Cyan Moon extra"],
                  ["SetTextColor 255 255 255 255 9", "SetTextColor 1.5 2 3"], ["PlayAlertSound 3 4 5", "CustomAlertSoundOptional \"x.mp3\" 300"]]:
        c("filter_style.lines_to_style", lines)
    pairs = [({}, {}), ({"text": [1, 2, 3]}, {"text": [4, 5, 6], "size": 20}), ({"sound": {"kind": "game", "id": 3}}, {"sound": {"kind": "none"}}),
             ({"sound": {"kind": "game", "id": 3}}, {"off": ["sound"]}), ({"text": [1, 2, 3], "icon": {"size": 1, "color": "Red", "shape": "Star"}}, {"off": ["icon", "text"]}),
             ({"sound": {"kind": "file", "file": "a.mp3"}}, {"sound": {"kind": "game", "id": 2}}), (None, None), ({"size": 30}, {"size": None}),
             ({"effect": {"color": "Red", "temp": True}}, {"effect": {"color": "Blue"}, "off": ["effect", "bg"]})]
    for b, o in pairs:
        c("filter_style.merge_styles", b, o)
    c("filter_style.default_quest_style")
    c("filter_style.DEFAULT_STYLES")

    # ---- filter_gen
    bt_lines = [
        "Show", '    BaseType == "A" "B"', "Hide", '  BaseType "C"', 'Show # x', "Show\r", "Hide\t", " Show", "#Show", "ShowX", "", "    PlayAlertSound 6 300",
        'Show', '    BaseType  ==  "D"   ', '    BaseType"E"', '    BaseType== "F"', "\xa0Show", "Show", '    BaseType "G" extra', '    BaseType == ""',
    ]
    c("filter_gen.parse_blocks", "\n".join(bt_lines))
    c("filter_gen.parse_blocks", "")
    c("filter_gen.parse_blocks", "Show\nHide\nShow")
    for body in [[], ["    PlayAlertSound 6 300"], ["    PlayAlertSound   3   "], ["    PlayAlertSound"], ["    PlayAlertSound  "], ["  x", "PlayAlertSound 1"],
                 ["    PlayAlertSound 2\r"], ["    PlayAlertSound 2 100\r", "    PlayAlertSound 3"], ["    PlayAlertSound\t4 5"], ["    PlayAlertSound 12 300"]]:
        c("filter_gen.sound_id_of", body)
    for g in GAMES:
        for base in ("s2", "base"):
            c("filter_gen.sound_block_counts", f"fx:ns_{g}_{base}")
            c("filter_gen.apply_numbered_sounds", f"fx:ns_{g}_{base}", {"1": "a.mp3", "4": "d e.wav"})
            c("filter_gen.apply_numbered_sounds", f"fx:ns_{g}_{base}", {"1": "a", "2": "b", "3": "c", "4": "d", "5": "e", "6": "f", "7": "g", "Q": "q"})
            c("filter_gen.apply_numbered_sounds", f"fx:ns_{g}_{base}", {"1": None, "2": ""})
            c("filter_gen.apply_numbered_sounds", f"fx:ns_{g}_{base}", None)
    c("filter_gen.apply_numbered_sounds_text", "Show\n    PlayAlertSound 6 300\n    CustomAlertSound \"old.mp3\"\n\n# c\nHide\n    PlayAlertSound 1\n", {"1": "x.mp3", "2": "y.mp3"})
    c("filter_gen.apply_numbered_sounds_text", "Show\n\tPlayAlertSound 6 300\n\tSetFontSize 30\n\n\nShow\n    PlayAlertSound 1\n#end", {"1": "x.mp3", "2": "y.mp3"})
    c("filter_gen.apply_numbered_sounds_text", "Show\r\n    PlayAlertSound 6 300\r\n\r\nShow\r\n    PlayAlertSound 1 100\r\n", {"1": "x.mp3", "2": "y.mp3"})
    c("filter_gen.apply_numbered_sounds_text", "Show\n    PlayAlertSound 6 300", {"1": "x.mp3"})
    c("filter_gen.apply_numbered_sounds_text", "Show\nPlayAlertSound 6 300\nHide", {"1": "x.mp3"})
    for g in GAMES:
        cats = filter_core.filter_gen.WHITELIST_CATEGORIES[g]
        c("filter_gen.names_in_categories", f"fx:hub_{g}", cats[:2])
        c("filter_gen.names_in_categories", f"fx:hub_{g}", ["currency", "RUNE", 5])
        c("filter_gen.names_in_categories", f"fx:hub_{g}", [])
        c("filter_gen.names_in_categories", f"fx:hub_{g}", None)
        c("filter_gen.expand_categories", f"fx:hub_{g}", cats[:3], {cats[0]: ["Chaos Orb", "Orb of Alchemy"], "Zzz": ["a"]})
        c("filter_gen.expand_categories", f"fx:hub_{g}", cats)
    for x in [None, [], ["a", " b ", ""], [{"name": "a"}], [{"name": "a", "rarities": ["Rare", "Normal"]}], [{"name": None}], [{"name": "z", "rarities": ["x"]}],
              [{"name": 5}], [{"rarities": ["Rare"]}], [5, None, "q", {"name": "w", "rarities": None}], [{"name": " x ", "rarities": ["Unique", "Magic", "Magic"]}]]:
        c("filter_gen.normalize_custom", x)
    sect = [
        ([], None, None), (["B", "A", "A", ""], None, None), ([], ["U2", "U1"], None), ([], None, ["x", {"name": "y", "rarities": ["Rare"]}, {"name": "z", "rarities": ["Magic", "Rare"]}]),
        ([], None, None, {"gem_uncut": [["Uncut Skill Gem", 5], ["Uncut Spirit Gem", "12"], ["", 3]]}), ([], None, None, {"gold": True}),
        ([], None, None, {"gold": True, "gold_min": 50}), ([], None, None, {"gold": True, "gold_min": "bad"}), ([], None, None, {"unique_all": True}),
        (["Q"], ["U"], ["c"], {"gem_uncut": [["G", 1]], "gold": True, "gold_min": 3, "unique_all": True}),
    ]
    for t in sect:
        exact, uniq, cont = t[0], t[1], t[2]
        kw = t[3] if len(t) > 3 else {}
        c("filter_gen.build_whitelist_section", exact, uniq, cont, **kw)

    # ---- filter_core
    for s in ["abc", "a b", "NeverSink's filter - 2-SEMI-STRICT.filter", "ü ö 日本 😀", "a/b", "~._-", "%", "a+b=c&d", "x'y(z)!*"]:
        c("filter_core.quote", s)
    for g in GAMES:
        for s in range(0, 7):
            c("filter_core.neversink_filename", g, s)
            c("filter_core.neversink_file_url", g, "1.2.3", s)
        c("filter_core.neversink_latest_api_url", g)
    c("filter_core.neversink_filename", "poe1", 9)
    c("filter_core.neversink_filename", "poe1", -1)
    for gen, base in [("", None), ("  \n", None), ("", ""), ("x", None), ("", "b"), ("g\n", "base text\n"), ("  ", "b")]:
        c("filter_core.compose_filter_body", gen, base)
    for nm in ["", " ", "ok", "poe-checker", "a<b", 'q"q', "a:b", "a/b", "a\\b", "a|b", "a?b", "a*b", "x\ny", "x\ty", "name.", "name ", "name .", "CON", "con", "Com1.txt",
               "lpt9", "AUX.x", "NUL", " con ", "ที่", "a" * 100, "a" * 101, "😀" * 100, "😀" * 101, "a\x7fb", None, 5, "a.b.c", ".hidden", "..", "x<y>z"]:
        c("filter_core.validate_filter_name", nm)
    for nm in ["a.mp3", "a#b.mp3", "a;b.mp3", "a#b;c#d.mp3", "", "#", ";;"]:
        c("filter_core.safe_sound_name", nm)
    plans = [
        ([], {}), ([["S", "a.mp3", "h1"]], {}), ([["S", "a.mp3", "h1"]], {"a.mp3": "h1"}), ([["S", "a.mp3", "h1"]], {"a.mp3": "h2"}),
        ([["S", "a.mp3", "h1"], ["A", "a.mp3", "h1"]], {}), ([["S", "a.mp3", "h1"], ["A", "a.mp3", "h2"]], {}),
        ([["S", "a.mp3", "h1"], ["A", "a.mp3", "h2"], ["B", "a.mp3", "h3"]], {"a-2.mp3": "x"}),
        ([["S", "a#1.mp3", "h1"], ["A", "a_1.mp3", "h2"]], {}), ([["S", "a#1.mp3", "h1"], ["A", "a;1.mp3", "h1"]], {"a_1.mp3": "h9"}),
        ([["S", "noext", "h1"], ["A", "noext", "h2"]], {"noext": None}), ([["S", "x.mp3", "h1"]], {"x.mp3": None}),
        ([["S", "a.b.mp3", "h1"], ["A", "a.b.mp3", "h2"]], {"a.b.mp3": "h3", "a.b-2.mp3": "h4"}),
    ]
    for req, ex in plans:
        c("filter_core.plan_sound_files", req, ex)
        for pol in (None, "keep", "overwrite"):
            c("filter_core.resolve_sound_plan", req, ex, pol)
    for g in GAMES + ("poe9",):
        for style, sf, dl in [({}, None, None), ({}, None, ["    SetFontSize 40"]), ({"text": [1, 2, 3]}, None, None),
                              ({"sound": {"kind": "file", "file": "q.mp3"}}, "q2.mp3", None), ({"sound": {"kind": "file", "file": "q.mp3"}}, None, None),
                              (None, None, ["    SetTextColor 1 2 3"]), ({"size": 30}, None, ["    x"])]:
            c("filter_core.build_quest_blocks", g, style, sf, dl)
    for cfg in [{}, {"sound_1": "a", "sound_6": "f"}, {"sound_2": "", "style_q": {"sound": {"kind": "file", "file": "q.mp3"}}}, {"style_q": {}}, {"style_q": {"text": [1, 2, 3]}},
                {"sound_9": "x", "sound_1": 0}]:
        c("filter_core.tier_sound_requests", cfg)
    mig = [{}, {"sound_format": 2}, {"sound_s": "D:/x/S.mp3"}, {"sound_s": "S.mp3", "sound_a": "A.mp3", "sound_b": "B.mp3", "sound_c": "C.mp3"},
           {"sound_s": "S.mp3", "sound_1": "keep.mp3"}, {"sound_c": "C\\win\\path.mp3"}, {"sound_a": "A.mp3", "wl_tier_style": {"A": {"sound": {"kind": "game", "id": 3}}}},
           {"sound_a": "A.mp3", "wl_tier_style": {"A": {"sound": {"kind": "none"}, "text": [1, 2, 3]}, "B": "str"}}, {"sound_b": "B.mp3", "wl_tier_style": {"B": {"sound": "x"}}},
           {"sound_s": ""}, {"sound_format": 1, "sound_s": "x.mp3"}, {"wl_tier_style": {"S": {"text": [1, 2, 3]}}}]
    for cfg in mig:
        c("filter_core.migrate_sounds", cfg)
    for cfg in [{}, {"whitelist_enabled": True}, {"whitelist_enabled": True, "wl_v2": True}, {"whitelist_enabled": True, "whitelist_cats_poe2": ["Currency"]},
                {"whitelist_enabled": False, "wl_v2": True}]:
        for g in GAMES:
            c("filter_core.plan_fetch", cfg, g)
    sec = "# a\nShow\n    PlayAlertSound 6 300\n  PlayAlertSound 1 100\n   PlayAlertSound 3\nShow\n    PlayAlertSound 12 5\nPlayAlertSound 2 1\n\n"
    c("filter_core.add_shared_tier_sounds", sec, {"1": "a.mp3", "2": "b.mp3", "4": "d.mp3"})
    c("filter_core.add_shared_tier_sounds", sec.rstrip("\n"), {"1": "a.mp3"})
    c("filter_core.add_shared_tier_sounds", sec, {})
    c("filter_core.add_shared_tier_sounds", "x\r\ny\r\n    PlayAlertSound 6 1\r\n", {"1": "a.mp3"})
    c("filter_core.add_shared_tier_sounds", "", {"1": "a"})

    # ---- filter_whitelist
    for tag in [None, "", "t1", "t2", "t3", "t4", "t5", "t6", "t7", "t8", "t9", "t10", "t1b", "t1->x", "t", "T1", "s", "a", "b", "c", "d", "e", "f", "supply", "any", "s1", "t12ab", "t1_"]:
        c("w.tier_of_step", tag)
    for nm in ["", "[DNT] x", "x [dnt]", "INCOMPLETE", "xINCOMPLETEx", "a INCOMPLETE b", "(not visible to players)", "x (Not Visible To Players)", "60634", "6a", " lead", "trail ", "trail\n",
               "NonEleBowRangerPhysNoble", "NonEle", "Abc", "AbcDef", "AbcDefGhi", "AbcDefGhij1", "Chaos Orb", "Map (Tier 14)", "Thaumaturgic Flux (Level 5)", "Ünï", "١٢٣", None, "tab\there", "a\u00a0b", "\u00a0x"]:
        c("w.bad_name", nm)
    for g in GAMES:
        for base in ("s2", "base"):
            ref = f"fx:ns_{g}_{base}"
            c("w.default_tiers", ref)
            c("w.ladder_names", ref)
            c("w.known_names", ref)
            c("w.start_tiers", ref)
            c("w.stack_info", ref)
            c("w.unique_base_defaults", ref)
            c("w.poe1_special_map_bases", ref)
            c("w.gear_sequence", g, ref)
            c("w.neversink_quest_lines", ref)
            c("w.default_tier_lines", ref)
            c("w.universe", g, f"fx:hub_{g}", ref)
            c("filter_gen.sound_block_counts", ref)
        c("w.universe", g, None, f"fx:ns_{g}_s2")
        c("w.unique_entries", f"fx:hub_{g}")
        c("w.sound_requests", {"wl_tier_style": {"S": {"sound": {"kind": "file", "file": "s.mp3"}}, "G": {"sound": {"kind": "file", "file": "g.mp3"}},
                                                  "Tablet": {"sound": {"kind": "file", "file": "t.mp3"}}, "Map": {"sound": {"kind": "file", "file": "m.mp3"}},
                                                  "Gem": {"sound": {"kind": "file", "file": "gem.mp3"}}}}, g)
        c("w.sound_requests", {"wl_tier_style": {"S": {"sound": {"kind": "file", "file": "s.mp3"}}, "G": {"sound": {"kind": "file", "file": "g.mp3"}}},
                               "whitelist_gold": True, "wl_map_on": True, "whitelist_gem_tier": "D"}, g)
        c("w.sound_requests", {"wl_tier_style": {"S": {"sound": {"kind": "file", "file": "s.mp3"}}, "Gem": {"sound": {"kind": "file", "file": "g.mp3"}}}})
        c("w.sound_requests", {})
        c("w.equip_groups", g)
        for ty in [None, "", "leveling", "currency", "exoticmap", "6l", "socketslinks", "heist->cloak", "heist->contract", "heist->blueprint", "jewels", "endgameflasks", "influenced->x",
                   "rr", "rareeg", "decorators->rareeg", "rareid", "rareblendid", "magicid", "exotic->x", "rare->exotic", "corruptedid", "crafting->x", "gear->x", "gems->x",
                   "ut->x", "endgame->jewellery", "rr->jewellery", "rare->salvagable", "endgame->flasks", "endgame->charms", "endgame->normalcraft", "chancing", "endgame->salvagable",
                   "special->alwaysshow", "exotic->wombgifts", "currency->leveling"]:
            c("w.gear_group_of", g, ty)
            c("w.type_category", g, ty)
    c("w.universe", "poe2", "fx:hub_poe2", "")
    for ty, conds in [("t", []), ("t", ["    Rarity Rare", "    Class == \"Rings\"", "    ItemLevel >= 82"]), ("t", ["    Rarity >= Rare", "    Class \"Bows\" \"Wands\""]),
                      ("t", ["    Rarity Normal Magic Rare", "    Class == \"Body Armours\" \"Boots\"", "    ItemLevel >= 70", "    ItemLevel <= 80"]),
                      ("t", ["    Rarity Normal Magic", "    Class == \"Life Flasks\" \"Mana Flasks\" \"Tinctures\"", "    ItemLevel < 30"]),
                      ("t", ["    BaseType == \"A\" \"B\" \"C\"", "    AreaLevel <= 30", "    Quality >= 10", "    HasInfluence Shaper", "    Corrupted True", "    Identified True"]),
                      ("t", ["    Class \"Bows\" \"Spears\" \"Rings\"", "    BaseType \"X\"", "    HasExplicitMod \"x\"", "    TransfiguredGem True", "    AlwaysShow True", "    FracturedItem False"]),
                      ("t", ["    Class \"Skill Gems\" \"Support Gems\" \"Skill Gems\"", "    GemLevel >= 20"]), ("t", ["    ItemLevel >= 5"]), ("t", ["    ItemLevel <= 5"]),
                      ("t", ["    ItemLevel > 5"]), ("t", ["    ItemLevel"]), ("t", ["    Rarity"]), ("t", ["    Rarity Unique"]), ("t", ["    Rarity < Unique Rare"]),
                      ("t", ["    Class"]), ("t", ["    Class \"A\" \"B\" \"C\" \"D\""]), ("t", ["Rarity Magic Rare"]), ("t", ["  \tClass == \"Charms\" "])]:
        c("w.block_label", ty, conds)

    # ---- wl_embed
    cfgs = [{}, {"wl_v2": True}, {"wl_v2": True, "wl_tier_format": 2, "wl_item_tier_poe2": {"Chaos Orb": "S", "é": "A"}, "unknown": 1},
            {"wl_tier_style": {"S": {"text": [1, 2, 3, 255], "sound": {"kind": "file", "file": "ñ.mp3", "volume": 300}}}, "whitelist_gold": True, "whitelist_gold_min": 5},
            {"whitelist_custom_poe2": [{"name": "日本語 😀", "rarities": ["Rare"], "tier": "A"}, "q\"uote\\"], "wl_map_tier_min": 5, "wl_item_stack_poe2": {"a": 1, "b": 2}},
            {"wl_cat_tier_poe2": {"z": "S", "a": "A", "10": "B", "2": "C", "": "D"}}]
    for cfg in cfgs:
        for g in GAMES:
            for ver in ("", "0.13.5", "v-é"):
                c("wl_embed.embed_lines", cfg, g, ver)
        c("wl_embed.whitelist_part", cfg, "poe2")
    for text in ["", "x", "x\n", "x\n\n\n", "\n\nx", "x\r\n"]:
        c("wl_embed.embed", text, {"wl_v2": True}, "poe1", "1")
    for text in ["", "# poe-checker-config:", "# poe-checker-config: abc", "# poe-checker-config:   \n", "garbage", "# poe-checker-config: eJyrVkrLz1eyUkpKLFKqBQAx9AWO"]:
        c("wl_embed.extract", text)
        c("wl_embed.classify", text)
    c("wl_embed.classify", "# === PoE Checker - Whitelist (show only) ===\nShow")
    c("wl_embed.classify", "x" * 700 + "# === PoE Checker - Whitelist")
    c("wl_embed.classify", "# Generated by PoE Price & Trade Checker (Filter Generator) - NeverSink")
    for name in ["old_v1_poe1_checker_whitelist", "old_v2_poe1_wl_sample", "old_v2_poe2_bus", "old_v2_poe2_checker_whitelist", "old_v2_poe2_wl_sample", "ns_poe1_s2", "ns_poe2_s2"]:
        c("wl_embed.classify_fixture", f"fx:{name}")
        c("wl_import.summarize_fixture", f"fx:{name}")
    for text in ["", "# === PoE Checker - Whitelist (show only) ===", "# === PoE Checker - Whitelist (own tiers", "x"]:
        c("wl_import.version_of", text)
    for text in ["", 'Class == "Maps"', "MapTier 5", "# maps: x", 'x\n# maps: y', "Waystone", '"Tablet"', "# tablets", "  # tablets", "a\n# tablets\nMapTier", 'MapTier\nWaystone']:
        c("wl_import.guess_game", text)

    # ---- hub / names / python behaviour
    for e in [{}, {"chaos_value": 2.5}, {"chaos_value": None, "value": 5, "value_currency": "chaos"}, {"value": 5.0, "value_currency": "chaos"}, {"value": 5.0, "value_currency": "exalted"},
              {"value": None, "value_currency": "chaos"}, {"chaos_value": 0}, {"chaos_value": "3.5"}, {"value": "7", "value_currency": "chaos"}]:
        c("hub_client.hub_chaos_value", e)
    for p in [None, {}, {"result": None}, {"result": [{"entries": [{"name": "a", "type": "b"}, {"text": "c"}, {"name": ""}, {"name": 5}]}, {"entries": None}, {}]}, {"result": [{"entries": [{"name": "dup"}, {"type": "dup"}]}]}]:
        c("trade_names.names_from_payload", p)
    return out


def all_cases() -> dict:
    groups: dict = {"tier": tier_cases(), "legacy": legacy_cases(), "wlhand": hand_model_cases(), "open": open_cases(), "openmut": openmut_cases(), "calls": call_cases()}
    for g in GAMES:
        rl = []
        for i in range(60):
            rl += random_model_case(g, i)
        groups[f"wlrand-{g}"] = rl
    return groups
