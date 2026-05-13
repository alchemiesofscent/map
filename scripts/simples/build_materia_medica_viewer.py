#!/usr/bin/env python3
"""Build viewer-ready Materia Medica data from accepted simples provenance."""
from __future__ import annotations

from collections import defaultdict
from pathlib import Path
from typing import Any

from provenance_common import (
    LINKS_PATH,
    MANIFEST_PATH,
    MAP_POINTS_PATH,
    REPO_ROOT,
    load_json,
    now_utc,
    rel,
    write_json,
)


OUT_DIR = REPO_ROOT / "data" / "generated" / "materia_medica"

AUTHOR_LABELS = {
    "aet": "Aetius",
    "dsc": "Dioscorides",
    "gal_alimfac": "Galen",
    "gal_smt": "Galen",
    "orib": "Oribasius",
    "paul": "Paul of Aegina",
}


def material_name(entry: dict[str, Any]) -> str:
    return (entry.get("lemma_en") or "").strip() or (entry.get("lemma") or "").strip()


def source_citation(entry: dict[str, Any]) -> str:
    author = entry.get("author", "")
    bits = [
        AUTHOR_LABELS.get(author, author),
        entry.get("work", ""),
        f"book {entry.get('book')}" if entry.get("book") else "",
        f"chapter {entry.get('chapter')}" if entry.get("chapter") else "",
    ]
    return ", ".join(bit for bit in bits if bit)


def place_key(pleiades_id: str) -> str:
    return f"pleiades_{pleiades_id}"


def sort_piece(value: object) -> tuple[int, object]:
    text = str(value or "").strip()
    if text.isdigit():
        return (0, int(text))
    return (1, text.lower())


def site_sort_key(site: dict[str, Any]) -> tuple[object, ...]:
    return (
        (site.get("author") or "").lower(),
        (site.get("work") or "").lower(),
        sort_piece(site.get("book")),
        sort_piece(site.get("chapter")),
        (site.get("lemma") or "").lower(),
        (site.get("place_label") or "").lower(),
        site.get("site_key") or "",
    )


def link_projection(link: dict[str, Any]) -> dict[str, Any]:
    return {
        "link_id": link["link_id"],
        "candidate_id": link["candidate_id"],
        "review_row_id": link.get("review_row_id", ""),
        "entry_id": link["entry_id"],
        "author": link.get("author", ""),
        "work": link.get("work", ""),
        "book": link.get("book", ""),
        "chapter": link.get("chapter", ""),
        "lemma": link.get("lemma", ""),
        "relation": link["relation"],
        "accepted_pleiades_id": link["accepted_pleiades_id"],
        "accepted_pleiades_uri": link["accepted_pleiades_uri"],
        "place_label": link.get("place_label", ""),
        "evidence_phrase": link.get("evidence_phrase", ""),
        "certainty": link.get("certainty", ""),
        "review_decision_source": link.get("review_decision_source", ""),
        "final_decision": link.get("final_decision", ""),
        "consensus_method": link.get("consensus_method", ""),
        "consensus_confidence": link.get("consensus_confidence"),
        "adjudication_id": link.get("adjudication_id", ""),
        "vote_trace_ids": link.get("vote_trace_ids", []),
    }


def build_places(points: list[dict[str, Any]]) -> list[dict[str, Any]]:
    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for point in points:
        grouped[point["group_key"]["pleiades_id"]].append(point)

    places = []
    for pid, rows in sorted(grouped.items(), key=lambda kv: (kv[1][0].get("place_label", ""), kv[0])):
        first = rows[0]
        coords = first.get("coordinates") or {}
        is_broad = any(row.get("is_broad_region") for row in rows)
        uncertain = any(row.get("has_uncertain_coordinates") for row in rows)
        places.append(
            {
                "place_key": place_key(pid),
                "display_name": first.get("place_label", ""),
                "place_type": "region" if is_broad else "place",
                "lat": coords.get("lat"),
                "lon": coords.get("lon"),
                "certainty": "representative" if is_broad else "accepted",
                "pleiades_id": pid,
                "pleiades_uri": first.get("pleiades_uri", ""),
                "coordinates_source": first.get("coordinate_source", ""),
                "location_precision": first.get("location_precision", ""),
                "is_broad_region": is_broad,
                "has_uncertain_coordinates": uncertain,
                "accepted_link_count": sum(len(row.get("link_ids", [])) for row in rows),
                "notes": "Representative Pleiades point for a broad provenance region."
                if is_broad
                else "",
            }
        )
    return places


def build_passages(entries_by_id: dict[str, dict[str, Any]], entry_ids: set[str]) -> list[dict[str, Any]]:
    passages = []
    for entry_id in sorted(entry_ids):
        entry = entries_by_id[entry_id]
        passages.append(
            {
                "passage_id": entry_id,
                "entry_id": entry_id,
                "source_citation": source_citation(entry),
                "author": entry.get("author", ""),
                "work": entry.get("work", ""),
                "book": entry.get("book", ""),
                "chapter": entry.get("chapter", ""),
                "lemma": entry.get("lemma", ""),
                "lemma_en": entry.get("lemma_en", ""),
                "greek": entry.get("greek_entry_text", ""),
                "translation_en": entry.get("entry_en", ""),
            }
        )
    return passages


def build_materia(
    entries_by_id: dict[str, dict[str, Any]],
    links: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    links_by_entry: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for link in links:
        links_by_entry[link["entry_id"]].append(link)

    materia = []
    for entry_id, grouped_links in sorted(links_by_entry.items()):
        entry = entries_by_id[entry_id]
        place_links = []
        for link in sorted(
            grouped_links,
            key=lambda row: (
                row.get("accepted_pleiades_id", ""),
                row.get("relation", ""),
                row.get("link_id", ""),
            ),
        ):
            projected = link_projection(link)
            projected.update(
                {
                    "place_key": place_key(link["accepted_pleiades_id"]),
                    "passage_id": entry_id,
                }
            )
            place_links.append(projected)
        materia.append(
            {
                "materia_key": entry_id,
                "entry_id": entry_id,
                "display_name": material_name(entry),
                "greek_name": entry.get("lemma", ""),
                "category": entry.get("category", ""),
                "source_citation": source_citation(entry),
                "source_json_path": rel(MANIFEST_PATH),
                "place_links": place_links,
            }
        )
    return materia


def build_route_views(
    entries_by_id: dict[str, dict[str, Any]],
    points: list[dict[str, Any]],
) -> dict[str, Any]:
    sites = []
    unmapped = []
    for point in points:
        if not point.get("links"):
            continue
        primary_link = point["links"][0]
        entry = entries_by_id[primary_link["entry_id"]]
        coords = point.get("coordinates") or {}
        lat = coords.get("lat")
        lon = coords.get("lon")
        accepted_links = [link_projection(link) for link in point.get("links", [])]
        pid = point["group_key"]["pleiades_id"]
        citation = source_citation(entry)
        is_broad = bool(point.get("is_broad_region"))
        site = {
            "site_key": point["map_point_id"],
            "place_key": place_key(pid),
            "route_key": "all",
            "route_label": "Accepted provenance",
            "route_order": None,
            "kind": "materia",
            "display_name": material_name(entry),
            "greek_name": entry.get("lemma", ""),
            "place_label": point.get("place_label", ""),
            "place_type": "region" if is_broad else "place",
            "lat": lat,
            "lon": lon,
            "has_geometry": lat is not None and lon is not None,
            "certainty": primary_link.get("certainty", ""),
            "pleiades_id": pid,
            "pleiades_uri": point.get("pleiades_uri", ""),
            "coordinates_source": point.get("coordinate_source", ""),
            "location_precision": point.get("location_precision", ""),
            "is_broad_region": is_broad,
            "has_uncertain_coordinates": bool(point.get("has_uncertain_coordinates")),
            "broad_region_label": "Broad region; representative Pleiades point"
            if is_broad
            else "",
            "materia_key": primary_link["entry_id"],
            "materia_keys": [primary_link["entry_id"]],
            "passage_id": primary_link["entry_id"],
            "entry_id": primary_link["entry_id"],
            "source_citation": citation,
            "author": primary_link.get("author", ""),
            "work": primary_link.get("work", ""),
            "book": primary_link.get("book", ""),
            "chapter": primary_link.get("chapter", ""),
            "lemma": entry.get("lemma", ""),
            "lemma_en": entry.get("lemma_en", ""),
            "relation": primary_link.get("relation", ""),
            "evidence_phrase": primary_link.get("evidence_phrase", ""),
            "consensus_confidence": primary_link.get("consensus_confidence"),
            "review_decision_source": primary_link.get("review_decision_source", ""),
            "candidate_id": primary_link.get("candidate_id", ""),
            "link_ids": point.get("link_ids", []),
            "accepted_links": accepted_links,
        }
        if not site["has_geometry"]:
            unmapped.append(site["site_key"])
        sites.append(site)

    sites.sort(key=site_sort_key)
    for index, site in enumerate(sites, start=1):
        site["route_order"] = index

    all_view = {
        "view_id": "all",
        "label": "All",
        "synopsis": (
            "Accepted Materia Medica provenance points from the cleaned simples "
            "pilot. Broad regions use representative Pleiades points and are "
            "labeled as broad rather than precise."
        ),
        "route_keys": [],
        "sites": sites,
        "drawable_line_points": [],
        "unmapped_site_keys": sorted(unmapped),
    }
    return {
        "schema_version": 1,
        "generated_at": now_utc(),
        "source": (
            f"{rel(MANIFEST_PATH)} + {rel(LINKS_PATH)} + "
            f"{rel(MAP_POINTS_PATH)} + scripts/simples/build_materia_medica_viewer.py"
        ),
        "views": {"all": all_view},
    }


def main() -> int:
    manifest = load_json(MANIFEST_PATH)
    entries_by_id = {entry["entry_id"]: entry for entry in manifest.get("entries", [])}
    links = load_json(LINKS_PATH).get("links", [])
    points = load_json(MAP_POINTS_PATH).get("points", [])

    missing_entries = sorted(
        {
            link["entry_id"]
            for link in links
            if link.get("entry_id") not in entries_by_id
        }
    )
    if missing_entries:
        raise AssertionError(f"links reference missing manifest entries: {missing_entries}")

    entry_ids = {link["entry_id"] for link in links}
    places = build_places(points)
    passages = build_passages(entries_by_id, entry_ids)
    materia = build_materia(entries_by_id, links)
    route_views = build_route_views(entries_by_id, points)

    write_json(OUT_DIR / "places_authority.json", places)
    write_json(OUT_DIR / "passages.json", passages)
    write_json(OUT_DIR / "materia.json", materia)
    write_json(OUT_DIR / "route_views.json", route_views)

    print(f"Wrote {rel(OUT_DIR / 'places_authority.json')} ({len(places)} places)")
    print(f"Wrote {rel(OUT_DIR / 'materia.json')} ({len(materia)} materia)")
    print(f"Wrote {rel(OUT_DIR / 'passages.json')} ({len(passages)} passages)")
    print(
        f"Wrote {rel(OUT_DIR / 'route_views.json')} "
        f"({len(route_views['views']['all']['sites'])} sites)"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
