#!/usr/bin/env python3
"""Ad-hoc dump: full Greek of every journey-relevant chapter in the Galen
TEI, with Kühn page anchors, written to a single markdown file for expert
review. Not part of the regular pipeline.

Scope: SMT (tlg075) book 9 chapters 1–3 + De antidotis (tlg078) book 1
chapters 1–3. These are the autobiographical-travel chapters; an expert
can read them in full and decide route boundaries independently of our
sentence-level extraction.
"""
from __future__ import annotations

import re
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
NS = {"tei": "http://www.tei-c.org/ns/1.0"}
TEI_NS = NS["tei"]

WORKS = [
    {
        "path": ROOT / "data" / "tei" / "tlg0057.tlg075.1st1K-grc1.xml",
        "title": "Galen, *De simplicium medicamentorum temperamentis* (SMT), Book 9",
        "kuhn_volume": "XII",
        "book_index": 8,  # 0-based; book 9 of 11
        "chapters_to_dump": [
            ("1", "Chapter 1 (Lemnos / Lemnian earth)"),
            ("2", "Chapter 2 (Coele Syria, Lycia, Dead Sea)"),
            ("3", "Chapter 3 (Cyprus / Pergamum / Ergasteria mines)"),
        ],
    },
    {
        "path": ROOT / "data" / "tei" / "tlg0057.tlg078.1st1K-grc1.xml",
        "title": "Galen, *De antidotis*, Book 1",
        "kuhn_volume": "XIV",
        "book_index": 0,  # book 1 of 2
        "chapters_to_dump": [
            ("1", "Chapter 1 (Theriac context)"),
            ("2", "Chapter 2 (Retrospective travel summary: Cyprus + Lemnos + Palestine)"),
            ("3", "Chapter 3 (Trifolinus wine, Italy)"),
        ],
    },
]

OUT = ROOT / "docs" / "galen_journey_passages_full_greek.md"


def localname(elem: ET.Element) -> str:
    t = elem.tag
    return t.split("}", 1)[1] if t.startswith("{") else t


def collect_chapter_text(chapter: ET.Element, vol: str) -> str:
    """Walk the chapter element in document order, emitting prose with
    Kühn page anchors `[K. XII p.l]` at every <pb> and a single space at
    every <lb>. Strip duplicate whitespace at the end."""
    parts: list[str] = []
    current_page: str | None = None

    def emit(text: str | None) -> None:
        if text is None:
            return
        # Newlines in source are layout-only; collapse to single space.
        clean = re.sub(r"\s+", " ", text)
        if clean:
            parts.append(clean)

    def walk(elem: ET.Element) -> None:
        nonlocal current_page
        name = localname(elem)
        if name == "pb":
            current_page = elem.get("n")
            # Insert page anchor when we cross a page boundary mid-flow.
            line_n = elem.get("n")
            parts.append(f" [K. {vol} {line_n}] ")
        elif name == "lb":
            line_n = elem.get("n") or ""
            # Only emit a soft line marker if it doesn't run together two
            # words; the source is well-formed enough that a space suffices.
            parts.append(" ")
        else:
            emit(elem.text)
        for child in elem:
            walk(child)
            emit(child.tail)

    # Skip the chapter heading element itself, just walk its children.
    for child in chapter:
        walk(child)

    text = "".join(parts)
    # Tighten whitespace and punctuation spacing.
    text = re.sub(r"\s+", " ", text)
    text = re.sub(r"\s+([,.;·])", r"\1", text)
    text = re.sub(r"\[\s*K\.\s+", "[K. ", text)
    return text.strip()


def chapter_ref_kuhn_anchors(chapter: ET.Element) -> list[str]:
    """Extract every (page, line) pair from <pb> + <lb> elements for the
    chapter's Kühn span."""
    pbs = chapter.findall(".//tei:pb", NS)
    if not pbs:
        return []
    first = pbs[0].get("n", "?")
    last = pbs[-1].get("n", "?")
    if first == last:
        return [first]
    return [first, last]


def dump_work(work: dict, out_lines: list[str]) -> None:
    tree = ET.parse(work["path"])
    root = tree.getroot()
    body = root.find(".//tei:text/tei:body", NS)
    wrap = body.find("tei:div", NS)
    books = wrap.findall("tei:div", NS)
    book = books[work["book_index"]]
    chapters_by_n = {
        ch.get("n"): ch for ch in book.findall("tei:div", NS)
    }

    out_lines.append(f"## {work['title']}")
    out_lines.append("")
    for ch_n, heading in work["chapters_to_dump"]:
        ch = chapters_by_n.get(ch_n)
        if ch is None:
            out_lines.append(f"### {heading}\n\n_(chapter {ch_n} not found in TEI)_\n")
            continue
        anchors = chapter_ref_kuhn_anchors(ch)
        anchor_str = (
            f"K. {work['kuhn_volume']} pp. {anchors[0]}–{anchors[-1]}"
            if len(anchors) >= 2
            else (f"K. {work['kuhn_volume']} p. {anchors[0]}" if anchors else "")
        )
        out_lines.append(f"### {heading}")
        out_lines.append("")
        if anchor_str:
            out_lines.append(f"_{anchor_str}_")
            out_lines.append("")
        text = collect_chapter_text(ch, work["kuhn_volume"])
        # Soft-wrap by inserting paragraph breaks at sentence boundaries —
        # but only every ~3 sentences, so the output stays readable but
        # not impossibly fragmented.
        sentences = re.split(r"(?<=[.·;])\s+", text)
        para: list[str] = []
        for i, s in enumerate(sentences):
            para.append(s)
            if (i + 1) % 4 == 0:
                out_lines.append(" ".join(para))
                out_lines.append("")
                para = []
        if para:
            out_lines.append(" ".join(para))
            out_lines.append("")


def main() -> int:
    out_lines: list[str] = [
        "# Galen — Full Greek of Journey-Relevant Chapters",
        "",
        (
            "Source: First1KGreek TEI for `tlg0057.tlg075` (SMT) and "
            "`tlg0057.tlg078` (De antidotis). Kühn volume.page anchors are "
            "inserted in-line as `[K. XII p]` at each TEI page break. "
            "Generated by `scripts/galen/dump_journey_chapters.py`."
        ),
        "",
        (
            "Scope: every chapter that contains autobiographical travel or "
            "materia-medica autopsy. Pulled in full from the TEI, not from "
            "our sentence-level extraction, so an expert can read the "
            "surrounding context and pick route boundaries independently."
        ),
        "",
        "---",
        "",
    ]
    for work in WORKS:
        dump_work(work, out_lines)
        out_lines.append("---")
        out_lines.append("")
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text("\n".join(out_lines))
    print(f"Wrote {OUT.relative_to(ROOT)} ({len(out_lines)} lines)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
