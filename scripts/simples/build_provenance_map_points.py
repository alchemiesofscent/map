#!/usr/bin/env python3
"""Convert accepted provenance links into map-ready points."""
from __future__ import annotations

from collections import defaultdict
from typing import Any

from provenance_common import GAZETTEER_PATH, LINKS_PATH, MAP_POINTS_PATH, load_json, rel, stable_id, write_json


BROAD_FEATURE_HINTS = {"region", "province", "island", "label", "people", "tribe", "ethnic"}


def is_broad_region(place: dict[str, Any]) -> bool:
    feature_types = " ".join(place.get("feature_types", [])).lower()
    return any(hint in feature_types for hint in BROAD_FEATURE_HINTS)


def main() -> None:
    links = load_json(LINKS_PATH)["links"]
    places = load_json(GAZETTEER_PATH)["places"]
    groups: dict[tuple[str, str, str, str, str], list[dict[str, Any]]] = defaultdict(list)
    for link in links:
        key = (
            link["accepted_pleiades_id"],
            link["ingredient_key"],
            link["relation"],
            link["entry_id"],
            link.get("claim_id", link["link_id"]),
        )
        groups[key].append(link)

    points = []
    for (pid, ingredient_key, relation, entry_id, claim_id), grouped_links in sorted(groups.items()):
        place = places[pid]
        coords = place.get("coordinates") or {}
        lat = coords.get("lat")
        lon = coords.get("lon")
        coordinate_source = "pleiades_repr_point" if lat is not None and lon is not None else "none"
        broad = is_broad_region(place)
        precision = place.get("location_precision", "")
        points.append(
            {
                "map_point_id": stable_id("map-point", pid, ingredient_key, relation, entry_id, claim_id),
                "group_key": {
                    "pleiades_id": pid,
                    "ingredient_key": ingredient_key,
                    "relation": relation,
                    "entry_id": entry_id,
                    "claim_id": claim_id,
                },
                "place_label": place.get("title", ""),
                "pleiades_uri": place.get("pleiades_uri", ""),
                "coordinates": {"lat": lat, "lon": lon},
                "coordinate_source": coordinate_source,
                "location_precision": precision,
                "is_broad_region": broad,
                "has_uncertain_coordinates": coordinate_source == "none" or precision not in {"", "precise"},
                "link_ids": [link["link_id"] for link in grouped_links],
                "links": grouped_links,
            }
        )

    payload = {
        "metadata": {
            "artifact_id": "simples-provenance-map-points",
            "stage": "stage_6_map_ready_output",
            "source_links_path": rel(LINKS_PATH),
            "notes": [
                "Map points derive only from accepted provenance links.",
                "Broad regions and uncertain coordinates are flagged rather than treated as precise points.",
            ],
        },
        "counts": {
            "accepted_links_in": len(links),
            "map_points": len(points),
            "null_coordinate_points": sum(1 for point in points if point["coordinate_source"] == "none"),
            "broad_region_points": sum(1 for point in points if point["is_broad_region"]),
        },
        "points": points,
    }
    write_json(MAP_POINTS_PATH, payload)
    print(f"Wrote {rel(MAP_POINTS_PATH)}")
    print(f"Accepted links in: {len(links)}")
    print(f"Map points: {len(points)}")
    print(f"Null-coordinate points: {payload['counts']['null_coordinate_points']}")
    print(f"Broad-region points: {payload['counts']['broad_region_points']}")


if __name__ == "__main__":
    main()
