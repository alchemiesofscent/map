# Periplus Tour MVP

A small repo scaffold for turning periploi passages into a visual route: source text chunks, LLM-assisted translations, Pleiades reconciliation, a route model, and a static story-map prototype.

The first sample uses the opening Red Sea sequence from the anonymous *Periplus Maris Erythraei* extraction supplied in the prompt.

## What is included

1. `docs/01-json-schema.md` — the minimal data model and JSON schemas.
2. `docs/02-repo-plan-task-list.md` — implementation order and task list.
3. `docs/03-frontend-wireframe-spec.md` — wireframe and UI behavior spec.
4. `data/*.sample.json` — starter data for passages, places, stops, route legs, movements, and tour cards.
5. `schemas/*.schema.json` — machine-readable JSON Schema drafts.
6. `app/` — a static Leaflet prototype with buttons and a route strip.
7. `features/scrollytelling-viewer/` — a standalone scroll-driven viewer feature for dev testing.
8. `scripts/check_data.py` — referential-integrity checks.
9. `scripts/export_geojson.py` — creates GeoJSON exports for GIS or debugging.
10. `scripts/refresh_pleiades.py` — fetches per-place Pleiades JSON snapshots into `data/pleiades/` and writes a drift report.
11. `scripts/import_mymaps_kml.py` — converts a Google My Maps KML export into a GeoJSON reference layer for the scrollytelling viewer.

## Run locally

From the repo root:

```bash
python3 scripts/check_data.py
python3 scripts/ingest_tour_chunk.py --start 1 --count 10
python3 scripts/check_generated_tour.py
python3 scripts/export_geojson.py
python3 scripts/refresh_pleiades.py     # optional: refresh data/pleiades/ + drift report
python3 -m http.server 8000
```

Then open:

```text
http://localhost:8000/app/
```

The app uses Leaflet and OpenStreetMap tiles from CDNs, so the visual map needs network access. The data model and scripts do not.

## Scrollytelling feature

A scroll-driven viewer has been added in its own folder so it can be tested independently from the base prototype.

Serve the repository root:

```bash
python3 -m http.server 8000
```

Then open:

```text
http://localhost:8000/features/scrollytelling-viewer/
```

The feature reads generated data from `data/generated/periplus/`. Run `python3 scripts/ingest_tour_chunk.py --start 1 --count 10` to rebuild the current generated pass from `texts.csv`, `translations.csv`, the curated starter authority, and provisional Google My Maps matches. Each source section becomes a scroll step; the active step drives map camera movement, route highlighting, active markers, and linked Greek/English place mentions.

## Make this into a git repo

```bash
tar -xzf periplus-tour-mvp.tar.gz
cd periplus-tour-mvp
git init
git add .
git commit -m "Initial periplus tour scaffold"
```

## Data stance

This scaffold separates four layers:

- `raw_sections.sample.json`: source chunk, CTS-ish passage identifiers, and draft translation.
- `places_authority.sample.json`: local reconciliation from textual place mentions to Pleiades and candidate coordinates.
- `tour_stops.sample.json` and `route_legs.sample.json`: the main guided route.
- `movements.sample.json`: commodity and side-route overlays.

Uncertain locations are not hidden. They are carried as `certainty: low` or `certainty: medium` and should be styled differently in the UI.

## Publication notes

Before public scholarly release, run `python3 scripts/refresh_pleiades.py` and read `generated/pleiades_drift.txt` to see where our curated authority diverges from the live Pleiades records; reconcile by hand in `data/places_authority.sample.json`, update the `coordinates_source` notes, and add project-specific source URLs for the First1KGreek TEI files. Pleiades data is CC-BY; DARE-derived data is subject to its own attribution/share-alike requirements. See `ATTRIBUTION.md` and `data/pleiades/README.md`.
