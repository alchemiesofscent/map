# 01. Minimal JSON schema

The data model is intentionally small. The browser should not infer ancient geography. It should render prepared, reviewed data.

## File order

1. `raw_sections.sample.json`
2. `places_authority.sample.json`
3. `tour_cards.sample.json`
4. `tour_stops.sample.json`
5. `route_legs.sample.json`
6. `movements.sample.json`

This order mirrors the interpretive workflow: text first, reconciliation second, user-facing tour third.

## Core entities

### Raw section

A raw section preserves the extraction unit and its LLM-assisted translation. This is the citation anchor.

Required fields:

```json
{
  "chunk_id": "section_0004",
  "passage_id": "text/body/div[...]",
  "source_ref": "anonymous_periplus:text/body/div[...]",
  "section_order": 4,
  "draft_translation": "About three thousand stades after Ptolemais...",
  "places": [],
  "commodity_entities": [],
  "movement_events": []
}
```

Do not overwrite raw extraction fields when you improve the interface. Add normalized records in other files.

### Place authority

The place authority table is the key scholarly layer. It maps textual mentions to local place keys, Pleiades IDs, coordinates, certainty, aliases, and notes.

Required fields:

```json
{
  "place_key": "adulis",
  "display_name": "Adulis",
  "greek_names": ["Ἀδουλίς"],
  "aliases": ["Adouli", "Zula"],
  "place_type": "port",
  "lat": 15.275955,
  "lon": 39.676537,
  "certainty": "high",
  "pleiades_id": "39271",
  "pleiades_uri": "https://pleiades.stoa.org/places/39271",
  "coordinates_source": "...",
  "notes": "..."
}
```

Use `lat: null` and `lon: null` for regions, unresolved islands, or named peoples that should not be forced into a point.

### Tour card

A tour card is what the user reads in the right-hand panel. It usually corresponds to one source section, but it may highlight multiple places.

Required fields:

```json
{
  "tour_card_id": "card_004_adulis",
  "section_order": 4,
  "chunk_id": "section_0004",
  "title": "Adulis and its inland supply lines",
  "subtitle": "Harbor, islands, ivory roads, and Aksumite routes",
  "focus_place_key": "adulis",
  "place_keys": ["adulis", "koloe", "aksum_metropolis"],
  "summary": "...",
  "goods": ["ivory", "tortoise shell"],
  "display_layers": ["main_route", "movements", "goods"],
  "ui_note": "..."
}
```

### Tour stop

A tour stop is a mapped node on the main guided route. Not every place mention becomes a tour stop.

Required fields:

```json
{
  "tour_stop_id": "stop_004_adulis",
  "section_order": 4,
  "chunk_id": "section_0004",
  "place_key": "adulis",
  "title": "Adulis",
  "kind": "primary_stop",
  "sequence_index": 4,
  "summary": "...",
  "goods": ["ivory"],
  "certainty": "high"
}
```

### Route leg

A route leg connects two primary tour stops.

Required fields:

```json
{
  "leg_id": "leg_003_ptolemais_adulis",
  "from_place_key": "ptolemais_theron",
  "to_place_key": "adulis",
  "distance_text": "about 3,000 stades",
  "distance_value": 3000,
  "distance_unit": "stades",
  "route_type": "coastal_sea",
  "certainty": "text_explicit",
  "notes": "..."
}
```

Keep the ancient distance string as the primary display. Any kilometer conversion is a secondary UI aid.

### Movement

A movement is a commodity or supply overlay. It is separate from the main route.

Required fields:

```json
{
  "movement_id": "mv_004_ivory_inland_to_adulis",
  "section_order": 4,
  "chunk_id": "section_0004",
  "movement_type": "inland_export_to_port",
  "source_place_key": "beyond_the_nile",
  "destination_place_key": "adulis",
  "via_place_keys": ["kyeneion", "aksum_metropolis", "koloe"],
  "polyline_place_keys": ["aksum_metropolis", "koloe", "adulis"],
  "goods": ["ivory"],
  "certainty": "medium",
  "notes": "..."
}
```

`polyline_place_keys` can omit unresolved source places. The textual chain remains in `source_place_key` and `via_place_keys`.

## Controlled values

Suggested `certainty` values:

- `high`
- `medium`
- `low`
- `text_explicit`
- `inferred_from_sequence`

Suggested `place_type` values:

- `port`
- `emporion`
- `island`
- `archipelago`
- `inland_market`
- `metropolis`
- `region`
- `source_region`
- `route_marker`
- `ethnographic_region`
- `archaeological_site`

Suggested `route_type` values:

- `coastal_sea`
- `inland_road`
- `island_supply`
- `regional_context`

Suggested `movement_type` values:

- `local_availability`
- `local_supply_to_port`
- `inland_export_to_port`
- `comparison`

## Validation policy

The repository includes machine-readable JSON Schemas in `schemas/`, but the lightweight default check is `scripts/check_data.py`. That script verifies references across files without requiring external dependencies.
