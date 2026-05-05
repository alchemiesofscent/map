# 02. Repo plan and task list

The goal is a simple guided visual tour, not a full historical GIS.

## Implementation order

### Phase 1: repository and sample data

- Keep the supplied section extraction in `data/raw_sections.sample.json`.
- Build a local place authority table in `data/places_authority.sample.json`.
- Add four main route stops: Myos Hormos, Berenike, Ptolemais of the Hunts, Adulis.
- Add side entities as non-primary places: Meroe, Koloe, Aksum, Alalaiou islands, Kyeneion, Oreine, Diodoros, and named regions.
- Run `scripts/check_data.py`.

### Phase 2: static prototype

- Render the main route on a Leaflet map.
- Render mapped side movements as dashed overlays.
- Show a right-hand passage card with translation, places, goods, and source reference.
- Add Previous / Next navigation.
- Add uncertainty badges.

### Phase 3: reconciliation workflow

- Replace starter coordinates with values from a reproducible Pleiades dump or API pull.
- Store reconciliation decisions in `coordinates_source` and `notes`.
- Preserve multiple candidates where needed.
- Do not force regions or peoples into artificial points.

### Phase 4: source integration

- Add a script that imports First1KGreek TEI by CTS ref or local path.
- Add Greek snippets to the tour cards only after text segmentation is stable.
- Keep Greek text, translation, and interpretation as separate fields.

### Phase 5: richer exploration

- Add filters for goods.
- Add filters for certainty.
- Add a layer toggle for main route, inland movements, island supply, and regional context.
- Add export buttons for GeoJSON and CSV.

## Suggested issue list

### Data issues

- Reconcile every `english_label` in raw section `places` to a `place_key`.
- Confirm Pleiades IDs for ethnographic groups where useful.
- Decide whether Ptolemais of the Hunts should use the candidate coordinate in the starter file or stay unpointed.
- Decide how to represent Oreine and Diodoros: unresolved points, polygons, or text-only anchorage notes.
- Add a stable `source_uri` or repository path for the First1KGreek TEI.

### Interface issues

- Add keyboard support for Previous / Next.
- Add permalink state, for example `?card=4`.
- Add hover labels for route legs.
- Add a compact mobile layout.
- Add a legend explaining line styles and certainty.

### Scholarship issues

- Review each LLM-assisted translation.
- Add translation status: draft, reviewed, published.
- Add notes for inferred route legs.
- Add bibliographic notes for disputed identifications.
- Record who made each reconciliation decision and when.

## Definition of done for MVP

The MVP is complete when a user can open the static app, click through the four tour cards in order, see the highlighted Red Sea route, inspect goods and place notes, and distinguish secure locations from uncertain or unresolved ones.
