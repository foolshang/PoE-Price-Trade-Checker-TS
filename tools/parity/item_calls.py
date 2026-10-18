"""Parity calls of the item pipeline (F5 / F4): parser, mod / base / meta databases, mod badge, trade url, skill reference,
league routing and the Python behaviours the TypeScript port had to imitate. Registered into oldlib.CALLS / RUNNERS."""
from __future__ import annotations
import dataclasses
import difflib
import gzip
import json
import math
import sys
import tempfile
import types
import urllib.parse
from pathlib import Path


def register(ns: dict) -> None:
    CALLS, RUNNERS, FIX, jsonable, snap = ns["CALLS"], ns["RUNNERS"], ns["FIX"], ns["jsonable"], ns["_snap"]
    from poe_price_trade import app as app_mod, base_db, hub_client, meta_db, mod_badge, mod_db, skill_ref, trade_url
    from poe_price_trade.item_parser import parse_item
    from poe_price_trade.models import Rarity
    from poe_price_trade.profiles import PROFILES

    def item_text(ref: str) -> str:
        assert ref.startswith("it:"), ref
        with open(FIX / "items" / (ref[3:] + ".txt"), encoding="utf-8", newline="") as fh:
            return fh.read()

    memo: dict = {}

    def stats_db(game):
        k = ("stats", game)
        if k not in memo:
            db = mod_db.ModDatabase(PROFILES[game])
            db._build_index(snap(f"gstats_{game}.json.gz"))
            memo[k] = db
        return memo[k]

    def base(game):
        k = ("base", game)
        if k not in memo:
            db = base_db.BaseDB(PROFILES[game])
            db._build(snap(f"gitems_{game}.json.gz"))
            db._loaded = True
            memo[k] = db
        return memo[k]

    def meta(game):
        k = ("meta", game)
        if k not in memo:
            d = Path(tempfile.mkdtemp(prefix="pfg-meta-"))
            (d / f"mod_meta_{game}.json").write_text(json.dumps(snap(f"mod_meta_{game}.json.gz")), encoding="utf-8")
            memo[k] = meta_db.MetaDB(d, game)
        return memo[k]

    def badge(game):
        k = ("badge", game)
        if k not in memo:
            b = mod_badge.ModBadgeDB()
            b._index(snap(f"hub_meta_{game}.json.gz"))
            memo[k] = b
        return memo[k]

    def fresh_item(ref, game):
        return parse_item(item_text(ref), game)

    # ------------------------------------------------------------------ parser / urls
    def c_parse(ref, game):
        it = parse_item(item_text(ref), game)
        return None if it is None else jsonable(it)

    def _filters(rows):
        """[[id|None, min|None, max|None], ...] -> the filters a picker sends (keys in the order it builds them, numbers are floats)"""
        out = []
        for sid, lo, hi in rows or []:
            f = {} if sid is None else {"id": sid}
            f["disabled"] = False
            v = {}
            if lo is not None:
                v["min"] = float(lo)
            if hi is not None:
                v["max"] = float(hi)
            if v:
                f["value"] = v
            out.append(f)
        return out

    def c_url(ref, game, league, base_on=True, custom=None, min_pct=0.8):
        it = fresh_item(ref, game)
        if it is None:
            return None
        return trade_url.build_trade_url(it, stats_db(game), league, PROFILES[game], min_pct,
                                         None if custom is None else _filters(custom), base(game) if base_on else None)

    CALLS["item_parser.parse_item"] = c_parse
    CALLS["item_parser.parse_text"] = lambda text, game: (lambda it: None if it is None else jsonable(it))(parse_item(text, game))
    CALLS["trade_url.build"] = c_url
    CALLS["mod_db.find"] = lambda game, text, typ=None, threshold=0.75: stats_db(game).find_stat_id(text, typ, threshold)
    CALLS["mod_db.normalize"] = lambda text: mod_db._normalize_mod(text)
    CALLS["base_db.resolve_type"] = lambda game, raw: base(game).resolve_type(raw)
    CALLS["base_db.resolve_name"] = lambda game, raw: base(game).resolve_name(raw)

    # ------------------------------------------------------------------ meta
    CALLS["meta_db.norm"] = lambda t: meta_db._norm(t)
    CALLS["meta_db.resolve_base"] = lambda game, name: meta(game).resolve_base(name)
    CALLS["meta_db.tier_range"] = lambda game, base_type, text, tier: meta(game).tier_range(base_type, text, tier)

    def c_annotate(ref, game):
        it = fresh_item(ref, game)
        if it is None:
            return None
        m = meta(game)
        if it.rarity == Rarity.MAGIC and it.identified:
            it.base_type = m.resolve_base(it.base_type) or ""
        if not it.mods_have_headers:
            m.infer_affixes(it)
        ann = m.annotate(it)
        cap = mod_badge.affix_cap(it.item_class, game)
        return {"ann": jsonable(ann), "summary": meta_db.MetaDB.summary(it, ann, cap, cap), "item": jsonable(it)}

    CALLS["meta_db.annotate"] = c_annotate
    CALLS["meta_db.tags_for_template"] = lambda game, t: sorted(meta(game).tags_for_template(t))

    # ------------------------------------------------------------------ badge
    CALLS["mod_badge.slot_for_item"] = lambda cls, base_type: mod_badge.slot_for_item(cls, base_type)
    CALLS["mod_badge.affix_cap"] = lambda cls, game="poe2": mod_badge.affix_cap(cls, game)
    CALLS["mod_badge.tier_roll_arrow"] = lambda values, rng, pct=0.25: mod_badge.tier_roll_arrow(tuple(values), rng, pct)
    CALLS["mod_badge.build_template_index"] = lambda game: mod_badge._build_template_index(snap(f"hub_meta_{game}.json.gz").get("stat_dictionary", []))

    def c_badge_all(game, slot, archetype):
        """the colours of every row of one slot: red / gold from the rules, green from tags"""
        b, m = badge(game), meta(game)
        out = {}
        for (s, a, sid) in sorted(b._by_key):
            if s == slot and a == archetype:
                out[sid] = [b.badge_color(sid, slot, archetype), b.tag_color(sid, slot, archetype, m)]
        return out

    CALLS["mod_badge.colors"] = c_badge_all
    CALLS["mod_badge.resolve"] = lambda game, text, typ=None: badge(game).resolve_stat_id(text, typ, stats_db(game))
    CALLS["mod_badge.fallback_arrow"] = lambda game, sid, slot, arch, values: badge(game).roll_indicator_fallback(sid, slot, arch, tuple(values))

    # ------------------------------------------------------------------ the F5 flow (the logic of App._on_f5_trade)
    def run_f5(case_id, a):
        game, league = a["game"], a.get("league", "")
        cfg = a.get("cfg") or {}
        profile = PROFILES[game]
        mdb, sdb, bdb, bad = meta(game), stats_db(game), base(game), badge(game)
        it = parse_item(item_text(a["text"]) if a["text"].startswith("it:") else a["text"], game)
        if not it:
            return {"kind": "unparsed"}
        if it.rarity == Rarity.MAGIC and it.identified:
            fixed = mdb.resolve_base(it.base_type)
            it.base_type = fixed if fixed else ""
        if not it.mods_have_headers:
            mdb.infer_affixes(it)
        use_picker = bool(cfg.get("f5_mod_picker", True)) and it.identified and it.rarity in (Rarity.RARE, Rarity.MAGIC) and it.mods
        if not use_picker:
            return {"kind": "url", "url": trade_url.build_trade_url(it, sdb, league, profile, base_db=bdb), "item": jsonable(it)}
        rows = [(m, sdb.find_stat_id(m.text, getattr(m, "mod_type", None))) for m in it.mods]
        annos, summary = {}, ""
        try:
            annos = mdb.annotate(it)
            cap = mod_badge.affix_cap(it.item_class, profile.game_version)
            summary = meta_db.MetaDB.summary(it, annos, prefix_cap=cap, suffix_cap=cap)
        except Exception:
            pass
        fake = types.SimpleNamespace(
            _get_meta_db=lambda: mdb, _config=types.SimpleNamespace(get=lambda k, d=None: cfg.get(k, d)),
            _mod_badge=bad, _mod_db=sdb)
        colors, arrows = app_mod.App._compute_mod_extras(fake, it, rows, annos)
        return {"kind": "picker", "item": jsonable(it), "rows": [[jsonable(m), s] for m, s in rows], "annos": jsonable(annos),
                "summary": summary, "badge_colors": colors, "roll_arrows": arrows, "affixes": [m.affix for m, _ in rows]}

    RUNNERS["f5"] = lambda cid, a: ns["compact"](cid, jsonable(run_f5(cid, a)))

    # ------------------------------------------------------------------ skill reference (hub patched with the fixture)
    import contextlib

    @contextlib.contextmanager
    def hub_patch(fx):
        saved = (hub_client.get_skills_index, hub_client.get_skills_dictionary, hub_client.get_passives, hub_client.get_skill_file)
        hub_client.get_skills_index = lambda g: fx["index"]
        hub_client.get_skills_dictionary = lambda g: fx["dictionary"]
        hub_client.get_passives = lambda g: fx["passives"]
        hub_client.get_skill_file = lambda p: fx["files"].get(p)
        try:
            yield
        finally:
            (hub_client.get_skills_index, hub_client.get_skills_dictionary, hub_client.get_passives, hub_client.get_skill_file) = saved

    def skill_db(game):
        k = ("skill", game)
        if k not in memo:
            fx = snap(f"hub_skills_{game}.json.gz")
            with hub_patch(fx):
                db = skill_ref.SkillRefDB(Path(tempfile.mkdtemp(prefix="pfg-skill-")), game)
                db.load()
            db._fx = fx
            memo[k] = db
        return memo[k]

    def skill_mods(game, t, s):
        db = skill_db(game)
        with hub_patch(db._fx):
            return db.mods_for_skill(t, s)

    def nn(x):
        """whole-number floats as ints: the TypeScript side cannot tell 40.0 from 40, and a big structure is compared by the hash of its text"""
        if isinstance(x, float) and x.is_integer() and abs(x) < 1e15:
            return int(x)
        if isinstance(x, list):
            return [nn(i) for i in x]
        if isinstance(x, dict):
            return {k: nn(v) for k, v in x.items()}
        return x

    CALLS["skill_ref.search"] = lambda game, prefix: [[s.skill_type, s.skill, s.facet_count] for s in skill_db(game).search_skills(prefix)][:40]
    CALLS["skill_ref.count"] = lambda game: [len(skill_db(game)._skills), skill_db(game).available()]
    CALLS["skill_ref.meta"] = lambda game, t, s: jsonable(skill_db(game).skill_meta(t, s))
    CALLS["skill_ref.mods"] = lambda game, t, s: nn(jsonable(skill_mods(game, t, s)))
    CALLS["skill_ref.passives"] = lambda game, t, s: jsonable(skill_db(game).passives_for_skill(t, s))
    CALLS["skill_ref.files"] = lambda game: sorted(skill_db(game)._fx["files"])

    def c_skill_schema(game, which):
        """a payload whose schema_version the program does not know is treated as empty"""
        fx = json.loads(json.dumps(snap(f"hub_skills_{game}.json.gz")))
        fx[which]["schema_version"] = 99
        with hub_patch(fx):
            db = skill_ref.SkillRefDB(Path(tempfile.mkdtemp(prefix="pfg-skill-")), game)
            db.load()
            first = next(iter(fx["files"]), None)
            skill = next((sk for sk in db._skills if sk.path == first), None)
            mods = None if skill is None else jsonable(db.mods_for_skill(skill.skill_type, skill.skill))
        return {"n_skills": len(db._skills), "available": db.available(), "dictionary": len(db._dictionary),
                "passive_keys": len(db._passives_by_key), "mods": nn(mods)}

    CALLS["skill_ref.schema"] = c_skill_schema

    # ------------------------------------------------------------------ leagues
    def league_files(game, shape):
        ix = snap(f"hub_league_index_{game}.json.gz")
        if shape == "real":
            return ix
        ix = json.loads(json.dumps(ix))
        if shape == "no_hc":
            ix["hardcore"] = None
        elif shape == "no_events":
            ix["events"] = []
        elif shape == "no_main":
            ix["main"] = {}
        elif shape == "dup":
            ix["events"] = ix["events"] + [{"league": ix["main"]["league"], "path": "dup/path.json"}]
        return ix

    def c_get_league_files(game, shape):
        saved = hub_client.get_index, hub_client.get_prices
        try:
            if shape == "down":
                hub_client.get_index = lambda g: None
                hub_client.get_prices = lambda p: {"league": "Fallback League"}
            elif shape == "down_nolatest":
                hub_client.get_index = lambda g: None

                def boom(p):
                    raise RuntimeError("down")
                hub_client.get_prices = boom
            else:
                hub_client.get_index = lambda g: league_files(game, shape)
            return hub_client.get_league_files(game)
        finally:
            hub_client.get_index, hub_client.get_prices = saved

    def c_choose(game, shape, auto, prefer_hc, current):
        files = c_get_league_files(game, shape)
        logs, state = [], {}
        fake = types.SimpleNamespace(
            _league_paths={}, _league_cb=types.SimpleNamespace(configure=lambda values=None: state.update(values=list(values))),
            _league_var=types.SimpleNamespace(get=lambda: current, set=lambda v: state.update(picked=v)),
            _config=types.SimpleNamespace(get=lambda k, d=None: {"prefer_hardcore": prefer_hc}.get(k, d)),
            _log=lambda m, t="info": logs.append([m, t]), _load_prices_async=lambda: state.update(loaded_cache=True))
        fake._pick_league = lambda main, hc: app_mod.App._pick_league(fake, main, hc)
        app_mod.App._update_league_menu(fake, files, auto_pick=auto)
        return {"files": files, "league_paths": list(fake._league_paths.items()), "state": state, "logs": logs}

    CALLS["hub_client.get_league_files"] = lambda game, shape: c_get_league_files(game, shape)
    CALLS["app.choose_league"] = c_choose

    # ------------------------------------------------------------------ Python behaviours
    CALLS["py.round"] = lambda x, n: (lambda r: 0.0 if r == 0 else r)(round(x, n))
    CALLS["py.format_g"] = lambda x: f"{x:g}"
    CALLS["py.float"] = lambda s: (lambda v: v if math.isfinite(v) else repr(v))(float(s))
    CALLS["py.sum"] = lambda xs: sum(xs)
    CALLS["py.quote"] = lambda s, safe="/": urllib.parse.quote(s, safe=safe)
    CALLS["py.close_matches"] = lambda word, poss, n=1, cutoff=0.6: difflib.get_close_matches(word, poss, n, cutoff)
    CALLS["py.ratio"] = lambda a, b: difflib.SequenceMatcher(None, a, b).ratio()
    CALLS["py.json_float"] = lambda x: json.dumps({"v": float(x)}, separators=(",", ":"))

    # ------------------------------------------------------------------ tools/build_mod_meta.py (the tier-ladder builder)
    def c_mod_meta(game, bases, mods):
        """Run the original's builder on these two files; the result is the file (the time stamp made constant) or its failure."""
        import contextlib
        import hashlib
        import importlib.util
        import io
        import os
        import re
        spec = importlib.util.spec_from_file_location("build_mod_meta_orig", Path(os.environ.get("OLD_REPO", r"D:\Projects\PoE_Price-Trade_Checker")) / "tools" / "build_mod_meta.py")
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        d = Path(tempfile.mkdtemp(prefix="pfg-modmeta-"))
        (d / "base_items.json").write_text(json.dumps(bases), encoding="utf-8")
        (d / "mods.json").write_text(json.dumps(mods), encoding="utf-8")
        out = d / "out.json"
        argv, code = sys.argv, 0
        err = io.StringIO()
        try:
            sys.argv = ["build_mod_meta.py", "--game", game, "--local", str(d), "-o", str(out)]
            with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(err):
                try:
                    mod.main()
                except SystemExit as e:
                    code = e.code or 0
        finally:
            sys.argv = argv
        if code:
            return {"exit": code, "errors": err.getvalue().splitlines()}
        text = re.sub(r'"generated":"[^"]*"', '"generated":"T"', out.read_text(encoding="utf-8"), count=1)
        return {"exit": 0, "len": len(text), "sha": hashlib.sha256(text.encode("utf-8")).hexdigest(), "meta": json.loads(text)}

    CALLS["tools.build_mod_meta"] = c_mod_meta

