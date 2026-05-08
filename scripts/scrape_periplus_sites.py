#!/usr/bin/env python3
"""Scrape reviewed Periplus webmap site metadata into a sidecar dataset."""
from __future__ import annotations

import argparse
import json
import re
import sys
import unicodedata
from dataclasses import dataclass
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from typing import Any
from urllib.error import URLError
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUT = ROOT / "data" / "review" / "periplus_sites_webmap_scrape.json"
WEBMAP_URL = (
    "https://raw.githubusercontent.com/pbarchi/"
    "periplus-interactive-webmap/main/data/PeriplusSites_3.js"
)

# Reviewed route order supplied for this sidecar pass. The underlying webmap has
# two additional reference-only features (Puralaon Islands and Katakekaumene
# Island) that are not in this reviewed input list.
DEFAULT_INPUT_ORDER = [
    "Muos Hormos",
    "Berenike",
    "Meroe",
    "Ptolemais Theron",
    "Adouli",
    "Oreine",
    "Didoros Island",
    "Koloe",
    "Axomite metropolis",
    "Alalaiou Islands",
    "Aualites",
    "Malao",
    "Moundou",
    "Mosullon",
    "Cape Elephas",
    "Akannai",
    "Aromaton Emporion",
    "Tabai",
    "Opone",
    "Menounthias",
    "Rhapta",
    "Leuke Kome",
    "Mouza",
    "Saue",
    "Zafar Diodoros Island",
    "Okelis",
    "Eudaimon Arabia",
    "Kane",
    "Isle of Birds",
    "Troullas",
    "Saubatha",
    "Suagros",
    "Dioskouridou Island",
    "Moscha Limen",
    "Asikhonos",
    "Isles of Zenobios",
    "Sarapis Island",
    "Kalaiou Isles",
    "Apologos",
    "Pasinou Kharax",
    "Ommana",
    "Horaia",
    "Barbarikon",
    "Minnagar",
    "Astakapra",
    "Baiones Island",
    "Kammoni",
    "Barygaza",
    "Ozene",
    "Paithana",
    "Tagara",
    "Akabaru",
    "Souppara",
    "Kalliena",
    "Semulla",
    "Mandagora",
    "Palaipatmai",
    "Melizeigara",
    "Byzantion",
    "Toparon",
    "Erannoboas",
    "Sesekreienai Island",
    "Aigidion Island",
    "Kaineiton Island",
    "White Island",
    "Naoura",
    "Tyndis",
    "Muziris",
    "Nelkunda",
    "Bakare",
    "Balita",
    "Komarei",
    "Kolkhoi",
    "Argalou",
    "Kamara",
    "Podouke",
    "Sopatma",
    "Palaisimoundou",
    "Masalia",
    "Ganges",
    "Khruse Island",
    "Thina",
]

def normalize_name(value: str) -> str:
    """Return a lookup key that ignores diacritics, punctuation, and spacing."""
    decomposed = unicodedata.normalize("NFKD", value or "")
    without_marks = "".join(ch for ch in decomposed if not unicodedata.combining(ch))
    return re.sub(r"[^a-z0-9]+", "", without_marks.lower())


COMPOSITE_INPUTS = {normalize_name("Zafar Diodoros Island"): ["Zafar", "Diodoros Island"]}


def normalize_space(value: str | None) -> str | None:
    if value is None:
        return None
    cleaned = re.sub(r"\s+", " ", value).strip()
    return cleaned or None


def normalize_field(value: str | None) -> str | None:
    cleaned = normalize_space(value)
    if cleaned is None or cleaned.lower() == "nan":
        return None
    return cleaned


def normalize_block(value: str) -> str | None:
    lines = [normalize_space(line) for line in value.splitlines()]
    cleaned = "\n".join(line for line in lines if line)
    return cleaned or None


def fetch_text(url: str) -> str:
    request = Request(url, headers={"User-Agent": "periplus-tour-mvp-scraper/1.0"})
    with urlopen(request, timeout=30) as response:
        return response.read().decode("utf-8")


def parse_webmap_payload(text: str) -> dict[str, Any]:
    prefix = "var json_PeriplusSites_3 ="
    stripped = text.strip()
    if stripped.startswith(prefix):
        stripped = stripped[len(prefix) :].strip()
    stripped = stripped.rstrip(";")
    return json.loads(stripped)


class LocationPageParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.in_post_content = False
        self.post_div_depth = 0
        self.current_block: str | None = None
        self.current_heading: str | None = None
        self.block_parts: list[str] = []
        self.headings: list[tuple[str, str]] = []
        self.paragraphs: list[tuple[str | None, str]] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attrs_dict = dict(attrs)
        if tag == "div" and attrs_dict.get("class") == "post-content":
            self.in_post_content = True
            self.post_div_depth = 1
            return
        if not self.in_post_content:
            return
        if tag == "div":
            self.post_div_depth += 1
        if tag in {"h1", "h2", "p"}:
            self.current_block = tag
            self.block_parts = []
        elif tag == "br" and self.current_block:
            self.block_parts.append("\n")

    def handle_endtag(self, tag: str) -> None:
        if not self.in_post_content:
            return
        if tag in {"h1", "h2", "p"} and self.current_block == tag:
            raw_text = "".join(self.block_parts)
            text = normalize_space(raw_text) if tag in {"h1", "h2"} else normalize_block(raw_text)
            if text:
                if tag in {"h1", "h2"}:
                    self.headings.append((tag, text))
                    if tag == "h1":
                        self.current_heading = text
                else:
                    self.paragraphs.append((self.current_heading, text))
            self.current_block = None
            self.block_parts = []
        if tag == "div":
            self.post_div_depth -= 1
            if self.post_div_depth <= 0:
                self.in_post_content = False

    def handle_data(self, data: str) -> None:
        if self.in_post_content and self.current_block:
            self.block_parts.append(data)


def split_label_values(text: str) -> dict[str, str]:
    labels = (
        "Ancient Toponym",
        "Place Type",
        "Route",
        "Next on Route",
        "Ancient Area",
        "Periplus Chapter",
        "Longitude",
        "Latitude",
        "Location Source",
        "Modern Identification",
        "Modern Country",
        "Ancient source",
        "Bibliography",
    )
    label_pattern = re.compile(rf"^({'|'.join(re.escape(label) for label in labels)}):?\s*(.*)$")
    values: dict[str, str] = {}
    for line in text.splitlines():
        match = label_pattern.match(line)
        if match:
            label = match.group(1)
            value = normalize_field(match.group(2))
            if value is not None:
                values[label] = value
    return values


def split_bibliography(value: str | None) -> list[str]:
    if not value:
        return []
    entries = [normalize_field(part) for part in value.split(";")]
    return [entry for entry in entries if entry]


def passage_excerpt(value: str | None) -> str | None:
    if not value:
        return None
    marker = "(from the Casson translation)"
    excerpt = value.replace(marker, "")
    excerpt = normalize_space(excerpt) or ""
    if len(excerpt) <= 240:
        return excerpt
    return excerpt[:237].rstrip() + "..."


def parse_location_page(html: str) -> dict[str, Any]:
    parser = LocationPageParser()
    parser.feed(html)

    labeled: dict[str, str] = {}
    passage_text: str | None = None
    for heading, paragraph in parser.paragraphs:
        labeled.update(split_label_values(paragraph))
        if heading == "Passage from the Periplus":
            passage_text = paragraph

    page_title = next((text for tag, text in parser.headings if tag == "h2"), None)
    bibliography_text = labeled.get("Bibliography")
    return {
        "page_title": page_title,
        "page_ancient_toponym": normalize_field(labeled.get("Ancient Toponym")),
        "page_place_type": normalize_field(labeled.get("Place Type")),
        "page_route": normalize_field(labeled.get("Route")),
        "page_next_on_route": normalize_field(labeled.get("Next on Route")),
        "page_ancient_area": normalize_field(labeled.get("Ancient Area")),
        "page_periplus_chapter": normalize_field(labeled.get("Periplus Chapter")),
        "page_location_source": normalize_field(labeled.get("Location Source")),
        "modern_identification": normalize_field(labeled.get("Modern Identification")),
        "modern_country": normalize_field(labeled.get("Modern Country")),
        "ancient_source": normalize_field(labeled.get("Ancient source")),
        "bibliography_entries": split_bibliography(bibliography_text),
        "passage_present": bool(passage_text),
        "passage_excerpt": passage_excerpt(passage_text),
    }


def pleiades_id_from_uri(uri: str | None) -> str | None:
    if not uri:
        return None
    match = re.search(r"/places/([0-9]+)(?:/)?$", uri)
    return match.group(1) if match else None


@dataclass
class SourceRecord:
    feature: dict[str, Any]
    source_index: int

    @property
    def name(self) -> str:
        return self.feature["properties"]["ancient_toponym"]


def index_features(features: list[dict[str, Any]]) -> dict[str, list[SourceRecord]]:
    index: dict[str, list[SourceRecord]] = {}
    for source_index, feature in enumerate(features, start=1):
        record = SourceRecord(feature=feature, source_index=source_index)
        index.setdefault(normalize_name(record.name), []).append(record)
    return index


def resolve_input_order(
    input_order: list[str], feature_index: dict[str, list[SourceRecord]]
) -> tuple[list[tuple[int, str, SourceRecord, bool]], list[str]]:
    resolved: list[tuple[int, str, SourceRecord, bool]] = []
    unresolved: list[str] = []
    consumed: dict[str, int] = {}

    for source_order, input_name in enumerate(input_order, start=1):
        input_key = normalize_name(input_name)
        source_names = COMPOSITE_INPUTS.get(input_key, [input_name])
        is_split = len(source_names) > 1
        for source_name in source_names:
            source_key = normalize_name(source_name)
            candidates = feature_index.get(source_key, [])
            offset = consumed.get(source_key, 0)
            if offset >= len(candidates):
                unresolved.append(input_name if not is_split else f"{input_name} -> {source_name}")
                continue
            consumed[source_key] = offset + 1
            resolved.append((source_order, input_name, candidates[offset], is_split))

    return resolved, unresolved


def build_record(
    source_order: int,
    input_name: str,
    source: SourceRecord,
    is_split_from_input: bool,
    page_metadata: dict[str, Any] | None,
    scrape_notes: list[str],
    webmap_url: str,
) -> dict[str, Any]:
    props = source.feature["properties"]
    geometry = source.feature.get("geometry")
    coordinates = geometry.get("coordinates") if geometry else None
    lon = coordinates[0] if coordinates else None
    lat = coordinates[1] if coordinates else None
    pleiades_uri = props.get("pleiades_link")
    github_url = props.get("github_link")

    record: dict[str, Any] = {
        "source_order": source_order,
        "input_name": input_name,
        "source_name": props.get("ancient_toponym"),
        "source_feature_index": source.source_index,
        "is_split_from_input": is_split_from_input,
        "route": props.get("route"),
        "next_on_route": normalize_space(props.get("next_on_route")),
        "periplus_place_type": normalize_space(props.get("periplus_place_type")),
        "periplus_ancient_area": props.get("periplus_ancient_area"),
        "periplus_chapter": normalize_space(props.get("periplus_chapter")),
        "location_precision": props.get("location_precision"),
        "location_source": props.get("location_source"),
        "pleiades_id": pleiades_id_from_uri(pleiades_uri),
        "pleiades_uri": pleiades_uri,
        "lat": lat,
        "lon": lon,
        "github_location_url": github_url,
        "modern_identification": None,
        "modern_country": None,
        "ancient_source": None,
        "bibliography_entries": [],
        "passage_present": False,
        "passage_excerpt": None,
        "page_metadata": None,
        "scrape_notes": scrape_notes,
        "source_urls": {
            "webmap_data": webmap_url,
            "github_location": github_url,
            "pleiades": pleiades_uri,
        },
    }
    if page_metadata:
        record.update(
            {
                "modern_identification": page_metadata.get("modern_identification"),
                "modern_country": page_metadata.get("modern_country"),
                "ancient_source": page_metadata.get("ancient_source"),
                "bibliography_entries": page_metadata.get("bibliography_entries", []),
                "passage_present": page_metadata.get("passage_present", False),
                "passage_excerpt": page_metadata.get("passage_excerpt"),
                "page_metadata": {
                    key: page_metadata.get(key)
                    for key in (
                        "page_title",
                        "page_ancient_toponym",
                        "page_place_type",
                        "page_route",
                        "page_next_on_route",
                        "page_ancient_area",
                        "page_periplus_chapter",
                        "page_location_source",
                    )
                },
            }
        )
    return record


def read_input_order(path: Path | None) -> list[str]:
    if not path:
        return DEFAULT_INPUT_ORDER
    with path.open(encoding="utf-8") as f:
        rows = [line.strip() for line in f]
    return [row for row in rows if row and not row.startswith("#")]


def scrape(args: argparse.Namespace) -> dict[str, Any]:
    input_order = read_input_order(args.input_order)
    webmap_text = fetch_text(args.webmap_url)
    webmap = parse_webmap_payload(webmap_text)
    feature_index = index_features(webmap["features"])
    resolved, unresolved = resolve_input_order(input_order, feature_index)
    if unresolved:
        raise SystemExit("Unresolved input names: " + ", ".join(unresolved))

    page_cache: dict[str, dict[str, Any]] = {}
    records: list[dict[str, Any]] = []
    for source_order, input_name, source, is_split in resolved:
        github_url = source.feature["properties"].get("github_link")
        page_metadata: dict[str, Any] | None = None
        scrape_notes: list[str] = []
        if github_url:
            try:
                if github_url not in page_cache:
                    page_cache[github_url] = parse_location_page(fetch_text(github_url))
                page_metadata = page_cache[github_url]
            except URLError as exc:
                scrape_notes.append(f"Location page fetch failed: {exc}")
        else:
            scrape_notes.append("No github_link in webmap source record; page-derived fields left null.")
        records.append(
            build_record(
                source_order,
                input_name,
                source,
                is_split,
                page_metadata,
                scrape_notes,
                args.webmap_url,
            )
        )

    generated_at = args.generated_at or datetime.now(timezone.utc).isoformat(timespec="seconds")
    return {
        "schema_version": 1,
        "generated_at": generated_at,
        "source": {
            "webmap_url": args.webmap_url,
            "location_page_base_url": "https://navigating-the-periplus.github.io/locations/",
            "input_row_count": len(input_order),
            "output_record_count": len(records),
            "notes": [
                "Sidecar review dataset only; active tour authority and route files are unchanged.",
                "Passage text is represented by passage_present and a short excerpt capped at 240 characters.",
                "Pleiades IDs are extracted from webmap pleiades_link fields.",
            ],
        },
        "records": records,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    parser.add_argument("--input-order", type=Path, default=None)
    parser.add_argument("--webmap-url", default=WEBMAP_URL)
    parser.add_argument(
        "--generated-at",
        default=None,
        help="Optional ISO timestamp override for reproducible fixtures.",
    )
    args = parser.parse_args()

    dataset = scrape(args)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    with args.out.open("w", encoding="utf-8") as f:
        json.dump(dataset, f, ensure_ascii=False, indent=2)
        f.write("\n")

    print(
        f"Wrote {len(dataset['records'])} records "
        f"from {dataset['source']['input_row_count']} input rows to {args.out}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
