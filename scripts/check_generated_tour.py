#!/usr/bin/env python3
"""Validate generated Periplus scrollytelling data."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DIR = ROOT / "data" / "generated" / "periplus"


def load(path: Path) -> Any:
    with path.open(encoding="utf-8") as f:
        return json.load(f)


def fail(errors: list[str], message: str) -> None:
    errors.append(message)


def check_coordinate(errors: list[str], key: str, lat: Any, lon: Any) -> None:
    if (lat is None) != (lon is None):
        fail(errors, f"{key}: lat/lon must both be null or both be numbers")
        return
    if lat is None:
        return
    if not isinstance(lat, (int, float)) or not isinstance(lon, (int, float)):
        fail(errors, f"{key}: lat/lon must be numbers")
        return
    if not -90 <= lat <= 90:
        fail(errors, f"{key}: latitude out of range")
    if not -180 <= lon <= 180:
        fail(errors, f"{key}: longitude out of range")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dir", type=Path, default=DEFAULT_DIR)
    args = parser.parse_args()

    errors: list[str] = []
    places_path = args.dir / "places_authority.json"
    sections_path = args.dir / "raw_sections.json"
    journey_path = args.dir / "journey_route.json"

    for path in [places_path, sections_path, journey_path]:
        if not path.exists():
            fail(errors, f"Missing generated file: {path}")
    if errors:
        for error in errors:
            print(f"- {error}", file=sys.stderr)
        return 1

    places = load(places_path)
    sections = load(sections_path)
    journey = load(journey_path)

    place_keys = [p.get("place_key") for p in places]
    section_ids = [s.get("chunk_id") for s in sections]
    place_key_set = set(place_keys)
    section_id_set = set(section_ids)

    if len(place_key_set) != len(place_keys):
        fail(errors, "Duplicate place_key in generated authority")
    if len(section_id_set) != len(section_ids):
        fail(errors, "Duplicate chunk_id in generated raw sections")

    for place in places:
        key = place.get("place_key")
        if not key:
            fail(errors, "Place without place_key")
            continue
        check_coordinate(errors, key, place.get("lat"), place.get("lon"))
        if place.get("pleiades_id") and not place.get("pleiades_uri"):
            fail(errors, f"{key}: pleiades_id requires pleiades_uri")

    for section in sections:
        chunk_id = section.get("chunk_id")
        if not section.get("draft_translation"):
            fail(errors, f"{chunk_id}: missing draft_translation")
        if not section.get("greek_text"):
            fail(errors, f"{chunk_id}: missing greek_text")

    main_route = journey.get("main_route_place_keys", [])
    for key in main_route:
        if key not in place_key_set:
            fail(errors, f"main_route_place_keys references unknown place_key {key}")

    step_ids: set[str] = set()
    for step in journey.get("steps", []):
        step_id = step.get("step_id")
        if not step_id:
            fail(errors, "Step without step_id")
            continue
        if step_id in step_ids:
            fail(errors, f"Duplicate step_id {step_id}")
        step_ids.add(step_id)
        focus = step.get("focus_place_key")
        if focus and focus not in place_key_set:
            fail(errors, f"{step_id}: unknown focus_place_key {focus}")
        for ref in step.get("section_refs", []):
            if ref not in section_id_set:
                fail(errors, f"{step_id}: unknown section_ref {ref}")
        if not step.get("translation"):
            fail(errors, f"{step_id}: missing translation")
        if not step.get("greek_text"):
            fail(errors, f"{step_id}: missing greek_text")
        for mention in step.get("place_mentions", []):
            key = mention.get("place_key")
            if key not in place_key_set:
                fail(errors, f"{step_id}: mention references unknown place_key {key}")
            if not mention.get("surface"):
                fail(errors, f"{step_id}: mention without surface")

    for i, leg in enumerate(journey.get("legs", []), start=1):
        for field in ("from_place_key", "to_place_key"):
            key = leg.get(field)
            if key not in place_key_set:
                fail(errors, f"leg {i}: unknown {field} {key}")
        for ref in leg.get("section_refs", []):
            if ref not in section_id_set:
                fail(errors, f"leg {i}: unknown section_ref {ref}")

    if errors:
        print("Generated tour check failed:")
        for error in errors:
            print(f"- {error}")
        return 1

    mapped = sum(1 for p in places if p.get("lat") is not None and p.get("lon") is not None)
    print(
        "Generated tour check passed. "
        f"{len(sections)} sections, {len(places)} places ({mapped} mapped), "
        f"{len(journey.get('steps', []))} steps, {len(journey.get('legs', []))} legs."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
