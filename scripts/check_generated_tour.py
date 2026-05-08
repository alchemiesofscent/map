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
DEFAULT_REVIEW_SEQUENCE = ROOT / "data" / "review" / "section_place_sequence.json"


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


def normalize_name(value: Any) -> str:
    return " ".join(str(value or "").casefold().split())


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dir", type=Path, default=DEFAULT_DIR)
    parser.add_argument("--review-sequence", type=Path, default=DEFAULT_REVIEW_SEQUENCE)
    args = parser.parse_args()

    errors: list[str] = []
    places_path = args.dir / "places_authority.json"
    sections_path = args.dir / "raw_sections.json"
    journey_path = args.dir / "journey_route.json"
    route_views_path = args.dir / "route_views.json"

    for path in [places_path, sections_path, journey_path, route_views_path]:
        if not path.exists():
            fail(errors, f"Missing generated file: {path}")
    if errors:
        for error in errors:
            print(f"- {error}", file=sys.stderr)
        return 1

    places = load(places_path)
    sections = load(sections_path)
    journey = load(journey_path)
    route_views = load(route_views_path)
    review_sequence = load(args.review_sequence) if args.review_sequence.exists() else {"sections": []}

    place_keys = [p.get("place_key") for p in places]
    section_ids = [s.get("chunk_id") for s in sections]
    place_key_set = set(place_keys)
    section_id_set = set(section_ids)

    if len(place_key_set) != len(place_keys):
        fail(errors, "Duplicate place_key in generated authority")
    if len(section_id_set) != len(section_ids):
        fail(errors, "Duplicate chunk_id in generated raw sections")
    if len(sections) != 66:
        fail(errors, f"Expected 66 raw sections, found {len(sections)}")

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

    views = route_views.get("views") or {}
    for view_id in ["all", "western", "eastern"]:
        if view_id not in views:
            fail(errors, f"route_views missing {view_id} view")
    expected_ranges = {
        "all": {"start_section": 1, "end_section": 66},
        "western": {"start_section": 1, "end_section": 18},
        "eastern": {"start_section": 19, "end_section": 66},
    }
    for view_id, expected_range in expected_ranges.items():
        view = views.get(view_id) or {}
        if view.get("section_range") != expected_range:
            fail(errors, f"{view_id}: expected section_range {expected_range}, found {view.get('section_range')}")

    all_routes = {
        site.get("route_key")
        for view in views.values()
        for site in view.get("sites", [])
        if site.get("route_key")
    }
    if not {"western", "eastern"} <= all_routes:
        fail(errors, f"route labels were not normalized to western/eastern: {sorted(all_routes)}")

    all_sites = views.get("all", {}).get("sites", [])
    all_site_keys = {site.get("site_key") for site in all_sites}
    drawable_keys = {
        point.get("site_key")
        for view in views.values()
        for point in view.get("drawable_line_points", [])
    }
    if len(all_site_keys) != len(all_sites):
        fail(errors, "Duplicate site_key in route_views all view")
    for site in all_sites:
        key = site.get("site_key")
        lat = site.get("lat")
        lon = site.get("lon")
        check_coordinate(errors, key or "route view site", lat, lon)
        if site.get("has_geometry"):
            if key not in drawable_keys:
                fail(errors, f"{key}: mapped route site missing from drawable_line_points")
        elif key in drawable_keys:
            fail(errors, f"{key}: null-geometry route site appears in drawable_line_points")

    expected_unmapped = {"Akabaru", "Khrusē Island", "Thina"}
    present_unmapped = {
        site.get("source_name")
        for site in all_sites
        if not site.get("has_geometry")
    }
    if not expected_unmapped <= present_unmapped:
        fail(errors, f"Expected unmapped route sites {sorted(expected_unmapped)}, found {sorted(present_unmapped)}")

    reviewed_sections = review_sequence.get("sections") or []
    allowed_review_statuses = {"draft", "reviewed", "needs_followup"}
    allowed_geometry_policies = {"mapped", "intentionally_unmapped", "needs_followup"}
    focus_names_by_section: dict[int, set[str]] = {}

    for review in reviewed_sections:
        section_order = review.get("section_order")
        section_id = f"section_{section_order:04d}" if isinstance(section_order, int) else None
        if section_id not in section_id_set:
            fail(errors, f"review section {section_order}: missing raw section {section_id}")
        if review.get("review_status") not in allowed_review_statuses:
            fail(errors, f"review section {section_order}: invalid review_status {review.get('review_status')}")
        focus_names: set[str] = set()
        for index, item in enumerate(review.get("visit_sequence") or [], start=1):
            label = item.get("display_name") or f"focus item {index}"
            focus_names.add(normalize_name(label))
            route_site_key = item.get("route_site_key")
            policy = item.get("geometry_policy")
            if route_site_key and route_site_key not in all_site_keys:
                fail(errors, f"review section {section_order} {label}: unknown route_site_key {route_site_key}")
            if policy not in allowed_geometry_policies:
                fail(errors, f"review section {section_order} {label}: invalid geometry_policy {policy}")
            if not route_site_key and policy not in {"intentionally_unmapped", "needs_followup"}:
                fail(errors, f"review section {section_order} {label}: unmapped focus needs intentional policy")
        focus_names_by_section[section_order] = focus_names
        for context in review.get("context_places") or []:
            context_name = normalize_name(context.get("display_name"))
            if context_name in focus_names:
                fail(errors, f"review section {section_order}: context place also appears as focus {context.get('display_name')}")

    all_section_focus = views.get("all", {}).get("section_focus") or []
    section_focus_by_order = {item.get("section_order"): item for item in all_section_focus}
    for review in reviewed_sections:
        section_order = review.get("section_order")
        generated = section_focus_by_order.get(section_order)
        if not generated:
            fail(errors, f"route_views all view missing section_focus for reviewed section {section_order}")
            continue
        expected_labels = [item.get("display_name") for item in review.get("visit_sequence") or []]
        generated_labels = [item.get("display_name") for item in generated.get("focus_sequence") or []]
        if generated_labels != expected_labels:
            fail(errors, f"section {section_order}: generated focus sequence {generated_labels} != reviewed {expected_labels}")
        for focus in generated.get("focus_sequence") or []:
            status = focus.get("mapping_status")
            if status not in {"mapped", "unmapped", "intentionally_unmapped", "needs_followup"}:
                fail(errors, f"section {section_order} {focus.get('display_name')}: invalid mapping_status {status}")
            if status == "mapped" and not focus.get("route_site_key"):
                fail(errors, f"section {section_order} {focus.get('display_name')}: mapped focus lacks route_site_key")
            if focus.get("route_site_key") and focus.get("route_site_key") not in all_site_keys:
                fail(errors, f"section {section_order} {focus.get('display_name')}: generated unknown route_site_key {focus.get('route_site_key')}")
        generated_focus_names = {normalize_name(item.get("display_name")) for item in generated.get("focus_sequence") or []}
        for context in generated.get("context_places") or []:
            if normalize_name(context.get("display_name")) in generated_focus_names:
                fail(errors, f"section {section_order}: generated context place also appears as focus {context.get('display_name')}")

    if errors:
        print("Generated tour check failed:")
        for error in errors:
            print(f"- {error}")
        return 1

    mapped = sum(1 for p in places if p.get("lat") is not None and p.get("lon") is not None)
    print(
        "Generated tour check passed. "
        f"{len(sections)} sections, {len(places)} places ({mapped} mapped), "
        f"{len(journey.get('steps', []))} steps, {len(journey.get('legs', []))} legs, "
        f"{len(all_sites)} route-view sites."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
