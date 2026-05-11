# Galen routes — align with the seven-account philological breakdown

## What this changes

Restructures `data/generated/galen/routes.json` to match the curator's expert reading of SMT 9.1–9.3 and De antidotis 1.1–1.3. Reverts the prior commit `56fa7a5` ("Promote overland legs in Galen routes 1 + 2 to primary"), which over-promoted context regions to primary stops.

Final shape:

```
                   primary stops          edges    polyline?
route 1   Alex Troas → Myrina               1     yes
route 2   Philippi → coast → Thasos →       5     yes
          Lemnos → Hephaistia → Alex Troas
route 3   Soloi → mine                      1     yes (~5 km)
route 4   Coele Syria                       0     no  (pin only)
route 5   Pergamum → Ergasteria             1     yes (unchanged)
```

Total drawable polyline points: 19 → 13.

## 1. Lexicon — `data/galen/lexicon/places.json`

Add four entries (template = the `alexandria_troas` shape):

- **`myrina_lemnos`**: display "Myrina (Lemnos)", `place_type: city`, lat 39.8748 lon 25.0570, `pleiades_id: "550755"`, certainty `secure`. Surfaces: `Μυρίναν`, `Μυρίνα`, `Μυρίνης` (passage_id `smt.9.1`). Notes should disambiguate vs Pleiades 550756 (Aiolis) and 594984 (Pisidia). `coordinates_source` flags pending Pleiades --refresh reconciliation.
- **`philippi_nearby_coast`**: "Nearby coast of Philippi (unnamed)", `place_type: port`, lat 40.83 lon 24.40, `pleiades_id: null`, `pleiades_uri: null`, certainty `ambiguous`, `coordinates_source: "Derived from Galen's stadia count, not a Pleiades record"`. One surface: `τὴν πλησίον θάλατταν` (passage_id `smt.9.1`).
- **`soloi_mine`**: "Mine near Soloi (unnamed)", `place_type: mine`, lat 35.10 lon 32.83, `pleiades_id: null`, certainty `ambiguous`. `ancient_names_in_galen: []` (no toponym surface — Galen describes "the mine" relatively).
- **`palaestina_syria_province`**: "Palaestina / Syria Palaestina (province)", `place_type: region`, lat null lon null, `pleiades_id: "991396"`, certainty `secure`. One surface: `Παλαιστίνης Συρίας` (passage_id `de_antidotis.1.2`).

Two corrections:

- **`palestine`**: change `pleiades_id` `"1001939"` → `"687995"` (Palaestina I is a fourth-century province, anachronistic for Galen; 687995 is the region record). Note that lat/lon need replacement with the live 687995 reprPoint on the next `--refresh`. Update `notes` to flag the prior misidentification.
- **`coele_syria`**: remove the four bare-Syria surfaces (`Συρία`, `Συρίαν`, `Συρίας`, `Συρίᾳ`). Keep only the four `κοίλη`-prefixed surfaces. Prevents future bare-Syria tokens from auto-resolving as Coele Syria.

## 2. Routes — `scripts/galen/build_galen_routes.py` (the `ROUTES` list)

**Route 1 `lemnos-alexandria-troas-to-thessalonica-context`**
- `label`: "First Lemnos attempt (via Alexandria Troas → Myrina)"
- `start_place_key`: `alexandria_troas` (unchanged)
- `stops`: `[alexandria_troas, myrina_lemnos]` only — both with `passage_id: smt.9.1.a`
- `edges`: one — `alexandria_troas → myrina_lemnos`, `secure`, `kuhn_citation: "K. XII 168.7–178.1"`, textual basis composite quoting "ἔπλευσα πρότερον … προσέσχε μὲν, οὐ μὴν ᾗ γ' ἐχρῆν πόλει … ἔγνων Μυρίναν μὲν ὀνομάζεσθαι τὴν πόλιν"
- `context_keys`: `["lemnos", "hephaistia", "thessalonica", "macedonia_region", "thracia_region", "rome"]` (Hephaistia is intended-but-not-reached on this trip; Lemnos is the island holding Myrina)
- Rewrite synopsis to describe the failed-port narrative

**Route 2 `lemnos-italy-to-troas-via-thasos`**
- `label`: "Second Lemnos voyage (Philippi → Thasos → Lemnos → Troas)"
- `start_place_key`: change `italia_peninsula` → `philippi`
- `stops`: `[philippi, philippi_nearby_coast, thasos, lemnos, hephaistia, alexandria_troas]` — all `passage_id: smt.9.1.b`
- `edges` (5):
  1. `philippi → philippi_nearby_coast`, `secure`, "ἐντεῦθεν ἐπὶ τὴν πλησίον θάλατταν εἴκοσιν ἐπὶ τοῖς ἑκατὸν ἀπέχουσαν στάδια κατελθὼν"
  2. `philippi_nearby_coast → thasos`, `secure`, "ἔπλευσα πρότερον μὲν εἰς Θάσον ἐγγύς που διακοσίους σταδίους"
  3. `thasos → lemnos`, `secure`, "ἐκεῖθεν δὲ εἰς Λῆμνον ἑπτακοσίους"
  4. `lemnos → hephaistia`, `probable`, implicit overland on Lemnos
  5. `hephaistia → alexandria_troas`, `probable`, "ἀπὸ Λήμνου τοὺς ἴσους ἑπτακοσίους εἰς Ἀλεξανδρείαν Τρῳάδα"
- `context_keys`: `["italia_peninsula", "macedonia_region", "thracia_region"]`

**Route 3 `cyprus-soloi-mines`**
- `stops`: `[soloi_cyprus, soloi_mine]` (was 1, now 2). `soloi_cyprus` stays with `passage_id: smt.9.3.b`; `soloi_mine` uses `passage_id: smt.9.3.a`, evidence "ἔνθα τὸ μέταλλόν ἐστιν, ὡς ἀπὸ σταδίων τῆς πόλεως τριάκοντα"
- `edges`: one — `soloi_cyprus → soloi_mine`, `probable`, kuhn `"K. XII 214.5–217.3"`
- `context_keys`: unchanged (`cyprus_island`, `asia_province`, `italia_peninsula`, `rome`, `pergamum`, `cyzicus`)

**Route 4 `coele-syria-dead-sea-materials`**
- `stops`: `[coele_syria]` only (drop `dead_sea` from primary)
- `edges`: `[]` (drop the existing `coele_syria → dead_sea` edge)
- `context_keys`: `["dead_sea", "palestine"]`
- Synopsis: "Material-source aggregation, not a routed itinerary…"

**Route 5 `pergamum-ergasteria-mines`** — unchanged.

## 3. Pipeline (run in order)

```
PYTHONPATH=. .venv/bin/python scripts/galen/build_place_authority.py --refresh
PYTHONPATH=. .venv/bin/python scripts/galen/extract_passages.py
PYTHONPATH=. .venv/bin/python scripts/galen/build_materia_index.py
PYTHONPATH=. .venv/bin/python scripts/galen/build_galen_routes.py
```

`--refresh` will fetch live Pleiades for the three new/corrected IDs (550755, 991396, 687995). Reconcile any drift on `palestine` by hand-replacing lat/lon with the new 687995 reprPoint, then re-run.

Expected console summary from `build_galen_routes.py`: route 1 = 2 primary / 1 edge, route 2 = 6 / 5, route 3 = 2 / 1, route 4 = 1 / 0, route 5 = 2 / 1. `route_views.json`'s `all` view ends at `drawable_line_points.length == 13`.

## 4. Docs — `docs/galen_route_decisions.md` (hand-edit, not regenerated)

- §1 (`lemnos-alexandria-troas`): core stops `[alexandria_troas, myrina_lemnos]`; note Hephaistia is intended-but-not-reached.
- §2 (`lemnos-italy-to-troas`): add `philippi_nearby_coast` to core mapped stops; Italia/Macedonia stay as context only.
- §3 (`cyprus-soloi`): add `soloi_mine` to core with derived-coords note.
- §4 (`coele-syria`): "no route line by default; material-source aggregation."
- Update the SMT 9.1(a) row in the Decisions table to reference Myrina (550755) and the intended-but-not-reached status of Hephaistia.
- Pleiades disambiguation table: drop the bare-Συρία row; add rows for Μυρίναν / Μυρίνης → 550755, Παλαιστίνης (bare) → 687995, Παλαιστίνης Συρίας → 991396.
- Complex designators table: change the Παλαιστίνης Συρίας row's Pleiades ID from 1001939 to 991396; add a `Μυρίναν / Μυρίνης` row pointing at 550755; add a `τὴν πλησίον θάλατταν` row pointing at the project-local `philippi_nearby_coast`.

## Known limitation (acknowledged, not addressed)

`smt.9.1.a` currently spans 3 sentences and does **not** include the Myrina-disembarkation sentence ("ὡς δὲ ἀποβὰς τῆς νεὼς, ἔγνων Μυρίναν…"). Adding `myrina_lemnos` to the lexicon and re-running `survey_routes.py` would extend the candidate to absorb that sentence (cluster_hits gap_tolerance is 1; the sentence has both `Μυρίνα` and the first-person verb `ἔγνων`). The plan as drafted does not re-run `survey_routes.py` — clicking the Myrina pin shows the existing 3-sentence Greek (without the explicit Μυρίναν sentence). The route line, pin, and lexicon are correct; only the dossier read-along text is one sentence shy. To close this, run the full pipeline including `scripts/galen/survey_routes.py` ahead of `extract_passages.py`.
