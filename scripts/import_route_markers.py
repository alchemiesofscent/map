#!/usr/bin/env python3
"""Read `*Name*` markers from data/review/route_markers.md and merge them into
data/review/section_place_sequence.json as per-section visit_sequence entries.

For each section heading (`## §N — section_NNNN`), every `*…*` marker found in
the prose becomes one visit, in source order. Markers are resolved to a
route_site_key by normalised-name lookup against
`data/generated/periplus/route_views.json::views.all.sites[]`. Unresolved
markers are kept in the visit_sequence with `route_site_key: null` and
`geometry_policy: "needs_followup"` so the curator can fix the spelling.

Sections present in the markup file overwrite their counterpart in
section_place_sequence.json. Sections not mentioned in the markup file are
left untouched (so e.g. the existing §27 hand-curation survives).

Stdlib only.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import unicodedata
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_MARKUP = ROOT / "data" / "review" / "route_markers.md"
DEFAULT_SEQUENCE = ROOT / "data" / "review" / "section_place_sequence.json"
DEFAULT_ROUTE_VIEWS = ROOT / "data" / "generated" / "periplus" / "route_views.json"
DEFAULT_REPORT = ROOT / "generated" / "route_markers_report.txt"

SECTION_HEADER_RX = re.compile(r"^## §(\d+)\b.*$", re.MULTILINE)
# Accepts either single-asterisk `*Name*` (markdown emphasis) or
# double-asterisk `**Name**` (markdown bold). Try double first so it isn't
# partially matched as two adjacent singles.
MARKER_RX = re.compile(r"\*\*([^*\n]+)\*\*|\*([^*\n]+)\*")
HTML_COMMENT_RX = re.compile(r"<!--.*?-->", re.DOTALL)

# Seed alias map. Curator can extend in-place when import reports unresolved markers.
ALIASES = {
    "myos hormos": "muos hormos",
    "berenike": "berenike",
    "meroe": "meroe",
    "ptolemais of the hunts": "ptolemais theron",
    "ptolemais theron": "ptolemais theron",
    "adulis": "adouli",
    "adule": "adouli",
    "aksum": "axomite metropolis",
    "aksum metropolis": "axomite metropolis",
    "aksumite metropolis": "axomite metropolis",
    "axum": "axomite metropolis",
    "diodoros island": "didoros island",
    "dioscorida": "dioskouridou",
    "dioscorida island": "dioskouridou island",
    "dioscorides island": "dioskouridou island",
    "moscha harbor": "moscha limen",
    "muza": "mouza",
    "sabbatha": "saubatha",
    "syagros": "suagros",
    "tabae": "tabai",
    "kane": "kane",
    "cane": "kane",
    "cane harbor": "kane",
    "bird island": "isle of birds",
    "dome island": "troullas",
    "calai islands": "kalaiou isles",
    "fortunate islands": "makaron",
    "white island": "white island",
}


def load_json(path: Path) -> Any:
    with path.open(encoding="utf-8") as f:
        return json.load(f)


def write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")


def display_path(path: Path) -> str:
    try:
        return str(path.relative_to(ROOT))
    except ValueError:
        return str(path)


def strip_marks(value: str) -> str:
    decomposed = unicodedata.normalize("NFD", value)
    return "".join(ch for ch in decomposed if unicodedata.category(ch) != "Mn")


def normalize(value: str) -> str:
    """Lowercase, strip diacritics, collapse non-alphanumerics to single spaces."""
    if not value:
        return ""
    folded = strip_marks(value).casefold()
    folded = folded.replace("ē", "e").replace("ō", "o")
    folded = re.sub(r"[^0-9a-z]+", " ", folded)
    folded = re.sub(r"([a-z])\1+", r"\1", folded)
    return folded.strip()


def alias_key(value: str) -> str:
    norm = normalize(value)
    return ALIASES.get(norm, norm)


def build_site_index(sites: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    index: dict[str, dict[str, Any]] = {}
    for site in sites:
        page_meta = site.get("page_metadata") or {}
        terms = [
            site.get("source_name"),
            site.get("input_name"),
            page_meta.get("page_title"),
            page_meta.get("page_ancient_toponym"),
        ]
        for term in terms:
            if not term:
                continue
            key = alias_key(term)
            if key and key not in index:
                index[key] = site
    return index


def parse_markers(markup_text: str) -> list[tuple[int, list[str]]]:
    """Return [(section_order, [marker, ...]), ...] in document order."""
    headers = list(SECTION_HEADER_RX.finditer(markup_text))
    out: list[tuple[int, list[str]]] = []
    for index, match in enumerate(headers):
        order = int(match.group(1))
        start = match.end()
        end = headers[index + 1].start() if index + 1 < len(headers) else len(markup_text)
        block = markup_text[start:end]
        block = HTML_COMMENT_RX.sub("", block)
        markers = []
        for m in MARKER_RX.finditer(block):
            surface = (m.group(1) or m.group(2) or "").strip()
            if surface:
                markers.append(surface)
        out.append((order, markers))
    return out


def resolve_marker(
    surface: str,
    site_index: dict[str, dict[str, Any]],
) -> dict[str, Any] | None:
    key = alias_key(surface)
    if not key:
        return None
    return site_index.get(key)


def build_visit_entry(surface: str, site: dict[str, Any] | None) -> dict[str, Any]:
    if site:
        return {
            "display_name": surface.strip(),
            "source_name": site.get("source_name"),
            "route_site_key": site.get("site_key"),
            "geometry_policy": "mapped" if site.get("has_geometry") else "needs_followup",
        }
    return {
        "display_name": surface.strip(),
        "source_name": None,
        "route_site_key": None,
        "geometry_policy": "needs_followup",
        "note": f"Unresolved marker `{surface.strip()}` — add to ALIASES in scripts/import_route_markers.py or update the marker spelling.",
    }


def merge_sequence(
    existing: dict[str, Any],
    parsed: list[tuple[int, list[str]]],
    site_index: dict[str, dict[str, Any]],
) -> tuple[dict[str, Any], dict[str, list[str]]]:
    """Return (updated_sequence_doc, {section_order: [unresolved_surfaces]})."""
    sections_by_order: dict[int, dict[str, Any]] = {
        int(s.get("section_order")): s for s in existing.get("sections", []) if s.get("section_order") is not None
    }
    unresolved_per_section: dict[int, list[str]] = {}

    for order, markers in parsed:
        if not markers:
            # Empty section in markup: leave any existing entry untouched.
            continue
        visit_sequence = []
        unresolved: list[str] = []
        for surface in markers:
            site = resolve_marker(surface, site_index)
            if site is None:
                unresolved.append(surface)
            visit_sequence.append(build_visit_entry(surface, site))
        existing_entry = sections_by_order.get(order, {})
        updated_entry = {
            "section_order": order,
            "card_title": existing_entry.get("card_title"),
            "review_status": existing_entry.get("review_status") or "draft",
            "visit_sequence": visit_sequence,
            "context_places": existing_entry.get("context_places") or [],
        }
        if existing_entry.get("notes"):
            updated_entry["notes"] = existing_entry["notes"]
        sections_by_order[order] = updated_entry
        if unresolved:
            unresolved_per_section[order] = unresolved

    merged_sections = [
        sections_by_order[order]
        for order in sorted(sections_by_order.keys())
    ]
    out = dict(existing)
    out["schema_version"] = existing.get("schema_version", 1)
    out["description"] = existing.get(
        "description",
        "Reviewed chapter-level place focus sequences for the Periplus scrollytelling viewer. Generated runtime files may copy these records, but this sidecar is the durable curation source.",
    )
    out["sections"] = merged_sections
    out["last_marker_import"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    return out, unresolved_per_section


def write_report(
    report_path: Path,
    parsed: list[tuple[int, list[str]]],
    unresolved: dict[int, list[str]],
    sections_with_no_markers: list[int],
    total_sites: int,
) -> None:
    lines: list[str] = []
    lines.append("Periplus route-marker import report")
    lines.append(f"Generated: {datetime.now(timezone.utc).isoformat(timespec='seconds')}")
    lines.append("")
    total_markers = sum(len(markers) for _, markers in parsed)
    resolved = total_markers - sum(len(v) for v in unresolved.values())
    lines.append(f"Total markers parsed: {total_markers}")
    lines.append(f"Resolved → route site:  {resolved}")
    lines.append(f"Unresolved (kept as needs_followup): {total_markers - resolved}")
    lines.append(f"Site index size: {total_sites} unique normalised names")
    lines.append("")

    if unresolved:
        lines.append("UNRESOLVED MARKERS")
        for order in sorted(unresolved.keys()):
            for surface in unresolved[order]:
                lines.append(f"  §{order}: '{surface}' → no matching route_site (added as needs_followup)")
        lines.append("")
    else:
        lines.append("All markers resolved to a route_site.")
        lines.append("")

    if sections_with_no_markers:
        lines.append("SECTIONS WITHOUT MARKERS")
        chunk_size = 12
        for i in range(0, len(sections_with_no_markers), chunk_size):
            row = ", ".join(f"§{o}" for o in sections_with_no_markers[i : i + chunk_size])
            lines.append(f"  {row}")
        lines.append("")

    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--markup", type=Path, default=DEFAULT_MARKUP)
    parser.add_argument("--sequence", type=Path, default=DEFAULT_SEQUENCE)
    parser.add_argument("--route-views", type=Path, default=DEFAULT_ROUTE_VIEWS)
    parser.add_argument("--report", type=Path, default=DEFAULT_REPORT)
    args = parser.parse_args()

    if not args.markup.exists():
        print(f"Markup file missing: {display_path(args.markup)} — run scripts/export_translation_markup.py first", file=sys.stderr)
        return 1
    if not args.route_views.exists():
        print(f"route_views.json missing: {display_path(args.route_views)} — run scripts/build_route_views.py first", file=sys.stderr)
        return 1

    markup_text = args.markup.read_text(encoding="utf-8")
    parsed = parse_markers(markup_text)

    route_views = load_json(args.route_views)
    sites = (route_views.get("views") or {}).get("all", {}).get("sites", [])
    site_index = build_site_index(sites)

    existing = load_json(args.sequence) if args.sequence.exists() else {"sections": []}
    updated, unresolved = merge_sequence(existing, parsed, site_index)

    write_json(args.sequence, updated)

    sections_with_no_markers = [order for order, markers in parsed if not markers]
    write_report(args.report, parsed, unresolved, sections_with_no_markers, len(site_index))

    total_markers = sum(len(markers) for _, markers in parsed)
    resolved = total_markers - sum(len(v) for v in unresolved.values())
    print(
        f"Imported {total_markers} marker(s) across {len([o for o, m in parsed if m])} section(s); "
        f"{resolved} resolved, {total_markers - resolved} kept as needs_followup."
    )
    print(f"Sequence: {display_path(args.sequence)}")
    print(f"Report:   {display_path(args.report)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
