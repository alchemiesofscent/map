# Simple Provenance Model

This stage defines the evidence model for Materia provenance extraction. The
current accepted-link path is TEI annotation first: local `placeName` elements
carry the Pleiades `ref`, ingredient key, relation, claim group, qualifier,
claim order, evidence phrase, and warnings. Generated JSON is rebuildable
runtime data.

## Core Record

A `provenance_link` records one claim that connects a simple medicine, variety,
or preparation to a place.

Required fields:

- `link_id`: stable local identifier for the proposed link.
- `entry_id`: source entry manifest identifier.
- `subject_label`: Greek label for the medicine, variety, or preparation being
  linked.
- `subject_scope`: one of `entry`, `named_variety`, `preparation`,
  `source_material`, or `context_only`.
- `place_label`: source-form place name or regional label.
- `place_key`: local place authority key when one is already known.
- `pleiades_id`: matched Pleiades id, only after matching.
- `relation`: controlled relation term.
- `certainty`: one of `accepted`, `probable`, `possible`, `rejected`, or
  `context_only`.
- `evidence_phrase`: shortest useful Greek evidence span.
- `evidence_translation`: optional working translation or gloss.
- `source_entry_id`: entry manifest id supplying the evidence.
- `source_path`: local TEI source path under `data/tei/`.
- `notes`: brief editorial note when the link is not obvious.

## Relation Vocabulary

The current Galen materia vocabulary is retained:

- `acquired`: the author obtained or brought back the material from the place.
- `observed`: the author personally observed the material or its production at
  the place.
- `sourced_from`: the text identifies the place as the source, origin, or
  supply region.
- `tested`: the author tested the material, typically as part of evaluating its
  quality or authenticity.
- `prepared`: the material or preparation was made at, or by a process tied to,
  the place.

The simple-entry provenance model extends it with:

- `named_variety_from`: a named variety has a geographic qualifier, such as
  Illyrian iris or Arabian bdellium. Use this when the place modifies the
  variety label rather than the whole entry.
- `grows_at`: the text says a plant grows, is generated, or is abundant at a
  place.
- `produced_at`: the text says a mineral, animal product, resin, or prepared
  item is produced at a place.
- `traded_from`: the text frames the place as a market, export point, or trade
  source rather than a biological or geological origin.
- `compared_with`: the place appears only in a comparison of kinds or qualities.
- `rejected`: a candidate place mention was considered and rejected as a
  provenance link.

## Rules

### Named Varieties

Use `named_variety_from` when the geography belongs to a named subtype: for
example, a row whose lemma contains multiple varieties should produce separate
candidate links for each geographic variety rather than one broad entry-level
link. The `subject_label` should preserve the full Greek variety label.

### Growth and Production

Use `grows_at` for botanical statements that the plant grows, is born, or is
most abundant in a place. Use `produced_at` for minerals, resins, animal
products, and manufactured preparations. If the text says the author acquired a
sample there, prefer `acquired`; if it says the thing is naturally generated
there, prefer `grows_at` or `produced_at`.

### Context-Only Places

A place is `context_only` when it belongs to an anecdote, comparison, citation,
authorial itinerary, or textual source context but does not identify where the
medicine or variety comes from. Context-only places should remain visible for
review but must not be promoted to map points for the substance.

### Rejected and Uncertain Links

Do not silently drop rejected candidates. Keep them with `relation: "rejected"`
or `certainty: "rejected"` and a short note explaining the rejection. Use
`probable` or `possible` for candidates whose syntax or referent needs later
review. A rejected link must not include a Pleiades id unless the rejected
candidate is specifically a rejected match to that place.

### Place Matching

Accepted Materia claims must already point to a Pleiades `ref` in annotated TEI.
Old Pleiades mention scans, review queues, and LLM adjudication sidecars can
remain as research artifacts, but they are not accepted-link authorities for the
reset Materia viewer.

### Source Boundary

The simples pipeline reads source text only from `data/tei/`, preferring
`data/tei/annotated/` when an annotated file exists. Greek TEI is the evidence
authority. English in generated viewer data is derived display text and must not
be used as the authority for extraction or adjudication.

Current Materia draft translations are stored in
`data/review/materia_draft_translations.json` for viewer orientation only. Do
not repopulate English from old generated manifest caches such as
`derived_display_cache`.
