#!/usr/bin/env python3
"""Validate TEI-derived Materia provenance claims."""
from __future__ import annotations

from provenance_common import (
    DEPRECATED_ARABIA_PLEIADES_ID,
    ENTRY_CLAIMS_PATH,
    GAZETTEER_PATH,
    MANIFEST_PATH,
    REPO_ROOT,
    load_json,
    normalized_contains,
    validate_schema,
)


SCHEMA_PATH = REPO_ROOT / "schemas" / "simples" / "provenance-entry-claims.schema.json"

EXPECTED_STOPS = {
    "balsamum": ["687934"],
    "cardamom": ["658443", "874350", "520977", "50004", "1001942"],
    "calamus": ["50004"],
    "schoinos": ["29677", "1001942", "716588"],
    "myrrh": ["1001942", "39435", "39386", "540689"],
}


def main() -> int:
    payload = load_json(ENTRY_CLAIMS_PATH)
    validate_schema(payload, SCHEMA_PATH)
    entries = {entry["entry_id"]: entry for entry in load_json(MANIFEST_PATH).get("entries", [])}
    places = load_json(GAZETTEER_PATH)["places"]

    claim_ids: set[str] = set()
    for claim in payload["claims"]:
        claim_id = claim["claim_id"]
        if claim_id in claim_ids:
            raise AssertionError(f"duplicate claim_id {claim_id}")
        claim_ids.add(claim_id)
        entry = entries.get(claim["entry_id"])
        if not entry:
            raise AssertionError(f"{claim_id}: unknown entry_id")
        if claim["ingredient_key"] not in entry.get("ingredient_keys", []):
            raise AssertionError(f"{claim_id}: ingredient not listed on manifest entry")
        if claim["accepted_pleiades_id"] not in places:
            raise AssertionError(f"{claim_id}: unknown accepted_pleiades_id")
        if claim["accepted_pleiades_id"] == DEPRECATED_ARABIA_PLEIADES_ID:
            raise AssertionError(f"{claim_id}: Arabia provenance must not use 981506")
        greek = entry.get("greek_entry_text", "")
        if not normalized_contains(greek, claim["evidence_phrase"]):
            raise AssertionError(f"{claim_id}: evidence phrase not in Greek entry")
        if not normalized_contains(greek, claim["place_surface"]):
            raise AssertionError(f"{claim_id}: place surface not in Greek entry")
        if claim["relation"] in {"context_only", "rejected_candidate", "rejected"}:
            raise AssertionError(f"{claim_id}: excluded relation promoted")
        if claim["final_decision"] != "accept":
            raise AssertionError(f"{claim_id}: non-accept final decision")
        if "provenance_llm_adjudications" in claim.get("review_decision_source", ""):
            raise AssertionError(f"{claim_id}: old LLM sidecar used as authority")
        if "simples_provenance_review" in claim.get("review_decision_source", ""):
            raise AssertionError(f"{claim_id}: old review CSV used as authority")

    by_ingredient: dict[str, list[dict[str, object]]] = {}
    for claim in payload["claims"]:
        by_ingredient.setdefault(claim["ingredient_key"], []).append(claim)
    if set(by_ingredient) != set(EXPECTED_STOPS):
        raise AssertionError(f"expected ingredients {sorted(EXPECTED_STOPS)}, found {sorted(by_ingredient)}")
    for ingredient_key, expected_pids in EXPECTED_STOPS.items():
        claims = sorted(by_ingredient[ingredient_key], key=lambda claim: claim["claim_order"])
        pids = [claim["accepted_pleiades_id"] for claim in claims]
        if pids != expected_pids:
            raise AssertionError(f"{ingredient_key}: expected Pleiades IDs {expected_pids}, found {pids}")
        if [claim["claim_order"] for claim in claims] != list(range(1, len(claims) + 1)):
            raise AssertionError(f"{ingredient_key}: claim_order regression")

    mina = [
        claim
        for claim in payload["claims"]
        if claim["ingredient_key"] == "myrrh" and claim["accepted_pleiades_id"] == "39386"
    ]
    if not mina or "broad_low_precision" not in mina[0].get("warnings", []):
        raise AssertionError("Minaei myrrh claim must carry broad_low_precision warning")

    print("TEI-derived provenance claims validate")
    print(f"Accepted claims: {payload['counts']['accepted_claims']}")
    print(f"Ingredients with claims: {payload['counts']['ingredients_with_claims']}")
    print(f"Entries with claims: {payload['counts']['entries_with_claims']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
