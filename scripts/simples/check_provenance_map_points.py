#!/usr/bin/env python3
"""Validate map-ready provenance points."""
from __future__ import annotations

from provenance_common import (
    DEPRECATED_ARABIA_PLEIADES_ID,
    LINKS_PATH,
    MAP_POINTS_PATH,
    REPO_ROOT,
    load_json,
    validate_schema,
)


SCHEMA_PATH = REPO_ROOT / "schemas" / "simples" / "provenance-map-points.schema.json"


def main() -> None:
    payload = load_json(MAP_POINTS_PATH)
    validate_schema(payload, SCHEMA_PATH)
    links = {link["link_id"]: link for link in load_json(LINKS_PATH)["links"]}
    point_ids: set[str] = set()
    for point in payload["points"]:
        point_id = point["map_point_id"]
        if point_id in point_ids:
            raise AssertionError(f"duplicate map_point_id {point_id}")
        point_ids.add(point_id)
        if not point.get("coordinate_source"):
            raise AssertionError(f"{point_id}: coordinate_source missing")
        if point["group_key"]["pleiades_id"] == DEPRECATED_ARABIA_PLEIADES_ID:
            raise AssertionError(f"{point_id}: Arabia provenance must not emit 981506")
        for link_id in point["link_ids"]:
            if link_id not in links:
                raise AssertionError(f"{point_id}: unknown link {link_id}")
    print("Map-ready provenance points validate against schema")
    print(f"Map points: {payload['counts']['map_points']}")
    print(f"Null-coordinate points: {payload['counts']['null_coordinate_points']}")
    print(f"Broad-region points: {payload['counts']['broad_region_points']}")


if __name__ == "__main__":
    main()
