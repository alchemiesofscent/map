#!/usr/bin/env python3
"""Scan manifest source fields for Pleiades gazetteer names."""
from __future__ import annotations

from typing import Any

from provenance_common import (
    GAZETTEER_PATH,
    MENTIONS_PATH,
    context_window,
    has_greek_script,
    is_token_boundary,
    load_json,
    load_manifest_entries,
    normalize_key,
    normalize_relation_context,
    normalize_with_offsets,
    place_summary,
    rel,
    sorted_counter,
    stable_id,
    write_json,
)


SCAN_FIELDS = [
    "greek_entry_text",
    "lemma",
    "chapter_heading_gr",
    "section_heading_gr",
    "variant_or_parallel_gr",
    "book_no_gr",
    "chapter_no_gr",
]
ENTRY_LABEL_FIELDS = ["lemma", "chapter_heading_gr", "section_heading_gr"]
ALIAS_CUES = ["καλουσιν", "καλειται", "προσαγορευ", "ονομαζ"]


def starts_with_uppercase(text: str) -> bool:
    for char in text.strip():
        return char.upper() == char and char.lower() != char
    return False


def is_alias_context(text: str) -> bool:
    context = normalize_relation_context(text)
    return any(cue in context for cue in ALIAS_CUES)


def split_label_forms(text: str) -> list[str]:
    for delimiter in (":", ";", "\n"):
        text = text.replace(delimiter, "\n")
    return [form.strip() for form in text.splitlines() if form.strip()]


def entry_label_keys(entry: dict[str, Any]) -> set[str]:
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


def mention_sort_key(item: tuple[str, list[str]]) -> tuple[int, int, str]:
    key, _ids = item
    return (-len(key.split()), -len(key), key)


def scan_field(
    entry: dict[str, Any],
    field: str,
    text: str,
    scan_keys: list[tuple[str, list[str]]],
    places: dict[str, Any],
) -> tuple[list[dict[str, Any]], int, int, int]:
    norm_text, offsets = normalize_with_offsets(text)
    if not norm_text:
        return [], 0, 0, 0
    occupied = [False] * len(norm_text)
    mentions: list[dict[str, Any]] = []
    suppressed_entry_label_matches = 0
    suppressed_lowercase_matches = 0
    suppressed_alias_matches = 0
    label_keys = entry_label_keys(entry)
    for key, pleiades_ids in scan_keys:
        pos = norm_text.find(key)
        while pos != -1:
            end = pos + len(key)
            if (
                is_token_boundary(norm_text, pos, end)
                and not any(occupied[pos:end])
                and end <= len(offsets)
            ):
                start_original = offsets[pos]
                end_original = offsets[end - 1] + 1
                matched_surface = text[start_original:end_original]
                if key in label_keys:
                    suppressed_entry_label_matches += 1
                    pos = norm_text.find(key, pos + 1)
                    continue
                if not starts_with_uppercase(matched_surface):
                    suppressed_lowercase_matches += 1
                    pos = norm_text.find(key, pos + 1)
                    continue
                local_context = context_window(text, start_original, end_original)
                alias_context = context_window(text, start_original, end_original, width=35)
                if is_alias_context(alias_context):
                    suppressed_alias_matches += 1
                    pos = norm_text.find(key, pos + 1)
                    continue
                for i in range(pos, end):
                    occupied[i] = True
                options = [place_summary(places[pid]) for pid in pleiades_ids]
                mentions.append(
                    {
                        "mention_id": stable_id(
                            "mention",
                            entry["entry_id"],
                            field,
                            start_original,
                            end_original,
                            key,
                            ",".join(pleiades_ids),
                        ),
                        "entry_id": entry["entry_id"],
                        "author": entry.get("author", ""),
                        "work": entry.get("work", ""),
                        "book": entry.get("book", ""),
                        "chapter": entry.get("chapter", ""),
                        "lemma": entry.get("lemma", ""),
                        "matched_field": field,
                        "matched_surface": matched_surface,
                        "normalized_key": key,
                        "candidate_pleiades_ids": pleiades_ids,
                        "candidate_places": options,
                        "char_offsets": {"start": start_original, "end": end_original},
                        "context_window": local_context,
                        "ambiguity_count": len(pleiades_ids),
                        "is_high_risk": len(key.replace(" ", "")) <= 3 or len(pleiades_ids) >= 10,
                    }
                )
            pos = norm_text.find(key, pos + 1)
    return mentions, suppressed_entry_label_matches, suppressed_lowercase_matches, suppressed_alias_matches


def build_mentions() -> dict[str, Any]:
    _manifest, entries = load_manifest_entries()
    gazetteer = load_json(GAZETTEER_PATH)
    lookup_index: dict[str, list[str]] = gazetteer["lookup_index"]
    places: dict[str, Any] = gazetteer["places"]
    scan_keys = sorted(
        [
            (key, ids)
            for key, ids in lookup_index.items()
            if has_greek_script(key) and len(key.replace(" ", "")) >= 3
        ],
        key=mention_sort_key,
    )
    mentions: list[dict[str, Any]] = []
    suppressed_entry_label_matches = 0
    suppressed_lowercase_matches = 0
    suppressed_alias_matches = 0
    for entry in entries.values():
        for field in SCAN_FIELDS:
            value = entry.get(field)
            if not isinstance(value, str) or not value.strip():
                continue
            (
                field_mentions,
                field_entry_label_suppressed,
                field_lowercase_suppressed,
                field_alias_suppressed,
            ) = scan_field(entry, field, value, scan_keys, places)
            mentions.extend(field_mentions)
            suppressed_entry_label_matches += field_entry_label_suppressed
            suppressed_lowercase_matches += field_lowercase_suppressed
            suppressed_alias_matches += field_alias_suppressed

    by_author = sorted_counter([mention["author"] for mention in mentions])
    by_entry = sorted_counter([mention["entry_id"] for mention in mentions])
    by_field = sorted_counter([mention["matched_field"] for mention in mentions])
    high_risk = [mention for mention in mentions if mention["is_high_risk"]]
    ambiguous = [mention for mention in mentions if mention["ambiguity_count"] > 1]
    return {
        "metadata": {
            "artifact_id": "simples-pleiades-name-mentions",
            "stage": "stage_2_scan_source_text_for_pleiades_names",
            "source_manifest_path": rel(__import__("provenance_common").MANIFEST_PATH),
            "source_gazetteer_path": rel(GAZETTEER_PATH),
            "scanned_fields": SCAN_FIELDS,
            "matching": "longest normalized Pleiades Greek-script lookup keys first; occupied spans suppress shorter overlaps",
        },
        "counts": {
            "entries_scanned": len(entries),
            "lookup_keys_scanned": len(scan_keys),
            "mentions": len(mentions),
            "entries_with_mentions": len({mention["entry_id"] for mention in mentions}),
            "ambiguous_mentions": len(ambiguous),
            "high_risk_mentions": len(high_risk),
            "suppressed_entry_label_matches": suppressed_entry_label_matches,
            "suppressed_lowercase_matches": suppressed_lowercase_matches,
            "suppressed_alias_matches": suppressed_alias_matches,
        },
        "reports": {
            "mentions_by_author": by_author,
            "mentions_by_entry": by_entry,
            "mentions_by_field": by_field,
            "high_risk_mentions": [
                {
                    "mention_id": mention["mention_id"],
                    "entry_id": mention["entry_id"],
                    "normalized_key": mention["normalized_key"],
                    "ambiguity_count": mention["ambiguity_count"],
                }
                for mention in high_risk
            ],
        },
        "mentions": mentions,
    }


def main() -> None:
    payload = build_mentions()
    write_json(MENTIONS_PATH, payload)
    counts = payload["counts"]
    print(f"Wrote {rel(MENTIONS_PATH)}")
    print(f"Entries scanned: {counts['entries_scanned']}")
    print(f"Lookup keys scanned: {counts['lookup_keys_scanned']}")
    print(f"Mentions: {counts['mentions']}")
    print(f"Entries with mentions: {counts['entries_with_mentions']}")
    print(f"Ambiguous mentions: {counts['ambiguous_mentions']}")
    print(f"High-risk mentions: {counts['high_risk_mentions']}")
    print(f"Suppressed entry-label matches: {counts['suppressed_entry_label_matches']}")
    print(f"Suppressed lowercase matches: {counts['suppressed_lowercase_matches']}")
    print(f"Suppressed alias matches: {counts['suppressed_alias_matches']}")


if __name__ == "__main__":
    main()
