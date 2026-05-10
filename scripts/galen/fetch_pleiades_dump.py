#!/usr/bin/env python3
"""Fetch the Pleiades places JSON dump.

Downloads https://atlantides.org/downloads/pleiades/dumps/pleiades-places-latest.json.gz
to data/pleiades/dumps/. Stdlib only. Idempotent: skips download if cached
and not stale beyond --max-age-days, unless --force is given.

The dump is the bulk source of Greek-script place names used by
build_gazetteer.py to seed Stage 1.5 of the Galen ingest.
"""
from __future__ import annotations

import argparse
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DUMP_DIR = ROOT / "data" / "pleiades" / "dumps"
DUMP_BASE_URL = "https://atlantides.org/downloads/pleiades/dumps/"
# Pleiades publishes CSV-gzipped daily snapshots. We pull the three relevant
# files: places (one row per place, with featureTypes + repr coordinates),
# names (one row per name, with nameAttested in original script + nameLanguage),
# and locations (per-feature polygons; not currently used but cheap to mirror).
DUMP_FILES = [
    "pleiades-places-latest.csv.gz",
    "pleiades-names-latest.csv.gz",
    "pleiades-locations-latest.csv.gz",
]
README_PATH = DUMP_DIR / "README.md"
USER_AGENT = "periplus-tour-mvp/1.0 (+galen-route ingest, contact: project README)"


def human_bytes(n: int) -> str:
    for unit in ("B", "KiB", "MiB", "GiB"):
        if n < 1024:
            return f"{n:.1f} {unit}"
        n /= 1024
    return f"{n:.1f} TiB"


def fetch(url: str, dest: Path) -> int:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=60) as resp:
        total = int(resp.headers.get("Content-Length") or 0)
        dest.parent.mkdir(parents=True, exist_ok=True)
        tmp = dest.with_suffix(dest.suffix + ".tmp")
        downloaded = 0
        last_print = 0.0
        with open(tmp, "wb") as out:
            while True:
                chunk = resp.read(64 * 1024)
                if not chunk:
                    break
                out.write(chunk)
                downloaded += len(chunk)
                now = time.monotonic()
                if total and now - last_print >= 0.5:
                    pct = downloaded / total * 100
                    print(
                        f"  downloaded {human_bytes(downloaded)} / {human_bytes(total)} ({pct:.1f}%)",
                        file=sys.stderr,
                    )
                    last_print = now
        tmp.replace(dest)
        return downloaded


def write_readme(file_sizes: dict[str, int]) -> None:
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    file_lines = "\n".join(f"  - `{name}` ({human_bytes(size)})" for name, size in file_sizes.items())
    body = f"""# Pleiades places dumps

This directory caches the bulk Pleiades dumps used by
`scripts/galen/build_gazetteer.py` to seed the Galen route survey.

## Provenance
- **Source directory**: <{DUMP_BASE_URL}>
- **Last fetched**: {now}
- **Files**:
{file_lines}
- **Fetcher**: `scripts/galen/fetch_pleiades_dump.py`

## License
Pleiades data is published under CC-BY 3.0. See
<https://pleiades.stoa.org/credits>. When derivative artifacts (gazetteers,
maps) are produced, attribute Pleiades and link back to the relevant
`pleiades_uri` for each place.

## Refreshing
Run `python scripts/galen/fetch_pleiades_dump.py --force` to re-download.
The dumps are excluded from git via `.gitignore`; they are reproducible from
the URL above (Pleiades publishes daily snapshots; the `-latest` suffix
always points to the most recent).
"""
    README_PATH.write_text(body)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--force", action="store_true",
                    help="Re-download even if cached files exist.")
    ap.add_argument("--max-age-days", type=float, default=90.0,
                    help="Re-download if cache older than this many days. Default 90.")
    args = ap.parse_args()

    DUMP_DIR.mkdir(parents=True, exist_ok=True)
    file_sizes: dict[str, int] = {}
    any_fetched = False

    for name in DUMP_FILES:
        url = DUMP_BASE_URL + name
        dest = DUMP_DIR / name
        if dest.exists() and not args.force:
            age_days = (time.time() - dest.stat().st_mtime) / 86400.0
            if age_days < args.max_age_days:
                size = dest.stat().st_size
                print(f"Cache hit: {dest.relative_to(ROOT)} ({human_bytes(size)}, {age_days:.1f} days old)")
                file_sizes[name] = size
                continue
            print(f"Cache stale ({age_days:.1f} days), re-downloading {name}...")

        print(f"Fetching {url}")
        try:
            n = fetch(url, dest)
        except urllib.error.URLError as e:
            print(f"ERROR: download of {name} failed: {e}", file=sys.stderr)
            return 1
        print(f"  -> {human_bytes(n)} written to {dest.relative_to(ROOT)}")
        file_sizes[name] = n
        any_fetched = True

    if not args.force and not any_fetched:
        print("All dumps cached and fresh. Use --force to re-download.")
    write_readme(file_sizes)
    print(f"Wrote provenance to {README_PATH.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
