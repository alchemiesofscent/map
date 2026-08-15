#!/usr/bin/env python3
"""Regenerate the `court` array of mendes/data/claims.json.

Source: mendes/data/ptolemaic-queens-fragments.json, the stamped copy of the
perfume-tables dataset (research/ptolemaic-queens-fragments). That repository
is canonical for the records; this script owns only the site-side derivation:
which aromatics each record attests (linked to the map's ingredient ids where
the material is the same), and which places a record names concretely enough
to plot as report-evidence.

The mapping tables below are deliberately explicit per record id. When the
upstream dataset grows (v0.2+), this script fails loudly until every new
record has been read and mapped by a human.

Usage: python3 scripts/build_mendes_court_claims.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PQF_PATH = ROOT / "mendes" / "data" / "ptolemaic-queens-fragments.json"
CLAIMS_PATH = ROOT / "mendes" / "data" / "claims.json"

# Aromatics attested by each record: (display name, map ingredient id or None).
# A ref means the material is the same as a House of Mendes recipe ingredient,
# so one filter can cross both corpora. Records with no aromatic content map
# to an empty list — they are retained as deliberate comparators.
AROMATICS = {
    "PQF-CLEO-GAL-ALOPECIA": [],
    "PQF-CLEO-GAL-HAIR-ODOR": [("cedar oil", None), ("wine", "wine")],
    "PQF-CLEO-GAL-ACHORAI": [("myrtle", None)],
    "PQF-CLEO-PAUL-CURLING": [("myrtle unguent / myrtle oil", None)],
    "PQF-CLEO-AET-HAIR": [],
    "PQF-CLEO-AET-CLEANSER": [
        ("costus", None),
        ("Troglodytic myrrh", "myrrh"),
        ("iris", None),
        ("spikenard (nard)", None),
        ("amomum leaf", None),
        ("cassia", "cassia"),
        ("rush flower", "schoinos"),
        ("myrobalan", "balanos"),
    ],
    "PQF-CLEO-GAL-CRITON": [],
    "PQF-ARS-BER-ATH-PERFUME": [("rose perfume", None)],
    "PQF-BER-CALL-GRACES": [("perfumes (myra)", None)],
    "PQF-CLEO-PLUT-BARGE": [("incense (thymiamata)", None)],
    "PQF-CLEO-PLUT-TOXICOLOGY": [],
    "PQF-CLEO-PLINY-CROWN": [("flower garland", None)],
    "PQF-CLEO-LUCAN-BANQUET": [
        ("flowering nard", None),
        ("rose", None),
        ("cinnamon", "cinnamon"),
        ("amomum", None),
    ],
    "PQF-CLEO-FLORUS-DEATH": [("perfumes (odores)", None)],
    "PQF-CLEO-JOSEPHUS-BALSAM": [("balsam", "balsam"), ("date palm", None)],
}

# Places a record names concretely enough to plot. Coordinates are [lon, lat]
# in the viewers' convention. Poetic or unlocated records map to [] — a court
# record never becomes an ingredient-provenance dot.
PLACES = {
    "PQF-CLEO-GAL-ALOPECIA": [],
    "PQF-CLEO-GAL-HAIR-ODOR": [],
    "PQF-CLEO-GAL-ACHORAI": [],
    "PQF-CLEO-PAUL-CURLING": [],
    "PQF-CLEO-AET-HAIR": [],
    "PQF-CLEO-AET-CLEANSER": [],
    "PQF-CLEO-GAL-CRITON": [],
    "PQF-ARS-BER-ATH-PERFUME": [
        {"name": "Alexandria", "coord": [29.92, 31.20]},
        {"name": "Cyrene", "coord": [21.86, 32.82]},
    ],
    "PQF-BER-CALL-GRACES": [],
    "PQF-CLEO-PLUT-BARGE": [{"name": "Tarsus, on the Cydnus", "coord": [34.90, 36.92]}],
    "PQF-CLEO-PLUT-TOXICOLOGY": [],
    "PQF-CLEO-PLINY-CROWN": [],
    "PQF-CLEO-LUCAN-BANQUET": [{"name": "Alexandria", "coord": [29.92, 31.20]}],
    "PQF-CLEO-FLORUS-DEATH": [{"name": "Alexandria", "coord": [29.92, 31.20]}],
    "PQF-CLEO-JOSEPHUS-BALSAM": [{"name": "Jericho", "coord": [35.44, 31.87]}],
    "PQF-BER-ATH-PROCESSION": [{"name": "Alexandria", "coord": [29.92, 31.20]}],
}
AROMATICS["PQF-BER-ATH-PROCESSION"] = [("incense and aromatics", None)]


def short_cite(source: dict) -> str:
    parts = [f"{source['ancientAuthor']}, {source['ancientWork']}"]
    if source.get("ancientLines"):
        parts.append(source["ancientLines"])
    return ", ".join(parts)


def build_record(record: dict, ingredient_ids: set[str]) -> dict:
    rid = record["id"]
    if rid not in AROMATICS or rid not in PLACES:
        sys.exit(f"error: no aromatics/places mapping for {rid}; "
                 f"read the record and add it to scripts/build_mendes_court_claims.py")
    aromatics = []
    for name, ref in AROMATICS[rid]:
        if ref is not None and ref not in ingredient_ids:
            sys.exit(f"error: {rid} maps aromatic {name!r} to unknown ingredient id {ref!r}")
        aromatics.append({"name": name, "ref": ref})
    return {
        "id": "court-" + rid.lower(),
        "pqfId": rid,
        "kind": record["recordKind"],
        "subtype": record["subtype"],
        "queen": record["queen"],
        "queenConfidence": record["queenIdentification"]["confidence"],
        "olfactoryRelevance": record["olfactoryRelevance"],
        "textScope": record["textScope"],
        "aromatics": aromatics,
        "places": PLACES[rid],
        "cite": short_cite(record["source"]),
        "source": record["source"],
        "commentary": record["commentary"],
    }


def main() -> None:
    pqf = json.loads(PQF_PATH.read_text(encoding="utf-8"))
    claims = json.loads(CLAIMS_PATH.read_text(encoding="utf-8"))
    ingredient_ids = {i["id"] for i in claims["ingredients"]}
    ingredient_ids.update(i["id"] for i in claims["contextIngredients"])

    records = pqf["records"]
    mapped = set(AROMATICS) | set(PLACES)
    unknown = mapped - {r["id"] for r in records}
    if unknown:
        sys.exit(f"error: mappings for records absent upstream: {sorted(unknown)}")

    claims["court"] = [build_record(r, ingredient_ids) for r in records]
    claims["courtSource"] = {
        "repository": pqf.get("sourceRepository"),
        "path": pqf.get("sourcePath"),
        "version": pqf.get("sourceVersion"),
        "syncedOn": pqf.get("syncedOn"),
    }
    CLAIMS_PATH.write_text(
        json.dumps(claims, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {len(claims['court'])} court records to {CLAIMS_PATH.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
