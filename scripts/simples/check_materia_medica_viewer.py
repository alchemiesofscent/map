#!/usr/bin/env python3
"""Validate the generated Materia Medica viewer adapter."""
from __future__ import annotations

from pathlib import Path
from typing import Any

from provenance_common import (
    DEPRECATED_ARABIA_PLEIADES_ID,
    LINKS_PATH,
    MAP_POINTS_PATH,
    REPO_ROOT,
    load_json,
    rel,
)


OUT_DIR = REPO_ROOT / "data" / "generated" / "materia_medica"
EXPECTED_STOPS = {
    "balsamum": ["687934"],
    "cardamom": ["658443", "874350", "520977", "50004", "1001942"],
    "calamus": ["50004"],
    "schoinos": ["29677", "1001942", "716588"],
    "myrrh": ["1001942", "39435", "39386", "540689"],
}
EXPECTED_INGREDIENT_ORDER = ["balsamum", "cardamom", "calamus", "schoinos", "myrrh"]


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
    if len(materia) != 5:
        raise AssertionError(f"expected exactly 5 Materia journeys, found {len(materia)}")
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
        if place["pleiades_id"] == DEPRECATED_ARABIA_PLEIADES_ID:
            raise AssertionError(f"{place['place_key']}: Arabia provenance must not emit 981506")

    for passage in passages:
        if passage.get("evidence_authority") != "greek_tei":
            raise AssertionError(f"{passage['passage_id']}: Greek TEI must be evidence authority")
        if passage.get("translation_en"):
            if passage.get("translation_en_authority") != "display_only_draft_translation":
                raise AssertionError(f"{passage['passage_id']}: English translation must be display-only draft")
            if passage.get("translation_en_source") != "data/review/materia_draft_translations.json":
                raise AssertionError(f"{passage['passage_id']}: translation source must be draft sidecar")

    ingredient_order = [item["ingredient_key"] for item in materia]
    if ingredient_order != EXPECTED_INGREDIENT_ORDER:
        raise AssertionError(f"expected ingredient order {EXPECTED_INGREDIENT_ORDER}, found {ingredient_order}")
    for item in materia:
        require_keys(
            item,
            (
                "materia_key",
                "ingredient_key",
                "display_name",
                "greek_name",
                "entry_ids",
                "passage_ids",
                "place_links",
                "view_id",
            ),
            f"materia {item.get('materia_key')}",
        )
        key = item["ingredient_key"]
        if item["materia_key"] != key:
            raise AssertionError(f"{key}: materia_key should match ingredient_key")
        if item["view_id"] != key:
            raise AssertionError(f"{key}: view_id should match ingredient_key")
        pids = [link["accepted_pleiades_id"] for link in item["place_links"]]
        if pids != EXPECTED_STOPS[key]:
            raise AssertionError(f"{key}: expected Pleiades IDs {EXPECTED_STOPS[key]}, found {pids}")
        for passage_id in item["passage_ids"]:
            if passage_id not in passage_ids:
                raise AssertionError(f"{key}: unknown passage_id {passage_id}")
        for link in item["place_links"]:
            require_keys(
                link,
                (
                    "link_id",
                    "place_key",
                    "ingredient_key",
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
            if link["relation"] in {"context_only", "rejected_candidate", "rejected"}:
                raise AssertionError(f"{link['link_id']}: excluded relation promoted")
            if not link.get("relation_group_label"):
                raise AssertionError(f"{link['link_id']}: missing relation group label")
            if "provenance_llm_adjudications" in link.get("review_decision_source", ""):
                raise AssertionError(f"{link['link_id']}: generated English/LLM sidecar used as authority")

    views = route_views.get("views", {})
    expected_view_ids = ["all", *EXPECTED_INGREDIENT_ORDER]
    if list(views.keys()) != expected_view_ids:
        raise AssertionError(f"expected view ids {expected_view_ids}, found {list(views.keys())}")
    all_view = views["all"]
    sites = all_view.get("sites", [])
    if len(sites) != len(points):
        raise AssertionError(f"expected {len(points)} sites, found {len(sites)}")
    if all_view.get("drawable_line_points"):
        raise AssertionError("Materia Medica view must not emit drawable line points")
    for view_id in EXPECTED_INGREDIENT_ORDER:
        view = views[view_id]
        if view.get("drawable_line_points"):
            raise AssertionError(f"{view_id}: material view must not emit drawable line points")
        pids = [site["pleiades_id"] for site in view.get("sites", [])]
        if pids != EXPECTED_STOPS[view_id]:
            raise AssertionError(f"{view_id}: expected view stops {EXPECTED_STOPS[view_id]}, found {pids}")

    for site in sites:
        require_keys(
            site,
            (
                "site_key",
                "place_key",
                "ingredient_key",
                "display_name",
                "greek_name",
                "place_label",
                "relation",
                "relation_group_label",
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
        if site["pleiades_id"] == DEPRECATED_ARABIA_PLEIADES_ID:
            raise AssertionError(f"{site['site_key']}: Arabia provenance must not emit 981506")

    broad_sites = sum(1 for site in sites if site.get("is_broad_region"))
    print("Materia Medica viewer adapter validates")
    print(f"Places: {len(places)}")
    print(f"Materia: {len(materia)}")
    print(f"Passages: {len(passages)}")
    print(f"Sites: {len(sites)}")
    print(f"Ingredient views: {len(EXPECTED_INGREDIENT_ORDER)}")
    print(f"Broad-region sites: {broad_sites}")
    print("Drawable line points: 0")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
