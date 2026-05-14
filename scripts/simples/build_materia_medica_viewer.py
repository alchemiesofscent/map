#!/usr/bin/env python3
"""Build viewer-ready Materia Medica data from TEI-derived provenance."""
from __future__ import annotations

from collections import defaultdict
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
    "gal_antid": "Galen",
    "gal_alimfac": "Galen",
    "gal_smt": "Galen",
    "orib": "Oribasius",
    "paul": "Paul of Aegina",
}

RELATION_GROUPS = {
    "best_preferred_source": (10, "Best/preferred source"),
    "grows_found_produced": (20, "Grows/found/produced"),
    "named_variety": (30, "Named variety"),
    "acquired_transported": (40, "Acquired/transported"),
    "observed_tested_prepared": (50, "Observed/tested/prepared"),
    "reviewed_provenance": (90, "Reviewed provenance"),
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


def place_key(pleiades_id: str) -> str:
    return f"pleiades_{pleiades_id}"


def sort_piece(value: object) -> tuple[int, object]:
    text = str(value or "").strip()
    if text.isdigit():
        return (0, int(text))
    return (1, text.lower())


def relation_group(link: dict[str, Any]) -> tuple[str, int, str]:
    relation = link.get("relation", "")
    qualifier = str(link.get("qualifier", "")).lower()
    claim_group = str(link.get("claim_group", "")).lower()
    if qualifier in {"best", "preferred"} or claim_group in {"best_source", "preferred_source"}:
        key = "best_preferred_source"
    elif relation in {"grows_at", "produced_at", "found_at"}:
        key = "grows_found_produced"
    elif relation == "named_variety_from":
        key = "named_variety"
    elif relation in {"acquired", "acquired_from", "transported_from", "traded_from", "sourced_from"}:
        key = "acquired_transported"
    elif relation in {"observed", "observed_at", "tested", "tested_at", "prepared", "prepared_at"}:
        key = "observed_tested_prepared"
    else:
        key = "reviewed_provenance"
    rank, label = RELATION_GROUPS[key]
    return key, rank, label


def link_projection(link: dict[str, Any]) -> dict[str, Any]:
    group_key, group_rank, group_label = relation_group(link)
    return {
        "link_id": link["link_id"],
        "candidate_id": link.get("candidate_id", ""),
        "claim_id": link.get("claim_id", ""),
        "review_row_id": link.get("review_row_id", ""),
        "entry_id": link["entry_id"],
        "passage_id": link.get("passage_id", link["entry_id"]),
        "ingredient_key": link["ingredient_key"],
        "author": link.get("author", ""),
        "work": link.get("work", ""),
        "book": link.get("book", ""),
        "chapter": link.get("chapter", ""),
        "lemma": link.get("lemma", ""),
        "relation": link["relation"],
        "relation_group": group_key,
        "relation_group_rank": group_rank,
        "relation_group_label": group_label,
        "qualifier": link.get("qualifier", ""),
        "claim_group": link.get("claim_group", ""),
        "claim_note": link.get("claim_note", ""),
        "claim_order": link.get("claim_order"),
        "place_surface": link.get("place_surface", ""),
        "accepted_pleiades_id": link["accepted_pleiades_id"],
        "accepted_pleiades_uri": link["accepted_pleiades_uri"],
        "place_label": link.get("place_label", ""),
        "evidence_phrase": link.get("evidence_phrase", ""),
        "certainty": link.get("certainty", ""),
        "review_decision_source": link.get("review_decision_source", ""),
        "entry_claim_source": link.get("entry_claim_source", ""),
        "final_decision": link.get("final_decision", ""),
        "consensus_method": link.get("consensus_method", ""),
        "consensus_confidence": link.get("consensus_confidence"),
        "warnings": link.get("warnings", []),
    }


def ingredient_order(manifest: dict[str, Any]) -> dict[str, int]:
    return {
        ingredient["ingredient_key"]: index
        for index, ingredient in enumerate(manifest.get("ingredients", []))
    }


def site_sort_key(site: dict[str, Any], ingredient_rank: dict[str, int]) -> tuple[object, ...]:
    return (
        ingredient_rank.get(site.get("ingredient_key", ""), 999),
        site.get("claim_order") if site.get("claim_order") is not None else 9999,
        sort_piece(site.get("book")),
        sort_piece(site.get("chapter")),
        (site.get("place_label") or "").lower(),
        site.get("site_key") or "",
    )


def combined_source_citation(entries: list[dict[str, Any]]) -> str:
    if not entries:
        return ""
    first = entries[0]
    base = [
        AUTHOR_LABELS.get(first.get("author", ""), first.get("author", "")),
        first.get("work", ""),
        f"book {first.get('book')}" if first.get("book") else "",
    ]
    chapters = [
        str(entry.get("chapter"))
        for entry in entries
        if entry.get("chapter") not in (None, "")
    ]
    if chapters:
        base.append("chapters " + ", ".join(chapters))
    return ", ".join(bit for bit in base if bit)


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
    for entry_id in sorted(
        entry_ids,
        key=lambda eid: (
            sort_piece(entries_by_id[eid].get("book")),
            sort_piece(entries_by_id[eid].get("chapter")),
            eid,
        ),
    ):
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
                "ingredient_keys": entry.get("ingredient_keys", []),
                "greek": entry.get("greek_entry_text", ""),
                "translation_en": entry.get("entry_en", ""),
                "translation_en_authority": entry.get("translation_en_authority", ""),
                "translation_en_source": entry.get("translation_en_source", ""),
                "evidence_authority": entry.get("evidence_authority", "greek_tei"),
            }
        )
    return passages


def build_materia(
    manifest: dict[str, Any],
    entries_by_id: dict[str, dict[str, Any]],
    links: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    links_by_ingredient: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for link in links:
        links_by_ingredient[link["ingredient_key"]].append(link)

    materia = []
    for ingredient in manifest.get("ingredients", []):
        ingredient_key = ingredient["ingredient_key"]
        grouped_links = links_by_ingredient.get(ingredient_key, [])
        if not grouped_links:
            continue
        entry_ids = ingredient.get("entry_ids", [])
        entries = [entries_by_id[entry_id] for entry_id in entry_ids if entry_id in entries_by_id]
        place_links = []
        for link in sorted(
            grouped_links,
            key=lambda row: (
                row.get("claim_order") if row.get("claim_order") is not None else 9999,
                sort_piece(row.get("book")),
                sort_piece(row.get("chapter")),
                row.get("accepted_pleiades_id", ""),
                row.get("link_id", ""),
            ),
        ):
            projected = link_projection(link)
            projected.update(
                {
                    "place_key": place_key(link["accepted_pleiades_id"]),
                    "passage_id": link.get("passage_id", link["entry_id"]),
                }
            )
            place_links.append(projected)
        materia.append(
            {
                "materia_key": ingredient_key,
                "ingredient_key": ingredient_key,
                "display_name": ingredient["display_name"],
                "greek_name": ingredient["greek_name"],
                "entry_ids": entry_ids,
                "passage_ids": ingredient.get("passage_ids", entry_ids),
                "category": "Materia Medica source journey",
                "source_citation": combined_source_citation(entries),
                "source_json_path": rel(MANIFEST_PATH),
                "place_links": place_links,
                "view_id": ingredient["view_id"],
            }
        )
    return materia


def build_route_views(
    manifest: dict[str, Any],
    entries_by_id: dict[str, dict[str, Any]],
    points: list[dict[str, Any]],
) -> dict[str, Any]:
    ingredient_by_key = {
        ingredient["ingredient_key"]: ingredient
        for ingredient in manifest.get("ingredients", [])
    }
    rank = ingredient_order(manifest)
    sites = []
    unmapped = []
    for point in points:
        if not point.get("links"):
            continue
        primary_link = point["links"][0]
        ingredient = ingredient_by_key[primary_link["ingredient_key"]]
        entry = entries_by_id[primary_link["entry_id"]]
        coords = point.get("coordinates") or {}
        lat = coords.get("lat")
        lon = coords.get("lon")
        accepted_links = [link_projection(link) for link in point.get("links", [])]
        pid = point["group_key"]["pleiades_id"]
        is_broad = bool(point.get("is_broad_region"))
        group_key, group_rank, group_label = relation_group(primary_link)
        site = {
            "site_key": point["map_point_id"],
            "place_key": place_key(pid),
            "route_key": primary_link["ingredient_key"],
            "route_label": ingredient["display_name"],
            "route_order": None,
            "kind": "materia",
            "display_name": ingredient["display_name"],
            "greek_name": ingredient["greek_name"],
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
            "materia_key": primary_link["ingredient_key"],
            "materia_keys": [primary_link["ingredient_key"]],
            "ingredient_key": primary_link["ingredient_key"],
            "passage_id": primary_link.get("passage_id", primary_link["entry_id"]),
            "entry_id": primary_link["entry_id"],
            "source_citation": source_citation(entry),
            "author": primary_link.get("author", ""),
            "work": primary_link.get("work", ""),
            "book": primary_link.get("book", ""),
            "chapter": primary_link.get("chapter", ""),
            "lemma": entry.get("lemma", ""),
            "lemma_en": entry.get("lemma_en", ""),
            "relation": primary_link.get("relation", ""),
            "relation_group": group_key,
            "relation_group_rank": group_rank,
            "relation_group_label": group_label,
            "qualifier": primary_link.get("qualifier", ""),
            "claim_group": primary_link.get("claim_group", ""),
            "claim_note": primary_link.get("claim_note", ""),
            "claim_order": primary_link.get("claim_order"),
            "place_surface": primary_link.get("place_surface", ""),
            "evidence_phrase": primary_link.get("evidence_phrase", ""),
            "consensus_confidence": primary_link.get("consensus_confidence"),
            "review_decision_source": primary_link.get("review_decision_source", ""),
            "entry_claim_source": primary_link.get("entry_claim_source", ""),
            "claim_id": primary_link.get("claim_id", ""),
            "link_ids": point.get("link_ids", []),
            "accepted_links": accepted_links,
        }
        if not site["has_geometry"]:
            unmapped.append(site["site_key"])
        sites.append(site)

    sites.sort(key=lambda site: site_sort_key(site, rank))
    for index, site in enumerate(sites, start=1):
        site["route_order"] = index

    all_view = {
        "view_id": "all",
        "label": "All",
        "synopsis": (
            "Accepted Materia Medica provenance claims from local TEI annotations. "
            "Broad regions use representative Pleiades points and are labeled as broad rather than precise."
        ),
        "route_keys": [],
        "sites": sites,
        "drawable_line_points": [],
        "unmapped_site_keys": sorted(unmapped),
    }
    views = {"all": all_view}
    for ingredient in manifest.get("ingredients", []):
        ingredient_key = ingredient["ingredient_key"]
        ingredient_sites = [site for site in sites if site["ingredient_key"] == ingredient_key]
        if not ingredient_sites:
            continue
        for index, site in enumerate(ingredient_sites, start=1):
            site["ingredient_route_order"] = index
        views[ingredient["view_id"]] = {
            "view_id": ingredient["view_id"],
            "label": ingredient["display_name"],
            "synopsis": f"Accepted place claims for {ingredient['display_name']}.",
            "route_keys": [],
            "materia_key": ingredient_key,
            "ingredient_key": ingredient_key,
            "entry_ids": ingredient.get("entry_ids", []),
            "passage_ids": ingredient.get("passage_ids", ingredient.get("entry_ids", [])),
            "sites": ingredient_sites,
            "drawable_line_points": [],
            "unmapped_site_keys": sorted(
                site["site_key"] for site in ingredient_sites if not site.get("has_geometry")
            ),
        }
    return {
        "schema_version": 1,
        "generated_at": now_utc(),
        "source": (
            f"{rel(MANIFEST_PATH)} + {rel(LINKS_PATH)} + "
            f"{rel(MAP_POINTS_PATH)} + scripts/simples/build_materia_medica_viewer.py"
        ),
        "views": views,
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
    materia = build_materia(manifest, entries_by_id, links)
    route_views = build_route_views(manifest, entries_by_id, points)

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
