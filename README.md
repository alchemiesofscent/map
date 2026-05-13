# Periplus Tour MVP

Periplus Tour MVP is a static research atlas for reading ancient geographic and medical texts as structured journeys. It combines source passages, translations, local review ledgers, Pleiades place identifiers, and generated map-ready JSON so that a reader can move between text, place evidence, and route geography without needing a database server.

The current app has two main research surfaces:

- A Periplus route viewer for the anonymous *Periplus Maris Erythraei*, covering the full 66-section journey model currently generated from `texts.csv`, `translations.csv`, review ledgers, and route sidecars.
- A Galen/simple-medicine provenance pipeline that identifies source passages where a simple medicine is tied to a place, adjudicates candidate links, and emits map-ready provenance points.

The project is still an MVP, but the important pieces are reproducible: generated data is built from scripts, uncertain geography is preserved as metadata, and accepted place links carry their review source.

## What The Atlas Does

The viewer in `app/` presents a full-screen Leaflet map with a reading panel and a site strip. It lets a reader step through the route, inspect places mentioned in the passage, and distinguish mapped locations from unresolved or contextual geography.

For the Periplus route, the generated data model separates:

- source sections and translations,
- local place-authority records,
- reviewed route focus records,
- route legs,
- off-route or contextual sites,
- optional Google My Maps and webmap-derived review inputs.

For the simple-medicine provenance work, the pipeline asks a narrower question: when a medical entry names a place, is that place actually evidence for where a substance grows, is produced, is sourced, is acquired, or is merely contextual? The current cleaned run keeps only five accepted Dioscorides provenance links after suppressing false positives such as entry headwords that happen to match Pleiades place names.

## Why This Exists

Ancient route and materia-medica texts often mix several kinds of geography:

- direct route sequence,
- market or harbor geography,
- ethnographic or regional context,
- ingredient provenance,
- named varieties such as regional plants,
- later editorial or translation labels.

Mapping all of those as if they were the same thing produces misleading maps. This repo keeps those layers separate. The route viewer can show the journey, while provenance sidecars can say why a material is linked to Arabia, Galatia, Iudaea, or another region and whether that link came from deterministic matching, human review, or LLM consensus review.

## Repository Layout

- `app/` - canonical static Atlas viewer.
- `features/scrollytelling-viewer/` - older scroll-driven prototype kept for reference.
- `data/generated/periplus/` - generated Periplus sections, places, route views, and route model.
- `data/generated/galen/` - generated Galen route and materia data used by the viewer.
- `data/generated/simples/` - generated simple-medicine provenance artifacts.
- `data/review/` - human-readable review ledgers and CSV review surfaces.
- `data/pleiades/` - cached Pleiades place snapshots and local Pleiades documentation.
- `schemas/` - JSON Schemas for generated data contracts.
- `scripts/` - deterministic builders, importers, validators, and exporters.
- `docs/` - design notes, pipeline checklists, and data-model documentation.

## Data Pipeline

The Periplus route pipeline is:

```bash
python3 scripts/ingest_tour_chunk.py --start 1 --count 66
python3 scripts/apply_place_review_decisions.py --max-section 66
python3 scripts/build_route_views.py
python3 scripts/check_generated_tour.py
```

That rebuilds `data/generated/periplus/` from the CSV source text, translations, reviewed place decisions, and route-view sidecars.

The simple provenance pipeline is:

```bash
python3 scripts/simples/build_pilot_manifest.py
python3 scripts/simples/check_pilot_manifest.py
python3 scripts/simples/build_pleiades_gazetteer.py
python3 scripts/simples/check_pleiades_gazetteer.py
python3 scripts/simples/scan_pleiades_name_mentions.py
python3 scripts/simples/check_pleiades_name_mentions.py
python3 scripts/simples/build_provenance_candidates.py
python3 scripts/simples/check_provenance_candidates.py
python3 scripts/simples/build_provenance_review_queue.py
python3 scripts/simples/check_provenance_review_queue.py
python3 scripts/simples/build_llm_provenance_adjudications.py --timeout 900
python3 scripts/simples/check_llm_provenance_adjudications.py
python3 scripts/simples/build_provenance_links.py
python3 scripts/simples/check_provenance_links.py
python3 scripts/simples/build_provenance_map_points.py
python3 scripts/simples/check_provenance_map_points.py
```

The LLM adjudication step uses Codex CLI. It asks two independent agents to review each candidate against the full source passage. If they agree, that decision is final. If they disagree, a third vote is requested and majority wins. Accepted links are built from `data/generated/simples/provenance_llm_adjudications.json` when that file exists; otherwise the builder falls back to explicit human decisions in `data/review/simples_provenance_review.csv`.

The current cleaned provenance run produces:

- 5 Pleiades name mentions after filtering,
- 5 provenance candidates,
- 5 final LLM consensus accepts,
- 5 accepted provenance links,
- 5 map-ready points,
- 5 broad-region flags.

The scanner now rejects exact entry-label homonyms and lowercase ordinary-word collisions before candidates reach the LLM stage. This prevents examples such as a simple's own name being mistaken for the Pleiades place Abrotonum/Sabratha.

## Run Locally

From the repo root:

```bash
make check
python3 -m http.server 8000
```

Then open:

```text
http://localhost:8000/app/
```

The map uses Leaflet and public CartoDB/OpenStreetMap tiles, so the visual basemap needs network access. The generated JSON data and validation scripts can run locally.

Useful commands:

```bash
npm run ingest
npm run check:generated
npm run geojson
python3 scripts/refresh_pleiades.py
node --check app/viewer-data.js
node --check app/viewer.js
```

## Generated Artifacts

The most important generated contracts are:

- `data/generated/periplus/raw_sections.json`
- `data/generated/periplus/places_authority.json`
- `data/generated/periplus/journey_route.json`
- `data/generated/periplus/route_views.json`
- `data/generated/simples/entry_manifest.json`
- `data/generated/simples/pleiades_gazetteer.json`
- `data/generated/simples/pleiades_name_mentions.json`
- `data/generated/simples/provenance_candidates.json`
- `data/generated/simples/provenance_llm_adjudications.json`
- `data/generated/simples/provenance_links.json`
- `data/generated/simples/provenance_map_points.json`

These files are intentionally readable JSON. They are meant to be inspected, diffed, and validated, not treated as opaque build products.

## Review And Uncertainty

The project does not hide uncertain geography. Instead it records uncertainty where it belongs:

- local review ledgers record accepted, rejected, deferred, and provisional place decisions;
- broad regions are flagged in map output;
- null-coordinate places are kept as textual or review records rather than forced into invented points;
- simple provenance links carry `review_decision_source`, accepted Pleiades IDs, evidence phrases, consensus confidence, and vote trace IDs.

This matters because a map can easily look more certain than the text allows. The data model is designed to make that uncertainty visible.

## Validation

Run the general checks:

```bash
make check
```

Run the simple provenance checks:

```bash
python3 scripts/simples/check_pleiades_name_mentions.py
python3 scripts/simples/check_provenance_candidates.py
python3 scripts/simples/check_llm_provenance_adjudications.py
python3 scripts/simples/check_provenance_links.py
python3 scripts/simples/check_provenance_map_points.py
python3 scripts/simples/check_pilot_manifest.py
```

`check_pilot_manifest.py` also verifies that the sibling `../aetius` checkout has not been modified by this repo's build steps.

## Documentation

- `docs/01-json-schema.md` explains the original route data model.
- `docs/02-repo-plan-task-list.md` records the initial MVP plan.
- `docs/03-frontend-wireframe-spec.md` describes the viewer interaction model.
- `docs/simple_provenance_model.md` defines simple-medicine provenance relations.
- `docs/simples_provenance_pipeline_todo.md` records the current provenance pipeline state and counts.

## Attribution And Publication Notes

Pleiades data is CC-BY. Map tiles and any imported external reference layers carry their own attribution requirements. See `ATTRIBUTION.md` and `data/pleiades/README.md` before publishing the viewer or derived data.

Before public scholarly release, rerun the Pleiades refresh and validation steps, review broad-region map points, and make sure any source texts or translations have the required license and attribution metadata.
