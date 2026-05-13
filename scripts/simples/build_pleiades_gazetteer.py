#!/usr/bin/env python3
"""Build a Pleiades-first gazetteer for the simples provenance pipeline."""
from __future__ import annotations

import csv
import gzip
import sys
from pathlib import Path
from typing import Any

from provenance_common import (
    GAZETTEER_PATH,
    PLEIADES_DUMP_DIR,
    has_greek_script,
    normalize_key,
    now_utc,
    rel,
    write_json,
)


PLACES_CSV = PLEIADES_DUMP_DIR / "pleiades-places-latest.csv.gz"
NAMES_CSV = PLEIADES_DUMP_DIR / "pleiades-names-latest.csv.gz"
LOCATIONS_CSV = PLEIADES_DUMP_DIR / "pleiades-locations-latest.csv.gz"
PLEIADES_URI = "https://pleiades.stoa.org/places/{pid}"
EXPECTED_SPOT_KEYS = {
    "Lemnos": ["λημνοσ", "lemnos"],
    "Cyprus": ["κυπροσ", "cyprus"],
    "Arabia": ["αραβια", "arabia"],
    "Egypt": ["αιγυπτοσ", "aegyptus", "egypt"],
    "Syria/Palestine": ["συρια", "syria", "palaestina", "palestine"],
    "Crete": ["κρητη", "crete"],
}


csv.field_size_limit(sys.maxsize)


def open_gzip_csv(path: Path):
    return gzip.open(path, "rt", encoding="utf-8", newline="")


def parse_float(value: str | None) -> float | None:
    if not value:
        return None
    try:
        return float(value)
    except ValueError:
        return None


def split_csvish(value: str | None) -> list[str]:
    if not value:
        return []
    return [part.strip() for part in value.split(",") if part.strip()]


def parse_pid(value: str | None) -> str | None:
    if not value:
        return None
    return value.strip().rstrip("/").rsplit("/", 1)[-1]


def title_surfaces(title: str) -> list[tuple[str, str]]:
    surfaces: list[tuple[str, str]] = []
    clean = " ".join((title or "").split())
    if clean:
        surfaces.append((clean, "title"))
    for sep in ("/", ";"):
        if sep in clean:
            for part in clean.split(sep):
                part = " ".join(part.split())
                if part and part != clean:
                    surfaces.append((part, "title_part"))
    return surfaces


def add_name(
    place: dict[str, Any],
    surface: str,
    kind: str,
    language: str = "",
    source_path: str = "",
) -> bool:
    surface = " ".join((surface or "").split())
    key = normalize_key(surface)
    if not surface or not key:
        return False
    marker = (kind, language, surface, key)
    seen = place.setdefault("_seen_names", set())
    if marker in seen:
        return False
    seen.add(marker)
    place["names"].append(
        {
            "surface": surface,
            "normalized_key": key,
            "language": language,
            "kind": kind,
            "source_path": source_path,
            "is_greek_script": has_greek_script(surface),
        }
    )
    place.setdefault("_lookup_keys", set()).add(key)
    return True


def load_places() -> tuple[dict[str, dict[str, Any]], int]:
    places: dict[str, dict[str, Any]] = {}
    with open_gzip_csv(PLACES_CSV) as handle:
        for row in csv.DictReader(handle):
            pid = (row.get("id") or "").strip()
            if not pid:
                continue
            places[pid] = {
                "pleiades_id": pid,
                "pleiades_uri": PLEIADES_URI.format(pid=pid),
                "title": (row.get("title") or "").strip(),
                "feature_types": split_csvish(row.get("featureTypes")),
                "coordinates": {
                    "lat": parse_float(row.get("reprLat")),
                    "lon": parse_float(row.get("reprLong")),
                },
                "location_precision": (row.get("locationPrecision") or "").strip(),
                "min_date": parse_float(row.get("minDate")),
                "max_date": parse_float(row.get("maxDate")),
                "time_periods": split_csvish(row.get("timePeriods")),
                "time_period_keys": split_csvish(row.get("timePeriodsKeys")),
                "time_period_range": (row.get("timePeriodsRange") or "").strip(),
                "path": (row.get("path") or "").strip(),
                "names": [],
            }
    return places, len(places)


def build_gazetteer() -> dict[str, Any]:
    missing = [path for path in (PLACES_CSV, NAMES_CSV) if not path.exists()]
    if missing:
        missing_list = ", ".join(rel(path) for path in missing)
        raise SystemExit(
            f"Missing Pleiades dump(s): {missing_list}. "
            "Run python3 scripts/galen/fetch_pleiades_dump.py first."
        )

    places, place_rows = load_places()
    greek_script_names = 0
    transliterated_names = 0
    title_strings = 0
    orphan_name_rows = 0

    names_source = rel(NAMES_CSV)
    with open_gzip_csv(NAMES_CSV) as handle:
        for row in csv.DictReader(handle):
            pid = parse_pid(row.get("pid"))
            if not pid or pid not in places:
                orphan_name_rows += 1
                continue
            place = places[pid]
            language = (row.get("nameLanguage") or "").strip()
            attested = (row.get("nameAttested") or "").strip()
            transliterated = (row.get("nameTransliterated") or "").strip()
            if attested and has_greek_script(attested):
                if add_name(place, attested, "greek_attested", language, names_source):
                    greek_script_names += 1
            if transliterated:
                if add_name(place, transliterated, "transliterated", language, names_source):
                    transliterated_names += 1

    for place in places.values():
        for surface, kind in title_surfaces(place.get("title", "")):
            if add_name(place, surface, kind, "", rel(PLACES_CSV)):
                title_strings += 1

    lookup_index: dict[str, list[str]] = {}
    places_out: dict[str, dict[str, Any]] = {}
    total_lookup_names = 0
    greek_lookup_names = 0
    transliterated_lookup_names = 0

    for pid, place in places.items():
        lookup_keys = sorted(place.pop("_lookup_keys", set()))
        place.pop("_seen_names", None)
        if not lookup_keys:
            continue
        for key in lookup_keys:
            lookup_index.setdefault(key, []).append(pid)
        for name in place["names"]:
            total_lookup_names += 1
            if name["kind"] == "greek_attested":
                greek_lookup_names += 1
            if name["kind"] == "transliterated":
                transliterated_lookup_names += 1
        place["lookup_keys"] = lookup_keys
        places_out[pid] = place

    for key in list(lookup_index):
        lookup_index[key] = sorted(set(lookup_index[key]))
    ambiguous = {key: ids for key, ids in lookup_index.items() if len(ids) > 1}
    spot_checks = {
        label: {
            "keys": keys,
            "matched_pleiades_ids": sorted({pid for key in keys for pid in lookup_index.get(key, [])}),
        }
        for label, keys in EXPECTED_SPOT_KEYS.items()
    }

    return {
        "metadata": {
            "artifact_id": "simples-pleiades-gazetteer",
            "stage": "stage_1_build_pleiades_name_gazetteer",
            "built_at": now_utc(),
            "source_paths": {
                "places_csv": rel(PLACES_CSV),
                "names_csv": rel(NAMES_CSV),
                "locations_csv": rel(LOCATIONS_CSV) if LOCATIONS_CSV.exists() else "",
            },
            "normalization": "NFD, strip combining marks, lowercase, final sigma to sigma, collapse whitespace",
            "notes": [
                "The gazetteer is seeded only from Pleiades places/names/title strings.",
                "Ambiguous lookup keys are preserved instead of collapsed.",
            ],
        },
        "counts": {
            "total_pleiades_place_rows": place_rows,
            "places_with_lookup_names": len(places_out),
            "total_lookup_names": total_lookup_names,
            "greek_script_names": greek_script_names,
            "transliterated_names": transliterated_names,
            "title_strings": title_strings,
            "greek_lookup_names": greek_lookup_names,
            "transliterated_lookup_names": transliterated_lookup_names,
            "lookup_keys": len(lookup_index),
            "ambiguous_lookup_keys": len(ambiguous),
            "orphan_name_rows": orphan_name_rows,
        },
        "places": places_out,
        "lookup_index": dict(sorted(lookup_index.items())),
        "ambiguous_lookup_keys": dict(sorted(ambiguous.items())),
        "spot_checks": spot_checks,
    }


def main() -> None:
    payload = build_gazetteer()
    write_json(GAZETTEER_PATH, payload)
    counts = payload["counts"]
    print(f"Wrote {rel(GAZETTEER_PATH)}")
    print(f"Pleiades places: {counts['total_pleiades_place_rows']}")
    print(f"Lookup names: {counts['total_lookup_names']}")
    print(f"Greek-script names: {counts['greek_script_names']}")
    print(f"Transliterated names: {counts['transliterated_names']}")
    print(f"Ambiguous lookup keys: {counts['ambiguous_lookup_keys']}")
    for label, result in payload["spot_checks"].items():
        ids = result["matched_pleiades_ids"]
        print(f"Spot {label}: {len(ids)} id(s)")


if __name__ == "__main__":
    main()
