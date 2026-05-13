# Simple Provenance Model

This stage defines the evidence model for later provenance extraction. It does
not accept new place links, run Pleiades matching, or ask an LLM to adjudicate
ambiguous geography. The first generated artifact is an entry manifest: source
rows plus enough context to decide provenance links in a later pass.

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
- `source_path`: source CSV or JSON path.
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

This stage does not perform place matching. Later stages may add `place_key`,
`pleiades_id`, and authority metadata after review. Until then, source-form
place labels and evidence phrases are the source of truth.
