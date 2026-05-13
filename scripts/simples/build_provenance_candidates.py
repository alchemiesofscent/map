#!/usr/bin/env python3
"""Convert Pleiades name mentions into provisional provenance candidates."""
from __future__ import annotations

from typing import Any

from provenance_common import (
    CANDIDATES_PATH,
    MENTIONS_PATH,
    context_window,
    normalize_key,
    load_json,
    normalize_relation_context,
    rel,
    sorted_counter,
    stable_id,
    write_json,
)


RELATIONS = [
    "named_variety_from",
    "grows_at",
    "produced_at",
    "sourced_from",
    "acquired",
    "observed",
    "tested",
    "prepared",
    "context_only",
    "rejected_candidate",
]

FIELD_NAMED_VARIETY_HINTS = {"lemma", "chapter_heading_gr", "section_heading_gr", "variant_or_parallel_gr"}
RULES: list[tuple[str, list[str], str]] = [
    ("acquired", ["εκομισ", "κομιζ", "κομισ"], "authorial acquisition/transport wording"),
    ("observed", ["ειδον", "εωρακ", "θεασ", "αυτοπ"], "authorial observation wording"),
    ("tested", ["εχρησ", "δοκιμ", "πειρα"], "testing or use wording"),
    ("prepared", ["σκευαζ", "παρασκευ", "κατασκευ"], "preparation wording"),
    ("sourced_from", [" απο ", " εξ ", " εκ ", "φερομεν", "κομιζομεν"], "source/preposition wording"),
    ("grows_at", ["φυεται", "φυομεν", "γενναται", "γεννωμεν", "γινεται", "βλασταν", "πλειστ"], "growth or abundance wording"),
    ("produced_at", ["γενναται", "γινεται", "ορυσσ", "μεταλλ", "λιθοτομ"], "production/extraction wording"),
]


def classify(mention: dict[str, Any]) -> tuple[str, str, str]:
    key_len = len(mention["normalized_key"].replace(" ", ""))
    if key_len <= 2 or mention["ambiguity_count"] >= 25:
        return (
            "rejected_candidate",
            "rejected",
            "high-risk key length or excessive Pleiades ambiguity",
        )
    context = normalize_relation_context(mention["context_window"])
    if mention["matched_field"] in FIELD_NAMED_VARIETY_HINTS:
        field_context = normalize_key(mention["context_window"].strip("…"))
        lemma_key = normalize_key(mention.get("lemma", ""))
        if field_context == mention["normalized_key"] or lemma_key == mention["normalized_key"]:
            return (
                "context_only",
                "context_only",
                "Pleiades key matches the simple label itself, not a geographic qualifier",
            )
        return ("named_variety_from", "possible", "place name occurs in lemma or heading field")
    for relation, needles, reason in RULES:
        if any(needle in f" {context} " for needle in needles):
            return (relation, "possible", reason)
    return ("context_only", "context_only", "Pleiades name occurs locally but no deterministic provenance cue matched")


def build_candidates() -> dict[str, Any]:
    mentions_payload = load_json(MENTIONS_PATH)
    mentions = mentions_payload["mentions"]
    candidates: list[dict[str, Any]] = []
    for mention in mentions:
        relation, certainty, reason = classify(mention)
        start = mention["char_offsets"]["start"]
        end = mention["char_offsets"]["end"]
        evidence = context_window(mention["context_window"], 0, len(mention["context_window"]), width=0)
        candidates.append(
            {
                "candidate_id": stable_id("candidate", mention["mention_id"], relation),
                "mention_id": mention["mention_id"],
                "entry_id": mention["entry_id"],
                "author": mention.get("author", ""),
                "work": mention.get("work", ""),
                "book": mention.get("book", ""),
                "chapter": mention.get("chapter", ""),
                "lemma": mention.get("lemma", ""),
                "subject_label": mention.get("lemma", ""),
                "matched_place_surface": mention["matched_surface"],
                "normalized_key": mention["normalized_key"],
                "candidate_pleiades_ids": mention["candidate_pleiades_ids"],
                "candidate_places": mention["candidate_places"],
                "provisional_relation": relation,
                "certainty": certainty,
                "evidence_phrase": evidence,
                "context_window": mention["context_window"],
                "matched_field": mention["matched_field"],
                "source_char_offsets": {"start": start, "end": end},
                "classifier_reason": reason,
                "accepted": False,
                "notes": "",
            }
        )
    mention_entries = {mention["entry_id"] for mention in mentions}
    candidate_entries = {candidate["entry_id"] for candidate in candidates}
    return {
        "metadata": {
            "artifact_id": "simples-provenance-candidates",
            "stage": "stage_3_filter_mentions_into_provenance_candidates",
            "source_mentions_path": rel(MENTIONS_PATH),
            "relations": RELATIONS,
            "notes": [
                "Candidates are provisional and deterministic.",
                "No candidate is accepted before human review.",
                "Context-only and rejected candidates are retained for audit.",
            ],
        },
        "counts": {
            "mentions_in": len(mentions),
            "candidates": len(candidates),
            "mention_entries_without_candidate": len(mention_entries - candidate_entries),
        },
        "reports": {
            "candidates_by_relation": sorted_counter([candidate["provisional_relation"] for candidate in candidates]),
            "candidates_by_author": sorted_counter([candidate["author"] for candidate in candidates]),
            "candidates_by_certainty": sorted_counter([candidate["certainty"] for candidate in candidates]),
            "entries_with_mentions_but_no_candidate": sorted(mention_entries - candidate_entries),
        },
        "candidates": candidates,
    }


def main() -> None:
    payload = build_candidates()
    write_json(CANDIDATES_PATH, payload)
    print(f"Wrote {rel(CANDIDATES_PATH)}")
    print(f"Mentions in: {payload['counts']['mentions_in']}")
    print(f"Candidates: {payload['counts']['candidates']}")
    print(f"By relation: {payload['reports']['candidates_by_relation']}")
    print(f"By certainty: {payload['reports']['candidates_by_certainty']}")


if __name__ == "__main__":
    main()
