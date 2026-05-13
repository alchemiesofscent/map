#!/usr/bin/env python3
"""Validate provisional provenance candidates."""
from __future__ import annotations

from provenance_common import CANDIDATES_PATH, MENTIONS_PATH, REPO_ROOT, load_json, validate_schema


SCHEMA_PATH = REPO_ROOT / "schemas" / "simples" / "provenance-candidates.schema.json"
ALLOWED_RELATIONS = {
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
}


def main() -> None:
    payload = load_json(CANDIDATES_PATH)
    validate_schema(payload, SCHEMA_PATH)
    mentions = {mention["mention_id"]: mention for mention in load_json(MENTIONS_PATH)["mentions"]}
    candidate_ids: set[str] = set()
    for candidate in payload["candidates"]:
        cid = candidate["candidate_id"]
        if cid in candidate_ids:
            raise AssertionError(f"duplicate candidate_id {cid}")
        candidate_ids.add(cid)
        if candidate["mention_id"] not in mentions:
            raise AssertionError(f"{cid}: unknown mention {candidate['mention_id']}")
        if candidate["provisional_relation"] not in ALLOWED_RELATIONS:
            raise AssertionError(f"{cid}: bad relation {candidate['provisional_relation']}")
        if candidate.get("accepted") is not False:
            raise AssertionError(f"{cid}: candidates must not be accepted before review")
        if not candidate["candidate_pleiades_ids"]:
            raise AssertionError(f"{cid}: no Pleiades ids")
    print("Provenance candidates validate against schema")
    print(f"Candidates: {payload['counts']['candidates']}")
    print(f"By relation: {payload['reports']['candidates_by_relation']}")
    print(f"By author: {payload['reports']['candidates_by_author']}")
    print(f"By certainty: {payload['reports']['candidates_by_certainty']}")
    print(
        "Entries with Pleiades name mentions but no candidate: "
        f"{len(payload['reports']['entries_with_mentions_but_no_candidate'])}"
    )


if __name__ == "__main__":
    main()
