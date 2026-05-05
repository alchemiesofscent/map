# Engine decision: why a custom Leaflet viewer

The scrollytelling viewer is the curated, route-first scholarly interface for the *Periplus of the Erythraean Sea*. We considered three engines for that interface and chose **Leaflet**. This note records why, so the choice is reversible later with full context.

## The three options

| | **Embedded Google My Map** (iframe) | **Leaflet custom viewer** | **Google Maps JavaScript API custom viewer** |
|---|---|---|---|
| Build effort | Near zero | Medium (this repo) | Medium-high |
| Editing the source data | In the My Maps UI by anyone with edit rights | JSON files in this repo, code review | Same as Leaflet (same JSON) |
| Route-first interaction | No — generic My Maps UI | **Yes** — per-step camera, place-link buttons, off-route status, Greek/English split | Yes, same model |
| Link from text → marker | No | **Yes** — `<button class="place-link" data-place-key="…">` | Yes |
| Greek text and source-ref panel | No | **Yes** | Yes |
| Certainty / kind-aware styling (text_explicit vs inferred, main_route vs off_route) | No | **Yes** | Yes |
| Base imagery quality | Google's | OSM-derived (CartoDB Voyager today) | Google's |
| Cost / dependencies | Free, but pulls in Google iframe + cookies | Free, no API key, pinned CDN | API key, billing exposure, ToS constraints |
| Sharing / embedding | Trivial in Google's ecosystem | Static hosting works (the current `python3 -m http.server`) | Static hosting works |
| Offline / local-first | iframe needs the network | Tiles cache; everything else is local files | Tiles need the network |
| Citability of presentation | Weak (Google can change the embed) | Strong (deterministic from versioned JSON) | Strong, but bound to a vendor |

## Conclusion

**Use the Leaflet custom viewer as the main interface.** The whole point of this prototype — route-first reading, per-step camera, place-link buttons that fly to markers, off-route places that never change the curated route — is interaction the embedded My Map cannot do. Outsourcing the UI to Google would cost the entire reading model.

**Use the Google My Map as a reference / import source only.** The My Map is convenient for sketching and for non-coders, so we let users bring it in: export to KML, run `scripts/import_mymaps_kml.py`, tick **Show external reference map** in the viewer. The layer renders in muted gray and is explicitly labeled "External reference map" in popups. It cannot change the active step or the main route line.

**Defer Google Maps JS API.** At our zoom range (Red Sea / Indian Ocean coast at z6–z8) Google's imagery does not meaningfully outperform CartoDB Voyager for this kind of textual/spatial narrative, and adopting the JS API would add an API key, billing, and ToS constraints. Worth a later spike only if a concrete need appears (e.g., shoreline-change studies that depend on Google's recent satellite tiles).

## What would change this decision

- We adopt a base imagery requirement that only Google supplies (high-resolution recent satellite, Street View, Earth integration).
- We need editor-grade collaborative authoring of the curated data and the JSON workflow becomes a blocker.
- A funder mandates a specific platform.

In any of those cases, the migration target is the Google Maps JavaScript API custom viewer (third column above), not the embedded My Map iframe — the iframe loses the route-first interaction that defines this prototype.
