#!/usr/bin/env python3
"""Build selectable Periplus route-view data from the reviewed webmap scrape."""
from __future__ import annotations

import argparse
import json
import math
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
DEFAULT_PLEIADES_DIR = ROOT / "data" / "pleiades"
DEFAULT_OVERRIDE_LOG = ROOT / "generated" / "coords_overrides.txt"

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


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    radius = 6371.0
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lambda = math.radians(lon2 - lon1)
    a = math.sin(delta_phi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(delta_lambda / 2) ** 2
    return 2 * radius * math.asin(math.sqrt(a))


def load_pleiades_overrides(pleiades_dir: Path) -> dict[str, tuple[float, float]]:
    """Map pleiades_id (str) → (lat, lon) from cached snapshot reprPoints.

    Pleiades stores reprPoint as [lon, lat] (GeoJSON convention)."""
    overrides: dict[str, tuple[float, float]] = {}
    if not pleiades_dir.exists():
        return overrides
    for path in sorted(pleiades_dir.glob("*.json")):
        try:
            with path.open(encoding="utf-8") as f:
                payload = json.load(f)
        except (OSError, json.JSONDecodeError):
            continue
        repr_point = payload.get("reprPoint")
        if not repr_point or len(repr_point) != 2:
            continue
        try:
            lon, lat = float(repr_point[0]), float(repr_point[1])
        except (TypeError, ValueError):
            continue
        overrides[path.stem] = (lat, lon)
    return overrides


def site_from_record(
    record: dict[str, Any],
    pleiades_overrides: dict[str, tuple[float, float]],
    override_log: list[dict[str, Any]],
) -> dict[str, Any]:
    route_key = normalize_route(record.get("route"))
    source_order = record.get("source_order")
    source_name = (record.get("source_name") or record.get("input_name") or "site").strip()
    scrape_lat = record.get("lat")
    scrape_lon = record.get("lon")
    pleiades_id = record.get("pleiades_id")

    coords_source = "webmap_scrape"
    drift_km: float | None = None
    pid_str = str(pleiades_id) if pleiades_id else None
    if pid_str and pid_str in pleiades_overrides:
        lat, lon = pleiades_overrides[pid_str]
        coords_source = "pleiades_reprPoint"
        if isinstance(scrape_lat, (int, float)) and isinstance(scrape_lon, (int, float)):
            drift_km = haversine_km(scrape_lat, scrape_lon, lat, lon)
    else:
        lat = scrape_lat
        lon = scrape_lon

    has_geometry = isinstance(lat, (int, float)) and isinstance(lon, (int, float))
    site_key = f"{route_key}_{int(source_order):04d}_{slugify(source_name)}"

    if coords_source == "pleiades_reprPoint":
        override_log.append(
            {
                "site_key": site_key,
                "source_name": source_name,
                "pleiades_id": pid_str,
                "scrape_lat": scrape_lat,
                "scrape_lon": scrape_lon,
                "pleiades_lat": lat,
                "pleiades_lon": lon,
                "drift_km": drift_km,
            }
        )

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
        "coords_source": coords_source,
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


def build(
    scrape_path: Path,
    section_sequence_path: Path,
    pleiades_dir: Path,
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    scrape = load_json(scrape_path)
    section_reviews = load_section_reviews(section_sequence_path)
    records = scrape.get("records", [])
    pleiades_overrides = load_pleiades_overrides(pleiades_dir)
    override_log: list[dict[str, Any]] = []
    sites = [site_from_record(record, pleiades_overrides, override_log) for record in records]
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
            "pleiades_snapshot_dir": display_path(pleiades_dir) if pleiades_dir.exists() else None,
            "pleiades_override_count": len(override_log),
            "webmap_url": scrape.get("source", {}).get("webmap_url"),
            "location_page_base_url": scrape.get("source", {}).get("location_page_base_url"),
            "record_count": len(records),
            "notes": [
                "Route ordering and route membership are derived from the reviewed webmap scrape.",
                "Route labels are normalized to western/eastern regardless of source capitalization.",
                "Sites with null geometry remain in view metadata but are excluded from drawable line points.",
                "Per-site coordinates are taken from the cached Pleiades reprPoint when a pleiades_id resolves to data/pleiades/<id>.json; otherwise they fall back to the webmap scrape lat/lon.",
            ],
        },
        "views": views,
    }, override_log


def write_override_log(path: Path, override_log: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if not override_log:
        path.write_text(
            f"Pleiades coord overrides — generated {datetime.now(timezone.utc).isoformat(timespec='seconds')}\n"
            "(no Pleiades reprPoints applied)\n",
            encoding="utf-8",
        )
        return

    drift_buckets = {"=0": 0, "<1km": 0, "<5km": 0, "<25km": 0, ">=25km": 0, "from_unmapped": 0}
    for entry in override_log:
        d = entry.get("drift_km")
        if d is None:
            drift_buckets["from_unmapped"] += 1
        elif d == 0:
            drift_buckets["=0"] += 1
        elif d < 1:
            drift_buckets["<1km"] += 1
        elif d < 5:
            drift_buckets["<5km"] += 1
        elif d < 25:
            drift_buckets["<25km"] += 1
        else:
            drift_buckets[">=25km"] += 1

    lines: list[str] = []
    lines.append(f"Pleiades coord overrides — generated {datetime.now(timezone.utc).isoformat(timespec='seconds')}")
    lines.append(f"Total overrides: {len(override_log)}")
    lines.append(
        "Drift buckets:  "
        + ", ".join(f"{label}={count}" for label, count in drift_buckets.items())
    )
    lines.append("")
    lines.append("OVERRIDES (sorted by drift, largest first)")
    sorted_log = sorted(
        override_log,
        key=lambda e: (e.get("drift_km") if e.get("drift_km") is not None else -1),
        reverse=True,
    )
    for e in sorted_log:
        scrape = (
            f"({e['scrape_lat']:.6f}, {e['scrape_lon']:.6f})"
            if isinstance(e.get("scrape_lat"), (int, float)) and isinstance(e.get("scrape_lon"), (int, float))
            else "(unmapped)"
        )
        target = f"({e['pleiades_lat']:.6f}, {e['pleiades_lon']:.6f})"
        drift = f"drift={e['drift_km']:.2f}km" if e.get("drift_km") is not None else "drift=n/a (was unmapped)"
        lines.append(
            f"  {e['site_key']:38s} pleiades={e['pleiades_id']:>10s}  "
            f"scrape={scrape}  pleiades={target}  {drift}  ({e['source_name']})"
        )
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--scrape", type=Path, default=DEFAULT_SCRAPE)
    parser.add_argument("--section-sequence", type=Path, default=DEFAULT_SECTION_SEQUENCE)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    parser.add_argument("--pleiades-dir", type=Path, default=DEFAULT_PLEIADES_DIR)
    parser.add_argument("--override-log", type=Path, default=DEFAULT_OVERRIDE_LOG)
    args = parser.parse_args()

    try:
        data, override_log = build(args.scrape, args.section_sequence, args.pleiades_dir)
        write_json(args.out, data)
        write_override_log(args.override_log, override_log)
    except Exception as exc:
        print(f"build_route_views failed: {exc}", file=sys.stderr)
        return 1

    print(f"Wrote route views: {display_path(args.out)}")
    print(f"Pleiades overrides: {len(override_log)} → {display_path(args.override_log)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
