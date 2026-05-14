#!/usr/bin/env python3
"""Validate accepted TEI-derived provenance links."""
from __future__ import annotations

from provenance_common import (
    DEPRECATED_ARABIA_PLEIADES_ID,
    ENTRY_CLAIMS_PATH,
    GAZETTEER_PATH,
    LINKS_PATH,
    REPO_ROOT,
    canonical_provenance_pleiades_id,
    load_json,
    rel,
    validate_schema,
)


SCHEMA_PATH = REPO_ROOT / "schemas" / "simples" / "provenance-links.schema.json"
EXPECTED_COUNTS = {
    "balsamum": 1,
    "cardamom": 5,
    "calamus": 1,
    "schoinos": 3,
    "myrrh": 4,
}


def main() -> None:
    payload = load_json(LINKS_PATH)
    validate_schema(payload, SCHEMA_PATH)
    places = load_json(GAZETTEER_PATH)["places"]
    entry_claims = {
        claim["claim_id"]: claim for claim in load_json(ENTRY_CLAIMS_PATH).get("claims", [])
    }
    if payload["metadata"].get("source_mode") != "tei_placeName_claims":
        raise AssertionError("accepted links must use source_mode=tei_placeName_claims")
    link_ids: set[str] = set()
    for link in payload["links"]:
        lid = link["link_id"]
        if lid in link_ids:
            raise AssertionError(f"duplicate link_id {lid}")
        link_ids.add(lid)
        if link["accepted_pleiades_id"] == DEPRECATED_ARABIA_PLEIADES_ID:
            raise AssertionError(f"{lid}: Arabia provenance must not emit 981506")
        claim = entry_claims.get(link["claim_id"])
        if not claim:
            raise AssertionError(f"{lid}: unknown entry-level claim")
        if link.get("entry_claim_source") != rel(ENTRY_CLAIMS_PATH):
            raise AssertionError(f"{lid}: link missing entry_claim_source")
        if link["accepted_pleiades_id"] != canonical_provenance_pleiades_id(claim["accepted_pleiades_id"]):
            raise AssertionError(f"{lid}: link Pleiades ID does not match TEI claim")
        if link["relation"] != claim["relation"]:
            raise AssertionError(f"{lid}: link relation does not match TEI claim")
        if link["evidence_phrase"] != claim["evidence_phrase"]:
            raise AssertionError(f"{lid}: link evidence does not match TEI claim")
        if link.get("claim_order") != claim["claim_order"]:
            raise AssertionError(f"{lid}: claim order mismatch")
        if link["accepted_pleiades_id"] not in places:
            raise AssertionError(f"{lid}: unknown Pleiades id")
        if link["relation"] in {"context_only", "rejected_candidate", "rejected"}:
            raise AssertionError(f"{lid}: context-only/rejected relation promoted")
        source = link["review_decision_source"]
        if "provenance_llm_adjudications" in source or "simples_provenance_review" in source:
            raise AssertionError(f"{lid}: stale review/LLM sidecar used as authority")

    counts: dict[str, int] = {}
    for link in payload["links"]:
        counts[link["ingredient_key"]] = counts.get(link["ingredient_key"], 0) + 1
    if counts != EXPECTED_COUNTS:
        raise AssertionError(f"expected counts {EXPECTED_COUNTS}, found {counts}")
    print("Accepted provenance links validate against schema")
    print(f"Accepted links: {payload['counts']['accepted_links']}")
    print(f"Accepted by ingredient: {payload['reports']['accepted_by_ingredient']}")
    print(f"Accepted by place: {payload['reports']['accepted_by_place']}")


if __name__ == "__main__":
    main()
