#!/usr/bin/env python3
"""Validate LLM consensus provenance adjudications."""
from __future__ import annotations

from collections import Counter
from typing import Any

from provenance_common import (
    CANDIDATES_PATH,
    GAZETTEER_PATH,
    LLM_ADJUDICATIONS_PATH,
    REPO_ROOT,
    load_json,
    validate_schema,
)


SCHEMA_PATH = REPO_ROOT / "schemas" / "simples" / "provenance-llm-adjudications.schema.json"
ALLOWED_DECISIONS = {
    "accept",
    "reject",
    "context_only",
    "uncertain",
    "needs_more_context",
    "wrong_pleiades_match",
}
ALLOWED_RELATIONS = {
    "",
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
EXCLUDED_ACCEPT_RELATIONS = {"", "context_only", "rejected_candidate"}
VOTE_FIELDS = {
    "decision",
    "supported",
    "relation",
    "accepted_pleiades_id",
    "confidence",
    "evidence_phrase",
    "rationale",
    "warnings",
}


def vote_key(vote: dict[str, Any]) -> str:
    response = vote["response"]
    decision = response["decision"]
    if decision == "accept":
        return "|".join(
            [
                decision,
                response.get("relation", ""),
                response.get("accepted_pleiades_id", ""),
            ]
        )
    return decision


def check_vote_response(
    candidate: dict[str, Any],
    vote: dict[str, Any],
    vote_ids: set[str],
) -> None:
    vote_id = vote["vote_trace_id"]
    if vote_id in vote_ids:
        raise AssertionError(f"duplicate vote_trace_id {vote_id}")
    vote_ids.add(vote_id)
    if vote["candidate_id"] != candidate["candidate_id"]:
        raise AssertionError(f"{vote_id}: vote candidate_id does not match adjudication")
    response = vote["response"]
    keys = set(response)
    if keys != VOTE_FIELDS:
        raise AssertionError(
            f"{vote_id}: vote response fields mismatch; "
            f"missing={sorted(VOTE_FIELDS - keys)} extra={sorted(keys - VOTE_FIELDS)}"
        )
    decision = response["decision"]
    if decision not in ALLOWED_DECISIONS:
        raise AssertionError(f"{vote_id}: invalid decision {decision}")
    relation = response["relation"]
    if relation not in ALLOWED_RELATIONS:
        raise AssertionError(f"{vote_id}: invalid relation {relation}")
    confidence = response["confidence"]
    if not isinstance(confidence, (int, float)) or not 0 <= confidence <= 1:
        raise AssertionError(f"{vote_id}: confidence out of range")
    if not isinstance(response["warnings"], list) or not all(
        isinstance(item, str) for item in response["warnings"]
    ):
        raise AssertionError(f"{vote_id}: warnings must be string array")
    accepted_pid = response["accepted_pleiades_id"]
    if decision == "accept":
        if response["supported"] is not True:
            raise AssertionError(f"{vote_id}: accept vote must be supported")
        if relation in EXCLUDED_ACCEPT_RELATIONS:
            raise AssertionError(f"{vote_id}: accept vote uses non-provenance relation")
        if accepted_pid not in candidate["candidate_pleiades_ids"]:
            raise AssertionError(f"{vote_id}: accept vote uses non-candidate Pleiades ID")
    else:
        if response["supported"] is not False:
            raise AssertionError(f"{vote_id}: non-accept vote must not be supported")
        if accepted_pid:
            raise AssertionError(f"{vote_id}: non-accept vote must not carry accepted ID")


def check_consensus(candidate: dict[str, Any], adjudication: dict[str, Any]) -> None:
    votes = adjudication["votes"]
    first_key = vote_key(votes[0])
    second_key = vote_key(votes[1])
    consensus = adjudication["consensus"]
    if first_key == second_key:
        if len(votes) != 2:
            raise AssertionError(f"{adjudication['adjudication_id']}: unnecessary third vote")
        if consensus["method"] != "two_vote_match":
            raise AssertionError(f"{adjudication['adjudication_id']}: bad consensus method")
        expected_decision = votes[0]["response"]["decision"]
    else:
        if len(votes) != 3:
            raise AssertionError(f"{adjudication['adjudication_id']}: missing third vote")
        counts = Counter(vote_key(vote) for vote in votes)
        top_key, top_count = counts.most_common(1)[0]
        if top_count < 2:
            if consensus["method"] != "all_different_uncertain":
                raise AssertionError(f"{adjudication['adjudication_id']}: expected all-different method")
            expected_decision = "uncertain"
        else:
            if consensus["method"] != "three_vote_majority":
                raise AssertionError(f"{adjudication['adjudication_id']}: expected majority method")
            expected_decision = next(
                vote["response"]["decision"] for vote in votes if vote_key(vote) == top_key
            )
    if consensus["decision"] != expected_decision:
        raise AssertionError(
            f"{adjudication['adjudication_id']}: final decision {consensus['decision']} "
            f"does not match expected {expected_decision}"
        )
    if consensus["decision"] == "accept":
        if consensus["supported"] is not True:
            raise AssertionError(f"{adjudication['adjudication_id']}: final accept not supported")
        if consensus["relation"] in EXCLUDED_ACCEPT_RELATIONS:
            raise AssertionError(f"{adjudication['adjudication_id']}: final accept has bad relation")
        if consensus["accepted_pleiades_id"] not in candidate["candidate_pleiades_ids"]:
            raise AssertionError(
                f"{adjudication['adjudication_id']}: final accept uses non-candidate Pleiades ID"
            )
    else:
        if consensus["supported"] is not False:
            raise AssertionError(f"{adjudication['adjudication_id']}: non-accept consensus supported")
        if consensus["accepted_pleiades_id"]:
            raise AssertionError(
                f"{adjudication['adjudication_id']}: non-accept consensus carries accepted ID"
            )


def main() -> None:
    payload = load_json(LLM_ADJUDICATIONS_PATH)
    validate_schema(payload, SCHEMA_PATH)
    candidates = {candidate["candidate_id"]: candidate for candidate in load_json(CANDIDATES_PATH)["candidates"]}
    places = load_json(GAZETTEER_PATH)["places"]
    if payload["counts"]["candidates_in"] != len(candidates):
        raise AssertionError("candidates_in does not match candidate artifact")
    adjudications = payload["adjudications"]
    if len(adjudications) != len(candidates):
        raise AssertionError(
            f"expected {len(candidates)} adjudications, found {len(adjudications)}"
        )
    seen_candidate_ids: set[str] = set()
    seen_adjudication_ids: set[str] = set()
    seen_vote_ids: set[str] = set()
    final_decisions: list[str] = []
    vote_total = 0
    third_votes = 0
    final_accepts = 0
    for adjudication in adjudications:
        adjudication_id = adjudication["adjudication_id"]
        if adjudication_id in seen_adjudication_ids:
            raise AssertionError(f"duplicate adjudication_id {adjudication_id}")
        seen_adjudication_ids.add(adjudication_id)
        candidate_id = adjudication["candidate_id"]
        candidate = candidates.get(candidate_id)
        if not candidate:
            raise AssertionError(f"{adjudication_id}: unknown candidate {candidate_id}")
        if candidate_id in seen_candidate_ids:
            raise AssertionError(f"duplicate adjudication for {candidate_id}")
        seen_candidate_ids.add(candidate_id)
        if adjudication["entry_id"] != candidate["entry_id"]:
            raise AssertionError(f"{adjudication_id}: entry_id does not match candidate")
        for pid in candidate["candidate_pleiades_ids"]:
            if pid not in places:
                raise AssertionError(f"{candidate_id}: candidate Pleiades ID not in gazetteer")
        votes = adjudication["votes"]
        vote_total += len(votes)
        if len(votes) == 3:
            third_votes += 1
        for vote in votes:
            check_vote_response(candidate, vote, seen_vote_ids)
        check_consensus(candidate, adjudication)
        decision = adjudication["consensus"]["decision"]
        final_decisions.append(decision)
        if decision == "accept":
            final_accepts += 1
    missing = sorted(set(candidates) - seen_candidate_ids)
    if missing:
        raise AssertionError(f"missing adjudications: {missing}")
    if payload["counts"]["adjudications"] != len(adjudications):
        raise AssertionError("adjudication count mismatch")
    if payload["counts"]["votes"] != vote_total:
        raise AssertionError("vote count mismatch")
    if payload["counts"]["third_votes"] != third_votes:
        raise AssertionError("third vote count mismatch")
    if payload["counts"]["final_accepts"] != final_accepts:
        raise AssertionError("final accept count mismatch")
    print("LLM provenance adjudications validate against schema")
    print(f"Adjudications: {len(adjudications)}")
    print(f"Votes: {vote_total}")
    print(f"Third votes: {third_votes}")
    print(f"Final decisions: {dict(sorted(Counter(final_decisions).items()))}")


if __name__ == "__main__":
    main()
