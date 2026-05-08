#!/usr/bin/env python3
"""Apply reviewed place-coordinate decisions to generated Periplus data."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_LEDGER = ROOT / "data" / "review" / "place_candidate_decisions.json"
DEFAULT_DIR = ROOT / "data" / "generated" / "periplus"
VISUAL_STATUSES = {"accepted", "accepted_reuse", "accepted_visual_anchor"}
UNMAPPED_STATUSES = {"deferred_polygon_review", "deferred_review", "rejected"}


def load_json(path: Path) -> Any:
    with path.open(encoding="utf-8") as f:
        return json.load(f)


def write_json(path: Path, data: Any) -> None:
    with path.open("w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")


def display_path(path: Path) -> str:
    try:
        return str(path.relative_to(ROOT))
    except ValueError:
        return str(path)


def candidate_label(decision: dict[str, Any]) -> str:
    label = decision.get("candidate_label")
    source = decision.get("candidate_source") or "review ledger"
    if label:
        return f"{source} candidate '{label}'"
    return str(source)


def review_source(decision: dict[str, Any]) -> str:
    return (
        f"Reviewed visual coordinate aid from {candidate_label(decision)} "
        f"({decision['decision_id']}). Not a Pleiades identification."
    )


def unmapped_source(decision: dict[str, Any]) -> str:
    status = str(decision.get("status", "reviewed"))
    note = decision.get("review_note")
    base = f"Intentionally unmapped after review ({status}; {decision['decision_id']})."
    return f"{base} {note}" if note else base


def pleiades_source(decision: dict[str, Any]) -> str:
    note = decision.get("review_note")
    base = f"Reviewer-accepted Pleiades URI ({decision['decision_id']}); coordinates pending review."
    return f"{base} {note}" if note else base


def infer_place_type(decision: dict[str, Any]) -> str:
    text = f"{decision.get('source_place_label') or ''} {decision.get('source_role') or ''}".casefold()
    if "island" in text:
        return "island"
    if "harbor" in text or "port" in text or "anchorage" in text:
        return "port"
    if any(token in text for token in ["region", "country", "territory", "mainland", "kingdom", "bay"]):
        return "region"
    if "city" in text or "metropolis" in text:
        return "settlement"
    return "route_marker"


def make_place(decision: dict[str, Any]) -> dict[str, Any]:
    greek = decision.get("source_greek_surface")
    label = decision.get("source_place_label") or decision["generated_place_key"]
    place = {
        "place_key": decision["generated_place_key"],
        "display_name": label,
        "greek_names": [greek] if greek else [],
        "aliases": [label],
        "place_type": infer_place_type(decision),
        "lat": None,
        "lon": None,
        "certainty": "low",
        "pleiades_id": None,
        "pleiades_uri": None,
        "coordinates_source": "Created from review ledger; pending decision application.",
        "notes": f"Generated from review ledger decision {decision['decision_id']} for section {decision.get('section_order')}.",
    }
    apply_decision(place, decision)
    return place


def apply_decision(place: dict[str, Any], decision: dict[str, Any]) -> bool:
    status = decision.get("status")
    before = json.dumps(place, sort_keys=True, ensure_ascii=False)

    if status in VISUAL_STATUSES and decision.get("candidate_pleiades_id"):
        place["pleiades_id"] = decision.get("candidate_pleiades_id")
        place["pleiades_uri"] = decision.get("candidate_pleiades_uri")
        place["lat"] = decision.get("candidate_lat")
        place["lon"] = decision.get("candidate_lon")
        place["coordinates_source"] = pleiades_source(decision)
    elif status in VISUAL_STATUSES:
        place["lat"] = decision.get("candidate_lat")
        place["lon"] = decision.get("candidate_lon")
        place["coordinates_source"] = review_source(decision)
    elif status == "accepted_pleiades":
        place["pleiades_id"] = decision.get("candidate_pleiades_id")
        place["pleiades_uri"] = decision.get("candidate_pleiades_uri")
        place["lat"] = decision.get("candidate_lat")
        place["lon"] = decision.get("candidate_lon")
        place["coordinates_source"] = pleiades_source(decision)
    elif status in UNMAPPED_STATUSES:
        place["lat"] = None
        place["lon"] = None
        place["coordinates_source"] = unmapped_source(decision)
    elif status == "skipped":
        if decision.get("candidate_source") == "curated_authority":
            return False
        place["lat"] = None
        place["lon"] = None
        place["coordinates_source"] = unmapped_source(decision)
    else:
        return False

    return before != json.dumps(place, sort_keys=True, ensure_ascii=False)


def add_raw_section_place(raw_sections: list[dict[str, Any]], decision: dict[str, Any]) -> bool:
    section = next(
        (item for item in raw_sections if item.get("section_order") == decision.get("section_order")),
        None,
    )
    if not section:
        return False
    key = decision.get("generated_place_key")
    places = section.setdefault("places", [])
    if any(place.get("generated_place_key") == key or place.get("english_label") == decision.get("source_place_label") for place in places):
        return False
    places.append(
        {
            "english_label": decision.get("source_place_label"),
            "greek_surface": decision.get("source_greek_surface"),
            "role": decision.get("source_role"),
            "generated_place_key": key,
            "notes": f"Added from review ledger decision {decision['decision_id']}.",
        }
    )
    return True


def add_step_mentions(journey: dict[str, Any], raw_sections: list[dict[str, Any]], decision: dict[str, Any]) -> int:
    section = next(
        (item for item in raw_sections if item.get("section_order") == decision.get("section_order")),
        None,
    )
    if not section:
        return 0
    chunk_id = section.get("chunk_id")
    key = decision.get("generated_place_key")
    added = 0
    for step in journey.get("steps", []):
        if chunk_id not in step.get("section_refs", []):
            continue
        mentions = step.setdefault("place_mentions", [])
        existing = {(mention.get("surface"), mention.get("place_key")) for mention in mentions}
        for surface in [decision.get("source_place_label"), decision.get("source_greek_surface")]:
            if not surface or (surface, key) in existing:
                continue
            mentions.append({"surface": surface, "place_key": key, "kind": "off_route"})
            existing.add((surface, key))
            added += 1
    return added


def apply_to_dir(data_dir: Path, decisions: list[dict[str, Any]]) -> tuple[int, int, int, int, int]:
    places_path = data_dir / "places_authority.json"
    if not places_path.exists():
        raise FileNotFoundError(f"Missing generated places file: {places_path}")

    raw_sections_path = data_dir / "raw_sections.json"
    journey_path = data_dir / "journey_route.json"
    places = load_json(places_path)
    raw_sections = load_json(raw_sections_path) if raw_sections_path.exists() else []
    journey = load_json(journey_path) if journey_path.exists() else {"steps": []}
    section_orders = {section.get("section_order") for section in raw_sections}
    by_key = {place.get("place_key"): place for place in places}
    applied = 0
    created = 0
    missing = 0
    no_key = 0
    added_mentions = 0

    for decision in decisions:
        key = decision.get("generated_place_key")
        if not key:
            no_key += 1
            continue
        place = by_key.get(key)
        if place is None:
            if decision.get("section_order") not in section_orders or decision.get("status") == "skipped":
                missing += 1
                continue
            place = make_place(decision)
            places.append(place)
            by_key[key] = place
            created += 1
        else:
            if apply_decision(place, decision):
                applied += 1
        if add_raw_section_place(raw_sections, decision):
            applied += 1
        added_mentions += add_step_mentions(journey, raw_sections, decision)

    write_json(places_path, places)
    if raw_sections_path.exists():
        write_json(raw_sections_path, raw_sections)
    if journey_path.exists():
        write_json(journey_path, journey)
    return applied, created, missing, no_key, added_mentions


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ledger", type=Path, default=DEFAULT_LEDGER)
    parser.add_argument(
        "--dir",
        dest="dirs",
        type=Path,
        action="append",
        default=[],
        help="Generated data directory to patch. May be supplied more than once.",
    )
    parser.add_argument("--max-section", type=int, default=32)
    args = parser.parse_args()

    ledger = load_json(args.ledger)
    decisions = [
        decision
        for decision in ledger.get("decisions", [])
        if int(decision.get("section_order", 0)) <= args.max_section
    ]
    dirs = args.dirs or [DEFAULT_DIR]

    try:
        for data_dir in dirs:
            applied, created, missing, no_key, added_mentions = apply_to_dir(data_dir, decisions)
            print(
                f"{display_path(data_dir)}: applied {applied} decision updates, "
                f"created {created} places, added {added_mentions} mentions "
                f"({missing} decisions not present in this chunk, {no_key} without place keys)."
            )
    except Exception as exc:
        print(f"apply_place_review_decisions failed: {exc}", file=sys.stderr)
        return 1

    return 0


if __name__ == "__main__":
    sys.exit(main())
