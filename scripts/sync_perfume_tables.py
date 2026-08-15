#!/usr/bin/env python3
"""Sync the Ptolemaic-queens dataset from a perfume-tables checkout.

Copies research/ptolemaic-queens-fragments/fragments.json into
mendes/data/ptolemaic-queens-fragments.json with a provenance stamp, then
regenerates the claims.json court array and validates the whole store — the
one-command replacement for the hand-stamped copy of the first import.

The perfume-tables repository stays canonical; this repository only carries
stamped copies. If a new release adds records, the court builder fails
loudly until every new record has been read and mapped by a human — that is
the intended behavior, not a bug in this script.

Usage:
    python3 scripts/sync_perfume_tables.py [--source PATH]

--source defaults to $PERFUME_TABLES_PATH, then ../perfume-tables (a sibling
checkout of alchemiesofscent/perfume-tables).
"""

from __future__ import annotations

import argparse
import datetime
import json
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATASET_RELPATH = Path("research") / "ptolemaic-queens-fragments" / "fragments.json"
DEST_PATH = ROOT / "mendes" / "data" / "ptolemaic-queens-fragments.json"
STAMP_KEYS = ("sourceRepository", "sourcePath", "sourceVersion", "syncedOn", "syncNote")


def default_source() -> Path:
    env = os.environ.get("PERFUME_TABLES_PATH")
    if env:
        return Path(env)
    return ROOT.parent / "perfume-tables"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--source", type=Path, default=default_source(),
                        help="path to a perfume-tables checkout "
                             "(default: $PERFUME_TABLES_PATH or ../perfume-tables)")
    args = parser.parse_args()

    src = args.source / DATASET_RELPATH
    if not src.is_file():
        sys.exit(f"error: {src} not found — pass --source or set PERFUME_TABLES_PATH "
                 f"to a perfume-tables checkout")

    data = json.loads(src.read_text(encoding="utf-8"))
    for key in STAMP_KEYS:
        data.pop(key, None)

    out = {
        "sourceRepository": "alchemiesofscent/perfume-tables",
        "sourcePath": str(DATASET_RELPATH).replace(os.sep, "/"),
        "sourceVersion": data.get("version"),
        "syncedOn": datetime.date.today().isoformat(),
        "syncNote": ("Versioned copy for the House of Mendes site (dossier Part V and "
                     "the claims reader). The perfume-tables repository is canonical; "
                     "do not edit records here."),
    }
    out.update(data)

    old_version = None
    if DEST_PATH.is_file():
        old_version = json.loads(DEST_PATH.read_text(encoding="utf-8")).get("sourceVersion")
    DEST_PATH.write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    change = f"{old_version} → {out['sourceVersion']}" if old_version else out["sourceVersion"]
    print(f"synced {len(data.get('records', []))} records "
          f"(version {change}) to {DEST_PATH.relative_to(ROOT)}")

    for script in ("build_mendes_court_claims.py", "check_mendes_claims.py"):
        subprocess.run([sys.executable, str(ROOT / "scripts" / script)], check=True)


if __name__ == "__main__":
    main()
