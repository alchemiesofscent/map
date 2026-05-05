# Pleiades snapshots

This folder contains per-place JSON snapshots fetched verbatim from [Pleiades](https://pleiades.stoa.org/), one file per `pleiades_id` referenced in `data/places_authority.sample.json`.

## Why this folder exists

`data/places_authority.sample.json` is the **curated** authority used by the viewer. These snapshots are **provenance**: they capture what Pleiades said about each place at the moment of the last refresh, so reviewers can see in git when upstream changes (or where our curated layer deliberately diverges).

The viewer never reads files in this folder directly. They are reference data only.

## Refresh

```bash
python3 scripts/refresh_pleiades.py
# or
make pleiades
```

The script:

- reads `pleiades_id` values from `data/places_authority.sample.json`;
- GETs `https://pleiades.stoa.org/places/<id>/json` for each (1 req/s, polite User-Agent);
- writes the response to `data/pleiades/<id>.json` with sorted keys + UTF-8 + indent=2 so re-runs produce stable diffs;
- writes a plain-text drift report to `generated/pleiades_drift.txt` comparing each Pleiades record to the curated entry (title, coordinates, Greek names, place type, URI);
- never modifies `data/places_authority.sample.json`. Reconciliation is curatorial — read the report and edit the authority by hand if the divergence isn't intentional.

`python3 scripts/refresh_pleiades.py --no-fetch` re-diffs against the existing snapshots without hitting the network.

## License and attribution

Pleiades data is licensed [CC-BY 3.0](https://creativecommons.org/licenses/by/3.0/). When citing, follow the project's guidance at https://pleiades.stoa.org/credits — name the place authors and the Pleiades editors. Snapshots in this folder retain the upstream `creators`, `contributors`, and `history` fields; do not strip them.

## What's *not* here

- The full Pleiades bulk dump (`pleiades-places-latest.json.gz`, ~126 MB at https://atlantides.org/downloads/pleiades/json/). It's only useful for discovering places not yet in our authority and is not committed.
- Records for places without a `pleiades_id` in our authority (e.g. `barbarian_country`, `kyeneion`, `beyond_the_nile`). Some of these aren't separate Pleiades records anyway; identifying them is curator territory.
