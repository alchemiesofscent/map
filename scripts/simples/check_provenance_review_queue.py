#!/usr/bin/env python3
"""Validate the simples provenance review queue."""
from __future__ import annotations

import csv
import json

from provenance_common import CANDIDATES_PATH, REVIEW_QUEUE_PATH, load_json


ALLOWED_DECISIONS = {
    "",
    "accept",
    "reject",
    "context_only",
    "uncertain",
    "needs_more_context",
    "wrong_pleiades_match",
}


def main() -> None:
    candidates = {candidate["candidate_id"]: candidate for candidate in load_json(CANDIDATES_PATH)["candidates"]}
    with REVIEW_QUEUE_PATH.open("r", encoding="utf-8", newline="") as handle:
        rows = list(csv.DictReader(handle))
    seen: set[str] = set()
    undecided = 0
    decisions: dict[str, int] = {}
    for row in rows:
        row_id = row["review_row_id"]
        if row_id in seen:
            raise AssertionError(f"duplicate review_row_id {row_id}")
        seen.add(row_id)
        candidate_id = row["candidate_id"]
        if candidate_id not in candidates:
            raise AssertionError(f"{row_id}: unknown candidate {candidate_id}")
        decision = row.get("review_decision", "")
        if decision not in ALLOWED_DECISIONS:
            raise AssertionError(f"{row_id}: invalid decision {decision}")
        if not decision:
            undecided += 1
        decisions[decision or "undecided"] = decisions.get(decision or "undecided", 0) + 1
        try:
            options = json.loads(row["pleiades_options_json"])
        except json.JSONDecodeError as exc:
            raise AssertionError(f"{row_id}: bad Pleiades options JSON") from exc
        if not isinstance(options, list) or not options:
            raise AssertionError(f"{row_id}: empty Pleiades options")
    print("Review queue validates")
    print(f"Review rows: {len(rows)}")
    print(f"Undecided rows: {undecided}")
    print(f"Decisions: {dict(sorted(decisions.items()))}")


if __name__ == "__main__":
    main()
