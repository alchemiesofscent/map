#!/usr/bin/env python3
"""Build selectable Periplus route-view data from the reviewed webmap scrape."""
from __future__ import annotations

import argparse
import json
import re
import sys
import unicodedata
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SCRAPE = ROOT / "data" / "review" / "periplus_sites_webmap_scrape.json"
DEFAULT_SECTION_SEQUENCE = ROOT / "data" / "review" / "section_place_sequence.json"
DEFAULT_OUT = ROOT / "data" / "generated" / "periplus" / "route_views.json"

VIEW_RANGES = {
    "all": {"start_section": 1, "end_section": 66},
    "western": {"start_section": 1, "end_section": 18},
    "eastern": {"start_section": 19, "end_section": 66},
}


def load_json(path: Path) -> Any:
    with path.open(encoding="utf-8") as f:
        return json.load(f)


def write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")


def display_path(path: Path) -> str:
    try:
        return str(path.relative_to(ROOT))
    except ValueError:
        return str(path)


def strip_marks(value: str) -> str:
    decomposed = unicodedata.normalize("NFD", value)
    return "".join(ch for ch in decomposed if unicodedata.category(ch) != "Mn")


def slugify(value: str) -> str:
    value = strip_marks(value).casefold()
    value = re.sub(r"[^0-9a-z]+", "_", value).strip("_")
    return value or "site"


def normalize_route(value: str | None) -> str:
    label = (value or "").strip().casefold()
    if "western" in label:
        return "western"
    if "eastern" in label:
        return "eastern"
    return slugify(label)


def route_label(route_key: str) -> str:
    labels = {
        "all": "All",
        "western": "Western",
        "eastern": "Eastern",
    }
    return labels.get(route_key, route_key.title())


def parse_sections(chapter: str | None) -> list[int]:
    if not chapter:
        return []
    return [int(value) for value in re.findall(r"\d+", chapter)]


def site_from_record(record: dict[str, Any]) -> dict[str, Any]:
    route_key = normalize_route(record.get("route"))
    source_order = record.get("source_order")
    source_name = (record.get("source_name") or record.get("input_name") or "site").strip()
    lat = record.get("lat")
    lon = record.get("lon")
    has_geometry = isinstance(lat, (int, float)) and isinstance(lon, (int, float))
    site_key = f"{route_key}_{int(source_order):04d}_{slugify(source_name)}"
    return {
        "site_key": site_key,
        "source_order": source_order,
        "source_name": source_name,
        "input_name": record.get("input_name"),
        "route_key": route_key,
        "route_label": route_label(route_key),
        "source_route_label": record.get("route"),
        "next_on_route": record.get("next_on_route"),
        "periplus_place_type": record.get("periplus_place_type"),
        "periplus_ancient_area": record.get("periplus_ancient_area"),
        "periplus_chapter": record.get("periplus_chapter"),
        "section_numbers": parse_sections(record.get("periplus_chapter")),
        "location_precision": record.get("location_precision"),
        "location_source": record.get("location_source"),
        "pleiades_id": record.get("pleiades_id"),
        "pleiades_uri": record.get("pleiades_uri"),
        "lat": lat,
        "lon": lon,
        "has_geometry": has_geometry,
        "modern_identification": record.get("modern_identification"),
        "modern_country": record.get("modern_country"),
        "ancient_source": record.get("ancient_source"),
        "bibliography_entries": record.get("bibliography_entries") or [],
        "github_location_url": record.get("github_location_url"),
        "source_urls": record.get("source_urls") or {},
        "page_metadata": record.get("page_metadata") or {},
        "scrape_notes": record.get("scrape_notes") or [],
    }


def drawable_points(sites: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [
        {
            "site_key": site["site_key"],
            "source_order": site["source_order"],
            "lat": site["lat"],
            "lon": site["lon"],
        }
        for site in sites
        if site["has_geometry"]
    ]


def load_section_reviews(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    data = load_json(path)
    return data.get("sections", [])


def filter_sites(all_sites: list[dict[str, Any]], view_id: str) -> list[dict[str, Any]]:
    if view_id == "all":
        return list(all_sites)
    return [site for site in all_sites if site["route_key"] == view_id]


def focus_mapping_status(item: dict[str, Any], site: dict[str, Any] | None) -> str:
    policy = item.get("geometry_policy")
    if policy == "needs_followup":
        return "needs_followup"
    if policy == "intentionally_unmapped":
        return "intentionally_unmapped"
    if site and site.get("has_geometry"):
        return "mapped"
    if site:
        return "unmapped"
    return "needs_followup"


def build_section_focus(
    reviews: list[dict[str, Any]],
    view_sites: list[dict[str, Any]],
    section_range: dict[str, int],
) -> list[dict[str, Any]]:
    site_index = {site["site_key"]: site for site in view_sites}
    focused_sections: list[dict[str, Any]] = []

    for review in sorted(reviews, key=lambda item: int(item.get("section_order") or 0)):
        section_order = review.get("section_order")
        in_section_range = (
            isinstance(section_order, int)
            and section_range["start_section"] <= section_order <= section_range["end_section"]
        )
        if not in_section_range:
            continue

        section_id = f"section_{section_order:04d}"
        focus_sequence = []
        for index, item in enumerate(review.get("visit_sequence") or [], start=1):
            route_site_key = item.get("route_site_key")
            site = site_index.get(route_site_key) if route_site_key else None
            focus_sequence.append(
                {
                    "focus_id": f"{section_id}_focus_{index:02d}",
                    "section_id": section_id,
                    "section_order": section_order,
                    "focus_order": index,
                    "display_name": item.get("display_name"),
                    "source_name": item.get("source_name")
                    or (site.get("source_name") if site else None),
                    "route_site_key": route_site_key,
                    "geometry_policy": item.get("geometry_policy"),
                    "mapping_status": focus_mapping_status(item, site),
                    "has_geometry": bool(site and site.get("has_geometry")),
                    "lat": site.get("lat") if site else None,
                    "lon": site.get("lon") if site else None,
                    "note": item.get("note"),
                }
            )

        focused_sections.append(
            {
                "section_id": section_id,
                "section_order": section_order,
                "card_title": review.get("card_title"),
                "review_status": review.get("review_status"),
                "focus_sequence": focus_sequence,
                "context_places": review.get("context_places") or [],
            }
        )

    return focused_sections


def build(scrape_path: Path, section_sequence_path: Path) -> dict[str, Any]:
    scrape = load_json(scrape_path)
    section_reviews = load_section_reviews(section_sequence_path)
    records = scrape.get("records", [])
    sites = [site_from_record(record) for record in records]
    sites.sort(key=lambda site: (int(site.get("source_order") or 0), site["site_key"]))

    views: dict[str, Any] = {}
    for view_id in ["all", "western", "eastern"]:
        view_sites = filter_sites(sites, view_id)
        views[view_id] = {
            "view_id": view_id,
            "label": route_label(view_id),
            "section_range": VIEW_RANGES[view_id],
            "route_keys": ["western", "eastern"] if view_id == "all" else [view_id],
            "sites": view_sites,
            "section_focus": build_section_focus(section_reviews, view_sites, VIEW_RANGES[view_id]),
            "drawable_line_points": drawable_points(view_sites),
            "unmapped_site_keys": [site["site_key"] for site in view_sites if not site["has_geometry"]],
        }

    return {
        "schema_version": 1,
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "source": {
            "scrape_file": display_path(scrape_path),
            "section_sequence_file": display_path(section_sequence_path)
            if section_sequence_path.exists()
            else None,
            "webmap_url": scrape.get("source", {}).get("webmap_url"),
            "location_page_base_url": scrape.get("source", {}).get("location_page_base_url"),
            "record_count": len(records),
            "notes": [
                "Route ordering and route membership are derived from the reviewed webmap scrape.",
                "Route labels are normalized to western/eastern regardless of source capitalization.",
                "Sites with null geometry remain in view metadata but are excluded from drawable line points.",
            ],
        },
        "views": views,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--scrape", type=Path, default=DEFAULT_SCRAPE)
    parser.add_argument("--section-sequence", type=Path, default=DEFAULT_SECTION_SEQUENCE)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    args = parser.parse_args()

    try:
        data = build(args.scrape, args.section_sequence)
        write_json(args.out, data)
    except Exception as exc:
        print(f"build_route_views failed: {exc}", file=sys.stderr)
        return 1

    print(f"Wrote route views: {display_path(args.out)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
