#!/usr/bin/env python3
"""Validate the generated Materia Medica viewer adapter."""
from __future__ import annotations

from pathlib import Path
from typing import Any

from provenance_common import LINKS_PATH, MAP_POINTS_PATH, REPO_ROOT, load_json, rel


OUT_DIR = REPO_ROOT / "data" / "generated" / "materia_medica"


def require_path(path: Path) -> None:
    if not path.exists():
        raise AssertionError(f"missing generated file: {rel(path)}")


def require_keys(row: dict[str, Any], keys: tuple[str, ...], label: str) -> None:
    for key in keys:
        if key not in row:
            raise AssertionError(f"{label}: missing {key}")


def main() -> int:
    paths = {
        "places": OUT_DIR / "places_authority.json",
        "materia": OUT_DIR / "materia.json",
        "passages": OUT_DIR / "passages.json",
        "route_views": OUT_DIR / "route_views.json",
    }
    for path in paths.values():
        require_path(path)

    places = load_json(paths["places"])
    materia = load_json(paths["materia"])
    passages = load_json(paths["passages"])
    route_views = load_json(paths["route_views"])
    links = load_json(LINKS_PATH)["links"]
    points = load_json(MAP_POINTS_PATH)["points"]

    accepted_pids = {link["accepted_pleiades_id"] for link in links}
    entry_ids = {link["entry_id"] for link in links}

    if len(places) != len(accepted_pids):
        raise AssertionError(f"expected {len(accepted_pids)} places, found {len(places)}")
    if len(materia) != len(entry_ids):
        raise AssertionError(f"expected {len(entry_ids)} materia, found {len(materia)}")
    if len(passages) != len(entry_ids):
        raise AssertionError(f"expected {len(entry_ids)} passages, found {len(passages)}")

    place_keys = {place["place_key"] for place in places}
    passage_ids = {passage["passage_id"] for passage in passages}
    materia_keys = {item["materia_key"] for item in materia}

    for place in places:
        require_keys(
            place,
            (
                "place_key",
                "display_name",
                "lat",
                "lon",
                "pleiades_id",
                "pleiades_uri",
                "location_precision",
                "is_broad_region",
                "has_uncertain_coordinates",
            ),
            f"place {place.get('place_key')}",
        )
        if place["pleiades_id"] not in accepted_pids:
            raise AssertionError(f"{place['place_key']}: unexpected Pleiades id")

    for item in materia:
        require_keys(
            item,
            ("materia_key", "entry_id", "display_name", "greek_name", "place_links"),
            f"materia {item.get('materia_key')}",
        )
        if item["materia_key"] not in passage_ids:
            raise AssertionError(f"{item['materia_key']}: no matching passage")
        if not item["display_name"]:
            raise AssertionError(f"{item['materia_key']}: empty display_name")
        for link in item["place_links"]:
            require_keys(
                link,
                (
                    "link_id",
                    "candidate_id",
                    "place_key",
                    "relation",
                    "evidence_phrase",
                    "review_decision_source",
                    "accepted_pleiades_uri",
                ),
                f"materia link {link.get('link_id')}",
            )
            if link["place_key"] not in place_keys:
                raise AssertionError(f"{link['link_id']}: unknown place_key")
            if link["passage_id"] not in passage_ids:
                raise AssertionError(f"{link['link_id']}: unknown passage_id")
            if link.get("final_decision") and link["final_decision"] != "accept":
                raise AssertionError(f"{link['link_id']}: non-accept final decision")
            if link["relation"] in {"context_only", "rejected_candidate"}:
                raise AssertionError(f"{link['link_id']}: excluded relation promoted")

    views = route_views.get("views", {})
    if set(views) != {"all"}:
        raise AssertionError(f"expected only all view, found {sorted(views)}")
    all_view = views["all"]
    sites = all_view.get("sites", [])
    if len(sites) != len(points):
        raise AssertionError(f"expected {len(points)} sites, found {len(sites)}")
    if all_view.get("drawable_line_points"):
        raise AssertionError("Materia Medica view must not emit drawable line points")

    for site in sites:
        require_keys(
            site,
            (
                "site_key",
                "place_key",
                "display_name",
                "greek_name",
                "place_label",
                "relation",
                "source_citation",
                "evidence_phrase",
                "is_broad_region",
                "pleiades_uri",
                "accepted_links",
            ),
            f"site {site.get('site_key')}",
        )
        if site["place_key"] not in place_keys:
            raise AssertionError(f"{site['site_key']}: unknown place_key")
        if site["materia_key"] not in materia_keys:
            raise AssertionError(f"{site['site_key']}: unknown materia_key")
        if site["passage_id"] not in passage_ids:
            raise AssertionError(f"{site['site_key']}: unknown passage_id")
        if not site["pleiades_uri"].startswith("https://pleiades.stoa.org/places/"):
            raise AssertionError(f"{site['site_key']}: invalid Pleiades URI")

    broad_sites = sum(1 for site in sites if site.get("is_broad_region"))
    print("Materia Medica viewer adapter validates")
    print(f"Places: {len(places)}")
    print(f"Materia: {len(materia)}")
    print(f"Passages: {len(passages)}")
    print(f"Sites: {len(sites)}")
    print(f"Broad-region sites: {broad_sites}")
    print("Drawable line points: 0")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
