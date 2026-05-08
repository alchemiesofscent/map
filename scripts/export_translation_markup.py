#!/usr/bin/env python3
"""Export translations as a markdown file the curator can mark up with `*Name*` visit markers.

Reads `data/generated/periplus/raw_sections.json` and writes
`data/review/route_markers.md`. Each section becomes an H2 block with the
draft translation verbatim and a hidden HTML-comment hint listing every place
mentioned in that section (handy when deciding what to mark).

Idempotent re-runs: if the markup file already exists, we keep each section's
text exactly as the curator edited it whenever the marker-stripped text still
matches the current source. Sections whose underlying translation has changed
are replaced and reported on stderr so the curator knows where to re-mark.

Run with `--force` to bypass the change check and regenerate everything.

Stdlib only.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SECTIONS = ROOT / "data" / "generated" / "periplus" / "raw_sections.json"
DEFAULT_JOURNEY = ROOT / "data" / "generated" / "periplus" / "journey_route.json"
DEFAULT_OUT = ROOT / "data" / "review" / "route_markers.md"

HEADER = """\
# Periplus route markers

> Wrap each place name you want to "visit" with single asterisks (`*Name*`)
> or double asterisks (`**Name**`) — both work. The order of markers in a
> section is the order the map will focus on each place. Multi-word names
> work (`*Ptolemais of the Hunts*`). The same place can be marked again in
> a later section. After editing, run `python3 scripts/import_route_markers.py`.
>
> Each section block keeps its source-of-truth translation in plain prose.
> The HTML comment under each header lists every place the upstream extractor
> tagged for that section — useful as a hint when you choose what to mark.

---
"""

SECTION_HEADER_RX = re.compile(r"^## §(\d+)\b", re.MULTILINE)
# Used only for the "did the prose change?" idempotency check — accepts either
# `*Name*` or `**Name**` so re-runs preserve markers in either flavour.
MARKER_RX = re.compile(r"\*\*([^*\n]+)\*\*|\*([^*\n]+)\*")


def load_json(path: Path) -> Any:
    with path.open(encoding="utf-8") as f:
        return json.load(f)


def display_path(path: Path) -> str:
    try:
        return str(path.relative_to(ROOT))
    except ValueError:
        return str(path)


def build_section_hints(journey_path: Path) -> dict[int, list[str]]:
    """For each section_order, return a deduped list of `surface (place_key)` hints."""
    if not journey_path.exists():
        return {}
    journey = load_json(journey_path)
    hints: dict[int, list[str]] = {}
    for step in journey.get("steps", []):
        refs = step.get("section_refs") or []
        if not refs:
            continue
        # section_refs[0] is e.g. "section_0001"; extract trailing int.
        m = re.search(r"(\d+)", refs[0])
        if not m:
            continue
        order = int(m.group(1))
        seen: list[str] = []
        for mention in step.get("place_mentions") or []:
            surface = (mention.get("surface") or "").strip()
            kind = mention.get("kind") or ""
            if not surface:
                continue
            tag = f"{surface} [{kind}]"
            if tag not in seen:
                seen.append(tag)
        if seen:
            hints[order] = seen
    return hints


def parse_existing_markup(text: str) -> dict[int, str]:
    """Split an existing route_markers.md into {section_order: marked_block_text}.

    The block text is everything between this section's `## §N …` header and
    the next `## §M …` header (or end of file), stripped of trailing newlines.
    """
    if not text:
        return {}
    matches = list(SECTION_HEADER_RX.finditer(text))
    blocks: dict[int, str] = {}
    for index, match in enumerate(matches):
        order = int(match.group(1))
        start = match.start()
        end = matches[index + 1].start() if index + 1 < len(matches) else len(text)
        blocks[order] = text[start:end].rstrip() + "\n"
    return blocks


def extract_translation_from_block(block: str) -> str:
    """Strip the section header, hint comment, and code-fences. Return prose only."""
    # Drop the `## §N — section_NNNN` header line.
    lines = block.splitlines()
    if lines and lines[0].startswith("## §"):
        lines = lines[1:]
    text = "\n".join(lines)
    # Drop hint HTML comments.
    text = re.sub(r"<!--.*?-->", "", text, flags=re.DOTALL)
    return text.strip("\n").strip()


def stripped_for_compare(value: str) -> str:
    """Return the translation prose with `*Name*` / `**Name**` markers removed and whitespace normalized."""
    no_markers = MARKER_RX.sub(lambda m: m.group(1) or m.group(2) or "", value)
    return re.sub(r"\s+", " ", no_markers).strip()


def render_section_block(
    section_order: int,
    chunk_id: str,
    translation: str,
    hint_names: list[str],
) -> str:
    parts: list[str] = []
    parts.append(f"## §{section_order} — {chunk_id}")
    parts.append("")
    if hint_names:
        parts.append("<!-- mentioned places in this section:")
        for name in hint_names:
            parts.append(f"     · {name}")
        parts.append("-->")
        parts.append("")
    parts.append(translation.strip() if translation.strip() else "_(translation pending)_")
    parts.append("")
    return "\n".join(parts) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sections", type=Path, default=DEFAULT_SECTIONS)
    parser.add_argument("--journey", type=Path, default=DEFAULT_JOURNEY)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    parser.add_argument(
        "--force",
        action="store_true",
        help="Regenerate the file even where the curator's marked text would normally be preserved.",
    )
    args = parser.parse_args()

    if not args.sections.exists():
        print(f"Sections file missing: {display_path(args.sections)}", file=sys.stderr)
        return 1

    sections = load_json(args.sections)
    hints = build_section_hints(args.journey)

    existing_blocks: dict[int, str] = {}
    if args.out.exists() and not args.force:
        with args.out.open(encoding="utf-8") as f:
            existing_blocks = parse_existing_markup(f.read())

    out_parts: list[str] = [HEADER]
    preserved = 0
    rewritten = 0
    refreshed_orders: list[int] = []

    for section in sorted(sections, key=lambda s: int(s.get("section_order") or 0)):
        order = section.get("section_order")
        if not isinstance(order, int):
            continue
        chunk_id = section.get("chunk_id") or f"section_{order:04d}"
        translation = (section.get("draft_translation") or "").strip()
        section_hints = hints.get(order, [])

        existing_block = existing_blocks.get(order)
        keep_existing = False
        if existing_block and not args.force:
            existing_prose = extract_translation_from_block(existing_block)
            if stripped_for_compare(existing_prose) == stripped_for_compare(translation):
                keep_existing = True

        if keep_existing:
            out_parts.append(existing_block.rstrip() + "\n\n")
            preserved += 1
        else:
            out_parts.append(
                render_section_block(order, chunk_id, translation, section_hints) + "\n",
            )
            rewritten += 1
            if existing_block is not None:
                refreshed_orders.append(order)

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text("".join(out_parts).rstrip() + "\n", encoding="utf-8")

    print(f"Wrote {display_path(args.out)} — preserved {preserved} section(s), wrote {rewritten} fresh.")
    if refreshed_orders:
        print(
            "  Translation changed for sections "
            + ", ".join(f"§{o}" for o in refreshed_orders[:30])
            + (" ..." if len(refreshed_orders) > 30 else ""),
            file=sys.stderr,
        )
        print("  Any *Name* markers in those sections were dropped; please re-mark.", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
