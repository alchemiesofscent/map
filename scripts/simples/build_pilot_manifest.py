#!/usr/bin/env python3
"""Build the Stage 1 simple-entry pilot manifest from read-only source rows."""
from __future__ import annotations

import csv
import json
import os
import unicodedata
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
AETIUS_ROOT = (REPO_ROOT / ".." / "aetius").resolve()
SOURCE_DIR = AETIUS_ROOT / "processing" / "alignment" / "data" / "csvs"
OUTPUT_PATH = REPO_ROOT / "data" / "generated" / "simples" / "entry_manifest.json"
SCHEMA_PATH = REPO_ROOT / "schemas" / "simples" / "entry-manifest.schema.json"
GALEN_MATERIA_PATH = REPO_ROOT / "data" / "generated" / "galen" / "materia.json"

WITNESS_WORKS = {
    "dsc": ("Dioscorides", "De materia medica"),
    "gal_smt": ("Galen", "De simplicium medicamentorum"),
    "gal_alimfac": ("Galen", "De alimentorum facultatibus"),
    "aet": ("Aetius", "Libri medicinales"),
    "orib": ("Oribasius", "Collectiones medicae XV"),
    "paul": ("Paul of Aegina", "Epitome VII.3"),
}

OVERLAP_TERMS = [
    {
        "term_id": "abrotonon",
        "label": "ἀβρότονον",
        "greek_forms": ["ἀβρότονον", "ἀβρότονον", "ἁβρότονον"],
    },
    {
        "term_id": "agnos_lygos",
        "label": "ἄγνος/λύγος",
        "greek_forms": ["ἄγνος", "λύγος", "λύγος"],
    },
    {
        "term_id": "agrostis",
        "label": "ἄγρωστις",
        "greek_forms": ["ἄγρωστις"],
    },
    {
        "term_id": "anchousa",
        "label": "ἄγχουσα",
        "greek_forms": ["ἄγχουσα", "ἄγχουσαι"],
    },
    {
        "term_id": "agarikon",
        "label": "ἀγαρικόν",
        "greek_forms": ["ἀγαρικόν", "ἀγαρικόν"],
    },
    {
        "term_id": "akantha_aigyptia_arabike",
        "label": "ἄκανθα Αἰγυπτία/Ἀραβική",
        "greek_forms": [
            "ἄκανθα Αἰγυπτία",
            "ἄκανθα Αἰγυπτία",
            "ἄκανθα Ἀραβική",
            "ἄκανθα Ἀραβική",
            "ἄκανθα αἰγυπτία",
            "ἄκανθα ἀραβική",
        ],
    },
    {
        "term_id": "bdellion",
        "label": "βδέλλιον",
        "greek_forms": ["βδέλλιον", "βδέλλιον"],
    },
    {
        "term_id": "nardos",
        "label": "νάρδος",
        "greek_forms": [
            "νάρδος",
            "νάρδος",
            "Κελτικὴ νάρδος",
            "ὀρεινὴ νάρδος",
            "νάρδος κελτική",
            "νάρδος ὀρεία",
            "ναρδόσταχυς",
        ],
    },
    {
        "term_id": "phou",
        "label": "φοῦ",
        "greek_forms": ["φοῦ"],
    },
    {
        "term_id": "agalochon",
        "label": "ἀγάλοχον",
        "greek_forms": ["ἀγάλοχον", "ἀγάλοχον"],
    },
]


def rel(path: Path) -> str:
    try:
        return path.resolve().relative_to(REPO_ROOT).as_posix()
    except ValueError:
        return os.path.relpath(path.resolve(), REPO_ROOT)


def read_csv(path: Path) -> list[dict[str, str]]:
    with path.open("r", encoding="utf-8", newline="") as handle:
        return list(csv.DictReader(handle))


def strip_to_match_key(text: str) -> str:
    text = unicodedata.normalize("NFD", text or "")
    text = "".join(c for c in text if unicodedata.category(c) != "Mn")
    return " ".join(text.lower().replace("ς", "σ").split())


def split_forms(lemma: str) -> list[str]:
    forms: list[str] = []
    for delimiter in (":", ";"):
        lemma = lemma.replace(delimiter, "\n")
    for form in lemma.splitlines():
        form = " ".join(form.split())
        if form:
            forms.append(form)
    return forms


def row_matches_term(row: dict[str, str], term: dict[str, object]) -> bool:
    forms = {strip_to_match_key(form) for form in split_forms(row.get("lemma_gr", ""))}
    wanted = {strip_to_match_key(form) for form in term["greek_forms"]}  # type: ignore[index]
    return bool(forms & wanted)


def make_entry(
    row: dict[str, str],
    witness_slug: str,
    source_path: Path,
    selection_sets: set[str],
    matched_terms: set[str],
) -> dict[str, object]:
    author, work = WITNESS_WORKS[witness_slug]
    row_idx = row.get("row_idx", "")
    entry_id = f"{witness_slug}:{row_idx}"
    return {
        "entry_id": entry_id,
        "selection_sets": sorted(selection_sets),
        "source_csv_path": rel(source_path),
        "source_row_idx": row_idx,
        "witness_slug": witness_slug,
        "author": row.get("author") or author,
        "work": work,
        "book": row.get("book", ""),
        "chapter": row.get("chapter", ""),
        "book_no_gr": row.get("book_no_gr", ""),
        "chapter_no_gr": row.get("chapter_no_gr", ""),
        "chapter_heading_gr": row.get("chapter_gr", ""),
        "section_heading_gr": row.get("section_gr", ""),
        "lemma": row.get("lemma_gr", ""),
        "lemma_en": row.get("lemma_en", ""),
        "variant_or_parallel_gr": row.get("var_par_prod_gr", ""),
        "variant_or_parallel_en": row.get("var_par_prod_en", ""),
        "entry_en": row.get("entry_en", ""),
        "category": row.get("cat", ""),
        "edition_pages": row.get("edition_pages", ""),
        "greek_entry_text": row.get("entry_gr", ""),
        "lemma_derived": row.get("lemma_derived", "").lower() == "true",
        "derived_from": row.get("derived_from", ""),
        "matched_overlap_terms": sorted(matched_terms),
    }


def selected_rows() -> dict[str, dict[str, object]]:
    selected: dict[str, dict[str, object]] = {}
    sources = {slug: SOURCE_DIR / f"{slug}.csv" for slug in WITNESS_WORKS}

    for witness_slug, source_path in sources.items():
        rows = read_csv(source_path)
        for row in rows:
            selection_sets: set[str] = set()
            matched_terms: set[str] = set()

            if (
                witness_slug == "dsc"
                and row.get("book") == "1"
                and row.get("chapter", "").isdigit()
                and 1 <= int(row["chapter"]) <= 23
            ):
                selection_sets.add("dioscorides_1_1-1_23")

            for term in OVERLAP_TERMS:
                if row_matches_term(row, term):
                    term_id = str(term["term_id"])
                    selection_sets.add(f"overlap:{term_id}")
                    matched_terms.add(term_id)

            if not selection_sets:
                continue

            entry_id = f"{witness_slug}:{row.get('row_idx', '')}"
            if entry_id in selected:
                existing = selected[entry_id]
                existing["selection_sets"] = sorted(
                    set(existing["selection_sets"]) | selection_sets  # type: ignore[arg-type]
                )
                existing["matched_overlap_terms"] = sorted(
                    set(existing["matched_overlap_terms"]) | matched_terms  # type: ignore[arg-type]
                )
            else:
                selected[entry_id] = make_entry(
                    row, witness_slug, source_path, selection_sets, matched_terms
                )

    return dict(sorted(selected.items()))


def galen_materia_context() -> list[dict[str, object]]:
    data = json.loads(GALEN_MATERIA_PATH.read_text(encoding="utf-8"))
    return [
        {
            "materia_key": item["materia_key"],
            "display_name": item["display_name"],
            "greek_name": item["greek_name"],
            "category": item["category"],
            "source_json_path": rel(GALEN_MATERIA_PATH),
            "description": item.get("description", ""),
            "place_links": item.get("place_links", []),
        }
        for item in data
    ]


def build_manifest() -> dict[str, object]:
    by_id = selected_rows()
    overlap_terms = []
    for term in OVERLAP_TERMS:
        term_id = str(term["term_id"])
        overlap_terms.append(
            {
                "term_id": term_id,
                "label": term["label"],
                "greek_forms": term["greek_forms"],
                "selected_entry_ids": [
                    entry_id
                    for entry_id, entry in by_id.items()
                    if term_id in entry.get("matched_overlap_terms", [])
                ],
            }
        )

    source_csv_paths = sorted(
        {
            entry["source_csv_path"]
            for entry in by_id.values()
            if isinstance(entry["source_csv_path"], str)
        }
    )
    return {
        "metadata": {
            "manifest_id": "simples-stage-1-pilot",
            "stage": "stage_1_provenance_model_pilot",
            "schema_path": rel(SCHEMA_PATH),
            "aetius_root": rel(AETIUS_ROOT),
            "source_csv_paths": source_csv_paths,
            "galen_materia_source_path": rel(GALEN_MATERIA_PATH),
            "notes": [
                "Entries are copied from read-only ../aetius alignment CSVs.",
                "Galen materia place links are context for calibration, not newly adjudicated links.",
                "No Pleiades matching or LLM adjudication is run in this stage.",
            ],
        },
        "entries": list(by_id.values()),
        "overlap_terms": overlap_terms,
        "galen_materia_context": galen_materia_context(),
    }


def main() -> None:
    manifest = build_manifest()
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"Wrote {rel(OUTPUT_PATH)}")
    print(f"Entries: {len(manifest['entries'])}")
    print(f"Galen materia context rows: {len(manifest['galen_materia_context'])}")


if __name__ == "__main__":
    main()
