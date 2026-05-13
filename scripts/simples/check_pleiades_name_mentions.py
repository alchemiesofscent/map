#!/usr/bin/env python3
"""Validate Pleiades name mentions."""
from __future__ import annotations

from provenance_common import (
    GAZETTEER_PATH,
    MENTIONS_PATH,
    REPO_ROOT,
    load_json,
    load_manifest_entries,
    normalize_key,
    validate_schema,
)


SCHEMA_PATH = REPO_ROOT / "schemas" / "simples" / "pleiades-name-mentions.schema.json"
ENTRY_LABEL_FIELDS = ["lemma", "chapter_heading_gr", "section_heading_gr"]


def split_label_forms(text: str) -> list[str]:
    for delimiter in (":", ";", "\n"):
        text = text.replace(delimiter, "\n")
    return [form.strip() for form in text.splitlines() if form.strip()]


def entry_label_keys(entry: dict[str, object]) -> set[str]:
    keys: set[str] = set()
    for field in ENTRY_LABEL_FIELDS:
        value = entry.get(field)
        if not isinstance(value, str):
            continue
        for form in split_label_forms(value):
            key = normalize_key(form)
            if key:
                keys.add(key)
    return keys


def starts_with_uppercase(text: str) -> bool:
    for char in text.strip():
        return char.upper() == char and char.lower() != char
    return False


def main() -> None:
    payload = load_json(MENTIONS_PATH)
    validate_schema(payload, SCHEMA_PATH)
    _manifest, entries = load_manifest_entries()
    gazetteer = load_json(GAZETTEER_PATH)
    places = gazetteer["places"]
    mention_ids: set[str] = set()
    for mention in payload["mentions"]:
        mention_id = mention["mention_id"]
        if mention_id in mention_ids:
            raise AssertionError(f"duplicate mention_id {mention_id}")
        mention_ids.add(mention_id)
        if mention["entry_id"] not in entries:
            raise AssertionError(f"{mention_id}: unknown entry {mention['entry_id']}")
        if not mention["candidate_pleiades_ids"]:
            raise AssertionError(f"{mention_id}: no Pleiades candidates")
        entry = entries[mention["entry_id"]]
        if mention["normalized_key"] in entry_label_keys(entry):
            raise AssertionError(f"{mention_id}: entry label matched as place")
        if not starts_with_uppercase(mention["matched_surface"]):
            raise AssertionError(f"{mention_id}: lowercase ordinary-word match")
        for pid in mention["candidate_pleiades_ids"]:
            if pid not in places:
                raise AssertionError(f"{mention_id}: unknown Pleiades id {pid}")
    counts = payload["counts"]
    print("Pleiades name mentions validate against schema")
    print(f"Mentions: {counts['mentions']}")
    print(f"Mentions by author: {payload['reports']['mentions_by_author']}")
    print(f"Mentions by field: {payload['reports']['mentions_by_field']}")
    print(f"Ambiguous mentions: {counts['ambiguous_mentions']}")
    print(f"High-risk mentions: {counts['high_risk_mentions']}")
    print(f"Suppressed entry-label matches: {counts.get('suppressed_entry_label_matches', 0)}")
    print(f"Suppressed lowercase matches: {counts.get('suppressed_lowercase_matches', 0)}")
    print(f"Suppressed alias matches: {counts.get('suppressed_alias_matches', 0)}")


if __name__ == "__main__":
    main()
