#!/usr/bin/env python3
"""Convert a Google My Maps KML export to GeoJSON.

The KML is treated as non-authoritative reference data. The output sits next
to the input under data/external/google_mymaps/ and is consumed by the
scrollytelling viewer's optional external reference layer.

Stdlib only. If the input file is missing, prints a friendly note and exits 0
so this script can run unconditionally as part of a make/check pipeline.
"""
from __future__ import annotations

import argparse
import json
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_INPUT = ROOT / "data" / "external" / "google_mymaps" / "periplus_mymap.kml"
DEFAULT_OUTPUT = ROOT / "data" / "external" / "google_mymaps" / "periplus_mymap.geojson"

KML_NS = "{http://www.opengis.net/kml/2.2}"


def kml_text(node: ET.Element | None, tag: str) -> str | None:
    if node is None:
        return None
    child = node.find(f"{KML_NS}{tag}")
    if child is None or child.text is None:
        return None
    text = child.text.strip()
    return text or None


def parse_coordinates(text: str) -> list[list[float]]:
    """Parse a KML <coordinates> body into a list of [lon, lat] pairs.

    KML coordinates are whitespace-separated tuples of "lon,lat[,alt]".
    Altitude is dropped. Malformed tuples are skipped.
    """
    coords: list[list[float]] = []
    for token in text.replace("\n", " ").split():
        parts = token.split(",")
        if len(parts) < 2:
            continue
        try:
            lon = float(parts[0])
            lat = float(parts[1])
        except ValueError:
            continue
        coords.append([lon, lat])
    return coords


def geometry_from_placemark(placemark: ET.Element) -> dict | None:
    """Return the first geometry found in this Placemark, or None.

    Supports Point, LineString, Polygon (outer ring only), and MultiGeometry
    (recursively flattened to a GeometryCollection). Anything else is skipped.
    """
    point = placemark.find(f"{KML_NS}Point/{KML_NS}coordinates")
    if point is not None and point.text:
        coords = parse_coordinates(point.text)
        if coords:
            return {"type": "Point", "coordinates": coords[0]}

    line = placemark.find(f"{KML_NS}LineString/{KML_NS}coordinates")
    if line is not None and line.text:
        coords = parse_coordinates(line.text)
        if len(coords) >= 2:
            return {"type": "LineString", "coordinates": coords}

    polygon = placemark.find(
        f"{KML_NS}Polygon/{KML_NS}outerBoundaryIs/{KML_NS}LinearRing/{KML_NS}coordinates"
    )
    if polygon is not None and polygon.text:
        coords = parse_coordinates(polygon.text)
        if len(coords) >= 4:
            return {"type": "Polygon", "coordinates": [coords]}

    multi = placemark.find(f"{KML_NS}MultiGeometry")
    if multi is not None:
        sub_geometries: list[dict] = []
        for child in multi:
            wrapper = ET.Element(f"{KML_NS}Placemark")
            wrapper.append(child)
            sub = geometry_from_placemark(wrapper)
            if sub is not None:
                sub_geometries.append(sub)
        if sub_geometries:
            return {"type": "GeometryCollection", "geometries": sub_geometries}

    return None


def walk_placemarks(node: ET.Element, folder_path: list[str]) -> list[dict]:
    """Yield GeoJSON features for every Placemark under this node.

    Folder context is preserved as a path string in feature.properties.folder.
    """
    features: list[dict] = []

    if node.tag == f"{KML_NS}Folder":
        folder_name = kml_text(node, "name") or ""
        next_path = folder_path + [folder_name] if folder_name else folder_path
    else:
        next_path = folder_path

    if node.tag == f"{KML_NS}Placemark":
        geometry = geometry_from_placemark(node)
        if geometry is not None:
            properties = {
                "name": kml_text(node, "name"),
                "description": kml_text(node, "description"),
                "folder": " / ".join(next_path) if next_path else None,
                "source": "google_mymaps",
            }
            features.append(
                {
                    "type": "Feature",
                    "geometry": geometry,
                    "properties": {k: v for k, v in properties.items() if v is not None},
                }
            )

    for child in node:
        features.extend(walk_placemarks(child, next_path))

    return features


def display_path(path: Path) -> str:
    """Show paths relative to the repo root when possible, else as-is."""
    try:
        return str(path.relative_to(ROOT))
    except ValueError:
        return str(path)


def convert(input_path: Path, output_path: Path) -> int:
    if not input_path.exists():
        print(
            f"No KML found at {display_path(input_path)}. "
            "Drop a Google My Maps export there and re-run; skipping."
        )
        return 0

    try:
        tree = ET.parse(input_path)
    except ET.ParseError as exc:
        print(f"Could not parse {input_path}: {exc}", file=sys.stderr)
        return 1

    root = tree.getroot()
    features = walk_placemarks(root, [])

    output_path.parent.mkdir(parents=True, exist_ok=True)
    feature_collection = {"type": "FeatureCollection", "features": features}
    with output_path.open("w", encoding="utf-8") as f:
        json.dump(feature_collection, f, ensure_ascii=False, indent=2)
        f.write("\n")

    print(
        f"Wrote {len(features)} features to {display_path(output_path)} "
        f"from {display_path(input_path)}."
    )
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, default=DEFAULT_INPUT)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()
    return convert(args.input, args.output)


if __name__ == "__main__":
    sys.exit(main())
