# Scrollytelling viewer feature

A standalone, route-first scroll-driven viewer of generated passes through the *Periplus of the Erythraean Sea*.

The current generated payload covers sections 1-66. Each section is a scroll step with full English translation, Greek text, and linked place names. Places with curated authority records, provisional Google My Maps coordinates, or reviewed visual-coordinate decisions can focus the map; off-route places can focus their own markers but never change the main route line.

The viewer has three selectable reading/map views:

- **All**: sections 1-66 with both western and eastern route sites.
- **Western**: sections 1-18 with western route sites.
- **Eastern**: sections 19-66 with eastern route sites.

Forward/back buttons and the keyboard Left/Right arrows move only within the selected view.

## Data files used

Generated:

- `../../data/generated/periplus/places_authority.json` — curated starter authority plus generated candidates.
- `../../data/generated/periplus/raw_sections.json` — Greek text, translation, and parsed entities for the active section pass.
- `../../data/generated/periplus/journey_route.json` — defines `main_route_place_keys`, `steps`, `legs`, and per-step `place_mentions`.
- `../../data/generated/periplus/route_views.json` — selectable route-view contract built from the reviewed webmap scrape.

Reference:

- `../../data/places_authority.sample.json` — starter curated authority.
- `../../data/external/google_mymaps/periplus_mymap.geojson` — non-authoritative coordinate reference for generated provisional candidates.

Goods, commodity, and movement data are intentionally **not rendered** in this iteration; they remain in `data/` for use by other prototypes.

## Run

From the repository root:

```bash
python3 scripts/check_data.py
python3 scripts/ingest_tour_chunk.py --start 1 --count 66
python3 scripts/apply_place_review_decisions.py --max-section 66
python3 scripts/build_route_views.py
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

Route ordering comes from `data/review/periplus_sites_webmap_scrape.json`, transformed by `scripts/build_route_views.py` into `route_views.json`. The scrape controls route membership and route-site order; `texts.csv` and `translations.csv` remain the source for the full Greek and English reading windows.

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

- Main route markers are drawn from the selected `route_views.json` view, not from generated `main_route_place_keys`.
- Route lines are quiet sequence guides only. They are no longer animated as sailing tracks, and inland/metropolis sites are omitted from line drawing so the UI does not imply a ship is sailing across land.
- Active step highlights its route marker. Clicking a route marker opens its popup and scrolls to the relevant source section when that section is in the current view.
- Off-route mapped places appear as smaller dashed markers, never connected to the route.
- Unmapped off-route places appear only in the text and the off-route status panel.
- Route-view sites with null geometry, currently `Akabaru`, `Khrusē Island`, and `Thina`, remain in route metadata/status but do not draw markers or polyline points. When such a site is active, the map remains on the nearest previous mapped route site and shows an unmapped-route note.
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
