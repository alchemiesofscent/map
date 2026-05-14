# Simples Provenance Pipeline Checklist

Current stage: Materia reset complete. The Materia Medica viewer data now derives
five ingredient journeys from local TEI annotations.

Status: TEI-first deterministic pipeline with a local `data/tei/` source
boundary. Accepted Materia links come from annotated `placeName` claims, not
from the old review queue, Pleiades mention candidates, or LLM adjudication
sidecars.

Last updated: 2026-05-14

## Implementation Rules

- [x] Source text is read only from `data/tei/`; annotated TEI is preferred when present.
- [x] Greek TEI is evidence authority; generated English is display-only draft data.
- [x] Old cached generated English is retired; draft display translations live in `data/review/materia_draft_translations.json`.
- [x] Pleiades is the place authority.
- [x] Arabia provenance claims use Pleiades `1001942`; accepted outputs must not emit `981506`.
- [x] Accepted Materia claims are encoded as TEI `placeName` annotations with ingredient key, relation, claim group, qualifier, order, evidence phrase, and warnings.
- [x] The manifest is grouped by ingredient keys, not by one source entry per route view.
- [x] Generated Galen materia JSON is not an input to the Materia extraction path.
- [x] Old review/LLM sidecars are not accepted-link authorities.
- [x] Broad regions and uncertain coordinates are flagged in map output.
- [x] Materia Medica stops are point-only ingredient journeys, not itinerary routes.

## Current Pilot

- Balsamum: Iudaea `687934`.
- Cardamom: Commagene `658443`, Armenia `874350`, Bosphorus `520977`, India `50004`, Arabia `1001942`.
- Calamus: India `50004`.
- Schoinos: Nabataea `29677`, Arabia `1001942`, Libya `716588`.
- Myrrh: Arabia `1001942`, Trogodytice `39435`, Minaei `39386`, Boeotia `540689`.

## Stages

### 0. Annotate And Check TEI

Output path: `data/tei/annotated/tlg0656.tlg001.annotated.xml`.

Commands:

- `python3 scripts/simples/annotate_dioscorides_tei.py`
- `python3 scripts/simples/check_tei_source_registry.py`

Current counts:

- Dioscorides Materia place annotations: 14.
- Ingredient keys: 5.

### 1. Build Ingredient Manifest

Output path: `data/generated/simples/entry_manifest.json`.

Commands:

- `python3 scripts/simples/build_pilot_manifest.py`
- `python3 scripts/simples/check_pilot_manifest.py`

Current counts:

- Ingredient journeys: 5.
- Manifest entries: 6.
- Source TEI paths: 1.
- Galen materia context rows: 0.
- Draft translation source: `data/review/materia_draft_translations.json`.

### 2. Normalize TEI Claims

Output path: `data/generated/simples/provenance_entry_claims.json`.

Commands:

- `python3 scripts/simples/build_entry_provenance_claims.py`
- `python3 scripts/simples/check_entry_provenance_claims.py`

Current counts:

- Accepted TEI claims: 14.
- Ingredients with claims: 5.
- Entries with claims: 6.

### 3. Accepted Provenance Links

Output path: `data/generated/simples/provenance_links.json`.

Commands:

- `python3 scripts/simples/build_provenance_links.py`
- `python3 scripts/simples/check_provenance_links.py`

Current counts:

- Accepted links: 14.
- Source mode: `tei_placeName_claims`.
- Accepted by ingredient: Cardamom 5, Myrrh 4, Schoinos 3, Balsamum 1, Calamus 1.

### 4. Map-Ready Output

Output path: `data/generated/simples/provenance_map_points.json`.

Commands:

- `python3 scripts/simples/build_provenance_map_points.py`
- `python3 scripts/simples/check_provenance_map_points.py`

Current counts:

- Accepted links in: 14.
- Map points: 14.
- Null-coordinate points: 0.
- Broad-region points: 13.

### 5. Materia Medica Viewer Data

Output path: `data/generated/materia_medica/`.

Commands:

- `python3 scripts/simples/build_materia_medica_viewer.py`
- `python3 scripts/simples/check_materia_medica_viewer.py`

Current counts:

- Places: 11.
- Materia journeys: 5.
- Passages: 6.
- Sites: 14.
- Ingredient views: 5 plus the `all` overview.
- Drawable line points: 0.

## Stop Conditions

- Stop if a source path escapes `data/tei/`.
- Stop if an accepted claim lacks a Pleiades `ref`.
- Stop if an accepted claim, link, map point, or viewer site emits Pleiades `981506` for Arabia.
- Stop if generated English is used as extraction evidence.
- Stop if `entry_manifest.json` repopulates English from old generated caches such as `derived_display_cache`.
- Stop if `provenance_links.json` cites old review or LLM sidecars as its authority.
- Stop before treating a broad region or null-coordinate place as a precise map point.

## Add-More Checklist

See `docs/materia_tei_ingredient_journeys.md` for the current "how to add the
rest" path: choose ingredient, annotate TEI, add display-only translation if
needed, rebuild, verify no stale sidecars, and inspect the viewer.
