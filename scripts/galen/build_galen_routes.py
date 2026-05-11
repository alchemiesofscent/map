#!/usr/bin/env python3
"""Stage 6: assemble Galen route data + viewer-friendly views.

Reads Stage-3/4/5 outputs (passages.json, places_authority.json, materia.json)
+ the consolidated route definitions hard-coded here, and emits:

  data/generated/galen/routes.json        — array of Route objects per
    schemas/galen/galen-route.schema.json (stops with route_order,
    materia_keys, narrative_note; edges with kuhn_citation + certainty).

  data/generated/galen/route_views.json   — Periplus-shaped viewer payload:
    {schema_version, generated_at, source, views} where each view carries
    label, route_keys, sites[], drawable_line_points[], unmapped_site_keys[].
    Includes one view per route, an "all" view that concatenates routes as
    separate disconnected polylines (per the curator decision: no synthetic
    edges between trips), and a "materia_observations" view for the
    not-a-route materia pins (Trifolinus / Mysia, etc.).

The route definitions mirror docs/galen_route_decisions.md exactly:
  - stops are the route's `core_stops` in narrative order
  - context places are not added to the polyline but appear in route_views
    sites with kind="context"
  - excluded (do_not_map) places never appear in stops or sites for that route
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PASSAGES = ROOT / "data" / "generated" / "galen" / "passages.json"
PLACES = ROOT / "data" / "generated" / "galen" / "places_authority.json"
LEXICON = ROOT / "data" / "galen" / "lexicon" / "places.json"
MATERIA = ROOT / "data" / "generated" / "galen" / "materia.json"
OUT_ROUTES = ROOT / "data" / "generated" / "galen" / "routes.json"
OUT_VIEWS = ROOT / "data" / "generated" / "galen" / "route_views.json"


# ---------------------------------------------------------------------------
# Hard-coded route definitions (mirror docs/galen_route_decisions.md)
#
# Each route lists:
#   stops:    ordered list of dicts with place_key, order_basis, narrative_note
#             pointing at the curator-authored evidence; the passage_id refers
#             back to passages.json so we can derive evidence_phrase + Kühn refs.
#   edges:    ordered list of dicts naming the from→to links the curator
#             accepts as drawable route lines.
#   context_keys: place_keys that are category-B in this route — added to the
#             view's sites list as `kind: context` but not to the polyline.
# ---------------------------------------------------------------------------

ROUTES: list[dict] = [
    {
        "route_key": "lemnos-alexandria-troas-to-thessalonica-context",
        "label": "First Lemnos attempt (via Alexandria Troas → Myrina)",
        "synopsis": (
            "Galen's first Lemnian-earth attempt (SMT 9.1, a). He boards a "
            "Thessalonica-bound ship at Alexandria Troas after arranging a Lemnos "
            "stopover. The captain puts in at the wrong Lemnian city — Myrina — "
            "and does not wait while Galen walks across the island; Hephaistia, "
            "the intended collection city, is not reached on this trip."
        ),
        "start_place_key": "alexandria_troas",
        "stops": [
            {
                "place_key": "alexandria_troas",
                "order_basis": "explicit",
                "passage_id": "smt.9.1.a",
                "evidence_phrase": "ἔπλευσα πρότερον ἀπὸ Τρῳάδος Ἀλεξανδρείας εἰς Λῆμνον",
                "narrative_note": "The named departure port for the Lemnos crossing.",
            },
            {
                "place_key": "myrina_lemnos",
                "order_basis": "explicit",
                "passage_id": "smt.9.1.a",
                "evidence_phrase": "ὡς δὲ ἀποβὰς τῆς νεὼς, ἔγνων Μυρίναν μὲν ὀνομάζεσθαι τὴν πόλιν",
                "narrative_note": "Galen's wrong-port disembarkation. He learns on landing that the city is Myrina, not the Hephaistia he wanted, and the captain cannot wait.",
            },
        ],
        "edges": [
            {
                "from_place_key": "alexandria_troas",
                "to_place_key": "myrina_lemnos",
                "kuhn_citation": "K. XII 168.7–178.1",
                "textual_basis": "ἔπλευσα πρότερον … προσέσχε μὲν, οὐ μὴν ᾗ γ' ἐχρῆν πόλει … ἔγνων Μυρίναν μὲν ὀνομάζεσθαι τὴν πόλιν",
                "certainty": "secure",
            },
        ],
        "context_keys": ["lemnos", "hephaistia", "thessalonica", "macedonia_region", "thracia_region", "rome"],
    },
    {
        "route_key": "lemnos-italy-to-troas-via-thasos",
        "label": "Second Lemnos voyage (Philippi → Thasos → Lemnos → Troas)",
        "synopsis": (
            "Galen's second, methodically-documented Lemnos voyage (SMT 9.1, b). "
            "Starting from Philippi he descends 120 stades to an unnamed nearby "
            "coast, then sails Thasos (200 stades) → Lemnos (700 stades) → "
            "Hephaistia (the collection city) → Alexandria Troas (another 700 "
            "stades). Galen records the stadia counts explicitly so future "
            "readers can replicate the trip. Italy and Macedonia frame the prose "
            "as backdrop but are not waypoints on the routed itinerary."
        ),
        "start_place_key": "philippi",
        "stops": [
            {
                "place_key": "philippi",
                "order_basis": "explicit",
                "passage_id": "smt.9.1.b",
                "evidence_phrase": "ἐν Φιλίπποις ἐγενόμην, ἥπερ ἐστὶν ὅμορος τῇ Θρᾴκῃ πόλις",
                "narrative_note": "Embarkation city after walking through Macedonia. Galen explicitly records the 120-stade descent to the nearby coast.",
            },
            {
                "place_key": "philippi_nearby_coast",
                "order_basis": "explicit",
                "passage_id": "smt.9.1.b",
                "evidence_phrase": "ἐντεῦθεν ἐπὶ τὴν πλησίον θάλατταν εἴκοσιν ἐπὶ τοῖς ἑκατὸν ἀπέχουσαν στάδια κατελθὼν",
                "narrative_note": "The unnamed embarkation port 120 stades (~22 km) south of Philippi. Galen does not name it; per the curator decision it is mapped as a derived project-local place, not pinned to Neapolis or any Pleiades record.",
            },
            {
                "place_key": "thasos",
                "order_basis": "explicit",
                "passage_id": "smt.9.1.b",
                "evidence_phrase": "ἔπλευσα πρότερον μὲν εἰς Θάσον ἐγγύς που διακοσίους σταδίους",
                "narrative_note": "First sea leg — 200 stades from the Philippi coast.",
            },
            {
                "place_key": "lemnos",
                "order_basis": "explicit",
                "passage_id": "smt.9.1.b",
                "evidence_phrase": "ἐκεῖθεν δὲ εἰς Λῆμνον ἑπτακοσίους",
                "narrative_note": "Second sea leg — 700 stades from Thasos to Lemnos.",
            },
            {
                "place_key": "hephaistia",
                "order_basis": "strongly_implied",
                "passage_id": "smt.9.1.b",
                "evidence_phrase": "ὅπως εἴ τις ἐθέλῃ θεάσασθαι … τὴν Ἡφαιστιάδα διαγινώσκων τὴν θέσιν αὐτῆς",
                "narrative_note": "The collection city on Lemnos — Galen's named destination.",
            },
            {
                "place_key": "alexandria_troas",
                "order_basis": "explicit",
                "passage_id": "smt.9.1.b",
                "evidence_phrase": "ἀπὸ Λήμνου τοὺς ἴσους ἑπτακοσίους εἰς Ἀλεξανδρείαν Τρῳάδα",
                "narrative_note": "Return leg — another 700 stades from Lemnos back to Alexandria Troas, completing the circuit.",
            },
        ],
        "edges": [
            {
                "from_place_key": "philippi",
                "to_place_key": "philippi_nearby_coast",
                "kuhn_citation": "K. XII 168.7–178.1",
                "textual_basis": "ἐντεῦθεν ἐπὶ τὴν πλησίον θάλατταν εἴκοσιν ἐπὶ τοῖς ἑκατὸν ἀπέχουσαν στάδια κατελθὼν",
                "certainty": "secure",
            },
            {
                "from_place_key": "philippi_nearby_coast",
                "to_place_key": "thasos",
                "kuhn_citation": "K. XII 168.7–178.1",
                "textual_basis": "ἔπλευσα πρότερον μὲν εἰς Θάσον ἐγγύς που διακοσίους σταδίους",
                "certainty": "secure",
            },
            {
                "from_place_key": "thasos",
                "to_place_key": "lemnos",
                "kuhn_citation": "K. XII 168.7–178.1",
                "textual_basis": "ἐκεῖθεν δὲ εἰς Λῆμνον ἑπτακοσίους",
                "certainty": "secure",
            },
            {
                "from_place_key": "lemnos",
                "to_place_key": "hephaistia",
                "kuhn_citation": "K. XII 168.7–178.1",
                "textual_basis": "Implicit overland leg on Lemnos to the collection city.",
                "certainty": "probable",
            },
            {
                "from_place_key": "hephaistia",
                "to_place_key": "alexandria_troas",
                "kuhn_citation": "K. XII 168.7–178.1",
                "textual_basis": "ἀπὸ Λήμνου τοὺς ἴσους ἑπτακοσίους εἰς Ἀλεξανδρείαν Τρῳάδα (Galen specifies Lemnos→Troas; Hephaistia is the implicit city of departure)",
                "certainty": "probable",
            },
        ],
        "context_keys": ["italia_peninsula", "macedonia_region", "thracia_region"],
    },
    {
        "route_key": "cyprus-soloi-mines",
        "label": "Cyprus / Soloi mines",
        "synopsis": (
            "Galen's autoptic visit to the imperial copper mines at Soloi on Cyprus "
            "(SMT 9.3, with retrospective summary in De antidotis 1.2). The "
            "passages document a single in-situ stay: he speaks with the mine "
            "steward, observes the three concentric mineral bands (sory, "
            "chalcitis, misy), collects cadmia and chalcanthon for transport "
            "back to Asia and Rome, and revisits the chalcanthon → chalcitis "
            "transformation in his samples thirty years later."
        ),
        "start_place_key": "soloi_cyprus",
        "stops": [
            {
                "place_key": "soloi_cyprus",
                "order_basis": "explicit",
                "passage_id": "smt.9.3.b",
                "evidence_phrase": "ἐν γοῦν τοῖς Σόλοις … καθ' ὃν ἐγὼ χρόνον ἐπεδήμησα τῇ νήσῳ",
                "narrative_note": "The named city anchor. Multiple anchors document the same stay: SMT 9.3 (K. XII 214.5, 219.5, 226.7, 238.1×2) and De antidotis 1.2.",
            },
            {
                "place_key": "soloi_mine",
                "order_basis": "explicit",
                "passage_id": "smt.9.3.a",
                "evidence_phrase": "ἔνθα τὸ μέταλλόν ἐστιν, ὡς ἀπὸ σταδίων τῆς πόλεως τριάκοντα",
                "narrative_note": "The unnamed mine ~30 stades from Soloi. Project-local derived coordinates; no Pleiades record.",
            },
        ],
        "edges": [
            {
                "from_place_key": "soloi_cyprus",
                "to_place_key": "soloi_mine",
                "kuhn_citation": "K. XII 214.5–217.3",
                "textual_basis": "ἔνθα τὸ μέταλλόν ἐστιν, ὡς ἀπὸ σταδίων τῆς πόλεως τριάκοντα — Galen specifies the mine's offset from the city in stades.",
                "certainty": "probable",
            },
        ],
        "context_keys": ["cyprus_island", "asia_province", "italia_peninsula", "rome", "pergamum", "cyzicus"],
    },
    {
        "route_key": "coele-syria-dead-sea-materials",
        "label": "Coele Syria / Dead Sea materials",
        "synopsis": (
            "Material-source aggregation, not a routed itinerary. SMT 9.1 (a) "
            "names Coele Syria as one of Galen's three primary materia-medica "
            "destinations (alongside Cyprus and Lemnos), and SMT 9.2 (a) "
            "records the bituminous black stones he brought back from there. "
            "De antidotis 1.2 supplies the related Palaestina-Syria opobalsam "
            "acquisition. No ordered city sequence is given; the Dead Sea is "
            "the source location for the asphalt and stones but not a routed "
            "waypoint. Rendered as a pin at Coele Syria with no polyline."
        ),
        "start_place_key": "coele_syria",
        "stops": [
            {
                "place_key": "coele_syria",
                "order_basis": "explicit",
                "passage_id": "smt.9.1.a",
                "evidence_phrase": "εἴς τε τὴν κοίλην Συρίαν, μόριον οὖσαν τῆς Παλαιστίνης, ἕνεκεν ἀσφάλτου … ἐπορεύθην",
                "narrative_note": "Galen names Coele Syria as one of his three primary materia-medica destinations alongside Cyprus and Lemnos.",
            },
        ],
        "edges": [],
        "context_keys": ["dead_sea", "palestine"],
    },
    {
        "route_key": "pergamum-ergasteria-mines",
        "label": "Pergamum → Ergasteria mines",
        "synopsis": (
            "A short overland trip on Galen's home turf: from Pergamum east-"
            "northeast to the mining village of Ergasteria, 440 stades distant, "
            "where he observed scattered molybdaina (galena) on the road. The "
            "lone passage anchoring this route (SMT 9.3 K. XII 229.7–230.4) "
            "supplies the named departure point, the named destination, and an "
            "explicit stadia distance."
        ),
        "start_place_key": "pergamum",
        "stops": [
            {
                "place_key": "pergamum",
                "order_basis": "explicit",
                "passage_id": "smt.9.3.d",
                "evidence_phrase": "κατὰ τὴν εἰς Ἐργαστήρια φέρουσαν ὁδὸν ἀπὸ Περγάμου",
                "narrative_note": "Galen's home city; the named departure point.",
            },
            {
                "place_key": "ergasteria",
                "order_basis": "explicit",
                "passage_id": "smt.9.3.d",
                "evidence_phrase": "καλεῖται δ' Ἐργαστήρια κώμη τις, ἐν ᾗ καὶ μέταλλά ἐστι, μεταξὺ Περγάμου καὶ Κυζίκου, σταδίους ἀπέχουσα Περγάμου τετρακοσίους τεσσαράκοντα",
                "narrative_note": "Mining village 440 stades from Pergamum, between Pergamum and Cyzicus; Galen observed molybdaina on the approach road.",
            },
        ],
        "edges": [
            {
                "from_place_key": "pergamum",
                "to_place_key": "ergasteria",
                "kuhn_citation": "K. XII 229.7–230.4",
                "textual_basis": "κατὰ τὴν εἰς Ἐργαστήρια φέρουσαν ὁδὸν ἀπὸ Περγάμου … σταδίους ἀπέχουσα Περγάμου τετρακοσίους τεσσαράκοντα",
                "certainty": "secure",
            },
        ],
        "context_keys": ["cyzicus", "cyprus_island"],
    },
]


# Materia-medica observation layer (not a route; rendered as standalone pins).
MATERIA_OBSERVATIONS = {
    "view_id": "materia_observations",
    "label": "Materia observations (no route)",
    "synopsis": (
        "Places where Galen records first-hand observation of substances or "
        "clinical practices but where the surrounding passage does not "
        "support a route. Rendered as map pins, not connected by lines."
    ),
    "place_keys": [
        "neapolis_campania",   # de_antidotis.1.3.a — Trifolinus wine
        "mysia",               # smt.10.2.a — chicken-dung antidote (observed)
    ],
}


# ---------------------------------------------------------------------------

def load_inputs() -> tuple[dict[str, dict], dict[str, dict], dict[str, dict]]:
    passages = {p["passage_id"]: p for p in json.loads(PASSAGES.read_text())}
    # Start from places_authority (Stage 4 output) and fall back to the curator
    # lexicon for any place_key referenced by routes but not auto-detected in
    # passages.json (e.g., dead_sea — Galen's descriptive 'so-called Dead Sea'
    # phrase is multi-word lowercase and the auto-tagger misses it).
    places: dict[str, dict] = {}
    for p in json.loads(PLACES.read_text()):
        places[p["place_key"]] = p
    if LEXICON.exists():
        for entry in json.loads(LEXICON.read_text()):
            places.setdefault(entry["place_key"], entry)
    materia_by_place: dict[str, list[dict]] = {}
    for m in json.loads(MATERIA.read_text()):
        for link in m.get("place_links", []) or []:
            materia_by_place.setdefault(link["place_key"], []).append(
                {"materia_key": m["materia_key"], "relation": link["relation"], "passage_id": link["passage_id"]}
            )
    return passages, places, materia_by_place


def kuhn_citations_for(passage: dict) -> list[str]:
    """Compose a single Kühn citation string for a passage."""
    vol = passage["kuhn_volume"]
    ps = passage["kuhn_page_start"]
    ls = passage["kuhn_line_start"]
    pe = passage["kuhn_page_end"]
    le = passage["kuhn_line_end"]
    if ps == pe:
        if ls == le:
            return [f"K. {vol} {ps}.{ls}"]
        return [f"K. {vol} {ps}.{ls}–{le}"]
    return [f"K. {vol} {ps}.{ls}–{pe}.{le}"]


def materia_keys_at(place_key: str, materia_by_place: dict[str, list[dict]]) -> list[str]:
    """Unique materia_keys associated with a place across all passages."""
    seen: set[str] = set()
    out: list[str] = []
    for entry in materia_by_place.get(place_key, []):
        if entry["materia_key"] not in seen:
            seen.add(entry["materia_key"])
            out.append(entry["materia_key"])
    return out


def build_route_record(
    route: dict,
    passages: dict[str, dict],
    materia_by_place: dict[str, list[dict]],
) -> dict:
    """Conform to schemas/galen/galen-route.schema.json."""
    stops = []
    for order, s in enumerate(route["stops"], start=1):
        passage = passages.get(s["passage_id"], {})
        stops.append({
            "route_order": order,
            "place_key": s["place_key"],
            "order_basis": s["order_basis"],
            "evidence_phrase": s["evidence_phrase"],
            "kuhn_citations": kuhn_citations_for(passage) if passage else [],
            "materia_keys": materia_keys_at(s["place_key"], materia_by_place),
            "narrative_note": s["narrative_note"],
        })
    edges = [
        {
            "from_place_key": e["from_place_key"],
            "to_place_key": e["to_place_key"],
            "kuhn_citation": e["kuhn_citation"],
            "textual_basis": e["textual_basis"],
            "certainty": e["certainty"],
        }
        for e in route["edges"]
    ]
    return {
        "route_key": route["route_key"],
        "label": route["label"],
        "synopsis": route["synopsis"],
        "start_place_key": route["start_place_key"],
        "stops": stops,
        "edges": edges,
    }


def site_record(
    place_key: str,
    place: dict,
    route_key: str,
    route_label: str,
    route_order: int | None,
    kind: str,
    stop_meta: dict | None,
    passages: dict[str, dict],
    materia_by_place: dict[str, list[dict]],
) -> dict:
    """One entry for `views[*].sites[]` — Periplus-shaped where it makes sense."""
    record = {
        "site_key": place_key,
        "place_key": place_key,
        "route_key": route_key,
        "route_label": route_label,
        "route_order": route_order,
        "kind": kind,  # 'primary' | 'context'
        "display_name": place["display_name"],
        "place_type": place["place_type"],
        "lat": place.get("lat"),
        "lon": place.get("lon"),
        "has_geometry": place.get("lat") is not None and place.get("lon") is not None,
        "certainty": place["certainty"],
        "pleiades_id": place.get("pleiades_id"),
        "pleiades_uri": place.get("pleiades_uri"),
        "ancient_names_in_galen": place.get("ancient_names_in_galen", []),
        "materia_keys": materia_keys_at(place_key, materia_by_place),
        "notes": place.get("notes", ""),
    }
    if stop_meta:
        passage = passages.get(stop_meta["passage_id"], {})
        record["order_basis"] = stop_meta["order_basis"]
        record["evidence_phrase"] = stop_meta["evidence_phrase"]
        record["narrative_note"] = stop_meta["narrative_note"]
        record["passage_id"] = stop_meta["passage_id"]
        record["kuhn_citation"] = (kuhn_citations_for(passage)[0] if passage else None)
    return record


def build_view_for_route(
    route: dict,
    places: dict[str, dict],
    passages: dict[str, dict],
    materia_by_place: dict[str, list[dict]],
) -> dict:
    sites: list[dict] = []
    drawable: list[dict] = []
    unmapped: list[str] = []

    primary_keys = [s["place_key"] for s in route["stops"]]

    for order, s in enumerate(route["stops"], start=1):
        pk = s["place_key"]
        place = places[pk]
        rec = site_record(
            pk, place, route["route_key"], route["label"],
            order, "primary", s, passages, materia_by_place,
        )
        sites.append(rec)
        if rec["has_geometry"]:
            drawable.append({
                "site_key": pk,
                "route_key": route["route_key"],
                "route_order": order,
                "lat": rec["lat"],
                "lon": rec["lon"],
            })
        else:
            unmapped.append(pk)

    for pk in route["context_keys"]:
        if pk in primary_keys:
            continue  # already in stops
        place = places.get(pk)
        if not place:
            continue
        rec = site_record(
            pk, place, route["route_key"], route["label"],
            None, "context", None, passages, materia_by_place,
        )
        sites.append(rec)
        if not rec["has_geometry"]:
            unmapped.append(pk)

    return {
        "view_id": route["route_key"],
        "label": route["label"],
        "synopsis": route["synopsis"],
        "route_keys": [route["route_key"]],
        "sites": sites,
        "drawable_line_points": drawable,
        "unmapped_site_keys": unmapped,
    }


def build_all_view(
    routes: list[dict],
    per_route_views: list[dict],
    materia_view: dict,
) -> dict:
    """Concatenate every route's primary stops as separate polylines.

    Sites are deduplicated by (site_key, route_key) so the same place can
    appear in multiple routes (e.g. Lemnos in two Lemnos routes).
    drawable_line_points carries route_key per point so the renderer can
    break the polyline at route_key transitions — no synthetic edges
    between trips, per the curator decision.
    """
    sites: list[dict] = []
    drawable: list[dict] = []
    unmapped: set[str] = set()
    seen_site_route: set[tuple[str, str]] = set()
    route_keys: list[str] = []

    for view in per_route_views:
        rk = view["view_id"]
        route_keys.append(rk)
        for s in view["sites"]:
            key = (s["site_key"], s["route_key"])
            if key in seen_site_route:
                continue
            seen_site_route.add(key)
            sites.append(s)
        for pt in view["drawable_line_points"]:
            drawable.append(pt)
        for u in view["unmapped_site_keys"]:
            unmapped.add(u)

    # Append materia-observation sites as a final group (no polyline)
    for s in materia_view["sites"]:
        key = (s["site_key"], s["route_key"])
        if key in seen_site_route:
            continue
        seen_site_route.add(key)
        sites.append(s)

    return {
        "view_id": "all",
        "label": "All routes",
        "synopsis": "Every accepted Galen route rendered together as separate polylines (no synthetic connections between trips). The materia-observation pins are also included.",
        "route_keys": route_keys,
        "sites": sites,
        "drawable_line_points": drawable,
        "unmapped_site_keys": sorted(unmapped),
    }


def build_materia_view(
    places: dict[str, dict],
    passages: dict[str, dict],
    materia_by_place: dict[str, list[dict]],
) -> dict:
    sites: list[dict] = []
    unmapped: list[str] = []
    for pk in MATERIA_OBSERVATIONS["place_keys"]:
        place = places.get(pk)
        if not place:
            continue
        rec = site_record(
            pk, place, MATERIA_OBSERVATIONS["view_id"], MATERIA_OBSERVATIONS["label"],
            None, "materia", None, passages, materia_by_place,
        )
        sites.append(rec)
        if not rec["has_geometry"]:
            unmapped.append(pk)
    return {
        "view_id": MATERIA_OBSERVATIONS["view_id"],
        "label": MATERIA_OBSERVATIONS["label"],
        "synopsis": MATERIA_OBSERVATIONS["synopsis"],
        "route_keys": [],
        "sites": sites,
        "drawable_line_points": [],   # no polyline for materia
        "unmapped_site_keys": unmapped,
    }


def main() -> int:
    passages, places, materia_by_place = load_inputs()

    # 1) emit routes.json (schema-conforming)
    routes_records = [build_route_record(r, passages, materia_by_place) for r in ROUTES]
    OUT_ROUTES.parent.mkdir(parents=True, exist_ok=True)
    OUT_ROUTES.write_text(json.dumps(routes_records, ensure_ascii=False, indent=2))
    print(f"Wrote {len(routes_records)} routes to {OUT_ROUTES.relative_to(ROOT)}")

    # 2) emit route_views.json
    per_route_views = [build_view_for_route(r, places, passages, materia_by_place) for r in ROUTES]
    materia_view = build_materia_view(places, passages, materia_by_place)
    all_view = build_all_view(ROUTES, per_route_views, materia_view)

    views = {v["view_id"]: v for v in [*per_route_views, materia_view, all_view]}
    payload = {
        "schema_version": 1,
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "source": "data/galen/lexicon/places.json + data/galen/materia/materia.json + scripts/galen/build_galen_routes.py",
        "views": views,
    }
    OUT_VIEWS.write_text(json.dumps(payload, ensure_ascii=False, indent=2))
    print(f"Wrote {len(views)} views to {OUT_VIEWS.relative_to(ROOT)}")

    # Summary
    for v in per_route_views:
        sites = v["sites"]
        primary = sum(1 for s in sites if s["kind"] == "primary")
        context = sum(1 for s in sites if s["kind"] == "context")
        edges = next((r for r in routes_records if r["route_key"] == v["view_id"]), {}).get("edges", [])
        print(f"  {v['view_id']}: {primary} primary stop(s), {context} context, {len(edges)} edge(s), "
              f"{len(v['drawable_line_points'])} drawable pts")
    print(f"  materia_observations: {len(materia_view['sites'])} pins")
    print(f"  all: {len(all_view['sites'])} sites total, {len(all_view['drawable_line_points'])} drawable pts")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
