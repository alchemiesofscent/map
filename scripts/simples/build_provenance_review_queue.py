#!/usr/bin/env python3
"""Build the human review CSV for simples provenance candidates."""
from __future__ import annotations

import csv

from provenance_common import CANDIDATES_PATH, REVIEW_QUEUE_PATH, json_compact, load_json, rel, stable_id


FIELDNAMES = [
    "review_row_id",
    "candidate_id",
    "mention_id",
    "entry_id",
    "lemma",
    "author",
    "work",
    "book",
    "chapter",
    "candidate_place",
    "pleiades_options_json",
    "proposed_relation",
    "certainty",
    "greek_evidence_phrase",
    "context_window",
    "review_decision",
    "accepted_pleiades_id",
    "reviewer_notes",
]


def main() -> None:
    payload = load_json(CANDIDATES_PATH)
    REVIEW_QUEUE_PATH.parent.mkdir(parents=True, exist_ok=True)
    rows = []
    for candidate in payload["candidates"]:
        rows.append(
            {
                "review_row_id": stable_id("review", candidate["candidate_id"]),
                "candidate_id": candidate["candidate_id"],
                "mention_id": candidate["mention_id"],
                "entry_id": candidate["entry_id"],
                "lemma": candidate["lemma"],
                "author": candidate["author"],
                "work": candidate["work"],
                "book": candidate["book"],
                "chapter": candidate["chapter"],
                "candidate_place": candidate["matched_place_surface"],
                "pleiades_options_json": json_compact(candidate["candidate_places"]),
                "proposed_relation": candidate["provisional_relation"],
                "certainty": candidate["certainty"],
                "greek_evidence_phrase": candidate["evidence_phrase"],
                "context_window": candidate["context_window"],
                "review_decision": "",
                "accepted_pleiades_id": "",
                "reviewer_notes": "",
            }
        )
    with REVIEW_QUEUE_PATH.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=FIELDNAMES)
        writer.writeheader()
        writer.writerows(rows)
    print(f"Wrote {rel(REVIEW_QUEUE_PATH)}")
    print(f"Review rows: {len(rows)}")
    print(f"Undecided rows: {len(rows)}")


if __name__ == "__main__":
    main()
