"""Shared helpers for the simples provenance pipeline."""
from __future__ import annotations

import hashlib
import json
import re
import unicodedata
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


REPO_ROOT = Path(__file__).resolve().parents[2]
GENERATED_DIR = REPO_ROOT / "data" / "generated" / "simples"
REVIEW_DIR = REPO_ROOT / "data" / "review"
PLEIADES_DUMP_DIR = REPO_ROOT / "data" / "pleiades" / "dumps"
TEI_SOURCE_REGISTRY_PATH = REPO_ROOT / "data" / "tei" / "source_registry.json"

MANIFEST_PATH = GENERATED_DIR / "entry_manifest.json"
GAZETTEER_PATH = GENERATED_DIR / "pleiades_gazetteer.json"
MENTIONS_PATH = GENERATED_DIR / "pleiades_name_mentions.json"
CANDIDATES_PATH = GENERATED_DIR / "provenance_candidates.json"
REVIEW_QUEUE_PATH = REVIEW_DIR / "simples_provenance_review.csv"
ENTRY_CLAIM_REVIEW_PATH = REVIEW_DIR / "simples_entry_provenance_claims.json"
LLM_ADJUDICATIONS_PATH = GENERATED_DIR / "provenance_llm_adjudications.json"
ENTRY_CLAIMS_PATH = GENERATED_DIR / "provenance_entry_claims.json"
LINKS_PATH = GENERATED_DIR / "provenance_links.json"
MAP_POINTS_PATH = GENERATED_DIR / "provenance_map_points.json"

CANONICAL_ARABIA_PLEIADES_ID = "1001942"
DEPRECATED_ARABIA_PLEIADES_ID = "981506"
PROVENANCE_PLEIADES_REPLACEMENTS = {
    DEPRECATED_ARABIA_PLEIADES_ID: CANONICAL_ARABIA_PLEIADES_ID,
}


def now_utc() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def rel(path: Path) -> str:
    try:
        return path.resolve().relative_to(REPO_ROOT).as_posix()
    except ValueError:
        return path.resolve().as_posix()


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def validate_schema(payload: Any, schema_path: Path) -> None:
    schema = load_json(schema_path)
    try:
        import jsonschema  # type: ignore
    except ImportError:
        validate_schema_minimal(payload, schema)
        return
    jsonschema.validate(payload, schema)


def validate_schema_minimal(payload: Any, schema: dict[str, Any]) -> None:
    if schema.get("type") == "object" and not isinstance(payload, dict):
        raise AssertionError("payload is not a JSON object")
    for key in schema.get("required", []):
        if key not in payload:
            raise AssertionError(f"payload missing required key: {key}")


def has_greek_script(text: str) -> bool:
    return any(0x0370 <= ord(ch) <= 0x03FF or 0x1F00 <= ord(ch) <= 0x1FFF for ch in text)


def normalize_key(text: str) -> str:
    decomposed = unicodedata.normalize("NFD", text or "")
    stripped = "".join(ch for ch in decomposed if unicodedata.category(ch) != "Mn")
    stripped = stripped.lower().replace("ς", "σ")
    return " ".join(stripped.split())


def normalize_with_offsets(text: str) -> tuple[str, list[int]]:
    chars: list[str] = []
    offsets: list[int] = []
    last_was_space = False

    for original_index, original_char in enumerate(text or ""):
        decomposed = unicodedata.normalize("NFD", original_char)
        emitted_for_char = False
        for ch in decomposed:
            if unicodedata.category(ch) == "Mn":
                continue
            if ch.isspace():
                if chars and not last_was_space:
                    chars.append(" ")
                    offsets.append(original_index)
                    last_was_space = True
                emitted_for_char = True
                continue
            out = ch.lower().replace("ς", "σ")
            chars.append(out)
            offsets.append(original_index)
            last_was_space = False
            emitted_for_char = True
        if not emitted_for_char and original_char.isspace() and chars and not last_was_space:
            chars.append(" ")
            offsets.append(original_index)
            last_was_space = True

    return "".join(chars), offsets


def is_token_boundary(text: str, start: int, end: int) -> bool:
    before = text[start - 1] if start > 0 else ""
    after = text[end] if end < len(text) else ""
    return (not before or not before.isalnum()) and (not after or not after.isalnum())


def context_window(text: str, start: int, end: int, width: int = 90) -> str:
    left = max(0, start - width)
    right = min(len(text), end + width)
    prefix = "…" if left > 0 else ""
    suffix = "…" if right < len(text) else ""
    return prefix + " ".join(text[left:right].split()) + suffix


def stable_id(prefix: str, *parts: object) -> str:
    joined = "\u241f".join(str(part) for part in parts)
    digest = hashlib.sha1(joined.encode("utf-8")).hexdigest()[:12]
    return f"{prefix}-{digest}"


def load_manifest_entries() -> tuple[dict[str, Any], dict[str, dict[str, Any]]]:
    manifest = load_json(MANIFEST_PATH)
    entries = {entry["entry_id"]: entry for entry in manifest.get("entries", [])}
    return manifest, entries


def place_summary(place: dict[str, Any]) -> dict[str, Any]:
    coords = place.get("coordinates") or {}
    return {
        "pleiades_id": place["pleiades_id"],
        "pleiades_uri": place["pleiades_uri"],
        "title": place.get("title", ""),
        "feature_types": place.get("feature_types", []),
        "coordinates": {
            "lat": coords.get("lat"),
            "lon": coords.get("lon"),
        },
        "location_precision": place.get("location_precision", ""),
    }


def sorted_counter(items: list[str]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for item in items:
        counts[item] = counts.get(item, 0) + 1
    return dict(sorted(counts.items(), key=lambda kv: (-kv[1], kv[0])))


def json_compact(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def normalize_relation_context(text: str) -> str:
    return re.sub(r"\s+", " ", normalize_key(text))


def canonical_provenance_pleiades_id(pleiades_id: str) -> str:
    return PROVENANCE_PLEIADES_REPLACEMENTS.get(str(pleiades_id), str(pleiades_id))


def is_deprecated_arabia_provenance_id(pleiades_id: object) -> bool:
    return str(pleiades_id) == DEPRECATED_ARABIA_PLEIADES_ID


def normalized_offsets(text: str, needle: str) -> dict[str, int] | None:
    norm_text, norm_offsets = normalize_with_offsets(text)
    norm_needle, _needle_offsets = normalize_with_offsets(needle)
    if not norm_text or not norm_needle:
        return None
    start = norm_text.find(norm_needle)
    if start < 0:
        return None
    end = start + len(norm_needle)
    if end > len(norm_offsets):
        return None
    return {"start": norm_offsets[start], "end": norm_offsets[end - 1] + 1}


def normalized_contains(text: str, needle: str) -> bool:
    return normalized_offsets(text, needle) is not None
