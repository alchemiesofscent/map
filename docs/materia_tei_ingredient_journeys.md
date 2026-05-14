# Materia TEI Ingredient Journeys

This is the current path for adding more Materia Medica ingredient journeys.
The Greek TEI under `data/tei/` is the evidence authority. Pleiades remains the
place authority. Generated English is display-only and must not decide claims.
The old cached English in generated manifests is retired and should not be
reused. Current draft translations live in
`data/review/materia_draft_translations.json` only for viewer orientation.

## Current Pilot

The reset pilot contains five ingredient journeys:

- Balsamum: Iudaea `687934`.
- Cardamom: Commagene `658443`, Armenia `874350`, Bosphorus `520977`, India `50004`, Arabia `1001942`.
- Calamus: India `50004`.
- Schoinos: Nabataea `29677`, Arabia `1001942`, Libya `716588`.
- Myrrh: Arabia `1001942`, Trogodytice `39435`, Minaei `39386`, Boeotia `540689`.

## How To Add The Rest

1. Choose one ingredient key.

   Use a stable lowercase key such as `iris` or `cinnamon`. Add its display name,
   Greek name, and view id in `scripts/simples/build_pilot_manifest.py`.

2. Annotate local TEI place claims.

   Add the accepted `placeName` annotations in
   `scripts/simples/annotate_dioscorides_tei.py`, then regenerate
   `data/tei/annotated/tlg0656.tlg001.annotated.xml`. Each `placeName` must carry
   `ref`, `cert`, `ingredient_key`, `relation`, `claim_group`, `qualifier`,
   `claim_order`, and `evidence_phrase`. Use `warnings` for broad, ethnic,
   ambiguous, or low-precision claims.

3. Add or revise display translation.

   If the ingredient needs English for the viewer, add a draft translation to
   `data/review/materia_draft_translations.json`. Keep it display-only. Do not
   use it for place extraction or claim adjudication.

4. Rebuild from TEI.

   Run:

   ```sh
   python3 scripts/simples/annotate_dioscorides_tei.py
   python3 scripts/simples/check_tei_source_registry.py
   python3 scripts/simples/build_pilot_manifest.py
   python3 scripts/simples/check_pilot_manifest.py
   python3 scripts/simples/build_entry_provenance_claims.py
   python3 scripts/simples/check_entry_provenance_claims.py
   python3 scripts/simples/build_provenance_links.py
   python3 scripts/simples/check_provenance_links.py
   python3 scripts/simples/build_provenance_map_points.py
   python3 scripts/simples/check_provenance_map_points.py
   python3 scripts/simples/build_materia_medica_viewer.py
   python3 scripts/simples/check_materia_medica_viewer.py
   ```

5. Verify no stale sidecars are being promoted.

   Accepted links must come from `data/generated/simples/provenance_entry_claims.json`.
   They must not cite `data/review/simples_provenance_review.csv`,
   `data/review/simples_entry_provenance_claims.json`, or
   `data/generated/simples/provenance_llm_adjudications.json`.

6. Inspect the viewer.

   In the Materia corpus, the ingredient buttons should appear beside `All`.
   Selecting an ingredient should step through its place claims. The route data
   must keep `drawable_line_points: []`.
