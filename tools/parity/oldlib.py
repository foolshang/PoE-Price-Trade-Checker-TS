"""Runs cases against the ORIGINAL Python program (read only: imported from OLD_REPO, no bytecode written there).

A case is {"id", "fn", "args"}; the output of a case is a JSON-able dict. tests/parity/parity.test.ts runs the same
cases against the TypeScript core and compares the outputs. Large texts are summarised ({"$text": sha256, len, lines});
the text itself goes to a side file so a difference can be shown line by line.
"""
from __future__ import annotations
import dataclasses
import gzip
import hashlib
import json
import os
import sys
from pathlib import Path

sys.dont_write_bytecode = True
OLD = os.environ.get("OLD_REPO", r"D:\Projects\PoE_Price-Trade_Checker")
if OLD not in sys.path:
    sys.path.insert(0, OLD)

from poe_price_trade import (filter_core, filter_gen, filter_style, filter_whitelist as w, hub_client, trade_names,  # noqa: E402
                             wl_embed, wl_import, wl_session)
from poe_price_trade.wl_model import WlModel  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
FIX = ROOT / "tests" / "parity" / "fixtures"


# ------------------------------------------------------------------------------------------------ fixtures

def _snap(name: str):
    with gzip.open(FIX / name, "rt", encoding="utf-8") as fh:
        return json.load(fh)


def fixture(ref):
    """'fx:hub_poe2' -> data; None -> None."""
    if ref is None:
        return None
    if ref == "":
        return ""
    assert ref.startswith("fx:"), ref
    name = ref[3:]
    if name.startswith("hub_"):
        return {"currency": [], "items": _snap(f"{name}.json.gz")["items"]}
    if name.startswith("names_"):
        return set(_snap(f"trade_names_{name[6:]}.json.gz"))
    if name.startswith("ns_"):                       # ns_poe2_s2 / ns_poe2_base
        _, game, kind = name.split("_")
        return (FIX / f"neversink_{game}_{kind}.filter").read_text(encoding="utf-8")
    if name.startswith("old_"):                      # old_v2_poe2_bus
        with gzip.open(FIX / "old_filters" / f"{name[4:]}.filter.gz", "rt", encoding="utf-8") as fh:
            return fh.read()
    raise KeyError(ref)


def data(game: str, hub="hub", base="s2", names=True):
    return (fixture(f"fx:hub_{game}") if hub else None, fixture(f"fx:ns_{game}_{base}") if base else "",
            fixture(f"fx:names_{game}") if names else set())


# ------------------------------------------------------------------------------------------------ outputs

class Sink:
    """Where the full texts of a run go (for line-by-line diffs); filled by text_ref()."""
    texts: dict = {}


def text_ref(case_id: str, name: str, text):
    if text is None:
        return None
    b = text.encode("utf-8")
    Sink.texts[f"{case_id}.{name}"] = text
    return {"$text": hashlib.sha256(b).hexdigest(), "len": len(text), "lines": text.count("\n") + 1}


def jsonable(x):
    if x is None or isinstance(x, (bool, int, float, str)):
        return x
    if isinstance(x, dict):
        return {str(k): jsonable(v) for k, v in x.items()}
    if isinstance(x, (list, tuple)):
        return [jsonable(v) for v in x]
    if isinstance(x, (set, frozenset)):
        items = [jsonable(v) for v in x]
        try:
            return sorted(items)
        except TypeError:
            return sorted(items, key=lambda v: json.dumps(v, sort_keys=True))
    if dataclasses.is_dataclass(x) and not isinstance(x, type):
        return {f.name: jsonable(getattr(x, f.name)) for f in dataclasses.fields(x)}
    if hasattr(x, "__slots__"):
        return {s: jsonable(getattr(x, s)) for s in x.__slots__}
    if isinstance(x, Path):
        return str(x)
    raise TypeError(f"not jsonable: {type(x)}")


# ------------------------------------------------------------------------------------------------ fn: build_filter_text

def fake_copy(calls: list):
    def copy_sounds(sound_map):
        calls.append({k: v for k, v in sound_map.items()})
        return {k: filter_core.safe_sound_name(os.path.basename(v))[0] for k, v in sound_map.items() if v}
    return copy_sounds


def run_build_filter_text(case_id: str, a: dict) -> dict:
    logs, calls = [], []
    hub = fixture(a.get("hub"))
    base = fixture(a.get("base"))
    names = fixture(a.get("names"))
    res = filter_core.build_filter_text(
        a["cfg"], a["game"], hub_data=hub, base_text=base, base_tag=a.get("base_tag"),
        copy_sounds_fn=fake_copy(calls) if a.get("sounds", "fake") else None, extra_names=names,
        app_version=a.get("version", ""), log=lambda m, t="info": logs.append([t, m]))
    out: dict = {"logs": logs, "copy_calls": calls}
    if res is None:
        out["result"] = None
        return out
    r = {k: jsonable(v) for k, v in res.items() if k not in ("generated_section", "base_text")}
    r["generated_section"] = text_ref(case_id, "section", res["generated_section"])
    r["base_text"] = text_ref(case_id, "base", res.get("base_text"))
    if res.get("generated_section") or res.get("base_text"):
        r["file"] = text_ref(case_id, "file", filter_core.compose_filter_body(res["generated_section"], res.get("base_text")))
    out["result"] = r
    return out


# ------------------------------------------------------------------------------------------------ fn: wl_model

def _row(r):
    return dataclasses.asdict(r)


def apply_op(m: WlModel, op: list):
    name, args = op[0], op[1:]
    if name == "$set":                   # ["$set", attr, value]
        setattr(m, args[0], args[1])
        return None
    if name == "$setdict":               # ["$setdict", attr, key, value]
        getattr(m, args[0])[args[1]] = args[2]
        return None
    return getattr(m, name)(*args)


def model_summary(case_id: str, m: WlModel, a: dict) -> dict:
    out: dict = {}
    out["cfg"] = jsonable(m.cfg())
    out["categories"] = jsonable(m.categories())
    rows = {}
    cats = [c for c, _l in m.categories()]
    for c in cats:
        rs = [_row(r) for r in m.rows(c)]
        blob = json.dumps(rs, sort_keys=True, ensure_ascii=True)
        rows[c] = {"n": len(rs), "sha": hashlib.sha256(blob.encode()).hexdigest(), "head": rs[:2],
                   "changed": m.changed_count(c), "cat_tier": m.category_tier(c)}
    out["rows"] = rows
    for q, cat in a.get("queries", []):
        rows[f"?{cat}:{q}"] = [_row(r) for r in m.rows(cat, q)][:50]
    out["flask_rows"] = jsonable(m.flask_rows())
    out["equip_groups"] = jsonable(m.equip_groups())
    out["conflicts"] = jsonable(m.unique_conflicts())
    out["styles"] = {lab: jsonable(m.effective_style(lab)) for lab in ("S", "A", "B", "C", "G", "Tablet", "Map", "Gem")}
    res = m.build(a.get("quest_text", ""), a.get("sound_names") or None)
    out["build"] = {
        "text": text_ref(case_id, "build", res["text"]), "count": res["count"], "report": res["report"],
        "skipped": jsonable(res["skipped"]), "bad_names": jsonable(res["bad_names"]),
        "unique_conflicts": jsonable(res["unique_conflicts"]), "gear_tiers": res["gear_tiers"], "block_tiers": res["block_tiers"],
        "stack_min": jsonable(res["stack_min"]),
        "tiers_sha": hashlib.sha256(json.dumps(sorted(res["tiers"].items()), ensure_ascii=True).encode()).hexdigest(),
        "categories_sha": hashlib.sha256(json.dumps(sorted(res["categories"].items()), ensure_ascii=True).encode()).hexdigest(),
    }
    return out


def run_wl_model(case_id: str, a: dict) -> dict:
    game = a["game"]
    m = WlModel.from_config(a.get("cfg") or {}, game)
    out: dict = {"notes_before": m.take_notes()}
    if a.get("known_lists", "-") != "-":
        m.adopt_known_lists(a["known_lists"])
    if a.get("data", True):
        m.set_data(*data(game, hub=a.get("hub", "hub"), base=a.get("base", "s2"), names=a.get("names", True)))
    out["notes_after"] = m.take_notes()
    out["op_results"] = [jsonable(apply_op(m, op)) for op in a.get("ops", [])]
    out["notes_ops"] = m.take_notes()
    out.update(model_summary(case_id, m, a))
    return out


# ------------------------------------------------------------------------------------------------ fn: open_text

class _Folder:
    pass


def mutate(text: str, ops: list) -> str:
    """Deterministic edits of a filter text (the TypeScript runner does exactly the same)."""
    for op in ops:
        kind = op[0]
        if kind == "drop":                       # drop the blocks (split at blank lines) with these indexes (modulo the count)
            chunks = text.split("\n\n")
            gone = {i % len(chunks) for i in op[1]}
            text = "\n\n".join(c for i, c in enumerate(chunks) if i not in gone)
        elif kind == "perm":                     # reorder the blocks: op[1] = a list of indexes (modulo the count)
            chunks = text.split("\n\n")
            seen, order = set(), []
            for i in op[1]:
                j = i % len(chunks)
                if j not in seen:
                    seen.add(j)
                    order.append(j)
            order += [j for j in range(len(chunks)) if j not in seen]
            text = "\n\n".join(chunks[j] for j in order)
        elif kind == "replace":                  # first `count` occurrences
            text = text.replace(op[1], op[2], op[3])
        elif kind == "crlf":
            text = text.replace("\n", "\r\n")
        elif kind == "truncate":
            text = text[:op[1]]
        elif kind == "append":
            text = text + op[1]
        else:
            raise KeyError(kind)
    return text


def run_open_text(case_id: str, a: dict) -> dict:
    game = a["game"]
    if "text_from_build" in a:
        text = run_build_text_only(a["text_from_build"])
    else:
        text = fixture(a["text"])
    if a.get("mutate"):
        text = mutate(text, a["mutate"])
    current = WlModel.from_config(a.get("current_cfg") or {}, game)
    d = data(game, hub=a.get("hub", "hub"), base=a.get("base", "s2"), names=a.get("names", True))
    current.set_data(*d)
    existing = set(a.get("sound_files", []))
    opened = wl_session.open_text(
        text, a.get("filename", "x.filter"), game, current, d if a.get("with_data", True) else None,
        sound_file=lambda name: ("/snd/" + name) if name in existing else None, folder=None)
    out = {"ok": opened.ok, "messages": jsonable(opened.messages), "name": opened.name, "kind": opened.kind,
           "app": opened.app, "sounds": jsonable(opened.sounds)}
    if opened.model is not None:
        out["model"] = model_summary(case_id, opened.model, a)
    return out


def run_build_text_only(b: dict) -> str:
    calls = []
    res = filter_core.build_filter_text(
        b["cfg"], b["game"], hub_data=fixture(b.get("hub")), base_text=fixture(b.get("base")), base_tag=b.get("base_tag"),
        copy_sounds_fn=fake_copy(calls), extra_names=fixture(b.get("names")), app_version=b.get("version", ""),
        log=lambda m, t="info": None)
    return filter_core.compose_filter_body(res["generated_section"], res.get("base_text"))


# ------------------------------------------------------------------------------------------------ fn: call

def _decide(policy):
    return {"keep": lambda n, alt: "keep", "overwrite": lambda n, alt: "overwrite", None: None}[policy]


def _blocks(lines):
    return [{"block_type": b.block_type, "start": b.start, "end": b.end, "basetype_line": b.basetype_line,
             "basetype_names": b.basetype_names} for b in filter_gen._parse_blocks(lines)]


def _gear_seq(game, base):
    out = []
    for e in w.gear_sequence(game, base):
        out.append(jsonable(e))
    return out


def _tuple_keys(d):
    return {json.dumps(k): v for k, v in d.items()}


CALLS = {
    # filter_style
    "filter_style.normalize_style": lambda x: filter_style.normalize_style(x),
    "filter_style.is_empty": lambda x: filter_style.is_empty(x),
    "filter_style.uses_sound_file": lambda x: filter_style.uses_sound_file(x),
    "filter_style.style_lines": lambda style, sound_file=None, indent="    ": filter_style.style_lines(style, sound_file, indent),
    "filter_style.lines_to_style": lambda lines: filter_style.lines_to_style(lines),
    "filter_style.merge_styles": lambda b, o: filter_style.merge_styles(b, o),
    "filter_style.default_quest_style": lambda: filter_style.default_quest_style(),
    "filter_style.DEFAULT_STYLES": lambda: filter_style.DEFAULT_STYLES,
    # filter_gen
    "filter_gen.parse_blocks": lambda text: _blocks(text.split("\n")),
    "filter_gen.sound_id_of": lambda body: filter_gen.sound_id_of(body),
    "filter_gen.sound_block_counts": lambda ref: filter_gen.sound_block_counts(fixture(ref)),
    "filter_gen.apply_numbered_sounds": lambda ref, sm: list(filter_gen.apply_numbered_sounds(fixture(ref), sm)),
    "filter_gen.apply_numbered_sounds_text": lambda text, sm: list(filter_gen.apply_numbered_sounds(text, sm)),
    "filter_gen.names_in_categories": lambda ref, cats: filter_gen.names_in_categories(fixture(ref), cats),
    "filter_gen.expand_categories": lambda ref, cats, ex=None: filter_gen.expand_categories(fixture(ref), cats, ex),
    "filter_gen.normalize_custom": lambda x: filter_gen._normalize_custom(x),
    "filter_gen.build_whitelist_section": lambda exact, uniq=None, contains=None, gem_uncut=None, gold=False, gold_min=0, unique_all=False:
        filter_gen.build_whitelist_section(exact, uniq, contains, gem_uncut=gem_uncut, gold=gold, gold_min=gold_min, unique_all=unique_all),
    # filter_core
    "filter_core.quote": lambda s: filter_core._quote(s),
    "filter_core.neversink_filename": lambda g, s: filter_core.neversink_filename(g, s),
    "filter_core.neversink_file_url": lambda g, tag, s: filter_core.neversink_file_url(g, tag, s),
    "filter_core.neversink_latest_api_url": lambda g: filter_core.neversink_latest_api_url(g),
    "filter_core.compose_filter_body": lambda gen, base: filter_core.compose_filter_body(gen, base),
    "filter_core.validate_filter_name": lambda n: filter_core.validate_filter_name(n),
    "filter_core.safe_sound_name": lambda n: filter_core.safe_sound_name(n),
    "filter_core.plan_sound_files": lambda req, existing: filter_core.plan_sound_files([tuple(r) for r in req], existing),
    "filter_core.resolve_sound_plan": lambda req, existing, policy=None: filter_core.resolve_sound_plan(
        filter_core.plan_sound_files([tuple(r) for r in req], existing), _decide(policy)),
    "filter_core.build_quest_blocks": lambda game, style, sound_file=None, default_lines=None:
        filter_core.build_quest_blocks(game, style, sound_file, default_lines),
    "filter_core.tier_sound_requests": lambda cfg: filter_core.tier_sound_requests(cfg),
    "filter_core.migrate_sounds": lambda cfg: list(filter_core.migrate_sounds(cfg)),
    "filter_core.plan_fetch": lambda cfg, game: filter_core.plan_fetch(cfg, game),
    "filter_core.add_shared_tier_sounds": lambda section, copied: filter_core.add_shared_tier_sounds(section, copied),
    # filter_whitelist
    "w.tier_of_step": lambda tag: w.tier_of_step(tag),
    "w.bad_name": lambda n: w.bad_name(n),
    "w.default_tiers": lambda ref: w.default_tiers(fixture(ref)),
    "w.ladder_names": lambda ref: w.ladder_names(fixture(ref)),
    "w.known_names": lambda ref: w.known_names(fixture(ref)),
    "w.start_tiers": lambda ref: [w.start_tiers(fixture(ref))[0], w.start_tiers(fixture(ref))[1]],
    "w.stack_info": lambda ref: [w.stack_info(fixture(ref))[0], sorted(w.stack_info(fixture(ref))[1])],
    "w.unique_base_defaults": lambda ref: w.unique_base_defaults(fixture(ref)),
    "w.poe1_special_map_bases": lambda ref: w.poe1_special_map_bases(fixture(ref)),
    "w.universe": lambda game, hub, ref: w.universe(game, fixture(hub), fixture(ref)),
    "w.type_category": lambda game, ty: w.type_category(game, ty),
    "w.gear_sequence": lambda game, ref: _gear_seq(game, fixture(ref)),
    "w.block_label": lambda ty, conds: w.block_label(ty, conds),
    "w.neversink_quest_lines": lambda ref: w.neversink_quest_lines(fixture(ref)),
    "w.default_tier_lines": lambda ref: w.default_tier_lines(fixture(ref)),
    "w.sound_requests": lambda cfg, game=None: w.sound_requests(cfg, game),
    "w.gear_group_of": lambda game, ty: w.gear_group_of(game, ty),
    "w.equip_groups": lambda game: w.equip_groups(game),
    "w.unique_entries": lambda ref: w.unique_entries(fixture(ref)),
    # wl_embed
    "wl_embed.embed_lines": lambda cfg, game, version="": wl_embed.embed_lines(cfg, game, version),
    "wl_embed.embed": lambda text, cfg, game, version="": wl_embed.embed(text, cfg, game, version),
    "wl_embed.extract": lambda text: wl_embed.extract(text),
    "wl_embed.classify": lambda text: wl_embed.classify(text),
    "wl_embed.classify_fixture": lambda ref: wl_embed.classify(fixture(ref)),
    "wl_embed.whitelist_part": lambda cfg, game: wl_embed.whitelist_part(cfg, game),
    # wl_import
    "wl_import.version_of": lambda text: wl_import.version_of(text),
    "wl_import.guess_game": lambda text: wl_import.guess_game(text),
    "wl_import.summarize_fixture": lambda ref: _summary(wl_import.summarize(fixture(ref))),
    # hub / names
    "hub_client.hub_chaos_value": lambda e: hub_client.hub_chaos_value(e),
    "trade_names.names_from_payload": lambda p: trade_names.names_from_payload(p),
    "wl_model.convert_legacy": lambda fg, game: list(WlModel.convert_legacy(fg, game)),
}


def _summary(sm):
    if sm is None:
        return None
    d = {}
    for f in dataclasses.fields(sm):
        v = getattr(sm, f.name)
        if f.name in ("tablet_block", "map_block", "gold_block"):
            d[f.name] = None if v is None else {"title": v.title, "kind": v.kind, "conds": jsonable(v.conds), "style": v.style}
        elif f.name == "gear":  # only the block types matter now (the rest fed the equipment lists, which are gone)
            d["gear_types"] = [t[0] for t in v]
        elif f.name == "gem_blocks":
            d[f.name] = [{"title": b.title, "kind": b.kind, "conds": jsonable(b.conds), "style": b.style} for b in v]
        else:
            d[f.name] = jsonable(v)
    return d


BIG_TEXT = 2000
BIG_JSON = 30000


def canonical(x) -> str:
    return json.dumps(x, sort_keys=True, ensure_ascii=True, separators=(",", ":"))


def compact(case_id: str, x, counter=None):
    """Long strings -> text refs, huge structures -> {"$json": sha256}. The TypeScript runner does exactly the same."""
    counter = counter if counter is not None else [0]

    def walk(v):
        if isinstance(v, str) and len(v) > BIG_TEXT:
            counter[0] += 1
            return text_ref(case_id, f"r{counter[0]}", v)
        if isinstance(v, list):
            return [walk(i) for i in v]
        if isinstance(v, dict):
            return {k: walk(i) for k, i in v.items()}
        return v
    out = walk(x)
    blob = canonical(out)
    if len(blob) > BIG_JSON:
        return {"$json": hashlib.sha256(blob.encode()).hexdigest(), "n": len(blob)}
    return out


def run_call(case_id: str, a: dict):
    fn = CALLS[a["name"]]
    try:
        r = fn(*a.get("args", []), **a.get("kwargs", {}))
    except Exception as e:  # noqa: BLE001
        return {"error": type(e).__name__}
    return {"result": compact(case_id, jsonable(r))}


RUNNERS = {"build_filter_text": run_build_filter_text, "wl_model": run_wl_model, "open_text": run_open_text, "call": run_call}


def run_case(case: dict):
    try:
        return RUNNERS[case["fn"]](case["id"], case["args"])
    except Exception as e:  # noqa: BLE001  (a case that raises is part of the expected behaviour)
        return {"error": type(e).__name__}
