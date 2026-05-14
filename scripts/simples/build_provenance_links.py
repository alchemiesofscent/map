#!/usr/bin/env python3
"""Build accepted provenance links from TEI-derived Materia claims."""
from __future__ import annotations

from typing import Any

from provenance_common import (
    ENTRY_CLAIMS_PATH,
    GAZETTEER_PATH,
    LINKS_PATH,
    canonical_provenance_pleiades_id,
    load_json,
    rel,
    sorted_counter,
    stable_id,
    write_json,
)


EXCLUDED_ACCEPT_RELATIONS = {"context_only", "rejected_candidate", "rejected"}


def canonical_pid(pid: str) -> str:
    return canonical_provenance_pleiades_id(pid)


def make_link(claim: dict[str, Any], places: dict[str, Any]) -> dict[str, Any]:
    pid = canonical_pid(claim["accepted_pleiades_id"])
    if pid not in places:
        raise AssertionError(f"{claim['claim_id']}: unknown accepted_pleiades_id {pid}")
    if claim["relation"] in EXCLUDED_ACCEPT_RELATIONS:
        raise AssertionError(f"{claim['claim_id']}: excluded relation promoted")
    place = places[pid]
    return {
        "link_id": stable_id("link", claim["claim_id"], claim["relation"], pid),
        "candidate_id": "",
        "claim_id": claim["claim_id"],
        "review_row_id": "",
        "entry_id": claim["entry_id"],
        "passage_id": claim.get("passage_id", claim["entry_id"]),
        "ingredient_key": claim["ingredient_key"],
        "lemma": claim["lemma"],
        "lemma_en": claim.get("lemma_en", ""),
        "author": claim["author"],
        "work": claim["work"],
        "book": claim["book"],
        "chapter": claim["chapter"],
        "source_xml_id": claim.get("source_xml_id", ""),
        "source_tei_path": claim.get("source_tei_path", ""),
        "source_citation": claim.get("source_citation", ""),
        "relation": claim["relation"],
        "accepted_pleiades_id": pid,
        "accepted_pleiades_uri": place["pleiades_uri"],
        "place_label": place.get("title") or claim.get("place_surface", ""),
        "evidence_phrase": claim["evidence_phrase"],
        "certainty": claim.get("certainty", "secure"),
        "review_decision_source": claim.get("review_decision_source", ""),
        "entry_claim_source": rel(ENTRY_CLAIMS_PATH),
        "place_surface": claim.get("place_surface", ""),
        "qualifier": claim.get("qualifier", ""),
        "claim_group": claim.get("claim_group", ""),
        "claim_note": claim.get("claim_note", ""),
        "claim_order": claim.get("claim_order"),
        "final_decision": "accept",
        "consensus_method": claim.get("consensus_method", "tei_placeName_annotation"),
        "consensus_confidence": claim.get("consensus_confidence", claim.get("confidence")),
        "vote_trace_ids": [],
        "warnings": claim.get("warnings", []),
    }


def link_sort_key(link: dict[str, Any]) -> tuple[object, ...]:
    return (
        link.get("ingredient_key", ""),
        link.get("claim_order") if link.get("claim_order") is not None else 9999,
        str(link.get("book", "")),
        str(link.get("chapter", "")),
        link.get("place_label", ""),
        link.get("link_id", ""),
    )


def main() -> None:
    entry_claims_payload = load_json(ENTRY_CLAIMS_PATH)
    places = load_json(GAZETTEER_PATH)["places"]
    claims = [
        claim
        for claim in entry_claims_payload.get("claims", [])
        if claim.get("final_decision") == "accept"
    ]
    links = sorted([make_link(claim, places) for claim in claims], key=link_sort_key)

    payload = {
        "metadata": {
            "artifact_id": "simples-provenance-links",
            "stage": "stage_3_accepted_tei_provenance_links",
            "source_entry_claims_path": rel(ENTRY_CLAIMS_PATH),
            "source_mode": "tei_placeName_claims",
            "notes": [
                "Accepted links derive only from TEI placeName annotations normalized in provenance_entry_claims.json.",
                "Old review queues, Pleiades mention candidates, and LLM adjudication sidecars are not promoted.",
                "Rejected, undecided, context-only, and uncertain records remain out of accepted map output.",
            ],
        },
        "counts": {
            "tei_claims": len(claims),
            "accepted_links": len(links),
            "skipped_invalid_accept_rows": 0,
        },
        "reports": {
            "accepted_by_ingredient": sorted_counter([link["ingredient_key"] for link in links]),
            "accepted_by_relation": sorted_counter([link["relation"] for link in links]),
            "accepted_by_author": sorted_counter([link["author"] for link in links]),
            "accepted_by_place": sorted_counter([link["place_label"] for link in links]),
            "accepted_by_lemma": sorted_counter([link["lemma"] for link in links]),
        },
        "links": links,
    }
    write_json(LINKS_PATH, payload)
    print(f"Wrote {rel(LINKS_PATH)}")
    print("Source mode: tei_placeName_claims")
    print(f"Accepted links: {len(links)}")
    print(f"Accepted by ingredient: {payload['reports']['accepted_by_ingredient']}")


if __name__ == "__main__":
    main()
