# Perfume GIS packages

Per-perfume GIS exports of the Alchemies of Scent ingredient-provenance
evidence, prepared for the National Geographic "What did the Past Smell
Like?" graphics/map team. One folder per perfume:

- `mendesian/` — the (Dark) Mendesian
- `susinum/` — Susinum
- `nardinon/` — the nard perfume (νάρδινον μύρον, Dioscorides 1.62)

Regenerate with `make perfume-gis` (runs `scripts/export_perfume_gis.py`).
Mendesian and Susinum come from `mendes/data/claims.json`, the dataset
behind the interactive map. Nardinon is not yet in that dataset: its shared
simples (balanos, omphacine oil, schoinos, myrrh, balsam) reuse the
project's ingredient-level claims, and the four simples the dataset does
not carry (spikenard, malabathron, kostos, amōmon) are compiled in the
export script from Dioscorides 1.7, 1.12, 1.15 and 1.16 (verified against
the project's TEI witness, `data/tei/tlg0656.tlg001.1st1K-grc1.xml`) with
Pleiades representative coordinates.

All coordinates are decimal degrees, WGS 84 (EPSG:4326). GeoJSON follows
the spec's `[lon, lat]` order; the CSVs carry explicit `lat` and `lon`
columns.

## Files in each folder

### `points.geojson` / `points.csv` — ancient provenance claims

One point per provenance claim. These plot the **ancient claim**, not a
modern species range: "Pliny says balanos comes from the Thebaid" is a
statement about Pliny, mapped at a hand-set representative point.

| Field | Meaning |
|---|---|
| `perfume` | mendesian / susinum / nardinon |
| `ingredient_id`, `ingredient`, `greek` | the ingredient, with its Greek name |
| `membership` | `member`, `substitution-register`, or `conjectural` — see below |
| `membership_note` | the textual basis for a non-member entry |
| `claim_id` | stable id of the claim in the project dataset |
| `place` | the place as the ancient claim names it |
| `evidence` | `attested-ancient` (a source says it) or `inference-modern` (working inference or modern botanical correction) |
| `cite` | the source citation(s) |
| `note` | evidential nuance carried by the claim, plus any Pleiades-matching caveat in brackets |
| `route` | key of the trade corridor the map associates with the claim (may be empty) |
| `point_source` | `project-plot` (hand-set point from the dataset) or `pleiades-representative` (Pleiades representative point, nardinon extras only) |
| `pleiades_id`, `pleiades_title`, `pleiades_uri` | the Pleiades gazetteer page for the place; empty for workshop-context and modern-correction anchors, which have no ancient place referent |

**`membership` matters for Susinum.** Cassia and karpesion are *not*
ingredients of susinum in any witness: they enter only through Paul of
Aegina's substitution rule (7.20.8, with Galen) — cassia at double weight,
karpesion as third permitted substitute, each standing in for cinnamon.
Cinnamon itself is `conjectural`: in Dioscorides 1.52 the finishing-triad
cinnamon is an editorial conjecture (the transmitted text carries cardamom
throughout), and cinnamon is canonical only in Paul's susinum. Filter to
`membership = member` for a strict recipe map; keep the rest if the map
wants the substitution economy.

### `modern-points.geojson` / `modern-points.csv` — modern identifications

The working modern identification of each ingredient (on assumption of
identification — several are open questions, and the files say so), a
native-range or production-range summary, and **range-representative
points**. These are *not* occurrence records: they are single points
chosen to represent the core native range (or, for the cultigen saffron,
production zones). For point-level occurrence data, run a filtered GBIF
download (hasCoordinate, no geospatial issues, preserved specimens,
non-cultivated) using the `powo` and `gbif` links carried on every row;
a GBIF download has a citable DOI.

### `routes.geojson` — trade corridors

The corridors from the interactive map that this perfume's claims
traverse, as LineStrings with `id`, `mode` (sea / land / river) and
`label`.

## About the routes (please read before tracing)

Every feature carries `geometry_status: "conventional corridor"`, and that
is meant literally: these polylines were **drawn for map legibility, not
researched as route geometries**. They connect the right endpoints
(Berenice and Myos Hormos to Coptos, Coptos down the Nile, South Arabia
up the incense road through Petra to Gaza and Egypt, the monsoon run from
India to the Red Sea straits) but their vertices are cartographic
convention. Treat them as schematic flow lines, the way the interactive
map draws them.

For genuinely source-derived route data:

- **Periplus of the Erythraean Sea** — this repository holds a
  section-by-section route reconstruction of the Periplus (66 sections
  with steps and legs): `data/generated/periplus/journey_route.json`,
  exportable to GeoJSON with `make geojson`. That is real evidence for
  the Red Sea–East Africa–India legs, from a 1st-century CE merchant's
  handbook.
- **ORBIS** (orbis.stanford.edu) — Stanford's geospatial network model of
  the Roman world; the standard source for modelled land/river/sea routes,
  travel times and costs across the Mediterranean core.
- The Eastern Desert caravan roads (Berenice→Coptos, Myos Hormos→Coptos)
  are archaeologically documented with way-stations (hydreumata); if the
  final map wants accurate desert-road geometry, the excavation literature
  on the Berenice road is the place to send a researcher.

## Attribution

Data: Alchemies of Scent (alchemiesofscent.cz), Institute of Philosophy,
Czech Academy of Sciences. Place authority: Pleiades
(pleiades.stoa.org), CC-BY. See `ATTRIBUTION.md` at the repository root.
