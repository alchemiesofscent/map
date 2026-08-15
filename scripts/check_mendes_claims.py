#!/usr/bin/env python3
"""Validate mendes/data/claims.json, the single home of the House of Mendes
evidence records consumed by the map viewer, the journeys viewer, and the
dossier's planned claims reader.

Checks structure, controlled vocabularies, id uniqueness, coordinate sanity,
group coverage, and that the generated court records stay in step with the
stamped Ptolemaic-queens dataset copy. Run via `make check`.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CLAIMS_PATH = ROOT / "mendes" / "data" / "claims.json"
PQF_PATH = ROOT / "mendes" / "data" / "ptolemaic-queens-fragments.json"

EVIDENCE = {"ancient", "modern", "theology"}
RECIPE_IDS = {"m", "t", "s"}
OLFACTORY = {"direct", "indirect", "contextual", "none"}
COURT_KINDS = {"recipe", "report"}

errors: list[str] = []


def err(msg: str) -> None:
    errors.append(msg)


def check_coord(coord, where: str) -> None:
    if (not isinstance(coord, list) or len(coord) != 2
            or not all(isinstance(v, (int, float)) for v in coord)):
        err(f"{where}: coord must be [lon, lat] numbers, got {coord!r}")
        return
    lon, lat = coord
    if not (5 <= lon <= 85 and 5 <= lat <= 45):
        err(f"{where}: coord {coord!r} outside the map frame (lon 5–85, lat 5–45)")


def check_claim(claim: dict, where: str, seen_ids: set[str]) -> None:
    for field in ("id", "place", "coord", "evidence", "recipes", "cite", "note"):
        if field not in claim:
            err(f"{where}: missing field {field!r}")
            return
    if claim["id"] in seen_ids:
        err(f"{where}: duplicate claim id {claim['id']!r}")
    seen_ids.add(claim["id"])
    check_coord(claim["coord"], f"{where} ({claim['id']})")
    if claim["evidence"] not in EVIDENCE:
        err(f"{where} ({claim['id']}): evidence {claim['evidence']!r} not in {sorted(EVIDENCE)}")
    if not set(claim["recipes"]) <= RECIPE_IDS:
        err(f"{where} ({claim['id']}): recipes {claim['recipes']!r} not in {sorted(RECIPE_IDS)}")
    if not claim["cite"].strip():
        err(f"{where} ({claim['id']}): empty cite")


def dossier_anchor_ids() -> set[str]:
    import re
    ids: set[str] = set()
    for part in sorted((ROOT / "mendes").glob("content-*.html")):
        ids.update(re.findall(r'id="([^"]+)"', part.read_text(encoding="utf-8")))
    return ids


def check_ingredient(ingredient: dict, where: str, seen_claims: set[str],
                     anchor_ids: set[str]) -> None:
    for field in ("id", "greek", "translit", "gloss", "dossierAnchor", "recipes", "claims"):
        if field not in ingredient:
            err(f"{where}: missing field {field!r}")
            return
    if ingredient["dossierAnchor"] not in anchor_ids:
        err(f"{where} ({ingredient['id']}): dossierAnchor "
            f"{ingredient['dossierAnchor']!r} not found in mendes/content-*.html")
    if not ingredient["claims"] and "unlocated" not in ingredient:
        err(f"{where} ({ingredient['id']}): no claims and no unlocated note")
    for claim in ingredient["claims"]:
        check_claim(claim, f"{where} {ingredient['id']}", seen_claims)


def main() -> None:
    data = json.loads(CLAIMS_PATH.read_text(encoding="utf-8"))
    for key in ("recipes", "ingredients", "contextIngredients", "theology",
                "ingredientGroups", "ingredientGroupShortLabels", "court"):
        if key not in data:
            sys.exit(f"claims.json: missing top-level key {key!r}")

    if set(data["recipes"]) != RECIPE_IDS:
        err(f"recipes keys {sorted(data['recipes'])} != {sorted(RECIPE_IDS)}")

    seen_claims: set[str] = set()
    anchor_ids = dossier_anchor_ids()
    all_ingredients = data["ingredients"] + data["contextIngredients"] + [data["theology"]]
    seen_ing: set[str] = set()
    for ingredient in all_ingredients:
        check_ingredient(ingredient, "ingredient", seen_claims, anchor_ids)
        if ingredient["id"] in seen_ing:
            err(f"duplicate ingredient id {ingredient['id']!r}")
        seen_ing.add(ingredient["id"])

    grouped = {i for g in data["ingredientGroups"] for i in g["ids"]}
    if missing := grouped - seen_ing:
        err(f"ingredientGroups reference unknown ids: {sorted(missing)}")
    if ungrouped := seen_ing - grouped:
        err(f"ingredients missing from ingredientGroups: {sorted(ungrouped)}")
    if set(data["ingredientGroupShortLabels"]) != {g["id"] for g in data["ingredientGroups"]}:
        err("ingredientGroupShortLabels keys do not match ingredientGroups ids")

    # Court records against the stamped queens dataset.
    pqf = json.loads(PQF_PATH.read_text(encoding="utf-8"))
    pqf_ids = {r["id"] for r in pqf["records"]}
    court_pqf_ids = set()
    seen_court: set[str] = set()
    for record in data["court"]:
        where = f"court {record.get('id', '?')}"
        for field in ("id", "pqfId", "kind", "subtype", "queen", "queenConfidence",
                      "olfactoryRelevance", "aromatics", "places", "cite", "source"):
            if field not in record:
                err(f"{where}: missing field {field!r}")
        if record["id"] in seen_court:
            err(f"{where}: duplicate court id")
        seen_court.add(record["id"])
        court_pqf_ids.add(record["pqfId"])
        if record["pqfId"] not in pqf_ids:
            err(f"{where}: pqfId {record['pqfId']!r} not in the queens dataset")
        if record["kind"] not in COURT_KINDS:
            err(f"{where}: kind {record['kind']!r} not in {sorted(COURT_KINDS)}")
        if record["olfactoryRelevance"] not in OLFACTORY:
            err(f"{where}: olfactoryRelevance {record['olfactoryRelevance']!r} invalid")
        for aromatic in record["aromatics"]:
            if aromatic.get("ref") is not None and aromatic["ref"] not in seen_ing:
                err(f"{where}: aromatic ref {aromatic['ref']!r} is not an ingredient id")
        for place in record["places"]:
            check_coord(place.get("coord"), f"{where} place {place.get('name')!r}")
    if unmapped := pqf_ids - court_pqf_ids:
        err(f"queens records missing from court (rerun scripts/build_mendes_court_claims.py): {sorted(unmapped)}")

    claim_count = sum(len(i["claims"]) for i in all_ingredients)
    if errors:
        print(f"claims.json: {len(errors)} problem(s)", file=sys.stderr)
        for e in errors:
            print(" -", e, file=sys.stderr)
        sys.exit(1)
    print(f"claims.json OK: {len(data['ingredients'])} ingredients, "
          f"{claim_count} provenance claims, {len(data['court'])} court records")


if __name__ == "__main__":
    main()
