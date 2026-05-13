#!/usr/bin/env python3
"""Validate accepted provenance links."""
from __future__ import annotations

import csv

from provenance_common import (
    CANDIDATES_PATH,
    GAZETTEER_PATH,
    LINKS_PATH,
    LLM_ADJUDICATIONS_PATH,
    REVIEW_QUEUE_PATH,
    REPO_ROOT,
    load_json,
    rel,
    validate_schema,
)


SCHEMA_PATH = REPO_ROOT / "schemas" / "simples" / "provenance-links.schema.json"


def main() -> None:
    payload = load_json(LINKS_PATH)
    validate_schema(payload, SCHEMA_PATH)
    places = load_json(GAZETTEER_PATH)["places"]
    candidates = {candidate["candidate_id"]: candidate for candidate in load_json(CANDIDATES_PATH)["candidates"]}
    with REVIEW_QUEUE_PATH.open("r", encoding="utf-8", newline="") as handle:
        review_rows = {row["review_row_id"]: row for row in csv.DictReader(handle)}
    llm_adjudications = {}
    if LLM_ADJUDICATIONS_PATH.exists():
        llm_payload = load_json(LLM_ADJUDICATIONS_PATH)
        llm_adjudications = {
            item["adjudication_id"]: item for item in llm_payload.get("adjudications", [])
        }
    link_ids: set[str] = set()
    for link in payload["links"]:
        lid = link["link_id"]
        if lid in link_ids:
            raise AssertionError(f"duplicate link_id {lid}")
        link_ids.add(lid)
        candidate = candidates.get(link["candidate_id"])
        if not candidate:
            raise AssertionError(f"{lid}: unknown candidate")
        if link["accepted_pleiades_id"] not in candidate["candidate_pleiades_ids"]:
            raise AssertionError(f"{lid}: accepted Pleiades ID is not a candidate option")
        if link["accepted_pleiades_id"] not in places:
            raise AssertionError(f"{lid}: unknown Pleiades id")
        if link["relation"] in {"context_only", "rejected_candidate"}:
            raise AssertionError(f"{lid}: context-only/rejected relation promoted")
        source = link["review_decision_source"]
        if source == rel(LLM_ADJUDICATIONS_PATH):
            adjudication = llm_adjudications.get(link.get("adjudication_id", ""))
            if not adjudication:
                raise AssertionError(f"{lid}: LLM-sourced link without adjudication")
            consensus = adjudication["consensus"]
            if consensus["decision"] != "accept":
                raise AssertionError(f"{lid}: LLM-sourced link without final accept")
            if consensus["relation"] != link["relation"]:
                raise AssertionError(f"{lid}: link relation does not match consensus")
            if consensus["accepted_pleiades_id"] != link["accepted_pleiades_id"]:
                raise AssertionError(f"{lid}: link Pleiades ID does not match consensus")
            if link.get("consensus_confidence") != consensus["confidence"]:
                raise AssertionError(f"{lid}: consensus confidence mismatch")
            expected_vote_ids = [vote["vote_trace_id"] for vote in adjudication["votes"]]
            if link.get("vote_trace_ids") != expected_vote_ids:
                raise AssertionError(f"{lid}: vote trace IDs mismatch")
        elif source == rel(REVIEW_QUEUE_PATH):
            row = review_rows.get(link["review_row_id"])
            if not row or row.get("review_decision") != "accept":
                raise AssertionError(f"{lid}: accepted link without accepted review row")
        else:
            raise AssertionError(f"{lid}: unknown review decision source {source}")
    print("Accepted provenance links validate against schema")
    print(f"Accepted links: {payload['counts']['accepted_links']}")
    print(f"Accepted by relation: {payload['reports']['accepted_by_relation']}")
    print(f"Accepted by author: {payload['reports']['accepted_by_author']}")
    print(f"Accepted by place: {payload['reports']['accepted_by_place']}")
    print(f"Accepted by lemma: {payload['reports']['accepted_by_lemma']}")


if __name__ == "__main__":
    main()
