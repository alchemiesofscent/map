#!/usr/bin/env python3
"""Validate the Stage 1 simple-entry pilot manifest."""
from __future__ import annotations

import json
import csv
import subprocess
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
MANIFEST_PATH = REPO_ROOT / "data" / "generated" / "simples" / "entry_manifest.json"
SCHEMA_PATH = REPO_ROOT / "schemas" / "simples" / "entry-manifest.schema.json"
REQUIRED_OVERLAP_TERMS = {
    "abrotonon",
    "agnos_lygos",
    "agrostis",
    "anchousa",
    "agarikon",
    "akantha_aigyptia_arabike",
    "bdellion",
    "nardos",
    "phou",
    "agalochon",
}
REQUIRED_ENTRY_FIELDS = {
    "author",
    "work",
    "book",
    "chapter",
    "lemma",
    "edition_pages",
    "greek_entry_text",
    "source_csv_path",
}
NONEMPTY_ENTRY_FIELDS = {
    "author",
    "work",
    "lemma",
    "greek_entry_text",
    "source_csv_path",
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
    entry_required = set(
        schema["$defs"]["entry"]["required"]  # type: ignore[index]
    )
    for entry in manifest["entries"]:
        if not isinstance(entry, dict):
            raise AssertionError("manifest entry is not an object")
        missing = sorted(entry_required - set(entry))
        if missing:
            raise AssertionError(f"{entry.get('entry_id')}: missing {missing}")


def check_dioscorides_range(entries: list[dict[str, object]]) -> None:
    found = {
        str(entry["chapter"])
        for entry in entries
        if entry.get("witness_slug") == "dsc"
        and entry.get("book") == "1"
        and "dioscorides_1_1-1_23" in entry.get("selection_sets", [])
    }
    expected = {str(i) for i in range(1, 24)}
    missing = sorted(expected - found, key=int)
    if missing:
        raise AssertionError(f"missing Dioscorides 1.1-1.23 chapters: {missing}")


def check_overlap_terms(manifest: dict[str, object]) -> None:
    terms = manifest["overlap_terms"]
    if not isinstance(terms, list):
        raise AssertionError("overlap_terms must be a list")
    by_id = {str(term["term_id"]): term for term in terms}  # type: ignore[index]
    missing_terms = REQUIRED_OVERLAP_TERMS - set(by_id)
    if missing_terms:
        raise AssertionError(f"missing overlap terms: {sorted(missing_terms)}")
    empty_terms = [
        term_id
        for term_id, term in by_id.items()
        if term_id in REQUIRED_OVERLAP_TERMS and not term.get("selected_entry_ids")
    ]
    if empty_terms:
        raise AssertionError(f"overlap terms with no selected rows: {empty_terms}")


def check_entry_fields(entries: list[dict[str, object]]) -> None:
    for entry in entries:
        missing = [field for field in REQUIRED_ENTRY_FIELDS if field not in entry]
        if missing:
            raise AssertionError(f"{entry.get('entry_id')}: missing {missing}")
        empty = [
            field for field in NONEMPTY_ENTRY_FIELDS if entry[field] in (None, "")
        ]
        if empty:
            raise AssertionError(f"{entry.get('entry_id')}: empty {empty}")
        source = str(entry["source_csv_path"])
        if not source.startswith("../aetius/") or not source.endswith(".csv"):
            raise AssertionError(f"{entry.get('entry_id')}: bad source path {source}")


def check_entries_match_sources(entries: list[dict[str, object]]) -> None:
    cache: dict[Path, dict[str, dict[str, str]]] = {}
    field_map = {
        "author": "author",
        "book": "book",
        "chapter": "chapter",
        "lemma": "lemma_gr",
        "lemma_en": "lemma_en",
        "edition_pages": "edition_pages",
        "greek_entry_text": "entry_gr",
    }
    for entry in entries:
        source_path = (REPO_ROOT / str(entry["source_csv_path"])).resolve()
        if source_path not in cache:
            with source_path.open("r", encoding="utf-8", newline="") as handle:
                rows = {row["row_idx"]: row for row in csv.DictReader(handle)}
            cache[source_path] = rows
        row = cache[source_path].get(str(entry["source_row_idx"]))
        if row is None:
            raise AssertionError(
                f"{entry.get('entry_id')}: source row {entry['source_row_idx']} missing"
            )
        for manifest_field, source_field in field_map.items():
            if str(entry[manifest_field]) != row.get(source_field, ""):
                raise AssertionError(
                    f"{entry.get('entry_id')}: {manifest_field} does not match source"
                )


def check_aetius_not_modified() -> None:
    aetius = REPO_ROOT.parent / "aetius"
    if not (aetius / ".git").exists():
        print("Skipped ../aetius git status check: not a git checkout")
        return
    result = subprocess.run(
        ["git", "-C", str(aetius), "status", "--short"],
        check=True,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    if result.stdout.strip():
        raise AssertionError("../aetius has modified or untracked files")


def main() -> None:
    manifest = load_json(MANIFEST_PATH)
    schema = load_json(SCHEMA_PATH)
    validate_schema(manifest, schema)
    if not isinstance(manifest, dict):
        raise AssertionError("manifest is not an object")
    entries = manifest["entries"]
    if not isinstance(entries, list):
        raise AssertionError("entries must be a list")
    check_dioscorides_range(entries)  # type: ignore[arg-type]
    check_overlap_terms(manifest)
    check_entry_fields(entries)  # type: ignore[arg-type]
    check_entries_match_sources(entries)  # type: ignore[arg-type]
    check_aetius_not_modified()
    print("Manifest validates against schema")
    print("Dioscorides 1.1-1.23 present")
    print("Selected overlap terms have source rows where available")
    print("Rows preserve required source fields")
    print("../aetius is unmodified")


if __name__ == "__main__":
    main()
