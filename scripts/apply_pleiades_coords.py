#!/usr/bin/env python3
"""Apply Pleiades reprPoint as authoritative lat/lon on places_authority.sample.json.

For every entry with a non-null `pleiades_id` whose snapshot exists in
`data/pleiades/<id>.json`, this script:

  1. Reads `reprPoint = [lon, lat]` from the snapshot (GeoJSON convention).
  2. Sets `lat`, `lon` on the authority entry.
  3. Rewrites `coordinates_source` to `"Pleiades reprPoint (cached snapshot <id>)"`.
  4. Records the pre/post drift so the run report flags any large shift.

Stdlib only. Reuses `haversine_km` and `load_snapshots` from refresh_pleiades.py.
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from refresh_pleiades import haversine_km, load_snapshots  # noqa: E402

DEFAULT_AUTHORITY = ROOT / "data" / "places_authority.sample.json"
DEFAULT_REPORT = ROOT / "generated" / "pleiades_coords_apply.txt"


def display_path(path: Path) -> str:
    try:
        return str(path.relative_to(ROOT))
    except ValueError:
        return str(path)


def repr_point_lat_lon(payload: dict[str, Any]) -> tuple[float, float] | None:
    """Pleiades stores reprPoint as [lon, lat]. Return (lat, lon) or None."""
    point = payload.get("reprPoint")
    if not point or len(point) != 2:
        return None
    try:
        lon, lat = float(point[0]), float(point[1])
    except (TypeError, ValueError):
        return None
    return (lat, lon)


def apply(authority: list[dict[str, Any]], snapshots: dict[str, dict[str, Any]]):
    updates: list[dict[str, Any]] = []
    skipped: list[dict[str, Any]] = []
    for place in authority:
        pid = place.get("pleiades_id")
        if not pid:
            continue
        pid_str = str(pid)
        snap = snapshots.get(pid_str)
        if not snap:
            skipped.append({"place_key": place.get("place_key"), "pleiades_id": pid_str, "reason": "no cached snapshot"})
            continue
        new = repr_point_lat_lon(snap)
        if new is None:
            skipped.append({"place_key": place.get("place_key"), "pleiades_id": pid_str, "reason": "snapshot has no reprPoint"})
            continue
        new_lat, new_lon = new
        old_lat = place.get("lat")
        old_lon = place.get("lon")
        drift_km: float | None = None
        if isinstance(old_lat, (int, float)) and isinstance(old_lon, (int, float)):
            drift_km = haversine_km(old_lat, old_lon, new_lat, new_lon)

        place["lat"] = new_lat
        place["lon"] = new_lon
        place["coordinates_source"] = f"Pleiades reprPoint (cached snapshot {pid_str})"

        updates.append(
            {
                "place_key": place.get("place_key"),
                "pleiades_id": pid_str,
                "old_lat": old_lat,
                "old_lon": old_lon,
                "new_lat": new_lat,
                "new_lon": new_lon,
                "drift_km": drift_km,
            }
        )
    return updates, skipped


def write_report(report_path: Path, updates: list[dict[str, Any]], skipped: list[dict[str, Any]]) -> None:
    lines: list[str] = []
    lines.append("Pleiades coordinate application report")
    lines.append(f"Generated: {datetime.now(timezone.utc).isoformat(timespec='seconds')}")
    lines.append("")
    lines.append(f"Updated:    {len(updates)}")
    lines.append(f"Skipped:    {len(skipped)} (no cached snapshot or no reprPoint)")
    lines.append("")
    if updates:
        lines.append("UPDATES")
        for u in sorted(updates, key=lambda x: -(x["drift_km"] or 0)):
            drift = f"{u['drift_km']:.2f} km" if u["drift_km"] is not None else "(was unmapped)"
            lines.append(
                f"  {u['place_key']:30s} pleiades={u['pleiades_id']:>10s}  "
                f"({u['old_lat']}, {u['old_lon']}) → ({u['new_lat']:.6f}, {u['new_lon']:.6f})  drift={drift}"
            )
        lines.append("")
    if skipped:
        lines.append("SKIPPED")
        for s in skipped:
            lines.append(f"  {s['place_key']} (pleiades={s['pleiades_id']}): {s['reason']}")
        lines.append("")
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--authority", type=Path, default=DEFAULT_AUTHORITY)
    parser.add_argument("--report", type=Path, default=DEFAULT_REPORT)
    parser.add_argument("--dry-run", action="store_true", help="Compute updates but don't write authority.")
    args = parser.parse_args()

    if not args.authority.exists():
        print(f"Authority file missing: {display_path(args.authority)}", file=sys.stderr)
        return 1

    with args.authority.open(encoding="utf-8") as f:
        authority = json.load(f)

    snapshots = load_snapshots(authority)
    updates, skipped = apply(authority, snapshots)
    write_report(args.report, updates, skipped)

    if not args.dry_run:
        with args.authority.open("w", encoding="utf-8") as f:
            json.dump(authority, f, ensure_ascii=False, indent=2)
            f.write("\n")
        print(f"Wrote authority: {display_path(args.authority)} ({len(updates)} updated, {len(skipped)} skipped)")
    else:
        print(f"DRY RUN — would update {len(updates)}, skip {len(skipped)}")
    print(f"Report: {display_path(args.report)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
