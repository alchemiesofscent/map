#!/usr/bin/env python3
"""Fetch per-place Pleiades JSON snapshots and report drift vs the curated authority.

For every entry in data/places_authority.sample.json that has a non-null
pleiades_id, this script:

  1. GETs https://pleiades.stoa.org/places/<id>/json
  2. writes the response verbatim to data/pleiades/<id>.json (sorted keys,
     UTF-8, indent=2 — so re-runs produce stable diffs in git)
  3. compares the Pleiades record to the curated entry and writes a plain-text
     drift report to generated/pleiades_drift.txt

The script never edits places_authority.sample.json. Reconciliation is left to
the curator.

Stdlib only.
"""
from __future__ import annotations

import argparse
import json
import math
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
AUTHORITY = ROOT / "data" / "places_authority.sample.json"
SNAPSHOT_DIR = ROOT / "data" / "pleiades"
DEFAULT_REPORT = ROOT / "generated" / "pleiades_drift.txt"

USER_AGENT = "periplus-tour-mvp/1.0 (+pleiades refresh)"
PLEIADES_URL = "https://pleiades.stoa.org/places/{pid}/json"
REQUEST_TIMEOUT = 20.0
RATE_LIMIT_SECONDS = 1.0
COORD_TOLERANCE_KM = 5.0


def load_authority() -> list[dict]:
    if not AUTHORITY.exists():
        raise SystemExit(f"Authority file missing: {AUTHORITY.relative_to(ROOT)}")
    with AUTHORITY.open(encoding="utf-8") as f:
        return json.load(f)


def fetch_one(pleiades_id: str) -> dict | None:
    url = PLEIADES_URL.format(pid=pleiades_id)
    request = urllib.request.Request(
        url,
        headers={"User-Agent": USER_AGENT, "Accept": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=REQUEST_TIMEOUT) as response:
            if response.status != 200:
                print(
                    f"  Pleiades {pleiades_id}: HTTP {response.status}; skipping",
                    file=sys.stderr,
                )
                return None
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        print(
            f"  Pleiades {pleiades_id}: HTTP {exc.code} {exc.reason}; skipping",
            file=sys.stderr,
        )
        return None
    except urllib.error.URLError as exc:
        print(f"  Pleiades {pleiades_id}: network error {exc.reason}; skipping", file=sys.stderr)
        return None
    except (TimeoutError, json.JSONDecodeError) as exc:
        print(f"  Pleiades {pleiades_id}: {exc}; skipping", file=sys.stderr)
        return None


def write_snapshot(pleiades_id: str, payload: dict) -> Path:
    SNAPSHOT_DIR.mkdir(parents=True, exist_ok=True)
    out = SNAPSHOT_DIR / f"{pleiades_id}.json"
    with out.open("w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2, sort_keys=True)
        f.write("\n")
    return out


def fetch_all(places: list[dict]) -> tuple[int, int, int]:
    targets = [p for p in places if p.get("pleiades_id")]
    if not targets:
        print("No places with pleiades_id in authority file; nothing to fetch.")
        return (0, 0, 0)

    success = 0
    failure = 0
    print(f"Fetching {len(targets)} Pleiades records (rate-limited 1 req/s)…")
    for index, place in enumerate(targets):
        pid = str(place["pleiades_id"])
        if index > 0:
            time.sleep(RATE_LIMIT_SECONDS)
        payload = fetch_one(pid)
        if payload is None:
            failure += 1
            continue
        out = write_snapshot(pid, payload)
        success += 1
        print(f"  {place['place_key']} → {out.relative_to(ROOT)}")
    return (success, failure, len(targets))


def load_snapshots(places: list[dict]) -> dict[str, dict]:
    snapshots: dict[str, dict] = {}
    for place in places:
        pid = place.get("pleiades_id")
        if not pid:
            continue
        path = SNAPSHOT_DIR / f"{pid}.json"
        if not path.exists():
            continue
        try:
            with path.open(encoding="utf-8") as f:
                snapshots[str(pid)] = json.load(f)
        except json.JSONDecodeError as exc:
            print(f"  {path.relative_to(ROOT)}: parse error ({exc}); skipping", file=sys.stderr)
    return snapshots


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    radius = 6371.0
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lambda = math.radians(lon2 - lon1)
    a = math.sin(delta_phi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(delta_lambda / 2) ** 2
    return 2 * radius * math.asin(math.sqrt(a))


def strip_question(value: str) -> str:
    return value.rstrip("? ").strip()


def collect_pleiades_greek_names(payload: dict) -> list[str]:
    """Return Greek-script surface forms from a Pleiades record.

    We accept any name whose `language` is `grc`/`grk`/`el` OR whose
    `attested` form contains characters in the Greek/Coptic block.
    """
    seen: list[str] = []
    for entry in payload.get("names", []) or []:
        if not isinstance(entry, dict):
            continue
        attested = (entry.get("attested") or "").strip()
        language = (entry.get("language") or "").lower()
        is_greek_lang = language in {"grc", "grk", "el"}
        is_greek_script = any("Ͱ" <= ch <= "Ͽ" or "ἀ" <= ch <= "῿" for ch in attested)
        if attested and (is_greek_lang or is_greek_script) and attested not in seen:
            seen.append(attested)
    return seen


def place_type_tail(payload: dict) -> str | None:
    uris = payload.get("placeTypeURIs") or []
    if not uris:
        return None
    first = uris[0]
    if not isinstance(first, str):
        return None
    return first.rstrip("/").rsplit("/", 1)[-1].lower()


def diff_one(curated: dict, payload: dict) -> tuple[list[str], int, int]:
    """Compare one curated entry to one Pleiades payload.

    Returns (lines, hard_mismatches, soft_notes).
    """
    lines: list[str] = []
    hard = 0
    soft = 0

    pid = curated.get("pleiades_id")
    lines.append(f"{curated['place_key']} · Pleiades {pid}")

    # Title vs display_name.
    pleiades_title = (payload.get("title") or "").strip()
    curated_name = (curated.get("display_name") or "").strip()
    stripped_title = strip_question(pleiades_title)
    if pleiades_title and curated_name:
        if pleiades_title == curated_name:
            lines.append("  title:       matches")
        elif stripped_title == curated_name:
            lines.append(
                f"  title:       Pleiades \"{pleiades_title}\" vs display_name \"{curated_name}\"  [soft: trailing ?]"
            )
            soft += 1
        else:
            lines.append(
                f"  title:       MISMATCH: Pleiades \"{pleiades_title}\" vs display_name \"{curated_name}\""
            )
            hard += 1
    else:
        lines.append("  title:       (one side empty; skipped)")

    # Coordinates.
    repr_point = payload.get("reprPoint")
    pleiades_lon, pleiades_lat = (None, None)
    if isinstance(repr_point, list) and len(repr_point) >= 2:
        try:
            pleiades_lon, pleiades_lat = float(repr_point[0]), float(repr_point[1])
        except (TypeError, ValueError):
            pleiades_lon, pleiades_lat = (None, None)

    curated_lat = curated.get("lat")
    curated_lon = curated.get("lon")

    if pleiades_lat is None and curated_lat is None:
        lines.append("  reprPoint:   neither side mapped — matches")
    elif pleiades_lat is None and curated_lat is not None:
        lines.append("  reprPoint:   Pleiades has no representative point; curated has one")
        soft += 1
    elif pleiades_lat is not None and curated_lat is None:
        lines.append(
            f"  reprPoint:   Pleiades has [{pleiades_lat:.6f}, {pleiades_lon:.6f}]; curated lat/lon are null"
        )
        soft += 1
    else:
        delta_km = haversine_km(curated_lat, curated_lon, pleiades_lat, pleiades_lon)
        if delta_km <= COORD_TOLERANCE_KM:
            lines.append(f"  reprPoint:   matches within {delta_km:.2f} km")
        else:
            lines.append(
                f"  reprPoint:   MISMATCH: {delta_km:.2f} km apart "
                f"(curated [{curated_lat:.5f}, {curated_lon:.5f}] vs Pleiades [{pleiades_lat:.5f}, {pleiades_lon:.5f}])"
            )
            hard += 1

    # Greek names.
    curated_greek = list(curated.get("greek_names") or [])
    pleiades_greek = collect_pleiades_greek_names(payload)
    missing = [name for name in pleiades_greek if name not in curated_greek]
    if not pleiades_greek and not curated_greek:
        lines.append("  greek_names: neither side has Greek names")
    elif not missing:
        lines.append(
            f"  greek_names: matches ({len(curated_greek)} curated, {len(pleiades_greek)} in Pleiades)"
        )
    else:
        lines.append(
            f"  greek_names: Pleiades has Greek surfaces not in curated list: {missing}"
        )
        soft += 1

    # Place type.
    pleiades_type = place_type_tail(payload)
    curated_type = (curated.get("place_type") or "").lower()
    if pleiades_type and curated_type:
        if pleiades_type == curated_type:
            lines.append(f"  place_type:  matches (\"{curated_type}\")")
        else:
            lines.append(
                f"  place_type:  Pleiades \"{pleiades_type}\" vs curated \"{curated_type}\""
            )
            soft += 1
    else:
        lines.append("  place_type:  (one side empty; skipped)")

    # URI sanity.
    pleiades_uri = (payload.get("uri") or "").rstrip("/")
    curated_uri = (curated.get("pleiades_uri") or "").rstrip("/")
    if pleiades_uri and curated_uri and pleiades_uri != curated_uri:
        lines.append(f"  uri:         MISMATCH: Pleiades {pleiades_uri} vs curated {curated_uri}")
        hard += 1

    return lines, hard, soft


def write_report(places: list[dict], snapshots: dict[str, dict], report_path: Path) -> tuple[int, int]:
    timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    output_lines = [
        f"Pleiades drift report — {timestamp}",
        "=" * 45,
        "",
    ]

    total_hard = 0
    total_soft = 0
    compared = 0

    for place in places:
        pid = place.get("pleiades_id")
        if not pid:
            continue
        payload = snapshots.get(str(pid))
        if payload is None:
            output_lines.append(f"{place['place_key']} · Pleiades {pid}")
            output_lines.append("  (no snapshot on disk; run without --no-fetch)")
            output_lines.append("")
            continue
        lines, hard, soft = diff_one(place, payload)
        compared += 1
        total_hard += hard
        total_soft += soft
        output_lines.extend(lines)
        output_lines.append("")

    output_lines.append(
        f"Summary: {compared} compared · {total_hard} hard mismatch{'es' if total_hard != 1 else ''} "
        f"· {total_soft} soft note{'s' if total_soft != 1 else ''}."
    )
    output_lines.append("")

    report_path.parent.mkdir(parents=True, exist_ok=True)
    with report_path.open("w", encoding="utf-8") as f:
        f.write("\n".join(output_lines))

    return total_hard, total_soft


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--report",
        type=Path,
        default=DEFAULT_REPORT,
        help=f"Drift report output path (default: {DEFAULT_REPORT.relative_to(ROOT)})",
    )
    parser.add_argument(
        "--no-fetch",
        action="store_true",
        help="Skip the network step; re-diff existing snapshots only.",
    )
    args = parser.parse_args()

    places = load_authority()

    targets_with_id = sum(1 for p in places if p.get("pleiades_id"))
    if args.no_fetch:
        print(
            f"--no-fetch: re-diffing existing snapshots in {SNAPSHOT_DIR.relative_to(ROOT)}/ only."
        )
    else:
        success, failure, total = fetch_all(places)
        if total > 0 and success == 0:
            print("All Pleiades fetches failed.", file=sys.stderr)
            return 1
        if failure:
            print(f"{failure} of {total} fetches failed; report will note missing snapshots.")

    snapshots = load_snapshots(places)

    hard, soft = write_report(places, snapshots, args.report)
    relative_report = args.report.relative_to(ROOT) if args.report.is_absolute() and ROOT in args.report.parents else args.report
    print(
        f"Drift report written to {relative_report}: "
        f"{len(snapshots)}/{targets_with_id} places compared, "
        f"{hard} hard mismatch{'es' if hard != 1 else ''}, "
        f"{soft} soft note{'s' if soft != 1 else ''}."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
