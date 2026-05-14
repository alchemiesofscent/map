#!/usr/bin/env python3
"""Extract accepted Materia provenance claims from annotated TEI placeName nodes."""
from __future__ import annotations

from collections import defaultdict
from typing import Any
import xml.etree.ElementTree as ET

from provenance_common import (
    DEPRECATED_ARABIA_PLEIADES_ID,
    ENTRY_CLAIMS_PATH,
    GAZETTEER_PATH,
    MANIFEST_PATH,
    REPO_ROOT,
    load_json,
    normalized_offsets,
    now_utc,
    rel,
    sorted_counter,
    stable_id,
    write_json,
)


SCHEMA_PATH = REPO_ROOT / "schemas" / "simples" / "provenance-entry-claims.schema.json"
TEI_NS = {"tei": "http://www.tei-c.org/ns/1.0"}
TEI = "{http://www.tei-c.org/ns/1.0}"

AUTHOR_LABELS = {
    "aet": "Aetius",
    "dsc": "Dioscorides",
    "gal_antid": "Galen",
    "gal_alimfac": "Galen",
    "gal_smt": "Galen",
    "orib": "Oribasius",
    "paul": "Paul of Aegina",
}

BROAD_FEATURE_HINTS = {"region", "province", "island", "label", "people", "tribe", "ethnic"}
CONFIDENCE_BY_CERT = {
    "secure": 1.0,
    "high": 0.95,
    "probable": 0.85,
    "ambiguous": 0.65,
    "low": 0.45,
}


def source_citation(entry: dict[str, Any]) -> str:
    author = entry.get("author", "")
    bits = [
        AUTHOR_LABELS.get(author, author),
        entry.get("work", ""),
        f"book {entry.get('book')}" if entry.get("book") else "",
        f"chapter {entry.get('chapter')}" if entry.get("chapter") else "",
    ]
    return ", ".join(bit for bit in bits if bit)


def is_broad_region(place: dict[str, Any]) -> bool:
    feature_types = " ".join(place.get("feature_types", [])).lower()
    return any(hint in feature_types for hint in BROAD_FEATURE_HINTS)


def append_text_without_notes(node: ET.Element, parts: list[str]) -> None:
    if node.tag == f"{TEI}note":
        return
    if node.tag in {f"{TEI}lb", f"{TEI}pb", f"{TEI}milestone"}:
        parts.append(" ")
    if node.text:
        parts.append(node.text)
    for child in list(node):
        append_text_without_notes(child, parts)
        if child.tail:
            parts.append(child.tail)


def text_without_notes(node: ET.Element) -> str:
    parts: list[str] = []
    append_text_without_notes(node, parts)
    return " ".join("".join(parts).split())


def place_surface(place: ET.Element) -> str:
    return " ".join("".join(place.itertext()).split())


def pleiades_id_from_ref(ref: str) -> str:
    for part in ref.split():
        if "/places/" in part:
            return part.rsplit("/", 1)[-1]
    return ""


def source_xml_id_for_chapter(book: str, chapter: str) -> str:
    return f"{book}.{chapter}"


def iter_entry_nodes(
    manifest_entries: dict[str, dict[str, Any]]
) -> list[tuple[dict[str, Any], ET.Element]]:
    by_path: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for entry in manifest_entries.values():
        by_path[entry["source_tei_path"]].append(entry)

    rows: list[tuple[dict[str, Any], ET.Element]] = []
    for source_tei_path, entries in by_path.items():
        root = ET.parse(REPO_ROOT / source_tei_path).getroot()
        entry_by_xml_id = {entry["source_xml_id"]: entry for entry in entries}
        for book_div in root.findall(".//tei:div[@subtype='book']", TEI_NS):
            book = book_div.get("n", "")
            for chapter_div in book_div.findall("./tei:div[@subtype='chapter']", TEI_NS):
                chapter = chapter_div.get("n", "")
                source_xml_id = source_xml_id_for_chapter(book, chapter)
                entry = entry_by_xml_id.get(source_xml_id)
                if entry:
                    rows.append((entry, chapter_div))
    return rows


def normalize_claim(
    *,
    entry: dict[str, Any],
    source_node: ET.Element,
    place_name: ET.Element,
    places: dict[str, dict[str, Any]],
) -> dict[str, Any] | None:
    ingredient_key = place_name.get("ingredient_key", "")
    if not ingredient_key:
        return None

    pid = pleiades_id_from_ref(place_name.get("ref", ""))
    if not pid:
        raise AssertionError(f"{entry['entry_id']}: annotated placeName missing Pleiades ref")
    if pid == DEPRECATED_ARABIA_PLEIADES_ID:
        raise AssertionError(f"{entry['entry_id']}: Arabia provenance must use Pleiades 1001942, not 981506")
    if pid not in places:
        raise AssertionError(f"{entry['entry_id']}: unknown accepted_pleiades_id {pid}")
    place = places[pid]

    relation = place_name.get("relation", "")
    if not relation:
        raise AssertionError(f"{entry['entry_id']}: annotated placeName missing relation")
    claim_order_text = place_name.get("claim_order", "")
    if not claim_order_text.isdigit():
        raise AssertionError(f"{entry['entry_id']}: annotated placeName missing numeric claim_order")
    claim_order = int(claim_order_text)

    greek_text = entry.get("greek_entry_text") or text_without_notes(source_node)
    evidence_phrase = place_name.get("evidence_phrase") or place_surface(place_name)
    surface = place_surface(place_name)
    evidence_offsets = normalized_offsets(greek_text, evidence_phrase)
    place_offsets = normalized_offsets(greek_text, surface)
    if evidence_offsets is None:
        raise AssertionError(f"{entry['entry_id']}: evidence phrase not found in Greek entry: {evidence_phrase}")
    if place_offsets is None:
        raise AssertionError(f"{entry['entry_id']}: place surface not found in Greek entry: {surface}")

    cert = place_name.get("cert", "secure")
    confidence = CONFIDENCE_BY_CERT.get(cert, 0.75)
    coords = place.get("coordinates") or {}
    precision = place.get("location_precision", "")
    broad = is_broad_region(place)
    warnings = [token for token in (place_name.get("warnings") or "").split() if token]
    if broad and "broad_region_representative_point" not in warnings:
        warnings.append("broad_region_representative_point")
    if precision and precision != "precise" and "uncertain_coordinate_precision" not in warnings:
        warnings.append("uncertain_coordinate_precision")

    claim_id = stable_id(
        "tei-claim",
        ingredient_key,
        entry["entry_id"],
        claim_order,
        surface,
        relation,
        pid,
    )
    return {
        "claim_id": claim_id,
        "candidate_id": "",
        "mention_id": "",
        "review_row_id": "",
        "entry_id": entry["entry_id"],
        "passage_id": entry["entry_id"],
        "ingredient_key": ingredient_key,
        "lemma": entry.get("lemma", ""),
        "lemma_en": entry.get("lemma_en", ""),
        "author": entry.get("author", ""),
        "work": entry.get("work", ""),
        "book": entry.get("book", ""),
        "chapter": entry.get("chapter", ""),
        "source_xml_id": entry.get("source_xml_id", ""),
        "source_tei_path": entry.get("source_tei_path", ""),
        "source_citation": source_citation(entry),
        "claim_order": claim_order,
        "place_surface": surface,
        "relation": relation,
        "qualifier": place_name.get("qualifier", ""),
        "claim_group": place_name.get("claim_group", ""),
        "claim_note": place_name.get("claim_note", ""),
        "accepted_pleiades_id": pid,
        "accepted_pleiades_uri": place.get("pleiades_uri", ""),
        "place_label": place.get("title", ""),
        "feature_types": place.get("feature_types", []),
        "coordinates": {"lat": coords.get("lat"), "lon": coords.get("lon")},
        "location_precision": precision,
        "is_broad_region": broad,
        "has_uncertain_coordinates": precision not in {"", "precise"},
        "evidence_phrase": evidence_phrase,
        "source_char_offsets": evidence_offsets,
        "place_char_offsets": place_offsets,
        "certainty": cert,
        "review_decision_source": entry.get("source_tei_path", ""),
        "entry_claim_source": rel(ENTRY_CLAIMS_PATH),
        "final_decision": "accept",
        "consensus_method": "tei_placeName_annotation",
        "confidence": confidence,
        "consensus_confidence": confidence,
        "vote_trace_ids": [],
        "warnings": sorted(set(warnings)),
    }


def main() -> int:
    manifest = load_json(MANIFEST_PATH)
    entries = {entry["entry_id"]: entry for entry in manifest.get("entries", [])}
    places = load_json(GAZETTEER_PATH)["places"]

    claims = []
    for entry, node in iter_entry_nodes(entries):
        for place_name in node.findall(".//tei:placeName", TEI_NS):
            claim = normalize_claim(
                entry=entry,
                source_node=node,
                place_name=place_name,
                places=places,
            )
            if claim is not None:
                claims.append(claim)

    ingredient_order = {
        ingredient["ingredient_key"]: index
        for index, ingredient in enumerate(manifest.get("ingredients", []))
    }
    claims.sort(
        key=lambda claim: (
            ingredient_order.get(claim["ingredient_key"], 999),
            claim["claim_order"],
            str(claim["book"]),
            str(claim["chapter"]),
            claim["place_label"],
            claim["claim_id"],
        )
    )

    payload = {
        "metadata": {
            "artifact_id": "simples-provenance-entry-claims",
            "stage": "stage_2_tei_placeName_claims",
            "built_at": now_utc(),
            "source_manifest_path": rel(MANIFEST_PATH),
            "source_gazetteer_path": rel(GAZETTEER_PATH),
            "source_tei_paths": sorted({claim["source_tei_path"] for claim in claims}),
            "schema_path": rel(SCHEMA_PATH),
            "notes": [
                "Accepted Materia provenance links are extracted only from annotated TEI placeName elements.",
                "Old review queues and LLM adjudication sidecars are not accepted-link authorities.",
                "Broad regions remain representative Pleiades points and carry warnings for the viewer.",
            ],
        },
        "counts": {
            "tei_place_claims_in": len(claims),
            "accepted_claims": len(claims),
            "ingredients_with_claims": len({claim["ingredient_key"] for claim in claims}),
            "entries_with_claims": len({claim["entry_id"] for claim in claims}),
        },
        "reports": {
            "claims_by_ingredient": sorted_counter([claim["ingredient_key"] for claim in claims]),
            "claims_by_entry": sorted_counter([claim["entry_id"] for claim in claims]),
            "claims_by_relation": sorted_counter([claim["relation"] for claim in claims]),
            "claims_by_place": sorted_counter([claim["place_label"] for claim in claims]),
            "claims_by_group": sorted_counter([claim["claim_group"] for claim in claims]),
        },
        "claims": claims,
    }
    write_json(ENTRY_CLAIMS_PATH, payload)
    print(f"Wrote {rel(ENTRY_CLAIMS_PATH)}")
    print(f"Accepted TEI claims: {len(claims)}")
    print(f"Ingredients with claims: {payload['counts']['ingredients_with_claims']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
