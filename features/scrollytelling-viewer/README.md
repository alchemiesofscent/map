# Scrollytelling viewer feature

A standalone, route-first scroll-driven viewer of generated 10-section passes through the *Periplus of the Erythraean Sea*.

The current generated payload covers sections 1-10. Each section is a scroll step with full English translation, Greek text, and linked place names. Places with curated authority records or provisional Google My Maps coordinates can focus the map; off-route places can focus their own markers but never change the main route line.

## Data files used

Generated:

- `../../data/generated/periplus/places_authority.json` — curated starter authority plus generated candidates.
- `../../data/generated/periplus/raw_sections.json` — Greek text, translation, and parsed entities for the active section pass.
- `../../data/generated/periplus/journey_route.json` — defines `main_route_place_keys`, `steps`, `legs`, and per-step `place_mentions`.

Reference:

- `../../data/places_authority.sample.json` — starter curated authority.
- `../../data/external/google_mymaps/periplus_mymap.geojson` — non-authoritative coordinate reference for generated provisional candidates.

Goods, commodity, and movement data are intentionally **not rendered** in this iteration; they remain in `data/` for use by other prototypes.

## Run

From the repository root:

```bash
python3 scripts/check_data.py
python3 scripts/ingest_tour_chunk.py --start 1 --count 10
python3 scripts/check_generated_tour.py
python3 scripts/export_geojson.py
node --check features/scrollytelling-viewer/scrolly.js
python3 -m http.server 8001
```

Open:

```text
http://localhost:8001/features/scrollytelling-viewer/
```

The map uses Leaflet + CartoDB Voyager tiles (warm light cream, OSM-derived) from a public CDN. Tiles still require network access.

## Why a custom viewer, not an embedded My Map?

Short version: the route-first interaction is the whole point of this prototype, and an embedded Google My Map iframe cannot do it. See [`ENGINE_DECISION.md`](./ENGINE_DECISION.md) for the full comparison.

- The translation panel needs to drive the map (clicking a place name flies the camera and opens its popup); the My Maps iframe has no such hook.
- Active-step highlighting, certainty-aware styling (text-explicit vs inferred legs, main-route vs off-route markers), and the Greek/English split panel all depend on owning the rendering.
- The Google My Map remains useful as a **reference layer**: drop a KML export in `data/external/google_mymaps/`, run `python3 scripts/import_mymaps_kml.py`, and tick **Show external reference map** in the viewer. Reference geometry is muted and labeled "External reference map" in popups; it cannot change the curated route or the active step.

## Greek text

The generator reads Greek from `texts.csv` and emits it into both `raw_sections.json` and the scrollytelling `steps`. Greek and English share the same `place_mentions` list; the viewer links only surfaces that actually appear in each panel.

## Place-link interaction

The translation (and Greek, when present) is HTML-escaped first, then linked via `linkifyText` using `<button class="place-link" data-place-key="…">` rather than raw anchors. Mentions are sorted by descending surface length so longer forms ("Ptolemais of the Hunts") win over shorter substrings, and a substring is never double-linked.

| Click target | Map behavior | Status panel | Main route line |
|---|---|---|---|
| `kind="main_route"` | flies to the route marker, opens its popup | unchanged | unchanged |
| `kind="off_route"`, mapped | flies to the off-route marker, opens its popup | shows "Off route: …" with notes/certainty | **unchanged** |
| `kind="off_route"`, unmapped | does not move | shows note + certainty | **unchanged** |
| `kind="comparison_or_forward_reference"` | same as off-route, mapped if available | shows note | unchanged |

The current scroll step is **not** changed by clicking a place link.

## Map behavior

- Main route line drawn only from `journey_route.sample.json` legs.
- Solid line for `text_explicit` legs; dashed line for `inferred_from_sequence`.
- Active step highlights its focus marker and the leg leading into it.
- Off-route mapped places appear as smaller dashed markers, never connected to the route.
- Unmapped off-route places appear only in the text and the off-route status panel.
- No goods or movement overlays.

## Leaflet tile alignment

Three layers of defense for the misaligned-tile / drifting-overlay symptoms:

1. **Local CSS fallback** at `vendor/leaflet-fallback.css`, loaded after the CDN stylesheet. It re-asserts the critical `.leaflet-container`, `.leaflet-pane`, `.leaflet-tile`, `.leaflet-tile-container`, `.leaflet-control`, and `.leaflet-top/.leaflet-bottom` positioning rules, plus pane `z-index` ordering and `.leaflet-zoom-animated { transform-origin: 0 0; }`, so the map (and the SVG that holds polylines + markers) keeps working if the unpkg CSS is blocked or fails.
2. **`map.invalidateSize()`** is called inside a `requestAnimationFrame` after `L.map(...)`, again after the first step is activated, on `window` resize, and via a `ResizeObserver` on `.map-stage` so the sticky container's first measured size is always correct.
3. **No CSS transforms/scale on `#map` or its ancestors** — that would double-multiply Leaflet's own tile transforms and reintroduce drift during zoom.

## Interaction stance

Plain `IntersectionObserver` (no Scrollama). Scroll-wheel zoom is off by default; touch dragging is off on coarse-pointer devices unless **Explore map** is enabled, so page scrolling never gets hijacked by the map.

Useful next refinements:

1. Replace straight-line legs with hand-drawn coastal polylines once available.
2. Plug in real Greek text + Greek `place_mentions` surfaces.
3. Promote the linkify helper into a shared module if other features need it.
