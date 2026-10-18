"""Builds the fixtures of the mod -> stat_id matching tests from the HUB's own code (read only: nothing in the hub folder is written).

  python -B tools/stat-match/gen_hub_golden.py <hub folder> <work folder with the downloads>

Inputs (downloaded by hand, see docs/PHASE5.md "Stat matching"):
  <work>/internal_stats_cache_poe1.json, internal_stats_cache.json   the GGG trade stats table as the hub published it (envelope {"fetched_at","data"})
  <work>/repoe_poe1.json, repoe_poe2.json                             RePoE stat translations (the hub's own source for the rendering aliases)
Outputs under tests/parity/fixtures/stat_match/:
  stats_<game>.json.gz      the GGG table (the "data" part: {"result": [...]})
  aliases_<game>.json.gz    the rendering aliases the hub's build_aliases makes from the two files above (also apps/checker/resources/rendering_aliases_<game>.json)
  corpus_<game>.json.gz     [[kind, text, expected]]: expected = what the hub's ModNormalizer answers ([] = unmapped, else [[stat_id, template, values]])
  truth_<game>.json.gz      [[kind, text, [numeric trade ids]]]: RePoE says this wording renders exactly these trade stats (the ground truth)
"""
from __future__ import annotations

import gzip
import json
import random
import re
import sys
import tempfile
from pathlib import Path

sys.dont_write_bytecode = True
HUB = Path(sys.argv[1])
WORK = Path(sys.argv[2])
ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "tests" / "parity" / "fixtures" / "stat_match"
OUT.mkdir(parents=True, exist_ok=True)
sys.path.insert(0, str(HUB))

from src.processing.normalizer import ModNormalizer  # noqa: E402  (the hub's code)
from src.processing.rendering_aliases import AliasIndex, KINDS, build_aliases  # noqa: E402

GAMES = {
    "poe1": ("repoe_poe1.json", "internal_stats_cache_poe1.json"),
    "poe2": ("repoe_poe2.json", "internal_stats_cache.json"),
}
PLACE = re.compile(r"\{(\d*)(?::[^}]*)?\}")
MARKUP = re.compile(r"\[([^\]|]*\|)?([^\]]*)\]")
TRADE_ID = re.compile(r"^([a-z]+)\.stat_(\d+)$")
rnd = random.Random(20261019)


def gz(path: Path, obj) -> None:
    with gzip.open(path, "wt", encoding="utf-8", compresslevel=9) as fh:
        json.dump(obj, fh, ensure_ascii=False, separators=(",", ":"))


def variants_of_template(text: str) -> list[str]:
    """wordings a player's item can show for one table template"""
    out = [text.replace("#", "7"), text.replace("#", "+7"), text.replace("#", "-7"), text.replace("#", "12.5")]
    swapped = re.sub("increased", "reduced", text, flags=re.I)
    swapped = re.sub("more", "less", swapped, flags=re.I)
    if swapped != text:
        out.append(swapped.replace("#", "11"))
    if text.endswith(" (Local)"):
        out.append(text[: -len(" (Local)")].replace("#", "5"))
    words = text.split(" ")
    if words and words[-1] and words[-1][-1].isalpha():
        out.append(" ".join(words[:-1] + [words[-1] + "s"]).replace("#", "3"))
    return out


class _Http:
    def get_json(self, url):  # never used: the table is fed directly
        raise RuntimeError("no network")


def build_normalizer(game: str, data: dict, payload: dict, tmp: Path) -> ModNormalizer:
    n = ModNormalizer(_Http(), game=game, cache_path=tmp / f"cache_{game}.json", unmapped_log_path=tmp / f"unmapped_{game}.log")
    n._build_index(data)
    n._aliases = AliasIndex(payload) if AliasIndex.valid(payload) else AliasIndex.empty()
    return n


def main() -> None:
    tmp = Path(tempfile.mkdtemp(prefix="stat-match-"))
    for game, (repoe_name, stats_name) in GAMES.items():
        translations = json.loads((WORK / repoe_name).read_text(encoding="utf-8"))
        data = json.loads((WORK / stats_name).read_text(encoding="utf-8"))["data"]
        table = {}
        for g in data["result"]:
            if g.get("id") in KINDS:
                table[g["id"]] = {e["id"]: e["text"] for e in g.get("entries", []) if e.get("id") and e.get("text")}
        payload = build_aliases(game, translations, table)
        gz(OUT / f"stats_{game}.json.gz", data)
        gz(OUT / f"aliases_{game}.json.gz", payload)
        # the snapshot that ships with the Checker (used until / unless the hub file can be fetched); replaced by the hub's own published file when it exists
        (ROOT / "apps" / "checker" / "resources" / f"rendering_aliases_{game}.json").write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        norm = build_normalizer(game, data, payload, tmp)

        pairs: list[tuple[str, str]] = []
        # 1 wordings of the table's own templates, in their own group
        for g in data["result"]:
            if g.get("id") not in KINDS:
                continue
            for e in g.get("entries", []):
                if e.get("text"):
                    for v in variants_of_template(e["text"]):
                        pairs.append((g["id"], v))
        # 2 every wording RePoE lists (the numbers filled in), asked as explicit and as implicit
        rendered: dict[str, set[str]] = {}
        for entry in translations:
            trade = entry.get("trade_stats") or []
            nums = sorted({m.group(2) for t in trade if (m := TRADE_ID.match(t.get("id", "")))})
            for v in entry.get("English") or []:
                s = MARKUP.sub(lambda m: m.group(2), v["string"])
                for fill in ("3", "14"):
                    text = PLACE.sub(fill, s)
                    for kind in ("explicit", "implicit"):
                        pairs.append((kind, text))
                    if nums and len(v.get("condition", [])) == 1 and chr(10) not in text:
                        rendered.setdefault(text, set()).update(nums)
        # the ground truth: a wording and EVERY trade stat that RePoE says renders exactly that wording (two stats can render one text,
        # e.g. a global stat and its (Local) twin: then either answer is right)
        truth: list[tuple[str, str, list[str]]] = [("explicit", text, sorted(nums)) for text, nums in rendered.items()]
        # 3 every line of the parity item fixtures
        for p in sorted((ROOT / "tests" / "parity" / "fixtures" / "items").glob("*.txt")):
            for line in p.read_text(encoding="utf-8").splitlines():
                line = line.strip()
                if line and not line.startswith("---"):
                    for kind in KINDS:
                        pairs.append((kind, line))
        seen = set()
        uniq = []
        for p in pairs:
            if p not in seen:
                seen.add(p)
                uniq.append(p)
        rnd.shuffle(uniq)
        uniq = uniq[:60000]
        corpus = []
        for kind, text in uniq:
            res = norm.normalize(text, kind)
            corpus.append([kind, text, [[r.stat_id, r.template, r.values] for r in res]])
        gz(OUT / f"corpus_{game}.json.gz", corpus)
        # ground truth: keep at most 40000, deterministic
        rnd.shuffle(truth)
        truth = truth[:40000]
        gz(OUT / f"truth_{game}.json.gz", [[k, t, n] for k, t, n in truth])
        mapped = sum(1 for c in corpus if c[2])
        print(game, "aliases", len(payload["aliases"]), "deprecated", len(payload["deprecated"]), "corpus", len(corpus), "hub mapped", mapped, "truth", len(truth))


main()
