#!/usr/bin/env python3
"""Export starter map layers as GeoJSON.

Outputs:
- generated/places.geojson
- generated/main_route.geojson
- generated/movements.geojson
"""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
OUT = ROOT / "generated"
OUT.mkdir(exist_ok=True)


def load(name: str):
    with (DATA / name).open(encoding="utf-8") as f:
        return json.load(f)


def write(name: str, obj) -> None:
    with (OUT / name).open("w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=2)
        f.write("\n")


def point_feature(place):
    return {
        "type": "Feature",
        "geometry": {"type": "Point", "coordinates": [place["lon"], place["lat"]]},
        "properties": {k: v for k, v in place.items() if k not in {"lat", "lon"}},
    }


def main() -> None:
    places = load("places_authority.sample.json")
    legs = load("route_legs.sample.json")
    movements = load("movements.sample.json")
    by_key = {p["place_key"]: p for p in places}

    place_features = [point_feature(p) for p in places if p["lat"] is not None and p["lon"] is not None]
    write("places.geojson", {"type": "FeatureCollection", "features": place_features})

    route_features = []
    for leg in legs:
        a, b = by_key[leg["from_place_key"]], by_key[leg["to_place_key"]]
        if None in (a["lat"], a["lon"], b["lat"], b["lon"]):
            continue
        route_features.append({
            "type": "Feature",
            "geometry": {"type": "LineString", "coordinates": [[a["lon"], a["lat"]], [b["lon"], b["lat"]]]},
            "properties": leg,
        })
    write("main_route.geojson", {"type": "FeatureCollection", "features": route_features})

    movement_features = []
    for m in movements:
        coords = []
        for key in m["polyline_place_keys"]:
            p = by_key[key]
            if p["lat"] is not None and p["lon"] is not None:
                coords.append([p["lon"], p["lat"]])
        if len(coords) >= 2:
            movement_features.append({
                "type": "Feature",
                "geometry": {"type": "LineString", "coordinates": coords},
                "properties": m,
            })
    write("movements.geojson", {"type": "FeatureCollection", "features": movement_features})

    print(f"Wrote {len(place_features)} places, {len(route_features)} route legs, {len(movement_features)} movements to {OUT}")


if __name__ == "__main__":
    main()
