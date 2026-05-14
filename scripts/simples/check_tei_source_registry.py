#!/usr/bin/env python3
"""Validate the local TEI source registry used by the simples pipeline."""
from __future__ import annotations

import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Any

from provenance_common import (
    CANONICAL_ARABIA_PLEIADES_ID,
    DEPRECATED_ARABIA_PLEIADES_ID,
    REPO_ROOT,
    TEI_SOURCE_REGISTRY_PATH,
    load_json,
    rel,
)


TEI_NS = {"tei": "http://www.tei-c.org/ns/1.0"}
EXPECTED_PIDS = {
    "29677",
    "39386",
    "39435",
    "50004",
    "520977",
    "540689",
    "658443",
    "687934",
    "716588",
    "874350",
    CANONICAL_ARABIA_PLEIADES_ID,
}
EXPECTED_INGREDIENTS = {"balsamum", "cardamom", "calamus", "schoinos", "myrrh"}


def assert_under_data_tei(path_text: str) -> Path:
    if path_text.startswith("../") or "/../" in path_text:
        raise AssertionError(f"source path escapes repo boundary: {path_text}")
    path = (REPO_ROOT / path_text).resolve()
    data_tei = (REPO_ROOT / "data" / "tei").resolve()
    try:
        path.relative_to(data_tei)
    except ValueError as exc:
        raise AssertionError(f"source path is outside data/tei: {path_text}") from exc
    if not path.exists():
        raise AssertionError(f"registered TEI path does not exist: {path_text}")
    return path


def place_refs(path: Path) -> tuple[set[str], set[str], int]:
    root = ET.parse(path).getroot()
    refs: set[str] = set()
    ingredients: set[str] = set()
    claim_count = 0
    for place in root.findall(".//tei:placeName", TEI_NS):
        if place.get("type") != "materia-provenance":
            continue
        claim_count += 1
        if place.get("ingredient_key"):
            ingredients.add(str(place.get("ingredient_key")))
        for ref in (place.get("ref") or "").split():
            if "/places/" in ref:
                refs.add(ref.rsplit("/", 1)[-1])
        for attr in ("relation", "claim_group", "qualifier", "claim_order"):
            if not place.get(attr):
                raise AssertionError(f"annotated placeName missing {attr}")
    return refs, ingredients, claim_count


def check_dioscorides_annotation(source: dict[str, Any]) -> None:
    annotated = assert_under_data_tei(source["annotated_path"])
    refs, ingredients, claim_count = place_refs(annotated)
    missing = sorted(EXPECTED_PIDS - refs)
    if missing:
        raise AssertionError(f"Dioscorides annotation missing expected refs: {missing}")
    if ingredients != EXPECTED_INGREDIENTS:
        raise AssertionError(f"Dioscorides annotation ingredients mismatch: {sorted(ingredients)}")
    if claim_count != 14:
        raise AssertionError(f"expected 14 Materia TEI claims, found {claim_count}")
    root = ET.parse(annotated).getroot()
    for place in root.findall(".//tei:placeName", TEI_NS):
        text = "".join(place.itertext())
        ref = place.get("ref") or ""
        if "Ἀραβ" in text and DEPRECATED_ARABIA_PLEIADES_ID in ref:
            raise AssertionError("Dioscorides Arabia annotation must not use 981506")


def main() -> int:
    payload = load_json(TEI_SOURCE_REGISTRY_PATH)
    if payload.get("metadata", {}).get("source_boundary") != "data/tei":
        raise AssertionError("source registry boundary must be data/tei")
    sources = payload.get("sources", [])
    if not sources:
        raise AssertionError("source registry has no sources")

    seen: set[str] = set()
    for source in sources:
        source_id = source.get("source_id")
        if not source_id:
            raise AssertionError("source without source_id")
        if source_id in seen:
            raise AssertionError(f"duplicate source_id {source_id}")
        seen.add(source_id)
        raw = assert_under_data_tei(source["raw_path"])
        annotated_path = source.get("annotated_path")
        preferred = raw
        if annotated_path:
            candidate = (REPO_ROOT / annotated_path).resolve()
            if candidate.exists():
                preferred = assert_under_data_tei(annotated_path)
        ET.parse(preferred)

    by_slug = {source["witness_slug"]: source for source in sources}
    if "dsc" not in by_slug:
        raise AssertionError("Dioscorides source missing from registry")
    check_dioscorides_annotation(by_slug["dsc"])

    print("TEI source registry validates")
    print(f"Registry: {rel(TEI_SOURCE_REGISTRY_PATH)}")
    print(f"Sources: {len(sources)}")
    print("Dioscorides Materia place annotations: 14")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
