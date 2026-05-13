# Simples Provenance Pipeline Checklist

Current stage: stage 7 complete; accepted links and map points derive from LLM consensus review.

Status: Pleiades-first deterministic pipeline with an automated LLM consensus review stage. When `data/generated/simples/provenance_llm_adjudications.json` exists, final LLM consensus decisions are the accepted-link authority; `data/review/simples_provenance_review.csv` remains a readable audit surface.

Last updated: 2026-05-13T02:17:00+02:00

## Implementation Rules

- [x] `../aetius` is read-only input.
- [x] Pleiades is the first place-name authority.
- [x] Entry-label homonyms and lowercase ordinary-word Pleiades collisions are suppressed before candidate generation.
- [x] Immediate alias/synonym formulae are suppressed before candidate generation.
- [x] LLM adjudication uses two independent Codex CLI votes, with a third vote only on disagreement.
- [x] No accepted provenance link without a final LLM `accept` decision or explicit human-review fallback.
- [x] Every generated artifact has a checker.
- [x] Broad regions and uncertain coordinates are flagged in map output.

## Stages

### 0. Baseline And Inputs

Output path: `data/generated/simples/entry_manifest.json`.

Commands:

- `python3 scripts/simples/build_pilot_manifest.py`
- `python3 scripts/simples/check_pilot_manifest.py`
- `git -C ../aetius status --short`

Current counts:

- Manifest entries: 83.
- Galen materia context rows: 25.
- Source CSV paths: 6.
- `../aetius`: unmodified.

### 1. Build Pleiades Name Gazetteer

Output path: `data/generated/simples/pleiades_gazetteer.json`.

Commands:

- `python3 scripts/simples/build_pleiades_gazetteer.py`
- `python3 scripts/simples/check_pleiades_gazetteer.py`

Current counts:

- Total Pleiades place rows: 42,168.
- Lookup-name records: 93,472.
- Greek-script names: 3,516.
- Transliterated names: 42,980.
- Ambiguous lookup keys: 3,174.

### 2. Scan Source Text For Pleiades Names

Output path: `data/generated/simples/pleiades_name_mentions.json`.

Commands:

- `python3 scripts/simples/scan_pleiades_name_mentions.py`
- `python3 scripts/simples/check_pleiades_name_mentions.py`

Current counts:

- Entries scanned: 83.
- Greek-script lookup keys scanned: 3,324.
- Mentions: 5.
- Entries with mentions: 5.
- Ambiguous mentions: 0.
- High-risk mentions: 0.
- Suppressed entry-label matches: 23.
- Suppressed lowercase ordinary-word matches: 30.
- Suppressed alias/synonym matches: 1.
- Mentions by author: `dsc` 5.
- Mentions by field: `greek_entry_text` 5.

Debug note: the old 59-mention output was dominated by false positives. The simple label `ἀβρότονον/ἁβρότονον` matched Pleiades Abrotonum/Sabratha, and ordinary lowercase words such as `λευκή`, `μέλαινα`, `παλαιά`, and `ἔλαιον` matched Pleiades names. The scanner now requires uppercase proper-name surface forms, rejects exact entry-label matches, and suppresses immediate alias formulae such as "some call it Herakleion."

### 3. Filter Mentions Into Provenance Candidates

Output path: `data/generated/simples/provenance_candidates.json`.

Commands:

- `python3 scripts/simples/build_provenance_candidates.py`
- `python3 scripts/simples/check_provenance_candidates.py`

Current counts:

- Mentions in: 5.
- Candidates: 5.
- Relation counts: `grows_at` 4, `acquired` 1.
- Author counts: `dsc` 5.
- Certainty counts: `possible` 5.

Current candidate set:

- `σχοῖνος` grows at Arabia.
- `βάλσαμον` grows at Iudaea.
- `ἀγαρικόν` grows at Galatia.
- `ἁβρότονον` grows at Galatia.
- `καρδάμωμον` grows at Arabia.

### 4. Readable Review Queue

Output path: `data/review/simples_provenance_review.csv`.

Commands:

- `python3 scripts/simples/build_provenance_review_queue.py`
- `python3 scripts/simples/check_provenance_review_queue.py`

Current counts:

- Review rows: 5.
- Undecided rows: 5.
- Decisions: `undecided` 5.

Notes: the queue intentionally starts blank and remains useful for inspection. The automated accepted-link path uses LLM consensus when the JSON adjudication sidecar exists.

### 5. LLM Consensus Review

Output path: `data/generated/simples/provenance_llm_adjudications.json`.

Commands:

- `python3 scripts/simples/build_llm_provenance_adjudications.py --timeout 900`
- `python3 scripts/simples/check_llm_provenance_adjudications.py`

Current counts:

- Candidates in: 5.
- Adjudications: 5.
- Votes: 10.
- Third votes: 0.
- Final accepts: 5.
- Final decisions: `accept` 5.

Notes: four adjudications were reused from the interrupted 59-candidate run because their candidate IDs and evidence packages remained valid. The stale false-positive adjudications were dropped when the sidecar was rewritten for the cleaned five-candidate set; one new vote pair was run for the corrected balsam/Iudaea candidate.

### 6. Accepted Provenance Links

Output path: `data/generated/simples/provenance_links.json`.

Commands:

- `python3 scripts/simples/build_provenance_links.py`
- `python3 scripts/simples/check_provenance_links.py`

Current counts:

- Review rows/adjudications: 5.
- Review decisions: `accept` 5.
- Accepted links: 5.
- Skipped invalid accept rows: 0.
- Accepted by place: `Arabia (province)` 2, `Galatia` 2, `Iudaea (region)` 1.

Notes: `review_decision_source` is `data/generated/simples/provenance_llm_adjudications.json`; accepted links include consensus confidence and vote trace IDs.

### 7. Map-Ready Output

Output path: `data/generated/simples/provenance_map_points.json`.

Commands:

- `python3 scripts/simples/build_provenance_map_points.py`
- `python3 scripts/simples/check_provenance_map_points.py`

Current counts:

- Accepted links in: 5.
- Map points: 5.
- Null-coordinate points: 0.
- Broad-region points: 5.

Notes: all five current map points are broad regions and are flagged as such rather than treated as precise point geography.

## Stop Conditions

- Stop if `../aetius` has any modified or untracked files.
- Stop if Pleiades dump CSVs are unavailable and cannot be fetched with existing tooling.
- Stop if a generated artifact fails its checker.
- Stop before promoting any candidate to `provenance_links.json` unless the LLM consensus sidecar has a final `accept` with a candidate Pleiades ID, or the fallback review queue contains explicit `accept` decisions with valid accepted Pleiades IDs.
- Stop before treating a broad region or null-coordinate place as a precise map point.

## Last Report

Stage 7 completed at 2026-05-13T02:17:00+02:00 after debugging the false-positive scan behavior. The scanner now suppresses exact entry-label homonyms, lowercase ordinary-word Pleiades collisions, and immediate alias formulae before candidate generation. The cleaned pipeline has 5 candidates, 5 LLM consensus accepts, 5 accepted links, and 5 broad-region map points.
