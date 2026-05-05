#!/usr/bin/env python3
"""Referential integrity checks for the Periplus Tour MVP data.

This intentionally avoids external dependencies. It checks cross-file links,
coordinate shape, and basic uniqueness. It does not replace scholarly review.
"""
from __future__ import annotations

import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"


def load(name: str):
    with (DATA / name).open(encoding="utf-8") as f:
        return json.load(f)


def fail(errors: list[str], message: str) -> None:
    errors.append(message)


def main() -> int:
    errors: list[str] = []
    places = load("places_authority.sample.json")
    sections = load("raw_sections.sample.json")
    cards = load("tour_cards.sample.json")
    stops = load("tour_stops.sample.json")
    legs = load("route_legs.sample.json")
    movements = load("movements.sample.json")

    place_keys = {p["place_key"] for p in places}
    chunk_ids = {s["chunk_id"] for s in sections}

    if len(place_keys) != len(places):
        fail(errors, "Duplicate place_key in places_authority.sample.json")
    if len(chunk_ids) != len(sections):
        fail(errors, "Duplicate chunk_id in raw_sections.sample.json")

    for p in places:
        lat, lon = p.get("lat"), p.get("lon")
        if (lat is None) != (lon is None):
            fail(errors, f"{p['place_key']}: lat/lon must both be null or both be numbers")
        if lat is not None and not (-90 <= lat <= 90):
            fail(errors, f"{p['place_key']}: latitude out of range")
        if lon is not None and not (-180 <= lon <= 180):
            fail(errors, f"{p['place_key']}: longitude out of range")

    for c in cards:
        if c["chunk_id"] not in chunk_ids:
            fail(errors, f"{c['tour_card_id']}: missing chunk_id {c['chunk_id']}")
        for key in [c["focus_place_key"], *c["place_keys"]]:
            if key not in place_keys:
                fail(errors, f"{c['tour_card_id']}: unknown place_key {key}")

    for s in stops:
        if s["chunk_id"] not in chunk_ids:
            fail(errors, f"{s['tour_stop_id']}: missing chunk_id {s['chunk_id']}")
        if s["place_key"] not in place_keys:
            fail(errors, f"{s['tour_stop_id']}: unknown place_key {s['place_key']}")

    for leg in legs:
        for field in ("from_place_key", "to_place_key"):
            if leg[field] not in place_keys:
                fail(errors, f"{leg['leg_id']}: unknown {field} {leg[field]}")

    for m in movements:
        if m["chunk_id"] not in chunk_ids:
            fail(errors, f"{m['movement_id']}: missing chunk_id {m['chunk_id']}")
        for field in ("source_place_key", "destination_place_key"):
            if m[field] not in place_keys:
                fail(errors, f"{m['movement_id']}: unknown {field} {m[field]}")
        for key in [*m["via_place_keys"], *m["polyline_place_keys"]]:
            if key not in place_keys:
                fail(errors, f"{m['movement_id']}: unknown place_key in path {key}")

    if errors:
        print("Data check failed:")
        for e in errors:
            print(f"- {e}")
        return 1

    mapped = sum(1 for p in places if p["lat"] is not None and p["lon"] is not None)
    print(f"Data check passed. {len(sections)} sections, {len(places)} places ({mapped} mapped), {len(stops)} stops, {len(legs)} legs, {len(movements)} movements.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
