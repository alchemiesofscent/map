#!/usr/bin/env python3
"""Generate scrollytelling data for a repeatable Periplus section chunk.

The source of truth is the pair of CSV files at the repository root:
`texts.csv` for Greek text and `translations.csv` for parsed translation JSON.
The generated data is written under `data/generated/periplus/` so the original
sample files stay available as hand-curated reference data.
"""
from __future__ import annotations

import argparse
import csv
import json
import re
import sys
import unicodedata
from copy import deepcopy
from dataclasses import dataclass
from pathlib import Path
from difflib import SequenceMatcher
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_TEXTS = ROOT / "texts.csv"
DEFAULT_TRANSLATIONS = ROOT / "translations.csv"
DEFAULT_AUTHORITY = ROOT / "data" / "places_authority.sample.json"
DEFAULT_MYMAPS = ROOT / "data" / "external" / "google_mymaps" / "periplus_mymap.geojson"
DEFAULT_OUTDIR = ROOT / "data" / "generated" / "periplus"

STADE_KM = 0.185
MAIN_ROUTE_ROLES = {"destination_port"}
CONTEXT_FOCUS_NAMES = {
    "Adulis and neighboring Barbaria": "Adulis",
}
GENERIC_UNMAPPED_LABELS = {
    "arabia",
    "inland arabia",
    "barbaria",
    "barbarian coast",
    "barbarian country",
    "egypt",
}


@dataclass
class MyMapsPoint:
    label: str
    variants: list[str]
    lat: float
    lon: float


def read_csv(path: Path) -> list[dict[str, str]]:
    with path.open(encoding="utf-8", newline="") as f:
        return list(csv.DictReader(f))


def load_json(path: Path) -> Any:
    with path.open(encoding="utf-8") as f:
        return json.load(f)


def write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")


def strip_marks(value: str) -> str:
    decomposed = unicodedata.normalize("NFD", value)
    return "".join(ch for ch in decomposed if unicodedata.category(ch) != "Mn")


def normalize(value: str | None) -> str:
    if not value:
        return ""
    value = strip_marks(value).casefold()
    value = value.replace("ῤ", "ρ").replace("ῥ", "ρ")
    return re.sub(r"[^0-9a-zα-ω]+", " ", value).strip()


def slugify(value: str) -> str:
    value = normalize(value)
    replacements = {
        "α": "a",
        "β": "b",
        "γ": "g",
        "δ": "d",
        "ε": "e",
        "ζ": "z",
        "η": "e",
        "θ": "th",
        "ι": "i",
        "κ": "k",
        "λ": "l",
        "μ": "m",
        "ν": "n",
        "ξ": "x",
        "ο": "o",
        "π": "p",
        "ρ": "r",
        "σ": "s",
        "ς": "s",
        "τ": "t",
        "υ": "u",
        "φ": "ph",
        "χ": "ch",
        "ψ": "ps",
        "ω": "o",
    }
    transliterated = "".join(replacements.get(ch, ch) for ch in value)
    slug = re.sub(r"[^0-9a-z]+", "_", transliterated).strip("_")
    return slug or "place"


def unique_key(base: str, existing: set[str]) -> str:
    key = base
    i = 2
    while key in existing:
        key = f"{base}_{i}"
        i += 1
    existing.add(key)
    return key


def authority_terms(place: dict[str, Any]) -> list[str]:
    terms = [place.get("display_name", "")]
    terms.extend(place.get("aliases") or [])
    terms.extend(place.get("greek_names") or [])
    return [term for term in terms if term]


def build_authority_index(places: list[dict[str, Any]]) -> dict[str, str]:
    index: dict[str, str] = {}
    for place in places:
        for term in authority_terms(place):
            norm = normalize(term)
            if norm:
                index.setdefault(norm, place["place_key"])
    return index


def geometry_point(feature: dict[str, Any]) -> tuple[float, float] | None:
    geometry = feature.get("geometry") or {}
    if geometry.get("type") != "Point":
        return None
    coords = geometry.get("coordinates") or []
    if len(coords) < 2:
        return None
    lon, lat = coords[0], coords[1]
    if not isinstance(lat, (int, float)) or not isinstance(lon, (int, float)):
        return None
    return float(lat), float(lon)


def split_mymaps_variants(name: str) -> list[str]:
    variants = [name]
    for token in re.split(r"[/,;()]+", name):
        token = token.strip(" ?")
        if token:
            variants.append(token)
    return list(dict.fromkeys(variants))


def load_mymaps_points(path: Path) -> list[MyMapsPoint]:
    if not path.exists():
        return []
    data = load_json(path)
    points: list[MyMapsPoint] = []
    for feature in data.get("features", []):
        coords = geometry_point(feature)
        name = (feature.get("properties") or {}).get("name")
        if coords is None or not name:
            continue
        lat, lon = coords
        points.append(MyMapsPoint(label=name, variants=split_mymaps_variants(name), lat=lat, lon=lon))
    return points


def label_match_score(label: str, candidate: str) -> float:
    a = normalize(label)
    b = normalize(candidate)
    if not a or not b:
        return 0.0
    if a == b:
        return 1.0
    a_words = set(a.split())
    b_words = set(b.split())
    if a_words and a_words <= b_words:
        return 0.92
    if b_words and b_words <= a_words:
        return 0.86
    # A tiny deterministic fuzzy match for Mundu/Mundus, Mosyllon/Mosylon, etc.
    prefix_bonus = 0.08 if (a[:5] and b.startswith(a[:5])) or (b[:5] and a.startswith(b[:5])) else 0.0
    return SequenceMatcher(None, a, b).ratio() + prefix_bonus


def allow_mymaps_match(label: str, role: str) -> bool:
    norm = normalize(label)
    if norm in GENERIC_UNMAPPED_LABELS:
        return False
    return role in {"destination_port", "route_or_intermediate_place"}


def match_mymaps(label: str, mymaps_points: list[MyMapsPoint]) -> MyMapsPoint | None:
    best: tuple[float, MyMapsPoint] | None = None
    for point in mymaps_points:
        score = max(label_match_score(label, variant) for variant in point.variants)
        if best is None or score > best[0]:
            best = (score, point)
    if best and best[0] >= 0.78:
        return best[1]
    return None


def infer_place_type(role: str, label: str) -> str:
    lowered = label.casefold()
    if role == "destination_port":
        return "emporion"
    if "island" in lowered:
        return "island"
    if role == "source_place":
        return "source_region"
    if role == "region":
        return "region"
    return "route_marker"


def first_point(place: dict[str, Any]) -> bool:
    return place.get("lat") is not None and place.get("lon") is not None


def find_surface(text: str, surface: str) -> str | None:
    if not text or not surface:
        return None
    if surface in text:
        return surface
    norm_surface = normalize(surface)
    if not norm_surface:
        return None
    for match in re.finditer(r"\S+(?:\s+\S+){0,5}", text):
        candidate = match.group(0).strip(" .,;:··")
        if normalize(candidate) == norm_surface:
            return candidate
    return None


def add_mention(
    mentions: list[dict[str, str]],
    seen: set[tuple[str, str]],
    surface: str | None,
    place_key: str,
    kind: str,
) -> None:
    if not surface:
        return
    surface = surface.strip()
    if not surface:
        return
    key = (surface, place_key)
    if key in seen:
        return
    mentions.append({"surface": surface, "place_key": place_key, "kind": kind})
    seen.add(key)


def parse_translation(row: dict[str, str]) -> dict[str, Any]:
    try:
        data = json.loads(row["result_json"])
    except json.JSONDecodeError as exc:
        raise ValueError(f"{row['chunk_id']}: invalid result_json: {exc}") from exc
    return data


def extract_distance(translation: str) -> tuple[str, float | None, str | None] | None:
    number_words = {
        "eight hundred": 800.0,
        "three thousand": 3000.0,
        "four thousand": 4000.0,
    }
    patterns = [
        r"about\s+([0-9,]+)\s+stades",
        r"after\s+([0-9,]+)\s+stades",
        r"([0-9,]+)\s+stades",
        r"about\s+(eight hundred|three thousand|four thousand)\s+stades",
        r"after\s+(eight hundred|three thousand|four thousand)\s+stades",
        r"two or three runs",
        r"two runs",
    ]
    lowered = translation.casefold()
    for pattern in patterns:
        match = re.search(pattern, lowered)
        if not match:
            continue
        if "runs" in pattern:
            return match.group(0), None, "runs"
        value_text = match.group(1)
        value = number_words.get(value_text, float(value_text.replace(",", "")) if value_text[0].isdigit() else None)
        if value is None:
            continue
        return match.group(0), value, "stades"
    return None


def make_route_label(section_order: int, total: int, focus_place: dict[str, Any] | None) -> str:
    if focus_place and first_point(focus_place):
        return f"Section {section_order} of {total} · mapped stop"
    return f"Section {section_order} of {total} · context"


def display_path(path: Path) -> str:
    try:
        return str(path.relative_to(ROOT))
    except ValueError:
        return str(path)


def generate(args: argparse.Namespace) -> dict[str, Path]:
    texts = {int(row["section_order"]): row for row in read_csv(args.texts)}
    translations = {int(row["section_order"]): row for row in read_csv(args.translations)}
    section_orders = list(range(args.start, args.start + args.count))
    missing = [order for order in section_orders if order not in texts or order not in translations]
    if missing:
        raise ValueError(f"Missing sections in CSV inputs: {missing}")

    authority = load_json(args.authority)
    generated_places = deepcopy(authority)
    by_key = {place["place_key"]: place for place in generated_places}
    authority_index = build_authority_index(generated_places)
    existing_keys = set(by_key)
    mymaps_points = load_mymaps_points(args.mymaps)

    raw_sections: list[dict[str, Any]] = []
    steps: list[dict[str, Any]] = []
    main_route_keys: list[str] = []
    legs: list[dict[str, Any]] = []
    report: dict[str, Any] = {
        "matched_authority": [],
        "matched_mymaps": [],
        "unmapped_new": [],
        "fallback_mentions": [],
        "steps": [],
        "legs": [],
    }

    last_focus_key: str | None = None
    last_main_key: str | None = None
    previous_distance: tuple[str, float | None, str | None] | None = None
    previous_chunk_id: str | None = None

    for order in section_orders:
        text_row = texts[order]
        translation_row = translations[order]
        parsed = parse_translation(translation_row)
        translation = parsed.get("draft_translation", "")
        greek_text = text_row["text"]

        section = {
            "chunk_id": text_row["chunk_id"],
            "passage_id": text_row["passage_id"],
            "source_ref": text_row["source_ref"],
            "section_order": order,
            "greek_text": greek_text,
            "draft_translation": translation,
            "places": parsed.get("places", []),
            "commodity_entities": parsed.get("commodity_entities", []),
            "movement_events": parsed.get("movement_events", []),
        }
        raw_sections.append(section)

        mentions: list[dict[str, str]] = []
        seen_mentions: set[tuple[str, str]] = set()
        place_keys_in_section: list[str] = []
        destination_candidates: list[str] = []

        for extracted in parsed.get("places", []):
            english_label = CONTEXT_FOCUS_NAMES.get(extracted.get("english_label"), extracted.get("english_label", ""))
            greek_surface = extracted.get("greek_surface")
            role = extracted.get("role", "")
            norm = normalize(english_label)
            place_key = authority_index.get(norm)

            if place_key:
                report["matched_authority"].append((order, english_label, place_key))
            else:
                mymaps = match_mymaps(english_label, mymaps_points) if allow_mymaps_match(english_label, role) else None
                place_key = unique_key(slugify(english_label), existing_keys)
                place = {
                    "place_key": place_key,
                    "display_name": english_label,
                    "greek_names": [greek_surface] if greek_surface else [],
                    "aliases": [english_label],
                    "place_type": infer_place_type(role, english_label),
                    "lat": mymaps.lat if mymaps else None,
                    "lon": mymaps.lon if mymaps else None,
                    "certainty": "low",
                    "pleiades_id": None,
                    "pleiades_uri": None,
                    "coordinates_source": (
                        f"Provisional Google MyMaps point matched by label to '{mymaps.label}'. "
                        "Not a Pleiades identification."
                        if mymaps
                        else "Unmapped generated candidate; requires authority review."
                    ),
                    "notes": f"Generated from section {order}: {extracted.get('notes', '').strip()}",
                }
                generated_places.append(place)
                by_key[place_key] = place
                for term in authority_terms(place):
                    authority_index.setdefault(normalize(term), place_key)
                if mymaps:
                    report["matched_mymaps"].append((order, english_label, place_key, mymaps.label))
                else:
                    report["unmapped_new"].append((order, english_label, place_key))

            if place_key not in place_keys_in_section:
                place_keys_in_section.append(place_key)

            kind = "main_route" if role in MAIN_ROUTE_ROLES else "off_route"
            if role in MAIN_ROUTE_ROLES:
                destination_candidates.append(place_key)

            add_mention(mentions, seen_mentions, find_surface(translation, english_label) or english_label, place_key, kind)
            add_mention(mentions, seen_mentions, find_surface(greek_text, greek_surface or ""), place_key, kind)

        # Authority-backed fallback for places omitted by result_json, especially
        # the first two sections where the parsed places arrays are empty.
        for place in generated_places:
            key = place["place_key"]
            matched_surfaces: list[tuple[str, str]] = []
            for term in authority_terms(place):
                english_surface = find_surface(translation, term)
                greek_surface = find_surface(greek_text, term)
                if english_surface:
                    matched_surfaces.append((english_surface, "translation"))
                if greek_surface:
                    matched_surfaces.append((greek_surface, "greek"))
            if not matched_surfaces:
                continue
            if key not in place_keys_in_section:
                place_keys_in_section.append(key)
            for surface, source in matched_surfaces:
                add_mention(mentions, seen_mentions, surface, key, "off_route")
                report["fallback_mentions"].append((order, surface, key, source))

        focus_key = destination_candidates[0] if destination_candidates else None
        if focus_key is None:
            mapped_mentions = [key for key in place_keys_in_section if first_point(by_key.get(key, {}))]
            focus_key = mapped_mentions[0] if mapped_mentions else last_focus_key
        if focus_key is None and generated_places:
            focus_key = generated_places[0]["place_key"]

        focus_place = by_key.get(focus_key or "")
        if focus_key and first_point(focus_place or {}):
            last_focus_key = focus_key
            for mention in mentions:
                if mention["place_key"] == focus_key:
                    mention["kind"] = "main_route"

        if destination_candidates:
            for key in destination_candidates:
                if first_point(by_key.get(key, {})) and key not in main_route_keys:
                    main_route_keys.append(key)
        elif focus_key and first_point(focus_place or {}) and focus_key not in main_route_keys:
            main_route_keys.append(focus_key)

        goods = [good.get("english_label") for good in parsed.get("commodity_entities", []) if good.get("english_label")]
        title = focus_place["display_name"] if focus_place else f"Section {order}"
        if destination_candidates:
            title = by_key[destination_candidates[0]]["display_name"]
        elif goods:
            title = f"Section {order}: trade goods"

        step = {
            "step_id": f"step_{order:04d}_{slugify(title)[:48]}",
            "type": "stop" if focus_key and first_point(focus_place or {}) else "context",
            "title": title,
            "route_label": make_route_label(order, len(section_orders), focus_place),
            "focus_place_key": focus_key,
            "section_refs": [text_row["chunk_id"]],
            "translation": translation,
            "greek_text": greek_text,
            "place_mentions": mentions,
            "goods": goods,
        }
        steps.append(step)
        report["steps"].append((order, step["title"], step["focus_place_key"], len(mentions)))

        if focus_key and first_point(focus_place or {}) and focus_key != last_main_key:
            if last_main_key:
                distance = extract_distance(translation) or previous_distance
                distance_ref = text_row["chunk_id"] if extract_distance(translation) else previous_chunk_id
                distance_text = distance[0] if distance else "inferred from section sequence"
                distance_value = distance[1] if distance else None
                distance_unit = distance[2] if distance else None
                certainty = "text_explicit" if distance else "inferred_from_sequence"
                leg = {
                    "from_place_key": last_main_key,
                    "to_place_key": focus_key,
                    "section_refs": [distance_ref or text_row["chunk_id"]],
                    "distance_text": distance_text,
                    "distance_value": distance_value,
                    "distance_unit": distance_unit,
                    "estimated_km_at_185m_stade": (
                        round(distance_value * STADE_KM, 1)
                        if isinstance(distance_value, (int, float)) and distance_unit == "stades"
                        else None
                    ),
                    "certainty": certainty,
                }
                legs.append(leg)
                report["legs"].append((order, last_main_key, focus_key, certainty, distance_text))
            last_main_key = focus_key

        current_distance = extract_distance(translation)
        if current_distance:
            previous_distance = current_distance
            previous_chunk_id = text_row["chunk_id"]

    for step in steps:
        for mention in step["place_mentions"]:
            if mention["place_key"] in main_route_keys:
                mention["kind"] = "main_route"

    journey = {
        "route_title": "Periplus of the Erythraean Sea: generated sections 1-10",
        "source_range": {
            "start_section": args.start,
            "end_section": args.start + args.count - 1,
        },
        "main_route_place_keys": main_route_keys,
        "steps": steps,
        "legs": legs,
    }

    outdir = args.outdir
    paths = {
        "raw_sections": outdir / "raw_sections.json",
        "places": outdir / "places_authority.json",
        "journey": outdir / "journey_route.json",
        "report": outdir / f"ingestion_report_{args.start:04d}_{args.start + args.count - 1:04d}.md",
    }
    write_json(paths["raw_sections"], raw_sections)
    write_json(paths["places"], generated_places)
    write_json(paths["journey"], journey)
    write_report(paths["report"], args, report, generated_places, journey)
    return paths


def write_report(
    path: Path,
    args: argparse.Namespace,
    report: dict[str, Any],
    places: list[dict[str, Any]],
    journey: dict[str, Any],
) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    unresolved = [p for p in places if p.get("pleiades_id") is None]
    provisional = [p for p in places if "Google MyMaps" in (p.get("coordinates_source") or "")]
    lines = [
        f"# Periplus ingestion report: sections {args.start}-{args.start + args.count - 1}",
        "",
        "## Outputs",
        "",
        "- `raw_sections.json`: Greek text plus parsed translation records.",
        "- `places_authority.json`: curated authority plus generated candidates.",
        "- `journey_route.json`: scrollytelling route contract.",
        "",
        "## Generated story steps",
        "",
    ]
    for order, title, focus, mention_count in report["steps"]:
        lines.append(f"- Section {order}: {title} (`{focus}`), {mention_count} linked mention surfaces.")
    lines.extend(["", "## Route legs", ""])
    if report["legs"]:
        for order, start, end, certainty, distance in report["legs"]:
            lines.append(f"- Section {order}: `{start}` -> `{end}` ({certainty}; {distance}).")
    else:
        lines.append("- No route legs generated.")
    lines.extend(["", "## New MyMaps provisional matches", ""])
    if report["matched_mymaps"]:
        for order, label, key, mymaps_label in report["matched_mymaps"]:
            lines.append(f"- Section {order}: {label} -> `{key}` using MyMaps label `{mymaps_label}`.")
    else:
        lines.append("- None.")
    lines.extend(["", "## New unmapped candidates", ""])
    if report["unmapped_new"]:
        for order, label, key in report["unmapped_new"]:
            lines.append(f"- Section {order}: {label} -> `{key}`.")
    else:
        lines.append("- None.")
    lines.extend(["", "## Existing authority matches", ""])
    for order, label, key in report["matched_authority"]:
        lines.append(f"- Section {order}: {label} -> `{key}`.")
    lines.extend(["", "## Authority-backed fallback mentions", ""])
    for order, surface, key, source in report["fallback_mentions"]:
        lines.append(f"- Section {order}: `{surface}` -> `{key}` ({source}).")
    lines.extend(
        [
            "",
            "## Review notes",
            "",
            f"- Main route keys: {', '.join(f'`{key}`' for key in journey['main_route_place_keys'])}.",
            f"- Places without Pleiades IDs: {len(unresolved)}.",
            f"- Provisional MyMaps coordinate records: {len(provisional)}.",
            "- MyMaps coordinates are provisional visual aids, not Pleiades identifications.",
        ]
    )
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--start", type=int, default=1, help="First section_order to ingest.")
    parser.add_argument("--count", type=int, default=10, help="Number of sections to ingest.")
    parser.add_argument("--texts", type=Path, default=DEFAULT_TEXTS)
    parser.add_argument("--translations", type=Path, default=DEFAULT_TRANSLATIONS)
    parser.add_argument("--authority", type=Path, default=DEFAULT_AUTHORITY)
    parser.add_argument("--mymaps", type=Path, default=DEFAULT_MYMAPS)
    parser.add_argument("--outdir", type=Path, default=DEFAULT_OUTDIR)
    args = parser.parse_args()

    if args.start < 1 or args.count < 1:
        print("--start and --count must be positive integers", file=sys.stderr)
        return 2

    try:
        paths = generate(args)
    except Exception as exc:
        print(f"ingest_tour_chunk failed: {exc}", file=sys.stderr)
        return 1

    for label, path in paths.items():
        print(f"Wrote {label}: {display_path(path)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
