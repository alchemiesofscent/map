# Galen route candidates — curator decisions

This file is **hand-authored** and is the durable record of which Stage-2
candidate route segments are accepted, rejected, or merged, plus the
canonical Pleiades-ID disambiguation choices for ambiguous mentions. It is
**not regenerated** by `scripts/galen/survey_routes.py` (the survey only
writes `docs/galen_route_candidates.md`, which is overwritten on every run).

Why a separate file: the auto-generated candidates document changes whenever
the gazetteer, lemmatizer, or stoplist changes — so any decisions written
inline there would be erased. Keeping decisions here lets the survey
regenerate freely without losing curator work, and lets later stages
(translation, place authority, route assembly) consume a stable input.

Candidates are anchored by their **Kühn citation range** rather than ordinal
position, so the table survives renumbering when the survey re-runs with
different gazetteer / lexicon settings. The "Cand (snapshot)" column records
the ordinal number as of the survey run dated in the column header.

## Decisions (2026-05-10)

| Candidate (Kühn citation)                | Cand (snapshot 2026-05-10)               | Decision                                                       | Notes                                                                                                                                                                                                                                                                                                                                       |
| ---------------------------------------- | ---------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **SMT 9.1, K. XII 168.7–178.1 (a)**      | SMT 1                                    | **ACCEPT, but split internally**                               | Major anchor for the Lemnos journey: **Alexandria Troas → Lemnos**, with Thessalonica / Macedonia / Thrace / Rome as route context. Do not let the opening Cyprus and Coele Syria comparisons become part of the Lemnos route. Place detection now resolves **Τρῳάδος Ἀλεξανδρείας = Alexandria Troas** correctly via the curator override. |
| **SMT 9.1, K. XII 168.7–178.1 (b)**      | SMT 2                                    | **ACCEPT**                                                     | Clearest linear route: **Italy → Macedonia → Philippi → unnamed nearby coast → Thasos → Lemnos → Alexandria Troas (Hephaistia city)**. Do not infer Neapolis unless Galen names it. **Philippi** and **Hephaistia** now resolve via curator overrides.                                                                                       |
| **SMT 9.2, K. XII 203.0–204.2**          | SMT 3                                    | **MERGE WITH `coele-syria-dead-sea-materials`**                | Not one coherent route as extracted. Lycia is a broad coastal-sailing notice with no usable stops; Coele Syria / Dead Sea is valid material-travel evidence and merges with the Coele Syria notice in SMT 9.1 (a) and De antidotis 1.2.                                                                                                     |
| **SMT 9.3, K. XII 214.5–217.3**          | SMT 4                                    | **MERGE WITH `cyprus-soloi-mines`**                            | Strong supporting evidence for the Cyprus / Soloi mines cluster. **Σόλοι / Soloi** now resolves via the curator override.                                                                                                                                                                                                                   |
| **SMT 9.3, K. XII 219.5–221.13**         | SMT 5 (newly surfaced after lexicon fix) | **MERGE WITH `cyprus-soloi-mines`; treat as primary anchor**   | NEW candidate, visible only after the curator override for Σόλοι landed. Greek: "ἐν γοῦν τοῖς Σόλοις … καθ' ὃν ἐγὼ χρόνον ἐπεδήμησα τῇ νήσῳ" — the most explicit "Galen sojourned on the island" statement in the corpus. Verb: ἐπεδήμησα. Stops: Soloi (mapped); Asia + Italy = transport context only.                                       |
| **SMT 9.3, K. XII 226.7–229.7**          | SMT 6 (was SMT 5 in earlier review)      | **MERGE WITH `cyprus-soloi-mines`; primary anchor**            | One of the best Cyprus passages: Galen is at the mine, sees the material, speaks with the mine official, and carries material onward. Do not map generic Asia as a point stop. Rome may be a destination/context point only if the route model allows transport endpoints.                                                                  |
| **SMT 9.3, K. XII 229.7–230.4**          | SMT 7 (was SMT 6 in earlier review)      | **ACCEPT** (becomes route `pergamum-ergasteria-mines`)         | Distinct, strong route segment: **Pergamum → road to Ergasteria → Ergasteria**, with Cyzicus as context. **Ἐργαστήρια = Pleiades 550534** now resolves via the curator override.                                                                                                                                                            |
| **SMT 9.3, K. XII 238.1–241.10 (a)**     | SMT 8 (was SMT 7 in earlier review)      | **MERGE WITH `cyprus-soloi-mines`**                            | Supporting Cyprus acquisition evidence only. Not a separate route.                                                                                                                                                                                                                                                                          |
| **SMT 9.3, K. XII 238.1–241.10 (b)**     | SMT 9 (was SMT 8 in earlier review)      | **MERGE WITH `cyprus-soloi-mines`; primary anchor**            | Strong proof Galen was physically in Cyprus and observed collection at the mine. Merge with the other Cyprus passages.                                                                                                                                                                                                                      |
| **SMT 10.2, K. XII 303.8–305.0**         | SMT 10 (was SMT 9 in earlier review)     | **REJECT**                                                     | Not a route. "I used" is medical practice, not travel. Mysia can be kept as contextual materia/clinical geography if needed, but not as a route stop.                                                                                                                                                                                       |
| **De antidotis 1.1, K. XIV 1.0–5.10**    | De antidotis 1                           | **REJECT**                                                     | False positive. **διῆλθον** here means "I explained / went through the account," not physical movement. Rome is context only.                                                                                                                                                                                                               |
| **De antidotis 1.2, K. XIV 5.10–13.15**  | De antidotis 2                           | **MERGE AFTER SPLITTING**                                      | Summarizes multiple travel/material episodes: Cyprus, Palestine/Syria, Lemnos. Do not create one route from it. Merge the Cyprus material with `cyprus-soloi-mines`, the Lemnos material with the Lemnos routes, and the Palestine/Syria material with `coele-syria-dead-sea-materials`.                                                    |
| **De antidotis 1.3, K. XIV 13.15–20.14** | De antidotis 3                           | **REJECT as route; keep as materia observation**               | Galen says he saw something in Italy near Naples / Trifolinus, but no route is described. This supports the materia-medica observation layer, not a route. **Νεάπολιν = Pleiades 433014** now resolves via the curator override.                                                                                                            |
| **De antidotis 1.5, K. XIV 27.9–32.9**   | De antidotis 4                           | **REJECT**                                                     | General Italy / Rome-suburbs / Crete botanical discussion. No route. Crete is source geography, not Galen travel.                                                                                                                                                                                                                           |
| **De antidotis 1.10, K. XIV 51.5–54.5**  | De antidotis 5                           | **REJECT**                                                     | Botanical geography and observation, not a coherent route. Cyzicus is not enough by itself here.                                                                                                                                                                                                                                            |
| **De antidotis 1.14, K. XIV 67.7–82.7**  | De antidotis 6                           | **REJECT**                                                     | Rome-suburbs observation plus Cretan imports. No route.                                                                                                                                                                                                                                                                                     |

## Pleiades disambiguation (2026-05-10)

For mentions that resolve to multiple Pleiades records via the
auto-detector, this table records the canonical ID Stage 3+ should use. Each
row is also encoded as a curator override in `data/galen/lexicon/places.json`,
so subsequent survey runs emit the chosen ID directly.

| Mention                | Pleiades ID                                            | Notes                                                                                                                                                                                                                                                                                                  |
| ---------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Κύπρον / Κύπρος        | **707498**                                             | Use **Cyprus (island)**, not the Roman province. Galen's phrase is physical/geographical — "to Cyprus for the mines" — and Pleiades treats the island and Roman province as separate records. ([Pleiades][cyprus])                                                                                       |
| Συρίαν / συρία         | **678096** (override added; bare Συρία → Coele Syria)  | The text says **κοίλην Συρίαν**, "Coele Syria," not generic Syria or Assyria. The generated candidates missed the better Pleiades record, **Coele Syria = 678096**. Do not pick Roman Syria here unless deliberately normalizing all regions to imperial provinces. ([Pleiades][coele])                  |
| Ἀσίας / Ἀσία           | **981509**                                             | Use **Asia (Roman province)**. In this Galenic context, "from Asia to Rome" is best treated as the Roman province of Asia / western Asia Minor, not the continent. ([Pleiades][asia])                                                                                                                  |
| Θρᾴκης / Θρᾳκία        | **501638**                                             | Use **Thracia region**, not the Roman province. The phrase "through Thrace and Macedonia" is geographical route language, not an administrative claim. ([Pleiades][thrace])                                                                                                                            |
| Μακεδονίας / Μακεδονία | **491656**                                             | Use **Macedonia region**, not the Roman province, for the same reason. ([Pleiades][macedonia])                                                                                                                                                                                                         |
| Ἰταλίας / Ἰταλία       | **1052**                                               | Use **Italia**, the Italian peninsula as recognized by the Romans. Do not use **452346**, which is the much narrower early Greek "toe of Italy" region. ([Pleiades][italia])                                                                                                                            |
| Μυσίᾳ / μυσια          | **550759** (already in lexicon)                        | Neither generated option is right. **570498** is a settlement in the Argolid; **609481** is Mysoi Abbaeitai. The intended place is almost certainly **Mysia (region), Pleiades 550759**. ([Pleiades][mysia])                                                                                            |

## Consolidated routes (2026-05-10)

The decisions above resolve to **five named routes** plus a materia-medica
observation layer. These `route_key` values are the canonical IDs Stage 3
onward (translation, place authority, route assembly) must use; they match
the `^[a-z0-9-]+$` pattern required by `schemas/galen/galen-route.schema.json`.

For every route below: **core mapped stops** become category-A pins on the
map; **context** places are recorded as category-B annotations only and are
not connected by route lines; **do-not-map** lists are explicit guards
against false-positive expansion the auto-detector tends toward.

### 1. `lemnos-alexandria-troas-to-thessalonica-context`
- **Anchors**: SMT 9.1 (K. XII 168.7–178.1, a); De antidotis 1.2 (K. XIV 5.10–13.15) as support.
- **Core mapped stops**: Alexandria Troas (Pleiades 550434), Lemnos.
- **Context (category B)**: Thessalonica (491741), Macedonia (491656), Thrace (501638), Rome.
- **Do not map**: Samos, Chios, Cos, Andros, Tenos, Aegean — these appear in
  Galen's text as comparison/contrast (cities sharing names with their islands),
  not as route stops.

### 2. `lemnos-italy-to-troas-via-thasos`
- **Anchor**: SMT 9.1 (K. XII 168.7–178.1, b).
- **Core mapped stops**: Philippi (501482), Thasos, Lemnos, Hephaistia (550569) on Lemnos, Alexandria Troas (550434).
- **Context (category B)**: Italy (1052), Macedonia (491656).
- **Do not invent**: Neapolis. Use the label "unnamed nearby coast/port" for
  the embarkation point near Philippi if a placeholder is needed; do not pin
  it to a specific Pleiades record.

### 3. `cyprus-soloi-mines`
- **Anchors**: SMT 9.3 K. XII 214.5, 219.5, 226.7, 238.1 (×2); De antidotis 1.2 (Cyprus portion) as support.
  The K. XII 219.5 passage (ἐπεδήμησα) is the strongest single anchor.
- **Core mapped stops**: Soloi / Aipeia on Cyprus (Pleiades 707624); the mine near Soloi if mappable.
- **Context (category B)**: Cyprus island (707498), Asia province (981509), Rome.
- **Do not draw**: Cyprus → Asia → Rome as a precise route line unless it is
  explicitly labeled as material-transport (not Galen's own travel).

### 4. `coele-syria-dead-sea-materials`
- **Anchors**: SMT 9.1 (Coele Syria mention), SMT 9.2 (K. XII 203.0–204.2); De antidotis 1.2 as support.
- **Core mapped places**: Coele Syria (Pleiades 678096); Dead Sea / Asphaltitis Limne (Pleiades 697709) if the passage supports a precise pin.
- **Likely no route line** unless we accept a broad "material-travel" segment;
  individual asphalt-stone collection points are unmapped without explicit
  evidence.

### 5. `pergamum-ergasteria-mines`
- **Anchor**: SMT 9.3 (K. XII 229.7–230.4).
- **Core mapped stops**: Pergamum, Ergasteria (Pleiades 550534).
- **Context (category B)**: Cyzicus.
- **Route line**: Pergamum → Ergasteria only. Do not extend to Cyzicus
  unless a separate passage shows Galen physically went there.

### Materia-medica observation layer (not a route)
- De antidotis 1.3 — Neapolis / Trifolinus area (Pleiades 433014 for Neapolis).
- Any other rejected candidates that record autopsy of substances without
  describing travel.

This layer renders as map pins (or callouts) tied to passages, but is **not**
connected by route lines and does **not** participate in the per-route
selectors in the viewer.

### Discarded entirely
SMT 10.2; De antidotis 1.1, 1.5, 1.10, 1.14.

[cyprus]: https://pleiades.stoa.org/places/707498 "Cyprus (island): a Pleiades place resource"
[coele]: https://pleiades.stoa.org/places/678096 "Coele Syria: a Pleiades place resource"
[asia]: https://pleiades.stoa.org/places/981509 "Asia (Roman province): a Pleiades place resource"
[thrace]: https://pleiades.stoa.org/places/501638 "Thracia: a Pleiades place resource"
[macedonia]: https://pleiades.stoa.org/places/491656 "Macedonia (region): a Pleiades place resource"
[italia]: https://pleiades.stoa.org/places/1052 "Italia: a Pleiades place resource"
[mysia]: https://pleiades.stoa.org/places/570498 "Mysia (settlement): a Pleiades place resource"
[ergasteria]: https://pleiades.stoa.org/places/550534 "Ergasteria: a Pleiades place resource"
[neapolis]: https://pleiades.stoa.org/places/433014 "Parthenope/Neapolis: a Pleiades place resource"
