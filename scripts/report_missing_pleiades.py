#!/usr/bin/env python3
"""Report places mentioned in the tour that have no Pleiades record.

Walks `route_views.json::views.all.sites[]` and `places_authority.json` for
entries with `pleiades_id == null` and writes a markdown checklist to
`generated/places_without_pleiades.md`. For each entry the report includes:

- display name (+ Greek surface forms when known)
- which Periplus sections mention it (from journey_route.json)
- modern_identification / notes if available
- a pre-filled Pleiades search URL the curator can click

Stdlib only.
"""
from __future__ import annotations

import argparse
import json
import sys
import urllib.parse
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_ROUTE_VIEWS = ROOT / "data" / "generated" / "periplus" / "route_views.json"
DEFAULT_AUTHORITY = ROOT / "data" / "generated" / "periplus" / "places_authority.json"
DEFAULT_JOURNEY = ROOT / "data" / "generated" / "periplus" / "journey_route.json"
DEFAULT_OUT = ROOT / "generated" / "places_without_pleiades.md"

PLEIADES_SEARCH = "https://pleiades.stoa.org/search?SearchableText={q}"


def load_json(path: Path) -> Any:
    with path.open(encoding="utf-8") as f:
        return json.load(f)


def display_path(path: Path) -> str:
    try:
        return str(path.relative_to(ROOT))
    except ValueError:
        return str(path)


def search_url(name: str) -> str:
    return PLEIADES_SEARCH.format(q=urllib.parse.quote(name))


def sections_mentioning(place_key: str, journey: dict[str, Any]) -> list[int]:
    """Return the sorted list of section_orders that mention this place_key."""
    sections: set[int] = set()
    for step in journey.get("steps", []):
        for mention in step.get("place_mentions") or []:
            if mention.get("place_key") == place_key:
                refs = step.get("section_refs") or []
                for ref in refs:
                    digits = "".join(ch for ch in ref if ch.isdigit())
                    if digits:
                        sections.add(int(digits))
                break
    return sorted(sections)


def render_route_section(
    sites: list[dict[str, Any]],
    journey: dict[str, Any],
) -> list[str]:
    lines: list[str] = ["## On-route sites missing a Pleiades ID", ""]
    if not sites:
        lines.append("_(none — every route site has a Pleiades record)_")
        lines.append("")
        return lines
    lines.append(
        f"**{len(sites)} site(s)** appear in the route view but have no `pleiades_id`. "
        "Map coordinates come from the webmap scrape; consider hunting for a Pleiades match."
    )
    lines.append("")
    fully_unmapped = [s for s in sites if not isinstance(s.get("lat"), (int, float))]
    if fully_unmapped:
        lines.append(
            "> ⚠️ **Fully unmapped** (no lat/lon at all): "
            + ", ".join(f"`{s['source_name']}`" for s in fully_unmapped)
        )
        lines.append("")

    for site in sites:
        name = site.get("source_name") or site.get("input_name") or "(unnamed)"
        section_orders = []
        chap = site.get("periplus_chapter") or ""
        digits = [int(d) for d in __import__("re").findall(r"\d+", chap)]
        section_orders = digits or site.get("section_numbers") or []

        lines.append(f"- [ ] **{name}**  ")
        if site.get("page_metadata", {}).get("page_ancient_toponym"):
            lines.append(f"      Ancient: _{site['page_metadata']['page_ancient_toponym']}_  ")
        meta_bits = []
        if site.get("modern_identification"):
            meta_bits.append(f"modern: {site['modern_identification']}")
        if site.get("modern_country"):
            meta_bits.append(site["modern_country"])
        if site.get("location_precision"):
            meta_bits.append(f"precision: {site['location_precision']}")
        if meta_bits:
            lines.append(f"      {' · '.join(meta_bits)}  ")
        if section_orders:
            lines.append(f"      Sections: §{', §'.join(str(o) for o in section_orders)}  ")
        coord = "(unmapped)" if not isinstance(site.get("lat"), (int, float)) else f"({site['lat']}, {site['lon']})"
        lines.append(f"      Webmap coord: {coord}  ")
        lines.append(f"      [Search Pleiades →]({search_url(name)})")
        lines.append("")
    return lines


def render_authority_section(
    authority: list[dict[str, Any]],
    journey: dict[str, Any],
    on_route_keys: set[str],
) -> list[str]:
    """Authority entries with no pleiades_id, excluding those already on-route."""
    candidates: list[dict[str, Any]] = []
    for place in authority:
        if place.get("pleiades_id"):
            continue
        place_key = place.get("place_key") or ""
        if place_key in on_route_keys:
            continue
        # Only include places that are actually mentioned somewhere.
        sections = sections_mentioning(place_key, journey)
        if not sections:
            continue
        candidates.append({**place, "_sections": sections})

    lines: list[str] = ["## Authority places mentioned but not on a route", ""]
    if not candidates:
        lines.append("_(none — every mentioned authority place has a Pleiades record or is already on the route)_")
        lines.append("")
        return lines
    lines.append(
        f"**{len(candidates)} place(s)** are mentioned in the translation but lack a Pleiades record. "
        "These typically include regions, tribes, and forward references."
    )
    lines.append("")
    for place in candidates:
        name = place.get("display_name") or place.get("place_key") or "(unnamed)"
        lines.append(f"- [ ] **{name}**  ")
        if place.get("greek_names"):
            lines.append(f"      Greek: _{', '.join(place['greek_names'])}_  ")
        if place.get("place_type"):
            lines.append(f"      Type: {place['place_type']}  ")
        if place.get("notes"):
            note = place["notes"]
            if len(note) > 160:
                note = note[:157] + "…"
            lines.append(f"      Notes: {note}  ")
        lines.append(f"      Sections: §{', §'.join(str(o) for o in place['_sections'])}  ")
        lines.append(f"      [Search Pleiades →]({search_url(name)})")
        lines.append("")
    return lines


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--route-views", type=Path, default=DEFAULT_ROUTE_VIEWS)
    parser.add_argument("--authority", type=Path, default=DEFAULT_AUTHORITY)
    parser.add_argument("--journey", type=Path, default=DEFAULT_JOURNEY)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    args = parser.parse_args()

    if not args.route_views.exists():
        print(f"Missing {display_path(args.route_views)} — run scripts/build_route_views.py first", file=sys.stderr)
        return 1
    if not args.authority.exists():
        print(f"Missing {display_path(args.authority)} — run scripts/ingest_tour_chunk.py first", file=sys.stderr)
        return 1
    if not args.journey.exists():
        print(f"Missing {display_path(args.journey)} — run scripts/ingest_tour_chunk.py first", file=sys.stderr)
        return 1

    route_views = load_json(args.route_views)
    authority = load_json(args.authority)
    journey = load_json(args.journey)

    sites = (route_views.get("views") or {}).get("all", {}).get("sites", [])
    on_route_no_pleiades = [s for s in sites if not s.get("pleiades_id")]

    # Names already covered by route sites — used to dedupe authority section.
    on_route_keys: set[str] = set()
    for s in sites:
        # We dedupe by both place_key (if any) and a slugified source_name as a heuristic.
        if s.get("source_name"):
            on_route_keys.add(s["source_name"].casefold().replace(" ", "_"))

    lines: list[str] = []
    lines.append("# Periplus places without Pleiades records")
    lines.append("")
    lines.append(f"_Generated {datetime.now(timezone.utc).isoformat(timespec='seconds')} by `scripts/report_missing_pleiades.py`._")
    lines.append("")
    lines.append("Use this checklist to hunt for Pleiades IDs. When you find one:")
    lines.append("")
    lines.append("1. Add `pleiades_id` and `pleiades_uri` to the entry in `data/places_authority.sample.json`.")
    lines.append("2. Run `python3 scripts/refresh_pleiades.py` to fetch the snapshot into `data/pleiades/`.")
    lines.append("3. Run `python3 scripts/apply_pleiades_coords.py` to push the reprPoint coords back into the authority.")
    lines.append("4. Re-run the build pipeline (`ingest_tour_chunk` → `build_route_views`).")
    lines.append("")
    lines.extend(render_route_section(on_route_no_pleiades, journey))
    lines.extend(render_authority_section(authority, journey, on_route_keys))

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text("\n".join(lines).rstrip() + "\n", encoding="utf-8")

    print(
        f"Wrote {display_path(args.out)} — "
        f"on-route gaps: {len(on_route_no_pleiades)}, "
        f"authority gaps: {sum(1 for p in authority if not p.get('pleiades_id') and sections_mentioning(p.get('place_key',''), journey))}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
