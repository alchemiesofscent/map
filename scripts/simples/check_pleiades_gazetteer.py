#!/usr/bin/env python3
"""Validate the simples Pleiades gazetteer artifact."""
from __future__ import annotations

from pathlib import Path

from provenance_common import GAZETTEER_PATH, REPO_ROOT, load_json, validate_schema


SCHEMA_PATH = REPO_ROOT / "schemas" / "simples" / "pleiades-gazetteer.schema.json"


def main() -> None:
    payload = load_json(GAZETTEER_PATH)
    validate_schema(payload, SCHEMA_PATH)
    places = payload["places"]
    lookup_index = payload["lookup_index"]
    ambiguous = payload["ambiguous_lookup_keys"]
    for key, ids in lookup_index.items():
        if not key:
            raise AssertionError("empty lookup key")
        if not ids:
            raise AssertionError(f"{key}: empty Pleiades id list")
        for pid in ids:
            if pid not in places:
                raise AssertionError(f"{key}: unknown Pleiades id {pid}")
    computed_ambiguous = {key: ids for key, ids in lookup_index.items() if len(ids) > 1}
    if set(computed_ambiguous) != set(ambiguous):
        raise AssertionError("ambiguous_lookup_keys does not match lookup_index")
    for pid, place in places.items():
        if place["pleiades_id"] != pid:
            raise AssertionError(f"{pid}: pleiades_id mismatch")
        if not place.get("lookup_keys"):
            raise AssertionError(f"{pid}: no lookup keys")
    counts = payload["counts"]
    missing_spots = [
        label for label, result in payload["spot_checks"].items() if not result["matched_pleiades_ids"]
    ]
    print("Gazetteer validates against schema")
    print(f"Pleiades places: {counts['total_pleiades_place_rows']}")
    print(f"Lookup names: {counts['total_lookup_names']}")
    print(f"Greek-script names: {counts['greek_script_names']}")
    print(f"Transliterated names: {counts['transliterated_names']}")
    print(f"Ambiguous lookup keys: {counts['ambiguous_lookup_keys']}")
    if missing_spots:
        print(f"Spot-check warnings: no direct key for {', '.join(missing_spots)}")
    else:
        print("Spot-checks found expected names")


if __name__ == "__main__":
    main()
