#!/usr/bin/env python3
"""Create the local annotated Dioscorides TEI used by the Materia pipeline."""
from __future__ import annotations

from html import escape
from pathlib import Path
import re
from typing import Any


REPO_ROOT = Path(__file__).resolve().parents[2]
RAW_PATH = REPO_ROOT / "data" / "tei" / "tlg0656.tlg001.1st1K-grc1.xml"
ANNOTATED_PATH = REPO_ROOT / "data" / "tei" / "annotated" / "tlg0656.tlg001.annotated.xml"

PLEIADES = "https://pleiades.stoa.org/places"


CLAIMS: list[dict[str, Any]] = [
    {
        "chapter": "6",
        "surface": "Κομμαγηνῆς",
        "pleiades_id": "658443",
        "cert": "secure",
        "ingredient_key": "cardamom",
        "relation": "sourced_from",
        "claim_group": "best_source",
        "qualifier": "best",
        "claim_order": 1,
        "evidence_phrase": "τὸ ἐκ τῆς Κομμαγηνῆς καὶ Ἀρμενίας καὶ βοσπόρου κομιζόμενον",
    },
    {
        "chapter": "6",
        "surface": "Ἀρμενίας",
        "pleiades_id": "874350",
        "cert": "probable",
        "ingredient_key": "cardamom",
        "relation": "sourced_from",
        "claim_group": "best_source",
        "qualifier": "best",
        "claim_order": 2,
        "evidence_phrase": "τὸ ἐκ τῆς Κομμαγηνῆς καὶ Ἀρμενίας καὶ βοσπόρου κομιζόμενον",
    },
    {
        "chapter": "6",
        "surface": "βοσπόρου",
        "pleiades_id": "520977",
        "cert": "ambiguous",
        "ingredient_key": "cardamom",
        "relation": "sourced_from",
        "claim_group": "best_source",
        "qualifier": "best",
        "claim_order": 3,
        "warnings": "bosporus_target_ambiguous",
        "evidence_phrase": "τὸ ἐκ τῆς Κομμαγηνῆς καὶ Ἀρμενίας καὶ βοσπόρου κομιζόμενον",
    },
    {
        "chapter": "6",
        "surface": "Ἰνδίᾳ",
        "pleiades_id": "50004",
        "cert": "secure",
        "ingredient_key": "cardamom",
        "relation": "grows_at",
        "claim_group": "also_grows",
        "qualifier": "also",
        "claim_order": 4,
        "evidence_phrase": "γεννᾶται δὲ καὶ ἐν Ἰνδίᾳ καὶ Ἀραβίᾳ",
    },
    {
        "chapter": "6",
        "surface": "Ἀραβίᾳ",
        "pleiades_id": "1001942",
        "cert": "secure",
        "ingredient_key": "cardamom",
        "relation": "grows_at",
        "claim_group": "also_grows",
        "qualifier": "also",
        "claim_order": 5,
        "evidence_phrase": "γεννᾶται δὲ καὶ ἐν Ἰνδίᾳ καὶ Ἀραβίᾳ",
    },
    {
        "chapter": "17",
        "surface": "Ναβαταίᾳ",
        "pleiades_id": "29677",
        "cert": "secure",
        "ingredient_key": "schoinos",
        "relation": "grows_at",
        "claim_group": "best_source",
        "qualifier": "best",
        "claim_order": 1,
        "evidence_phrase": "ἑτέρα δὲ ἐν τῇ Ναβαταίᾳ καλουμένῃ, ἥτις ἐστὶ κρατίστη",
        "claim_note": "Nabataean schoinos is ranked as strongest/best.",
    },
    {
        "chapter": "17",
        "surface": "Ἀραβίᾳ",
        "pleiades_id": "1001942",
        "cert": "secure",
        "ingredient_key": "schoinos",
        "relation": "grows_at",
        "claim_group": "ranked_source",
        "qualifier": "second",
        "claim_order": 2,
        "evidence_phrase": "ἡ δὲ ἐν Ἀραβίᾳ",
        "claim_note": "Arabian schoinos ranks second and is also called Babylonian or teuchitis.",
    },
    {
        "chapter": "17",
        "surface": "Λιβύῃ",
        "pleiades_id": "716588",
        "cert": "secure",
        "ingredient_key": "schoinos",
        "relation": "grows_at",
        "claim_group": "ranked_source",
        "qualifier": "poor",
        "claim_order": 3,
        "evidence_phrase": "ἡ μέν τις γίνεται ἐν Λιβύῃ",
        "claim_note": "Libyan schoinos is reported but ranked as useless in the quality note.",
    },
    {
        "chapter": "18",
        "surface": "Ἰνδίᾳ",
        "pleiades_id": "50004",
        "cert": "secure",
        "ingredient_key": "calamus",
        "relation": "grows_at",
        "claim_group": "source_region",
        "qualifier": "source",
        "claim_order": 1,
        "evidence_phrase": "κάλαμος ἀρωματικὸς φύεται μὲν ἐν Ἰνδίᾳ",
    },
    {
        "chapter": "19",
        "surface": "Ἰουδαίᾳ",
        "pleiades_id": "687934",
        "cert": "secure",
        "ingredient_key": "balsamum",
        "relation": "grows_at",
        "claim_group": "only_source",
        "qualifier": "only",
        "claim_order": 1,
        "evidence_phrase": "γεννώμενον ἐν μόνῃ Ἰουδαίᾳ κατά τινα αὐλῶνα",
    },
    {
        "chapter": "64",
        "surface": "Ἀραβίᾳ",
        "pleiades_id": "1001942",
        "cert": "secure",
        "ingredient_key": "myrrh",
        "relation": "grows_at",
        "claim_group": "source_region",
        "qualifier": "source",
        "claim_order": 1,
        "evidence_phrase": "σμύρνα δάκρυόν ἐστι δένδρου γεννωμένου ἐν Ἀραβίᾳ",
    },
    {
        "chapter": "64",
        "surface": "Τρωγλοδυτική",
        "pleiades_id": "39435",
        "cert": "secure",
        "ingredient_key": "myrrh",
        "relation": "named_variety_from",
        "claim_group": "named_variety",
        "qualifier": "best",
        "claim_order": 2,
        "evidence_phrase": "πρωτεύει δὲ ἡ Τρωγλοδυτική, καλουμένη ἀπὸ τῆς γεννώσης αὐτὴν χώρας",
        "claim_note": "Troglodytic myrrh is the leading named variety and is named from its producing country.",
    },
    {
        "chapter": "64",
        "surface": "Μιναία",
        "pleiades_id": "39386",
        "cert": "low",
        "ingredient_key": "myrrh",
        "relation": "named_variety_from",
        "claim_group": "named_variety",
        "qualifier": "low_precision",
        "claim_order": 3,
        "warnings": "ethnic_named_variety broad_low_precision",
        "evidence_phrase": "ἡ Μιναία δὲ καλουμένη ἀποδόκιμος",
        "claim_note": "Minaean is encoded as a named-variety/ethnic attestation with low geographic precision.",
    },
    {
        "chapter": "65",
        "surface": "Βοιωτίᾳ",
        "pleiades_id": "540689",
        "cert": "secure",
        "ingredient_key": "myrrh",
        "relation": "named_variety_from",
        "claim_group": "named_variety",
        "qualifier": "related",
        "claim_order": 4,
        "warnings": "related_variety_not_primary",
        "evidence_phrase": "ἡ δὲ Βοιςτιακὴ σμύρνα ἐστὶ δένδρου τινὸς ἐν Βοιωτίᾳ γεννωμένου",
        "claim_note": "Boeotian myrrh is a related named variety, not the main Arabian resin.",
    },
]


def chapter_spans(text: str) -> dict[str, tuple[int, int]]:
    book_matches = list(
        re.finditer(
            r'<div type="textpart" subtype="book" n="([^"]+)">',
            text,
        )
    )
    book_one = next((match for match in book_matches if match.group(1) == "1"), None)
    if book_one is None:
        raise AssertionError("missing Dioscorides book 1")
    book_index = book_matches.index(book_one)
    book_start = book_one.start()
    book_end = book_matches[book_index + 1].start() if book_index + 1 < len(book_matches) else len(text)
    book_text = text[book_start:book_end]

    matches = list(
        re.finditer(
            r'<div type="textpart" subtype="chapter" n="([^"]+)">',
            book_text,
        )
    )
    spans: dict[str, tuple[int, int]] = {}
    for index, match in enumerate(matches):
        chapter = match.group(1)
        end = matches[index + 1].start() if index + 1 < len(matches) else len(book_text)
        spans[chapter] = (book_start + match.start(), book_start + end)
    return spans


def attrs_for_claim(claim: dict[str, Any]) -> str:
    attrs = {
        "ref": f"{PLEIADES}/{claim['pleiades_id']}",
        "cert": claim["cert"],
        "type": "materia-provenance",
        "ingredient_key": claim["ingredient_key"],
        "relation": claim["relation"],
        "claim_group": claim["claim_group"],
        "qualifier": claim["qualifier"],
        "claim_order": str(claim["claim_order"]),
        "evidence_phrase": claim["evidence_phrase"],
    }
    for optional in ("warnings", "claim_note"):
        if claim.get(optional):
            attrs[optional] = str(claim[optional])
    return " ".join(f'{key}="{escape(value, quote=True)}"' for key, value in attrs.items())


def annotate_claim(block: str, claim: dict[str, Any]) -> str:
    surface = claim["surface"]
    if surface not in block:
        raise AssertionError(f"chapter {claim['chapter']} missing surface {surface!r}")
    replacement = f"<placeName {attrs_for_claim(claim)}>{surface}</placeName>"
    return block.replace(surface, replacement, 1)


def main() -> int:
    text = RAW_PATH.read_text(encoding="utf-8")
    spans = chapter_spans(text)
    by_chapter: dict[str, list[dict[str, Any]]] = {}
    for claim in CLAIMS:
        by_chapter.setdefault(claim["chapter"], []).append(claim)

    replacements: list[tuple[int, int, str]] = []
    for chapter, claims in by_chapter.items():
        if chapter not in spans:
            raise AssertionError(f"missing Dioscorides chapter {chapter}")
        start, end = spans[chapter]
        block = text[start:end]
        # Later replacements must run first because evidence_phrase attributes
        # may mention earlier/later place surfaces in the same sentence.
        for claim in sorted(claims, key=lambda row: int(row["claim_order"]), reverse=True):
            block = annotate_claim(block, claim)
        replacements.append((start, end, block))

    for start, end, block in sorted(replacements, reverse=True):
        text = text[:start] + block + text[end:]

    ANNOTATED_PATH.parent.mkdir(parents=True, exist_ok=True)
    ANNOTATED_PATH.write_text(text, encoding="utf-8")
    print(f"Wrote {ANNOTATED_PATH.relative_to(REPO_ROOT)}")
    print(f"Annotated place claims: {len(CLAIMS)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
