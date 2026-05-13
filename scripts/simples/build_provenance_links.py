#!/usr/bin/env python3
"""Build accepted provenance links from reviewed provenance candidates."""
from __future__ import annotations

import csv
from typing import Any

from provenance_common import (
    CANDIDATES_PATH,
    GAZETTEER_PATH,
    LINKS_PATH,
    LLM_ADJUDICATIONS_PATH,
    REVIEW_QUEUE_PATH,
    load_json,
    rel,
    sorted_counter,
    stable_id,
    write_json,
)


EXCLUDED_ACCEPT_RELATIONS = {"context_only", "rejected_candidate"}


def make_link(
    candidate: dict[str, Any],
    places: dict[str, Any],
    relation: str,
    pid: str,
    evidence_phrase: str,
    certainty: str,
    decision_source: str,
    review_row_id: str,
    extras: dict[str, Any] | None = None,
) -> dict[str, Any]:
    place = places[pid]
    link = {
        "link_id": stable_id("link", candidate["candidate_id"], relation, pid),
        "candidate_id": candidate["candidate_id"],
        "review_row_id": review_row_id,
        "entry_id": candidate["entry_id"],
        "lemma": candidate["lemma"],
        "author": candidate["author"],
        "work": candidate["work"],
        "book": candidate["book"],
        "chapter": candidate["chapter"],
        "relation": relation,
        "accepted_pleiades_id": pid,
        "accepted_pleiades_uri": place["pleiades_uri"],
        "place_label": place["title"] or candidate["matched_place_surface"],
        "evidence_phrase": evidence_phrase,
        "certainty": certainty,
        "review_decision_source": decision_source,
    }
    if extras:
        link.update(extras)
    return link


def build_from_llm(
    candidates: dict[str, dict[str, Any]],
    places: dict[str, Any],
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    payload = load_json(LLM_ADJUDICATIONS_PATH)
    adjudications = payload["adjudications"]
    if len(adjudications) != len(candidates):
        raise AssertionError(
            f"{rel(LLM_ADJUDICATIONS_PATH)} is incomplete: "
            f"{len(adjudications)} adjudications for {len(candidates)} candidates"
        )
    links = []
    skipped_accepts = 0
    final_decisions: dict[str, int] = {}
    for adjudication in adjudications:
        candidate = candidates[adjudication["candidate_id"]]
        consensus = adjudication["consensus"]
        decision = consensus["decision"]
        final_decisions[decision] = final_decisions.get(decision, 0) + 1
        if decision != "accept":
            continue
        relation = consensus["relation"]
        pid = consensus["accepted_pleiades_id"]
        if (
            not pid
            or pid not in candidate["candidate_pleiades_ids"]
            or pid not in places
            or relation in EXCLUDED_ACCEPT_RELATIONS
        ):
            skipped_accepts += 1
            continue
        links.append(
            make_link(
                candidate=candidate,
                places=places,
                relation=relation,
                pid=pid,
                evidence_phrase=consensus["evidence_phrase"] or candidate["evidence_phrase"],
                certainty=candidate["certainty"],
                decision_source=rel(LLM_ADJUDICATIONS_PATH),
                review_row_id=stable_id("review", candidate["candidate_id"]),
                extras={
                    "adjudication_id": adjudication["adjudication_id"],
                    "final_decision": decision,
                    "consensus_method": consensus["method"],
                    "consensus_confidence": consensus["confidence"],
                    "vote_trace_ids": [vote["vote_trace_id"] for vote in adjudication["votes"]],
                },
            )
        )
    return links, {
        "source_mode": "llm_consensus",
        "source_review_records": len(adjudications),
        "skipped_invalid_accept_rows": skipped_accepts,
        "review_decisions": dict(sorted(final_decisions.items())),
        "source_llm_adjudications_path": rel(LLM_ADJUDICATIONS_PATH),
    }


def build_from_review_queue(
    candidates: dict[str, dict[str, Any]],
    places: dict[str, Any],
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    with REVIEW_QUEUE_PATH.open("r", encoding="utf-8", newline="") as handle:
        rows = list(csv.DictReader(handle))

    links = []
    review_counts: dict[str, int] = {}
    skipped_accepts = 0
    for row in rows:
        decision = row.get("review_decision", "")
        review_counts[decision or "undecided"] = review_counts.get(decision or "undecided", 0) + 1
        if decision != "accept":
            continue
        candidate = candidates[row["candidate_id"]]
        pid = (row.get("accepted_pleiades_id") or "").strip()
        if not pid or pid not in candidate["candidate_pleiades_ids"] or pid not in places:
            skipped_accepts += 1
            continue
        relation = candidate["provisional_relation"]
        if relation in EXCLUDED_ACCEPT_RELATIONS:
            skipped_accepts += 1
            continue
        links.append(
            make_link(
                candidate=candidate,
                places=places,
                relation=relation,
                pid=pid,
                evidence_phrase=candidate["evidence_phrase"],
                certainty=candidate["certainty"],
                decision_source=rel(REVIEW_QUEUE_PATH),
                review_row_id=row["review_row_id"],
            )
        )
    return links, {
        "source_mode": "human_review_queue",
        "source_review_records": len(rows),
        "skipped_invalid_accept_rows": skipped_accepts,
        "review_decisions": dict(sorted(review_counts.items())),
        "source_llm_adjudications_path": "",
    }


def main() -> None:
    candidates = {candidate["candidate_id"]: candidate for candidate in load_json(CANDIDATES_PATH)["candidates"]}
    gazetteer = load_json(GAZETTEER_PATH)
    places = gazetteer["places"]
    if LLM_ADJUDICATIONS_PATH.exists():
        links, source_report = build_from_llm(candidates, places)
    else:
        links, source_report = build_from_review_queue(candidates, places)

    payload = {
        "metadata": {
            "artifact_id": "simples-provenance-links",
            "stage": "stage_5_accepted_provenance_links",
            "source_candidates_path": rel(CANDIDATES_PATH),
            "source_review_queue_path": rel(REVIEW_QUEUE_PATH),
            "source_llm_adjudications_path": source_report["source_llm_adjudications_path"],
            "source_mode": source_report["source_mode"],
            "notes": [
                "When LLM adjudications exist, final LLM consensus decisions are the review authority.",
                "Without LLM adjudications, rows with review_decision=accept and a valid accepted_pleiades_id become links.",
                "Rejected, undecided, context-only, and uncertain records remain in sidecar review/audit outputs.",
            ],
        },
        "counts": {
            "review_rows": source_report["source_review_records"],
            "accepted_links": len(links),
            "skipped_invalid_accept_rows": source_report["skipped_invalid_accept_rows"],
        },
        "reports": {
            "review_decisions": source_report["review_decisions"],
            "accepted_by_relation": sorted_counter([link["relation"] for link in links]),
            "accepted_by_author": sorted_counter([link["author"] for link in links]),
            "accepted_by_place": sorted_counter([link["place_label"] for link in links]),
            "accepted_by_lemma": sorted_counter([link["lemma"] for link in links]),
        },
        "links": links,
    }
    write_json(LINKS_PATH, payload)
    print(f"Wrote {rel(LINKS_PATH)}")
    print(f"Source mode: {source_report['source_mode']}")
    print(f"Accepted links: {len(links)}")
    print(f"Review decisions: {payload['reports']['review_decisions']}")


if __name__ == "__main__":
    main()
