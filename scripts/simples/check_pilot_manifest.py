#!/usr/bin/env python3
"""Validate the local-TEI Materia ingredient manifest."""
from __future__ import annotations

import json
import xml.etree.ElementTree as ET
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
MANIFEST_PATH = REPO_ROOT / "data" / "generated" / "simples" / "entry_manifest.json"
SCHEMA_PATH = REPO_ROOT / "schemas" / "simples" / "entry-manifest.schema.json"
SOURCE_REGISTRY_PATH = REPO_ROOT / "data" / "tei" / "source_registry.json"
EXPECTED_INGREDIENTS = ["balsamum", "cardamom", "calamus", "schoinos", "myrrh"]
EXPECTED_ENTRY_IDS = {
    "balsamum": {"dsc:18"},
    "cardamom": {"dsc:5"},
    "calamus": {"dsc:17"},
    "schoinos": {"dsc:16"},
    "myrrh": {"dsc:63", "dsc:64"},
}
REQUIRED_ENTRY_FIELDS = {
    "author",
    "work",
    "book",
    "chapter",
    "lemma",
    "greek_entry_text",
    "source_tei_path",
    "source_registry_id",
    "source_xml_id",
    "evidence_authority",
    "ingredient_keys",
}
NONEMPTY_ENTRY_FIELDS = {
    "author",
    "work",
    "lemma",
    "greek_entry_text",
    "source_tei_path",
    "source_registry_id",
    "source_xml_id",
}


def load_json(path: Path) -> object:
    return json.loads(path.read_text(encoding="utf-8"))


def validate_schema(manifest: object, schema: object) -> None:
    try:
        import jsonschema  # type: ignore
    except ImportError:
        validate_schema_minimal(manifest, schema)
        return
    jsonschema.validate(manifest, schema)


def validate_schema_minimal(manifest: object, schema: object) -> None:
    if not isinstance(manifest, dict):
        raise AssertionError("manifest is not a JSON object")
    for key in schema["required"]:  # type: ignore[index]
        if key not in manifest:
            raise AssertionError(f"manifest missing required key: {key}")
    if not isinstance(manifest.get("entries"), list) or not manifest["entries"]:
        raise AssertionError("manifest.entries must be a non-empty array")
    if not isinstance(manifest.get("ingredients"), list) or len(manifest["ingredients"]) != 5:
        raise AssertionError("manifest.ingredients must contain exactly five ingredients")


def assert_under_data_tei(path_text: str) -> Path:
    if "../" in path_text:
        raise AssertionError(f"source path escapes local TEI boundary: {path_text}")
    path = (REPO_ROOT / path_text).resolve()
    data_tei = (REPO_ROOT / "data" / "tei").resolve()
    try:
        path.relative_to(data_tei)
    except ValueError as exc:
        raise AssertionError(f"source path outside data/tei: {path_text}") from exc
    if not path.exists():
        raise AssertionError(f"missing source TEI: {path_text}")
    return path


def check_registry(manifest: dict[str, object]) -> None:
    metadata = manifest["metadata"]  # type: ignore[index]
    if metadata.get("source_boundary") != "data/tei":  # type: ignore[union-attr]
        raise AssertionError("manifest source_boundary must be data/tei")
    if metadata.get("source_registry_path") != "data/tei/source_registry.json":  # type: ignore[union-attr]
        raise AssertionError("manifest must point at data/tei/source_registry.json")
    registry = load_json(SOURCE_REGISTRY_PATH)
    if not isinstance(registry, dict):
        raise AssertionError("source registry is not an object")
    source_ids = {source["source_id"] for source in registry.get("sources", [])}
    if not source_ids:
        raise AssertionError("source registry has no sources")
    for source in registry.get("sources", []):
        raw = assert_under_data_tei(source["raw_path"])
        ET.parse(raw)
        annotated = source.get("annotated_path")
        if annotated and Path(REPO_ROOT / annotated).exists():
            ET.parse(assert_under_data_tei(annotated))


def check_ingredients(manifest: dict[str, object]) -> None:
    ingredients = manifest["ingredients"]
    if not isinstance(ingredients, list):
        raise AssertionError("ingredients must be a list")
    keys = [ingredient["ingredient_key"] for ingredient in ingredients]  # type: ignore[index]
    if keys != EXPECTED_INGREDIENTS:
        raise AssertionError(f"expected ingredient order {EXPECTED_INGREDIENTS}, found {keys}")
    for ingredient in ingredients:  # type: ignore[assignment]
        key = ingredient["ingredient_key"]
        entry_ids = set(ingredient["entry_ids"])
        expected = EXPECTED_ENTRY_IDS[key]
        if entry_ids != expected:
            raise AssertionError(f"{key}: expected entry_ids {sorted(expected)}, found {sorted(entry_ids)}")
        if ingredient["view_id"] != key:
            raise AssertionError(f"{key}: view_id should match ingredient_key")


def check_entry_fields(entries: list[dict[str, object]]) -> None:
    for entry in entries:
        if "source_csv_path" in entry:
            raise AssertionError(f"{entry.get('entry_id')}: source_csv_path is not allowed")
        missing = [field for field in REQUIRED_ENTRY_FIELDS if field not in entry]
        if missing:
            raise AssertionError(f"{entry.get('entry_id')}: missing {missing}")
        empty = [
            field for field in NONEMPTY_ENTRY_FIELDS if entry[field] in (None, "")
        ]
        if empty:
            raise AssertionError(f"{entry.get('entry_id')}: empty {empty}")
        assert_under_data_tei(str(entry["source_tei_path"]))
        if entry["evidence_authority"] != "greek_tei":
            raise AssertionError(f"{entry.get('entry_id')}: Greek TEI must be evidence authority")
        if entry.get("entry_en"):
            if entry.get("translation_en_authority") != "display_only_draft_translation":
                raise AssertionError(f"{entry.get('entry_id')}: English must be display-only draft data")
            if entry.get("translation_en_source") != "data/review/materia_draft_translations.json":
                raise AssertionError(f"{entry.get('entry_id')}: translation source must be draft sidecar")


def check_no_stale_context(manifest: dict[str, object]) -> None:
    rendered = json.dumps(manifest, ensure_ascii=False)
    stale_tokens = [
        "../aetius",
        "aetius_root",
        "galen_materia_context",
        "galen_materia_source_path",
        "provenance_llm_adjudications",
        "simples_provenance_review.csv",
        "derived_display_cache",
    ]
    for token in stale_tokens:
        if token in rendered:
            raise AssertionError(f"manifest still references stale source {token}")


def main() -> None:
    manifest = load_json(MANIFEST_PATH)
    schema = load_json(SCHEMA_PATH)
    validate_schema(manifest, schema)
    if not isinstance(manifest, dict):
        raise AssertionError("manifest is not an object")
    entries = manifest["entries"]
    if not isinstance(entries, list):
        raise AssertionError("entries must be a list")
    check_registry(manifest)
    check_ingredients(manifest)
    check_entry_fields(entries)  # type: ignore[arg-type]
    check_no_stale_context(manifest)
    print("Manifest validates against schema")
    print("Source boundary: data/tei")
    print("Ingredient journeys: 5")
    print(f"Entries: {len(entries)}")
    print("Greek TEI is evidence authority; English is display-only")


if __name__ == "__main__":
    main()
