#!/usr/bin/env python3
"""Stage 5: build the Galen materia medica index.

Reads the hand-authored curator file at `data/galen/materia/materia.json`,
validates it against `schemas/galen/galen-materia.schema.json`, cross-checks
references against `places_authority.json` and `passages.json`, and emits
`data/generated/galen/materia.json`.

Cross-reference rules:
- Every `place_links[].place_key` must exist in places_authority.json.
- Every `place_links[].passage_id` must exist in passages.json.
- For every passage's `materia_mentions[]`, the referenced `materia_key` must
  exist in the curator file. (i.e. all materia tagged in passages must have a
  full entry in the curator file.)

Errors fail the build. Warnings are printed but don't block emission.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CURATOR = ROOT / "data" / "galen" / "materia" / "materia.json"
PLACES_AUTHORITY = ROOT / "data" / "generated" / "galen" / "places_authority.json"
PASSAGES = ROOT / "data" / "generated" / "galen" / "passages.json"
SCHEMA = ROOT / "schemas" / "galen" / "galen-materia.schema.json"
OUT = ROOT / "data" / "generated" / "galen" / "materia.json"


def fail(msg: str) -> None:
    print(f"ERROR: {msg}", file=sys.stderr)


def warn(msg: str) -> None:
    print(f"WARNING: {msg}", file=sys.stderr)


def validate_schema(data: list[dict], schema: dict) -> int:
    """Lightweight schema check (required fields + enum values)."""
    item_schema = schema["items"]
    required = item_schema["required"]
    cat_enum = item_schema["properties"]["category"]["enum"]
    rel_enum = schema["$defs"]["relation"]["enum"]
    pk_pattern = schema["$defs"]["materiaKey"]["pattern"]
    import re
    pk_re = re.compile(pk_pattern)
    errors = 0
    seen_keys: set[str] = set()
    for i, e in enumerate(data):
        for r in required:
            if r not in e:
                fail(f"materia[{i}]: missing required field {r!r}")
                errors += 1
        if "materia_key" in e:
            mk = e["materia_key"]
            if not pk_re.match(mk):
                fail(f"materia[{i}]: materia_key {mk!r} does not match {pk_pattern}")
                errors += 1
            if mk in seen_keys:
                fail(f"materia[{i}]: duplicate materia_key {mk!r}")
                errors += 1
            seen_keys.add(mk)
        if e.get("category") not in cat_enum:
            fail(f"materia[{i}] {e.get('materia_key')}: bad category {e.get('category')!r}")
            errors += 1
        for j, link in enumerate(e.get("place_links", []) or []):
            if link.get("relation") not in rel_enum:
                fail(f"materia[{i}].place_links[{j}]: bad relation {link.get('relation')!r}")
                errors += 1
            for r in ("place_key", "passage_id", "evidence_phrase"):
                if r not in link:
                    fail(f"materia[{i}].place_links[{j}]: missing {r!r}")
                    errors += 1
    return errors


def validate_cross_refs(
    materia: list[dict],
    place_keys: set[str],
    passage_ids: set[str],
    passages: list[dict],
) -> int:
    errors = 0

    # Forward: every place_link references real entities
    for e in materia:
        for j, link in enumerate(e.get("place_links", []) or []):
            pk = link.get("place_key")
            pid = link.get("passage_id")
            if pk and pk not in place_keys:
                fail(
                    f"materia[{e['materia_key']}].place_links[{j}]: "
                    f"place_key {pk!r} not in places_authority.json"
                )
                errors += 1
            if pid and pid not in passage_ids:
                fail(
                    f"materia[{e['materia_key']}].place_links[{j}]: "
                    f"passage_id {pid!r} not in passages.json"
                )
                errors += 1

    # Reverse: every materia_mention in passages must have a curator entry
    materia_keys = {e["materia_key"] for e in materia}
    for p in passages:
        for m in p.get("materia_mentions", []) or []:
            mk = m.get("materia_key")
            if mk and mk not in materia_keys:
                fail(
                    f"passage {p['passage_id']!r} mentions materia_key {mk!r} "
                    "with no entry in curator materia.json"
                )
                errors += 1

    # Reverse soft: for each (materia, passage) referenced in a materia_mention,
    # warn if the curator file doesn't include that passage_id in any place_link.
    # This isn't a hard error — some passages are bare mentions with no
    # specific place_link — but it's worth flagging.
    materia_passages: dict[str, set[str]] = {e["materia_key"]: set() for e in materia}
    for e in materia:
        for link in e.get("place_links", []) or []:
            if link.get("passage_id"):
                materia_passages[e["materia_key"]].add(link["passage_id"])

    for p in passages:
        for m in p.get("materia_mentions", []) or []:
            mk = m.get("materia_key")
            if mk and mk in materia_passages:
                if (
                    p["passage_id"] not in materia_passages[mk]
                    and not any(
                        e["materia_key"] == mk and not e.get("place_links")
                        for e in materia
                    )
                ):
                    warn(
                        f"materia {mk!r} mentioned in passage {p['passage_id']!r} "
                        "but curator place_links don't reference that passage"
                    )

    return errors


def main() -> int:
    if not CURATOR.exists():
        fail(f"curator file missing: {CURATOR.relative_to(ROOT)}")
        return 1
    if not PLACES_AUTHORITY.exists():
        fail(f"run scripts/galen/build_place_authority.py first ({PLACES_AUTHORITY.relative_to(ROOT)})")
        return 1
    if not PASSAGES.exists():
        fail(f"run scripts/galen/extract_passages.py first ({PASSAGES.relative_to(ROOT)})")
        return 1

    materia = json.loads(CURATOR.read_text())
    schema = json.loads(SCHEMA.read_text())
    places = json.loads(PLACES_AUTHORITY.read_text())
    passages = json.loads(PASSAGES.read_text())

    place_keys = {p["place_key"] for p in places}
    passage_ids = {p["passage_id"] for p in passages}

    errors = validate_schema(materia, schema)
    errors += validate_cross_refs(materia, place_keys, passage_ids, passages)

    if errors:
        fail(f"{errors} validation error(s); not writing output.")
        return 1

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(materia, ensure_ascii=False, indent=2))

    # Summary
    print(f"Wrote {len(materia)} materia entries to {OUT.relative_to(ROOT)}")
    by_cat: dict[str, int] = {}
    by_rel: dict[str, int] = {}
    place_link_count = 0
    no_links = 0
    for m in materia:
        by_cat[m["category"]] = by_cat.get(m["category"], 0) + 1
        if not m.get("place_links"):
            no_links += 1
            continue
        for link in m["place_links"]:
            place_link_count += 1
            by_rel[link["relation"]] = by_rel.get(link["relation"], 0) + 1
    print(f"  category mix:        {by_cat}")
    print(f"  total place_links:   {place_link_count}")
    print(f"  no-link materia:     {no_links}")
    print(f"  relation mix:        {by_rel}")

    # Per-place inventory
    place_to_materia: dict[str, list[tuple[str, str]]] = {}
    for m in materia:
        for link in m.get("place_links", []) or []:
            place_to_materia.setdefault(link["place_key"], []).append(
                (m["materia_key"], link["relation"])
            )
    print("  per-place inventory (top entries):")
    for pk, items in sorted(place_to_materia.items(), key=lambda kv: (-len(kv[1]), kv[0])):
        rels = ", ".join(f"{mk}({rel})" for mk, rel in sorted(items))
        print(f"    {pk:25} ({len(items):>2}): {rels}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
