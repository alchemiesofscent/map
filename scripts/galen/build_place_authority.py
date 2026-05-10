#!/usr/bin/env python3
"""Stage 4: build the Galen place_authority from the curator lexicon.

Reads:
  - data/galen/lexicon/places.json   (curator-authored; canonical source)
  - data/generated/galen/passages.json  (Stage 3 output; tells us which
    place_keys are actually referenced by accepted passages)

Emits:
  - data/generated/galen/places_authority.json   (filtered + reordered)

Optionally (`--refresh`) fetches each place's live Pleiades JSON for drift
detection. Reuses scripts/refresh_pleiades.py helpers for the network step
(rate-limited, cached at data/pleiades/<pid>.json), and emits a Galen-specific
drift report at generated/galen_pleiades_drift.txt.

The curator lexicon is the single source of truth; this script never edits
it. Coordinate, place_type, or Pleiades-ID corrections happen by hand-editing
the lexicon and re-running.
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
LEXICON = ROOT / "data" / "galen" / "lexicon" / "places.json"
PASSAGES = ROOT / "data" / "generated" / "galen" / "passages.json"
OUT_AUTHORITY = ROOT / "data" / "generated" / "galen" / "places_authority.json"
DRIFT_REPORT = ROOT / "generated" / "galen_pleiades_drift.txt"

# Reuse the existing per-place Pleiades fetch + cache helpers.
sys.path.insert(0, str(ROOT))
from scripts.refresh_pleiades import (  # noqa: E402
    fetch_one,
    write_snapshot,
    load_snapshots as _load_snapshots,  # not directly compatible; we'll call by id
    haversine_km,
    SNAPSHOT_DIR,
    RATE_LIMIT_SECONDS,
    COORD_TOLERANCE_KM,
    collect_pleiades_greek_names,
    place_type_tail,
)
import time


def referenced_place_keys(passages: list[dict]) -> set[str]:
    keys: set[str] = set()
    for p in passages:
        for m in p.get("place_mentions", []):
            keys.add(m["place_key"])
    return keys


def authority_entry(lex_entry: dict) -> dict:
    """Project a lexicon entry onto the place_authority schema fields."""
    return {
        "place_key": lex_entry["place_key"],
        "display_name": lex_entry["display_name"],
        "ancient_names_in_galen": list(lex_entry.get("ancient_names_in_galen", [])),
        "place_type": lex_entry["place_type"],
        "lat": lex_entry.get("lat"),
        "lon": lex_entry.get("lon"),
        "certainty": lex_entry["certainty"],
        "pleiades_id": lex_entry.get("pleiades_id"),
        "pleiades_uri": lex_entry.get("pleiades_uri"),
        "coordinates_source": lex_entry.get("coordinates_source", ""),
        "notes": lex_entry.get("notes", ""),
    }


def fetch_one_with_retry(pid: str, attempts: int = 3) -> dict | None:
    """Wrap refresh_pleiades.fetch_one with retries on transient network errors.

    Pleiades occasionally serves chunked responses that yield IncompleteRead
    on a slow connection; retry once or twice and it usually succeeds.
    """
    last_err = None
    for attempt in range(attempts):
        try:
            payload = fetch_one(pid)
            if payload is not None:
                return payload
        except Exception as exc:  # IncompleteRead, TimeoutError, etc.
            last_err = exc
        if attempt + 1 < attempts:
            time.sleep(2.0 * (attempt + 1))
    if last_err is not None:
        print(f"  Pleiades {pid}: gave up after {attempts} attempts ({type(last_err).__name__}: {last_err})", file=sys.stderr)
    return None


def fetch_and_cache(pids: list[str]) -> dict[str, dict]:
    """Fetch live Pleiades JSON for each pid (rate-limited), write to cache."""
    snapshots: dict[str, dict] = {}
    for i, pid in enumerate(pids):
        if i > 0:
            time.sleep(RATE_LIMIT_SECONDS)
        # Skip if we already have a fresh cache entry (< 7 days old)
        cache_path = SNAPSHOT_DIR / f"{pid}.json"
        if cache_path.exists():
            try:
                payload = json.loads(cache_path.read_text(encoding="utf-8"))
                snapshots[pid] = payload
                continue
            except json.JSONDecodeError:
                pass
        payload = fetch_one_with_retry(pid)
        if payload is None:
            continue
        write_snapshot(pid, payload)
        snapshots[pid] = payload
    return snapshots


def load_cache(pids: list[str]) -> dict[str, dict]:
    snapshots: dict[str, dict] = {}
    for pid in pids:
        path = SNAPSHOT_DIR / f"{pid}.json"
        if not path.exists():
            continue
        try:
            snapshots[pid] = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            continue
    return snapshots


def diff_one(entry: dict, payload: dict) -> tuple[list[str], int, int]:
    """Return (lines, hard_mismatches, soft_notes) for one curator entry."""
    lines: list[str] = []
    hard = 0
    soft = 0
    pid = entry.get("pleiades_id")
    lines.append(f"{entry['place_key']} · Pleiades {pid}")

    pleiades_title = (payload.get("title") or "").strip()
    curator_name = (entry.get("display_name") or "").strip()
    stripped = pleiades_title.rstrip("? ").strip()
    if pleiades_title and curator_name:
        if pleiades_title == curator_name or stripped == curator_name:
            lines.append("  title:       matches")
        else:
            lines.append(
                f"  title:       Pleiades \"{pleiades_title}\" vs lexicon \"{curator_name}\""
            )
            soft += 1
    else:
        lines.append("  title:       (one side empty; skipped)")

    repr_point = payload.get("reprPoint")
    p_lon = p_lat = None
    if isinstance(repr_point, list) and len(repr_point) >= 2:
        try:
            p_lon, p_lat = float(repr_point[0]), float(repr_point[1])
        except (TypeError, ValueError):
            p_lon = p_lat = None
    c_lat = entry.get("lat")
    c_lon = entry.get("lon")
    if p_lat is None and c_lat is None:
        lines.append("  reprPoint:   neither side mapped")
    elif p_lat is None:
        lines.append("  reprPoint:   Pleiades has no representative point")
        soft += 1
    elif c_lat is None:
        lines.append(f"  reprPoint:   Pleiades [{p_lat:.5f}, {p_lon:.5f}]; lexicon null")
        soft += 1
    else:
        delta_km = haversine_km(c_lat, c_lon, p_lat, p_lon)
        if delta_km <= COORD_TOLERANCE_KM:
            lines.append(f"  reprPoint:   matches within {delta_km:.2f} km")
        else:
            lines.append(
                f"  reprPoint:   MISMATCH: {delta_km:.2f} km apart "
                f"(lexicon [{c_lat:.5f}, {c_lon:.5f}] vs Pleiades [{p_lat:.5f}, {p_lon:.5f}])"
            )
            hard += 1

    # Greek names: the curator lexicon stores ancient_names_in_galen[].surface
    # rather than a flat greek_names[]; compare unique surfaces.
    curator_surfaces = {
        (n.get("surface") if isinstance(n, dict) else n)
        for n in (entry.get("ancient_names_in_galen") or [])
    }
    pleiades_greek = collect_pleiades_greek_names(payload)
    missing_in_lex = [n for n in pleiades_greek if n not in curator_surfaces]
    if not pleiades_greek and not curator_surfaces:
        lines.append("  greek_names: neither side has Greek names")
    elif not missing_in_lex:
        lines.append(
            f"  greek_names: lexicon covers {len(curator_surfaces)} surface(s); Pleiades has {len(pleiades_greek)}"
        )
    else:
        lines.append(
            f"  greek_names: Pleiades has Greek surfaces not in lexicon: {missing_in_lex}"
        )
        soft += 1

    # Place type
    p_type = place_type_tail(payload)
    c_type = (entry.get("place_type") or "").lower()
    if p_type and c_type:
        # Galen schema's place_type uses values like "city", "port", "region",
        # "island", "mine", "sanctuary", "sea". Pleiades has more granular
        # types ("settlement", "province-2", etc.) and there's not a 1:1 map,
        # so we report rather than fail-hard.
        match = (
            (p_type == c_type)
            or (p_type == "settlement" and c_type in ("city", "port"))
            or (p_type in ("region", "label", "province", "province-2") and c_type == "region")
            or (p_type == "island" and c_type == "island")
            or (p_type in ("water-open", "lake", "sea") and c_type == "sea")
            or (p_type == "settlement" and c_type == "mine")
        )
        if match:
            lines.append(f"  place_type:  Pleiades \"{p_type}\" ≈ lexicon \"{c_type}\"")
        else:
            lines.append(f"  place_type:  Pleiades \"{p_type}\" vs lexicon \"{c_type}\"")
            soft += 1
    else:
        lines.append("  place_type:  (one side empty; skipped)")

    return lines, hard, soft


def write_drift_report(
    entries: list[dict], snapshots: dict[str, dict], path: Path
) -> tuple[int, int, int]:
    timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    out_lines = [
        f"Galen Pleiades drift report — {timestamp}",
        "=" * 50,
        "",
    ]
    compared = 0
    total_hard = 0
    total_soft = 0
    for entry in entries:
        pid = entry.get("pleiades_id")
        if not pid:
            continue
        snap = snapshots.get(pid)
        if not snap:
            out_lines.append(f"{entry['place_key']} · Pleiades {pid}")
            out_lines.append("  (no snapshot on disk; run with --refresh to fetch)")
            out_lines.append("")
            continue
        lines, hard, soft = diff_one(entry, snap)
        compared += 1
        total_hard += hard
        total_soft += soft
        out_lines.extend(lines)
        out_lines.append("")
    out_lines.append(
        f"Summary: {compared} compared · {total_hard} hard mismatch(es) · {total_soft} soft note(s)."
    )
    out_lines.append("")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(out_lines))
    return compared, total_hard, total_soft


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--refresh", action="store_true",
                    help="Fetch live Pleiades JSON per place (rate-limited 1 req/s) and write a drift report.")
    ap.add_argument("--no-filter", action="store_true",
                    help="Emit every lexicon entry regardless of whether it's referenced by passages.json.")
    ap.add_argument("--report", type=Path, default=DRIFT_REPORT,
                    help=f"Drift report path. Default: {DRIFT_REPORT.relative_to(ROOT)}")
    args = ap.parse_args()

    if not LEXICON.exists():
        print(f"ERROR: lexicon missing at {LEXICON.relative_to(ROOT)}", file=sys.stderr)
        return 1

    lexicon = json.loads(LEXICON.read_text())
    by_key = {e["place_key"]: e for e in lexicon}

    if args.no_filter or not PASSAGES.exists():
        keep_keys = set(by_key.keys())
        if not PASSAGES.exists():
            print(f"NOTE: {PASSAGES.relative_to(ROOT)} not found; emitting all lexicon entries.")
    else:
        passages = json.loads(PASSAGES.read_text())
        keep_keys = referenced_place_keys(passages)
        missing = keep_keys - set(by_key.keys())
        if missing:
            print(f"WARNING: {len(missing)} place_keys referenced by passages.json are missing from the lexicon:", file=sys.stderr)
            for k in sorted(missing):
                print(f"  - {k}", file=sys.stderr)

    selected = [by_key[k] for k in sorted(keep_keys) if k in by_key]
    authority = [authority_entry(e) for e in selected]

    OUT_AUTHORITY.parent.mkdir(parents=True, exist_ok=True)
    OUT_AUTHORITY.write_text(json.dumps(authority, ensure_ascii=False, indent=2))
    print(f"Wrote {len(authority)} entries to {OUT_AUTHORITY.relative_to(ROOT)}")

    # Summarise what got included
    referenced_only = [e for e in authority if e.get("pleiades_id")]
    print(f"  with Pleiades ID:    {len(referenced_only)}")
    types = sorted({e["place_type"] for e in authority})
    print(f"  place_types present: {types}")
    cert_counts: dict[str, int] = {}
    for e in authority:
        cert_counts[e["certainty"]] = cert_counts.get(e["certainty"], 0) + 1
    print(f"  certainty mix:       {cert_counts}")

    # Optional drift check
    if args.refresh:
        pids = [e["pleiades_id"] for e in authority if e.get("pleiades_id")]
        print(f"\nRefreshing Pleiades records for {len(pids)} places (rate-limited 1 req/s)...")
        snapshots = fetch_and_cache(pids)
        compared, hard, soft = write_drift_report(authority, snapshots, args.report)
        print(f"Drift report: {args.report.relative_to(ROOT)}: {compared} compared, {hard} hard, {soft} soft.")
    else:
        # Even without --refresh, report against any cached snapshots already on disk
        pids = [e["pleiades_id"] for e in authority if e.get("pleiades_id")]
        snapshots = load_cache(pids)
        if snapshots:
            compared, hard, soft = write_drift_report(authority, snapshots, args.report)
            print(f"\nUsing cached snapshots only: {compared} compared in {args.report.relative_to(ROOT)} ({hard} hard, {soft} soft).")
            print("Run with --refresh to fetch live records.")
        else:
            print("\n(No Pleiades snapshots cached; run with --refresh to fetch.)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
