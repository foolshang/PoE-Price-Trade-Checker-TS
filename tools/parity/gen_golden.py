"""Regenerate / check the parity cases and goldens against the ORIGINAL Python program (read only).

    python tools/parity/gen_golden.py            write tests/parity/cases + golden
    python tools/parity/gen_golden.py --check    regenerate in memory, fail if the original no longer gives the committed goldens
    OLD_REPO=<path> overrides the location of the original (default D:/Projects/PoE_Price-Trade_Checker)

Nothing is ever written below OLD_REPO (bytecode is off; git is only asked for the commit id).
"""
from __future__ import annotations
import argparse
import gzip
import json
import platform
import subprocess
import sys
from pathlib import Path

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).parent))
import oldlib  # noqa: E402
from cases import all_cases  # noqa: E402

ROOT = oldlib.ROOT
PARITY = ROOT / "tests" / "parity"
CASES, GOLDEN, TEXTS = PARITY / "cases", PARITY / "golden", PARITY / "golden" / "texts"
CACHE = ROOT / ".parity-cache" / "texts"


def dumps_cases(items: list) -> str:
    return "[\n" + ",\n".join(json.dumps(c, sort_keys=True, ensure_ascii=True, separators=(",", ":")) for c in items) + "\n]\n"


def dumps_golden(d: dict) -> str:
    return "{\n" + ",\n".join(f"{json.dumps(k)}:{json.dumps(v, sort_keys=True, ensure_ascii=True, separators=(',', ':'))}" for k, v in sorted(d.items())) + "\n}\n"


def old_info() -> dict:
    def git(*a):
        return subprocess.run(["git", "-C", oldlib.OLD, *a], capture_output=True, text=True).stdout.strip()
    try:
        ver = [l for l in (Path(oldlib.OLD) / "poe_price_trade" / "__init__.py").read_text(encoding="utf-8").splitlines() if "__version__" in l][0]
    except Exception:  # noqa: BLE001
        ver = "?"
    return {"commit": git("rev-parse", "HEAD"), "dirty": bool(git("status", "--porcelain")), "version": ver.split("=")[-1].strip().strip('"'),
            "python": platform.python_version()}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--only", default="")
    a = ap.parse_args()
    groups = all_cases()
    problems: list = []
    info = old_info()
    manifest_path = GOLDEN / "MANIFEST.json"
    if a.check and manifest_path.exists():
        old = json.loads(manifest_path.read_text(encoding="utf-8"))
        if old.get("commit") != info["commit"]:
            print(f"NOTE: the original is at {info['commit'][:7]}, the goldens were made at {old.get('commit', '?')[:7]}")
    if info["dirty"]:
        print("WARNING: the original has uncommitted changes")
    total = 0
    for gname, items in groups.items():
        if a.only and not gname.startswith(a.only):
            continue
        oldlib.Sink.texts = {}
        golden = {}
        for c in items:
            golden[c["id"]] = oldlib.run_case(c)
        total += len(items)
        cases_txt, golden_txt = dumps_cases(items), dumps_golden(golden)
        if a.check:
            for path, txt in ((CASES / f"{gname}.json", cases_txt), (GOLDEN / f"{gname}.json", golden_txt)):
                if not path.exists() or path.read_text(encoding="utf-8") != txt:
                    problems.append(str(path.relative_to(ROOT)))
            continue
        CASES.mkdir(parents=True, exist_ok=True)
        GOLDEN.mkdir(parents=True, exist_ok=True)
        (CASES / f"{gname}.json").write_text(cases_txt, encoding="utf-8", newline="\n")
        (GOLDEN / f"{gname}.json").write_text(golden_txt, encoding="utf-8", newline="\n")
        keep = {c["id"] for c in items if c.get("keep_text")}
        CACHE.mkdir(parents=True, exist_ok=True)
        TEXTS.mkdir(parents=True, exist_ok=True)
        for key, text in oldlib.Sink.texts.items():
            fname = key.replace("/", "__") + ".txt"
            (CACHE / fname).write_text(text, encoding="utf-8", newline="")
            if key.rsplit(".", 1)[0] in keep:
                with gzip.GzipFile(TEXTS / (fname + ".gz"), "wb", mtime=0) as fh:
                    fh.write(text.encode("utf-8"))
    if a.check:
        if problems:
            print("DIFFERENT from the committed goldens:\n  " + "\n  ".join(problems))
            return 1
        print(f"parity:check ok - {total} cases give the committed goldens (original {info['commit'][:7]})")
        return 0
    manifest_path.write_text(json.dumps({**info, "cases": total}, indent=1, sort_keys=True) + "\n", encoding="utf-8", newline="\n")
    print(f"wrote {total} cases + goldens (original {info['commit'][:7]}, python {info['python']})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
