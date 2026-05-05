# Contributing workflow

Use this sequence when adding more periplus sections.

1. Add raw section records to `data/raw_sections.sample.json` or replace it with your project export.
2. Reconcile place mentions in `data/places_authority.sample.json`.
3. Add or update `data/tour_cards.sample.json` for the guided reading order.
4. Add primary route stops to `data/tour_stops.sample.json`.
5. Add sea legs to `data/route_legs.sample.json`.
6. Add commodity and side-route overlays to `data/movements.sample.json`.
7. Run `python3 scripts/check_data.py`.
8. Run `python3 scripts/export_geojson.py` and inspect `generated/`.

Keep uncertain identifications in the data. Do not replace uncertainty with false precision.
