"""Cases of the tier-ladder builder (tools/build_mod_meta.py of the original, ported to packages/core/src/mod_meta_build.ts).

Small hand-made repoe-shaped data: every rule of the builder gets a case (first-match spawn weights, the domain allow-list per game,
abyss / cluster jewels not leaking into each other, identical tag sets merged, text normalisation, tier order, the sanity floor).
The filler (60 bases of one class, 60 families) only exists so the sanity floor lets the small cases through.
"""
from __future__ import annotations
import copy


def _filler():
    bases = {f"Metadata/Items/Filler/F{i}": {"name": f"Filler Base {i}", "domain": "item", "item_class": "Filler", "drop_level": i, "tags": ["fill", "default"]}
             for i in range(60)}
    mods = {}
    for i in range(60):
        mods[f"FillMod{i}"] = {"generation_type": "prefix" if i % 2 == 0 else "suffix", "domain": "item", "required_level": 1 + i,
                               "text": f"+({i}-{i + 5}) to Filler Stat {i}", "stats": [{"id": f"filler_stat_{i}", "min": i, "max": i + 5}],
                               "spawn_weights": [{"tag": "fill", "weight": 100}, {"tag": "default", "weight": 0}], "implicit_tags": ["zz", "aa"]}
    return bases, mods


def _base(name, tags, domain="item", cls="Ring", drop=10):
    return {"name": name, "domain": domain, "item_class": cls, "drop_level": drop, "tags": tags}


def _mod(gen, text, stats, level=1, weights=None, domain="item", tags=None):
    m = {"generation_type": gen, "domain": domain, "required_level": level, "text": text,
         "stats": [{"id": sid, "min": lo, "max": hi} for sid, lo, hi in stats], "spawn_weights": weights if weights is not None else [{"tag": "ring", "weight": 100}]}
    if tags is not None:
        m["implicit_tags"] = tags
    return m


def _ordered(d):
    """The cases are stored with sorted keys, but the builder's output depends on the order of the two files: keys that sort the way they were made."""
    return {f"{i:04d}_{k}": v for i, (k, v) in enumerate(d.items())}


def _case(name, game, bases, mods):
    bases, mods = _ordered(bases), _ordered(mods)
    return {"id": f"modmeta/{name}", "fn": "call", "args": {"name": "tools.build_mod_meta", "args": [game, bases, mods]}}


def mod_meta_cases() -> list:
    out = []
    for game in ("poe1", "poe2"):
        b, m = _filler()
        b["R1"] = _base("Ruby Ring", ["ring", "default"])
        b["R2"] = _base("Sapphire Ring", ["ring", "default"], drop=20)
        b["Bow1"] = _base("Warmonger Bow", ["bow", "ranged", "weapon", "default"], cls="Bow", drop=77)
        b["Dup1"] = _base("Twin", ["ring", "default"], cls="Ring")
        b["Dup2"] = _base("Twin", ["amulet", "default"], cls="Amulet", drop=33)  # the same name again: the later one wins
        b["NoName"] = {"domain": "item", "item_class": "X", "tags": ["ring"]}
        b["Flask1"] = _base("Life Flask", ["flask", "default"], domain="flask", cls="LifeFlask")
        b["Jewel1"] = _base("Cobalt Jewel", ["jewel", "default", "dex_jewel"], domain="misc", cls="Jewel")
        b["Abyss1"] = _base("Searching Eye Jewel", ["default", "jewel", "abyss_jewel_ranged"], domain="abyss_jewel", cls="AbyssJewel")
        b["Cluster1"] = _base("Large Cluster Jewel", ["default", "jewel", "affliction_jewel_large"], domain="affliction_jewel", cls="Jewel")
        b["NoTags"] = {"name": "Odd One", "domain": "item", "item_class": "Odd"}
        m["m_life1"] = _mod("prefix", "+(10-19) to maximum Life", [("base_maximum_life", 10, 19)], 1, tags=["resource", "life"])
        m["m_life2"] = _mod("prefix", "+(20-29) to maximum Life", [("base_maximum_life", 20, 29)], 20, tags=["resource", "life"])
        m["m_life3"] = _mod("prefix", "+(30-39) to maximum Life", [("base_maximum_life", 30, 39)], 20)  # (same level as T2: the order of the file is kept)
        m["m_first_match"] = _mod("suffix", "{0} Fire [Resistance|Resistances]", [("fire_res", 5, 10)], 5, weights=[{"tag": "bow", "weight": 0}, {"tag": "default", "weight": 1000}])
        m["m_default_only"] = _mod("suffix", "+#% to [Cold] Resistance", [("cold_res", 5, 10)], 5, weights=[{"tag": "default", "weight": 1000}, {"tag": "ring", "weight": 0}])
        m["m_no_weights"] = _mod("suffix", "Nothing rolls this", [("none_stat", 1, 1)], 5, weights=[])
        m["m_no_match"] = _mod("suffix", "Other tag only", [("other_stat", 1, 1)], 5, weights=[{"tag": "quiver", "weight": 100}])
        m["m_multi"] = _mod("prefix", "Adds (1-4) to (5-9) Fire Damage", [("fire_min", 1, 4), ("fire_max", 5, 9)], 12, tags=["fire", "damage", "attack"])
        m["m_numbers"] = _mod("suffix", "-(5-10)% to +3.5 [Dexterity|Dex] and (-5--2)% [Evasion] 2.5-7.5 rate", [("num_stat", -10, -5)], 3, tags=["Zed", "alpha", "Beta"])
        m["m_ws"] = _mod("suffix", "  Many   Spaces\tand\nlines  ", [("ws_stat", 1, 2)], 4)
        m["m_unicode"] = _mod("suffix", "ÅNGSTRÖM 日本語 +5 😀", [("uni_stat", 1, 2)], 4)
        m["m_no_stats"] = {"generation_type": "prefix", "domain": "item", "required_level": 1, "text": "no stats", "stats": [], "spawn_weights": [{"tag": "ring", "weight": 100}]}
        m["m_corrupted"] = _mod("corrupted", "+1 corrupted", [("cor_stat", 1, 1)], 1)
        m["m_unique"] = _mod("unique", "+1 unique", [("uni_stat2", 1, 1)], 1)
        m["m_flask"] = _mod("prefix", "Flask only", [("flask_stat", 1, 1)], 1, weights=[{"tag": "flask", "weight": 100}], domain="flask")
        m["m_jewel"] = _mod("prefix", "+(1-2) to Jewel Thing", [("jewel_stat", 1, 2)], 2, weights=[{"tag": "jewel", "weight": 100}], domain="misc")
        m["m_abyss"] = _mod("prefix", "+(5-9) Abyss Armour", [("abyss_stat", 5, 9)], 8, weights=[{"tag": "default", "weight": 100}], domain="abyss_jewel")
        m["m_cluster"] = _mod("prefix", "Added Passive Skill is Thing", [("cluster_stat", 1, 1)], 50, weights=[{"tag": "default", "weight": 100}], domain="affliction_jewel")
        m["m_nolevel"] = {"generation_type": "suffix", "domain": "item", "text": "No Level", "stats": [{"id": "nl", "min": 1, "max": 2}], "spawn_weights": [{"tag": "ring", "weight": 100}]}
        m["m_nostatid"] = {"generation_type": "suffix", "domain": "item", "required_level": 2, "text": "No Id", "stats": [{"min": 1, "max": 2}], "spawn_weights": [{"tag": "ring", "weight": 100}]}
        m["m_notext"] = {"generation_type": "suffix", "domain": "item", "required_level": 2, "stats": [{"id": "nt", "min": 1, "max": 2}], "spawn_weights": [{"tag": "ring", "weight": 100}]}
        m["m_dom_default"] = {"generation_type": "suffix", "required_level": 2, "text": "Domain defaults to item", "stats": [{"id": "dd", "min": 3, "max": 4}], "spawn_weights": [{"tag": "ring", "weight": 100}]}
        out.append(_case(f"features-{game}", game, b, m))

        # two bases whose tag sets differ but give the same mod pool: one tag set is kept, both bases point at it
        b2, m2 = _filler()
        b2["A"] = _base("Alpha Ring", ["ring", "default", "marker_a"])
        b2["B"] = _base("Beta Ring", ["ring", "default", "marker_b"])
        b2["C"] = _base("Gamma Amulet", ["amulet", "default"], cls="Amulet")
        m2["x1"] = _mod("prefix", "+(1-5) Alpha", [("alpha_stat", 1, 5)], 1, tags=["a"])
        m2["x2"] = _mod("suffix", "+(1-5) Gamma", [("gamma_stat", 1, 5)], 1, weights=[{"tag": "amulet", "weight": 10}], tags=["g"])
        out.append(_case(f"dedupe-{game}", game, b2, m2))

        # the sanity floor
        fb, fm = _filler()
        few_b = {k: v for k, v in list(fb.items())[:49]}
        out.append(_case(f"floor-few-bases-{game}", game, few_b, fm))
        out.append(_case(f"floor-exactly-50-bases-{game}", game, {k: v for k, v in list(fb.items())[:50]}, fm))
        few_m = {k: v for k, v in list(fm.items())[:49]}
        out.append(_case(f"floor-few-families-{game}", game, fb, few_m))
        only_prefix = {k: v for k, v in fm.items() if v["generation_type"] == "prefix"}
        out.append(_case(f"floor-no-suffix-{game}", game, fb, {**only_prefix, **{f"p{i}": _mod("prefix", f"extra {i}", [(f"e{i}", 1, 2)], 1, weights=[{"tag": "fill", "weight": 5}], tags=["t"]) for i in range(30)}}))
        untagged = copy.deepcopy(fm)
        for v in untagged.values():
            v.pop("implicit_tags", None)
        for i in range(0, 60, 4):
            untagged[f"FillMod{i}"]["implicit_tags"] = ["t"]
        out.append(_case(f"floor-low-tag-coverage-{game}", game, fb, untagged))
        ok_cov = copy.deepcopy(fm)
        for v in ok_cov.values():
            v.pop("implicit_tags", None)
        for i in range(0, 60, 3):
            ok_cov[f"FillMod{i}"]["implicit_tags"] = ["t"]
        out.append(_case(f"floor-tag-coverage-just-enough-{game}", game, fb, ok_cov))
        out.append(_case(f"floor-empty-{game}", game, {}, {}))
    return out
