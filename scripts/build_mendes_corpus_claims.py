#!/usr/bin/env python3
"""Generate mendes/data/corpus-claims.json — the wider corpus behind the
dossier's claims-aware search.

Two sources, both already verified elsewhere in this repository:

- The simples pipeline's TEI-verified provenance claims
  (data/generated/simples/provenance_entry_claims.json): placeName claims
  extracted from the annotated Dioscorides TEI, each with an accepted
  Pleiades id and coordinates. Five of the lemmas are House of Mendes
  materials, so each record carries an ingredientRef into
  mendes/data/claims.json where the material is the same.

- Galen's materia place-links (data/generated/galen/materia.json +
  passages.json + data/galen/lexicon/places.json): first-person autopsy and
  supply testimony — observed, acquired, sourced — with Kühn citations and
  the Greek evidence phrase.

The output is generated; do not edit it by hand. Usage:

    python3 scripts/build_mendes_corpus_claims.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SIMPLES_PATH = ROOT / "data" / "generated" / "simples" / "provenance_entry_claims.json"
GALEN_MATERIA_PATH = ROOT / "data" / "generated" / "galen" / "materia.json"
GALEN_PASSAGES_PATH = ROOT / "data" / "generated" / "galen" / "passages.json"
GALEN_PLACES_PATH = ROOT / "data" / "galen" / "lexicon" / "places.json"
CLAIMS_PATH = ROOT / "mendes" / "data" / "claims.json"
OUT_PATH = ROOT / "mendes" / "data" / "corpus-claims.json"

# Corpus lemma/materia → mendes/data/claims.json ingredient id, where the
# material is the same. Everything else stays ingredientRef: null — present
# in the search, not forced onto the recipes' shelf.
SIMPLES_INGREDIENT_REFS = {
    "balsamum": "balsam",
    "cardamom": "cardamom",
    "calamus": "kalamos",
    "schoinos": "schoinos",
    "myrrh": "myrrh",
}
GALEN_INGREDIENT_REFS = {
    "opobalsam": "balsam",
    "xylobalsam": "balsam",
}

GALEN_WORK_TITLES = {
    "SMT": "De simplicium medicamentorum temperamentis ac facultatibus",
    "De_antidotis": "De antidotis",
}


def galen_work_title(work: str) -> str:
    return GALEN_WORK_TITLES.get(work, work.replace("_", " "))


def compact_dioscorides_cite(claim: dict) -> str:
    return "Dioscorides, De materia medica " + claim["book"] + "." + claim["chapter"]


def build_simples(ingredient_ids: set[str]) -> list[dict]:
    data = json.loads(SIMPLES_PATH.read_text(encoding="utf-8"))
    records = []
    for claim in data["claims"]:
        ref = SIMPLES_INGREDIENT_REFS.get(claim["ingredient_key"])
        if ref is not None and ref not in ingredient_ids:
            sys.exit(f"error: simples ref {ref!r} is not a claims.json ingredient id")
        coords = claim["coordinates"]
        records.append({
            "id": claim["claim_id"],
            "ingredientRef": ref,
            "ingredientKey": claim["ingredient_key"],
            "lemma": claim["lemma"],
            "lemmaEn": claim["lemma_en"],
            "relation": claim["relation"],
            "qualifier": claim.get("qualifier") or None,
            "place": {
                "name": claim["place_label"],
                "surface": claim["place_surface"],
                "coord": [coords["lon"], coords["lat"]],
                "pleiades": claim["accepted_pleiades_id"],
                "pleiadesUri": claim["accepted_pleiades_uri"],
                "precision": claim.get("location_precision"),
            },
            "cite": compact_dioscorides_cite(claim),
        })
    return {"records": records, "builtAt": data["metadata"].get("built_at"),
            "stage": data["metadata"].get("stage")}


def galen_cite(passage: dict) -> str:
    work = galen_work_title(passage["work"])
    locator = passage.get("tei_div_path", "")
    locator = locator.rsplit(":", 1)[-1] if ":" in locator else ""
    kuhn = "Kühn " + passage["kuhn_volume"] + " " + \
        str(passage["kuhn_page_start"]) + "." + str(passage["kuhn_line_start"]) + \
        "–" + str(passage["kuhn_page_end"]) + "." + str(passage["kuhn_line_end"])
    return "Galen, " + work + (" " + locator if locator else "") + " (" + kuhn + ")"


def build_galen(ingredient_ids: set[str]) -> list[dict]:
    materia = json.loads(GALEN_MATERIA_PATH.read_text(encoding="utf-8"))
    passages = {p["passage_id"]: p for p in json.loads(GALEN_PASSAGES_PATH.read_text(encoding="utf-8"))}
    places = {p["place_key"]: p for p in json.loads(GALEN_PLACES_PATH.read_text(encoding="utf-8"))}
    records = []
    for item in materia:
        ref = GALEN_INGREDIENT_REFS.get(item["materia_key"])
        if ref is not None and ref not in ingredient_ids:
            sys.exit(f"error: galen ref {ref!r} is not a claims.json ingredient id")
        for link in item.get("place_links", []):
            passage = passages.get(link["passage_id"])
            place = places.get(link["place_key"])
            if passage is None or place is None:
                sys.exit(f"error: unresolved link {item['materia_key']} → "
                         f"{link['place_key']} / {link['passage_id']}")
            records.append({
                "id": "galen-" + item["materia_key"] + "-" + link["place_key"]
                      + "-" + link["relation"] + "-" + link["passage_id"],
                "materiaKey": item["materia_key"],
                "name": item["display_name"],
                "greekName": item["greek_name"],
                "ingredientRef": ref,
                "relation": link["relation"],
                "place": {
                    "name": place["display_name"],
                    "coord": [place["lon"], place["lat"]],
                    "pleiades": place.get("pleiades_id"),
                    "pleiadesUri": place.get("pleiades_uri"),
                },
                "cite": galen_cite(passage),
                "evidencePhrase": link.get("evidence_phrase") or None,
            })
    return records


def main() -> None:
    claims = json.loads(CLAIMS_PATH.read_text(encoding="utf-8"))
    ingredient_ids = {i["id"] for i in claims["ingredients"]}
    ingredient_ids.update(i["id"] for i in claims["contextIngredients"])

    simples = build_simples(ingredient_ids)
    galen = build_galen(ingredient_ids)

    out = {
        "note": ("Generated by scripts/build_mendes_corpus_claims.py — do not edit. "
                 "The wider corpus behind the dossier search: TEI-verified Dioscorides "
                 "simples claims and Galen's materia place-links. Regenerate with "
                 "python3 scripts/build_mendes_corpus_claims.py."),
        "builtFrom": {
            "simples": str(SIMPLES_PATH.relative_to(ROOT)) + " (" + (simples["stage"] or "?")
                       + ", built " + (simples["builtAt"] or "?") + ")",
            "galen": [str(GALEN_MATERIA_PATH.relative_to(ROOT)),
                      str(GALEN_PASSAGES_PATH.relative_to(ROOT)),
                      str(GALEN_PLACES_PATH.relative_to(ROOT))],
        },
        "simples": simples["records"],
        "galen": galen,
    }
    OUT_PATH.write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {len(out['simples'])} simples records and {len(out['galen'])} "
          f"Galen records to {OUT_PATH.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
