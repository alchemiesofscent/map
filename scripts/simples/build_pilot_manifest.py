#!/usr/bin/env python3
"""Build the Materia ingredient manifest from local TEI annotations."""
from __future__ import annotations

from collections import defaultdict
import json
import re
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Any


REPO_ROOT = Path(__file__).resolve().parents[2]
SOURCE_REGISTRY_PATH = REPO_ROOT / "data" / "tei" / "source_registry.json"
DRAFT_TRANSLATIONS_PATH = REPO_ROOT / "data" / "review" / "materia_draft_translations.json"
OUTPUT_PATH = REPO_ROOT / "data" / "generated" / "simples" / "entry_manifest.json"
SCHEMA_PATH = REPO_ROOT / "schemas" / "simples" / "entry-manifest.schema.json"
TEI_NS = {"tei": "http://www.tei-c.org/ns/1.0"}
TEI = "{http://www.tei-c.org/ns/1.0}"

INGREDIENT_ORDER = ["balsamum", "cardamom", "calamus", "schoinos", "myrrh"]
INGREDIENTS: dict[str, dict[str, str]] = {
    "balsamum": {
        "display_name": "Balsamum",
        "greek_name": "βάλσαμον",
        "view_id": "balsamum",
    },
    "cardamom": {
        "display_name": "Cardamom",
        "greek_name": "καρδάμωμον",
        "view_id": "cardamom",
    },
    "calamus": {
        "display_name": "Calamus",
        "greek_name": "κάλαμος ἀρωματικός",
        "view_id": "calamus",
    },
    "schoinos": {
        "display_name": "Schoinos",
        "greek_name": "σχοῖνος",
        "view_id": "schoinos",
    },
    "myrrh": {
        "display_name": "Myrrh",
        "greek_name": "σμύρνα",
        "view_id": "myrrh",
    },
}
ENTRY_LABEL_OVERRIDES: dict[str, dict[str, str]] = {
    "dsc:5": {"lemma": "καρδάμωμον", "lemma_en": "Cardamom"},
    "dsc:16": {"lemma": "σχοῖνος", "lemma_en": "Schoinos"},
    "dsc:17": {"lemma": "κάλαμος ἀρωματικός", "lemma_en": "Calamus"},
    "dsc:18": {"lemma": "βάλσαμον", "lemma_en": "Balsamum"},
    "dsc:63": {"lemma": "σμύρνα", "lemma_en": "Myrrh"},
    "dsc:64": {"lemma": "Βοιωτικὴ σμύρνα", "lemma_en": "Boeotian myrrh"},
}


def rel(path: Path) -> str:
    return path.resolve().relative_to(REPO_ROOT).as_posix()


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def normalize_spaces(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def source_path(spec: dict[str, Any], key: str) -> Path:
    return (REPO_ROOT / spec[key]).resolve()


def preferred_source_path(spec: dict[str, Any]) -> tuple[Path, bool]:
    annotated = spec.get("annotated_path")
    if annotated:
        annotated_path = source_path(spec, "annotated_path")
        if annotated_path.exists():
            return annotated_path, True
    return source_path(spec, "raw_path"), False


def load_registry() -> list[dict[str, Any]]:
    payload = load_json(SOURCE_REGISTRY_PATH)
    return payload.get("sources", [])


def load_draft_translations() -> dict[str, dict[str, Any]]:
    if not DRAFT_TRANSLATIONS_PATH.exists():
        return {}
    payload = load_json(DRAFT_TRANSLATIONS_PATH)
    return {
        entry_id: row
        for entry_id, row in payload.get("translations", {}).items()
        if isinstance(row, dict)
    }


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
    return normalize_spaces("".join(parts))


def strip_leading_marker(text: str) -> str:
    text = re.sub(r"^\s*\d+\s+", "", text)
    text = re.sub(r"^\s*\[[^\]]{1,80}\]\s*", "", text)
    return text.strip()


def derive_lemma(text: str) -> str:
    text = strip_leading_marker(text)
    bracket = re.match(r"^\[([^\]]{1,80})\]", text)
    if bracket:
        text = bracket.group(1)
    text = re.sub(r"^[α-ωΑ-Ωϛϙϟʹʹ΄´'.\s]+περὶ\s+", "", text, flags=re.IGNORECASE)
    text = text.split("·", 1)[0].split("·", 1)[0].split(".", 1)[0].split(":", 1)[0]
    words = text.split()
    return " ".join(words[:4]).strip("[] ,;·.") if words else ""


def annotated_ingredient_keys(node: ET.Element) -> list[str]:
    keys: set[str] = set()
    for place in node.findall(".//tei:placeName", TEI_NS):
        key = place.get("ingredient_key")
        if key:
            keys.add(key)
    return [key for key in INGREDIENT_ORDER if key in keys]


def translation_fields(entry_id: str, draft_translations: dict[str, dict[str, Any]]) -> dict[str, Any]:
    draft = draft_translations.get(entry_id, {})
    entry_en = draft.get("translation_en", "")
    return {
        "entry_en": entry_en,
        "translation_en_authority": "display_only_draft_translation" if entry_en else "",
        "translation_en_source": rel(DRAFT_TRANSLATIONS_PATH) if entry_en else "",
        "evidence_authority": "greek_tei",
    }


def dioscorides_entry_id(book: str, chapter: str, chapter_index: int) -> str:
    if book == "1" and chapter.isdigit():
        return f"dsc:{int(chapter) - 1}"
    if book == "3" and chapter == "1":
        return "dsc:319"
    if book == "3" and chapter == "24":
        return "dsc:341"
    return f"dsc:tei{chapter_index}"


def make_entry(
    *,
    spec: dict[str, Any],
    entry_id: str,
    source_entry_index: int,
    source_xml_id: str,
    preferred_path: Path,
    raw_path: Path,
    source_tei_annotated: bool,
    book: str,
    chapter: str,
    text: str,
    ingredient_keys: list[str],
    draft_translations: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    labels = ENTRY_LABEL_OVERRIDES.get(entry_id, {})
    lemma = labels.get("lemma") or derive_lemma(text)
    return {
        "entry_id": entry_id,
        "selection_sets": [f"ingredient:{key}" for key in ingredient_keys],
        "ingredient_keys": ingredient_keys,
        "source_registry_id": spec["source_id"],
        "source_tei_path": rel(preferred_path),
        "source_raw_tei_path": rel(raw_path),
        "source_tei_annotated": source_tei_annotated,
        "source_entry_index": str(source_entry_index),
        "source_xml_id": source_xml_id,
        "witness_slug": spec["witness_slug"],
        "author": spec["author"],
        "work": spec["work"],
        "book": book,
        "chapter": chapter,
        "book_no_gr": "",
        "chapter_no_gr": "",
        "chapter_heading_gr": lemma,
        "section_heading_gr": "",
        "lemma": lemma,
        "lemma_en": labels.get("lemma_en", ""),
        "variant_or_parallel_gr": "",
        "variant_or_parallel_en": "",
        **translation_fields(entry_id, draft_translations),
        "category": "",
        "edition_pages": "",
        "greek_entry_text": text,
        "lemma_derived": True,
        "derived_from": "local_tei_heading",
    }


def iter_dioscorides_entries(
    spec: dict[str, Any],
    draft_translations: dict[str, dict[str, Any]],
) -> list[dict[str, Any]]:
    preferred_path, annotated = preferred_source_path(spec)
    raw_path = source_path(spec, "raw_path")
    root = ET.parse(preferred_path).getroot()
    entries = []
    chapter_index = 0
    for book_div in root.findall(".//tei:div[@subtype='book']", TEI_NS):
        book = book_div.get("n", "")
        for chapter_div in book_div.findall("./tei:div[@subtype='chapter']", TEI_NS):
            chapter = chapter_div.get("n", "")
            if not chapter.isdigit():
                continue
            ingredient_keys = annotated_ingredient_keys(chapter_div)
            if not ingredient_keys:
                chapter_index += 1
                continue
            text = strip_leading_marker(text_without_notes(chapter_div))
            entry_id = dioscorides_entry_id(book, chapter, chapter_index)
            entries.append(
                make_entry(
                    spec=spec,
                    entry_id=entry_id,
                    source_entry_index=chapter_index,
                    source_xml_id=f"{book}.{chapter}",
                    preferred_path=preferred_path,
                    raw_path=raw_path,
                    source_tei_annotated=annotated,
                    book=book,
                    chapter=chapter,
                    text=text,
                    ingredient_keys=ingredient_keys,
                    draft_translations=draft_translations,
                )
            )
            chapter_index += 1
    return entries


def iter_paragraph_entries(
    spec: dict[str, Any],
    draft_translations: dict[str, dict[str, Any]],
) -> list[dict[str, Any]]:
    preferred_path, annotated = preferred_source_path(spec)
    raw_path = source_path(spec, "raw_path")
    root = ET.parse(preferred_path).getroot()
    entries = []
    paragraph_index = 0
    for book_div in root.findall(".//tei:div[@subtype='book']", TEI_NS):
        book = book_div.get("n", "")
        for chapter_div in book_div.findall("./tei:div[@subtype='chapter']", TEI_NS):
            chapter = chapter_div.get("n", "")
            for para in chapter_div.findall(".//tei:p", TEI_NS):
                ingredient_keys = annotated_ingredient_keys(para)
                if not ingredient_keys:
                    paragraph_index += 1
                    continue
                text = strip_leading_marker(text_without_notes(para))
                entry_id = f"{spec['witness_slug']}:p{paragraph_index}"
                entries.append(
                    make_entry(
                        spec=spec,
                        entry_id=entry_id,
                        source_entry_index=paragraph_index,
                        source_xml_id=f"{book}.{chapter}.p{paragraph_index}",
                        preferred_path=preferred_path,
                        raw_path=raw_path,
                        source_tei_annotated=annotated,
                        book=book,
                        chapter=chapter,
                        text=text,
                        ingredient_keys=ingredient_keys,
                        draft_translations=draft_translations,
                    )
                )
                paragraph_index += 1
    return entries


def selected_entries() -> dict[str, dict[str, Any]]:
    draft_translations = load_draft_translations()
    entries: dict[str, dict[str, Any]] = {}
    for spec in load_registry():
        if not spec.get("enabled", True):
            continue
        if spec["witness_slug"] == "dsc":
            rows = iter_dioscorides_entries(spec, draft_translations)
        else:
            rows = iter_paragraph_entries(spec, draft_translations)
        for row in rows:
            entries[row["entry_id"]] = row
    return dict(sorted(entries.items()))


def build_ingredients(entries: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    entries_by_ingredient: dict[str, list[str]] = defaultdict(list)
    for entry_id, entry in entries.items():
        for ingredient_key in entry.get("ingredient_keys", []):
            entries_by_ingredient[ingredient_key].append(entry_id)

    ingredients = []
    for ingredient_key in INGREDIENT_ORDER:
        entry_ids = sorted(
            set(entries_by_ingredient.get(ingredient_key, [])),
            key=lambda entry_id: (
                int(entries[entry_id]["book"]) if str(entries[entry_id]["book"]).isdigit() else 999,
                int(entries[entry_id]["chapter"]) if str(entries[entry_id]["chapter"]).isdigit() else 999,
                entry_id,
            ),
        )
        if not entry_ids:
            continue
        spec = INGREDIENTS[ingredient_key]
        ingredients.append(
            {
                "ingredient_key": ingredient_key,
                "display_name": spec["display_name"],
                "greek_name": spec["greek_name"],
                "entry_ids": entry_ids,
                "passage_ids": entry_ids,
                "view_id": spec["view_id"],
            }
        )
    return ingredients


def build_manifest() -> dict[str, object]:
    by_id = selected_entries()
    source_tei_paths = sorted(
        {
            entry["source_tei_path"]
            for entry in by_id.values()
            if isinstance(entry["source_tei_path"], str)
        }
    )
    return {
        "metadata": {
            "manifest_id": "materia-tei-ingredient-journeys",
            "stage": "stage_1_local_tei_ingredient_claims",
            "schema_path": rel(SCHEMA_PATH),
            "source_boundary": "data/tei",
            "source_registry_path": rel(SOURCE_REGISTRY_PATH),
            "draft_translations_path": rel(DRAFT_TRANSLATIONS_PATH),
            "source_tei_paths": source_tei_paths,
            "notes": [
                "Entries are selected only when local TEI placeName annotations carry ingredient provenance claims.",
                "Greek TEI is the evidence authority; English is derived display data only.",
                "The manifest is keyed by five ingredient journeys, not by one source entry per view.",
                "Generated Galen materia JSON is not an input to the Materia extraction path.",
                "Draft English is loaded from the review translation sidecar for display only, never from old generated caches.",
            ],
        },
        "ingredients": build_ingredients(by_id),
        "entries": list(by_id.values()),
    }


def main() -> None:
    manifest = build_manifest()
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"Wrote {rel(OUTPUT_PATH)}")
    print(f"Ingredients: {len(manifest['ingredients'])}")
    print(f"Entries: {len(manifest['entries'])}")
    print(f"Source TEI paths: {len(manifest['metadata']['source_tei_paths'])}")


if __name__ == "__main__":
    main()
