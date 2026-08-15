# 04 — A modern, searchable claims set for the House of Mendes

**Status:** in progress · Phases 0 and 1 shipped
**Date:** 2026-08-15
**Scope:** `mendes/` (dossier, map, journeys) + the Ptolemaic queens fragments from `perfume-tables`

## Goal

One claims corpus, one reading surface. Every evidence-bearing statement the
House of Mendes pages make — an ingredient’s attested origin, a recipe’s
witness, a price, a queen-attributed formula, a report of perfume at court —
should exist as a **structured claim record with a citation**, rendered in a
**reader with a left sidebar table of contents** and **client-side search**,
and cross-linked to the map and journey viewers that plot the same records.

The design system is already settled: the provenance map’s tokens and faces
(`mendes/map/site.css` + `mendes/shell.css` — Cormorant Garamond display,
Source Sans 3 body, Gentium Plus Greek, IBM Plex Mono citations; paper/panel
study register, gold accents). The dossier now shares it (Phase 0).

## Where claims live today

| Store | Shape | Consumed by |
| --- | --- | --- |
| `mendes/map/app-1.js` | ~22 ingredients × claims as inline JS objects (place, coord, evidence class, recipes, cite, note) | map viewer and journeys viewer (both concatenate this file) |
| `mendes/content-1..4.html` | dossier prose: recipe witnesses, quantities, crux notes, prices, sourcing | dossier reader |
| `perfume-tables/research/ptolemaic-queens-fragments/fragments.json` | 16 records (6 recipes, 10 reports), full citation blocks, Greek/Latin text + translation, olfactory relevance | dossier Part V (prose); versioned copy at `mendes/data/ptolemaic-queens-fragments.json` |
| `data/generated/simples/provenance_entry_claims.json` | TEI-derived provenance claims with Pleiades IDs | simples viewer pipeline |

Four stores, three shapes, one shared subject matter. The map’s claims are the
only ones a machine can currently filter; the dossier’s are the only ones a
reader can currently search (Phase 0); the queens’ records are the richest
(full citation hierarchy + confidence labels) but reach the site only as prose.

## Target claim schema

One record shape, superset of the three existing ones. Field names follow the
queens dataset (`schema.json` there), which is already the most disciplined:

```jsonc
{
  "id": "mend-cassia-arabia-hdt",          // stable, URL-safe → #claim-… permalinks
  "kind": "provenance",                     // provenance | recipe-witness | attribution |
                                            // practice | economy | patronage | spectacle
  "subject": { "type": "ingredient", "ref": "kassia" },   // or perfume | person | place
  "aromatics": ["kassia"],                  // normalized ingredient ids (map app-1 ids)
  "queen": null,                            // ["Cleopatra VII"], with confidence label
  "place": { "name": "Arabia", "coord": [47.0, 21.0], "pleiades": null },
  "evidence": "ancient",                    // ancient | inference | theological
  "olfactoryRelevance": null,               // direct | indirect | contextual | none (PQF)
  "recipes": ["m"],                         // m | t | s | court (new PQF layer)
  "source": { /* author, work, book…, editor, edition, page, lines, digitalLocator */ },
  "text": "…", "translation": "…",          // optional, PQF-style
  "note": "…",
  "provenanceOfRecord": "map-app1 | dossier | pqf-v0.1 | simples"
}
```

Mapping rules:

- **map/app-1.js claims** → `kind: "provenance"`, subject = ingredient, place +
  coord carried over, `cite` parsed into `source` (book.section stays a string;
  no invented precision).
- **PQF records** → kind from `recordKind` + subtype (`recipe` →
  `recipe-witness` with `attribution` to the queen; reports →
  `patronage | spectacle | economy | practice` per subtype). `aromatics` is a
  **new extraction**: nard, cinnamon, amomum, cassia, costus, iris, myrrh
  (Troglodytic), rush flower, myrobalan, rose, balsam, incense, myrtle, cedar
  oil — with myrobalan ↔ `balanos`, rush flower ↔ `schoinos`, cassia ↔
  `kassia` linked to the existing ingredient ids so one filter crosses both
  corpora. Records with places (Alexandria, Cyrene, Jericho, Tarsus/Cydnus)
  can optionally be plotted as a fourth map layer (“court”), dashed as
  report-evidence, never mixed with recipe provenance.
- **Dossier prose claims** (witness tables, prices, crux notes) → extracted
  gradually; the witness tables of Part I are the natural first batch because
  they are already tabular.

## Reader UX

- **Left sidebar TOC** (shipped for the dossier in Phase 0): sticky rail with
  wordmark, search, part-level contents plus script-generated section depth,
  scroll-position marker; compact sticky contents bar on phones.
- **Search** (shipped, v1): diacritic-insensitive section search — `nard`,
  `Petra`, `σμυρνα` all hit accented text. v2 indexes **claim records** rather
  than sections: one result row per claim (title, citation, evidence chip),
  powered by the unified JSON, so a search for *cinnamon* returns the
  Mendesian variant note, the susinum crux, Paul’s substitution clause, and
  Lucan’s banquet — each a jump target.
- **Claim permalinks:** every rendered claim gets `id="claim-<id>"`; the map’s
  “open in dossier” and the dossier’s “see on map” both become one-liners.
- **Filters** (v2): evidence class, recipe layer (m/t/s/court), queen,
  aromatic. Same chip components the map rail already uses.
- **No build step required** to keep the current pages working: the reader
  hydrates from static JSON exactly as the map hydrates from `app-1.js`.

## Phases

**Phase 0 — shipped with this change set**
- Dossier restyled onto the map’s design system (tokens, faces, study register).
- Left sidebar reader TOC + scrollspy + compact phone bar (`app-reader.js`).
- Diacritic-insensitive client-side search over all dossier sections.
- Queens’ fragments incorporated: dossier **Part V** (aromatics table centred
  on nard and cinnamon and their contexts; the cleanser recipe; banquet,
  patronage, spectacle, economy reports; full 16-record claim index) and the
  versioned dataset copy `mendes/data/ptolemaic-queens-fragments.json`.

**Phase 1 — one claims store (shipped)**
- The inline claims moved from `mendes/map/app-1.js` to
  `mendes/data/claims.json`; `app-1.js` is now a loader (the derived indexes
  and map geometry stay in it). One correction reaches map, journeys, and
  reader. The extraction was verified byte-identical to the old literals.
- PQF records are derived into the same file’s `court` array by
  `scripts/build_mendes_court_claims.py` (run via `make mendes-court`), with
  the aromatic extraction above — refs link nard/cassia/rush-flower/myrobalan
  records to the map’s ingredient ids — and conservative place mappings
  (Alexandria, Cyrene, Tarsus, Jericho); the script fails loudly when an
  upstream release adds unmapped records.
- The Part V claim-index rows carry `#claim-pqf-…` permalinks;
  `scripts/check_mendes_claims.py` validates the whole store via `make check`
  (vocabularies, id uniqueness, coordinate sanity, group coverage, court ↔
  PQF sync).

**Phase 2a — claims-aware search and cross-navigation (shipped)**
- The dossier search now searches three corpora and groups its results: “In
  the dossier” (sections), “On the map — provenance claims” (all 57 records,
  matched on place, Greek, transliteration, gloss, citation, and note), and
  “Queens’ fragments — court records” (matched on citation, queen, aromatics,
  commentary). Claim rows carry an evidence or olfactory chip and the
  citation; court rows jump to their `#claim-pqf-…` index row.
- Cross-navigation both ways: provenance results link to
  `map/#claim-<id>`, and the map now honours that deep link (on load and on
  hashchange) by selecting the claim; the map’s claim panel links back to
  the ingredient’s catalogue entry via a new `dossierAnchor` field on every
  ingredient in claims.json (validated against the content files by
  `check_mendes_claims.py`).

**Phase 2b — filters and the court layer**
- Filter chips in the search results (evidence class, recipe layer, queen,
  aromatic).
- Optional “court” map layer for the placed PQF reports (Alexandria, Cyrene,
  Jericho, Tarsus), dashed, clearly labelled report-evidence.

**Phase 3 — the rest of the corpus**
- Fold in `data/generated/simples/provenance_entry_claims.json` (already has
  Pleiades ids) and the Galen/periplus datasets behind the same schema.
- Sync script for `perfume-tables` datasets (copy + stamp, as done by hand in
  Phase 0) so future PQF releases (v0.2+) land with one command.
- Housekeeping: retire the orphaned `mendes/app-1.js`, `app-2.js`, `app-3.js`
  and `mendes/content-4.html`’s former duplicate content (done), and the
  root-level orphans once nothing references them.

## Non-goals

- No server, no external search service: everything stays static-hostable on
  GitHub Pages, self-contained, like the map.
- No silent geocoding of report evidence: a PQF report never becomes an
  “ancient provenance” dot; the evidence-class discipline of the map extends
  to every new record.
- No editing of PQF records inside this repo: `perfume-tables` is canonical;
  this repo carries stamped copies.
