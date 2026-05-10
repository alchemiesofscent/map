#!/usr/bin/env python3
"""Build a Pleiades-seeded gazetteer of Greek place names.

Consumes the daily Pleiades CSV dumps cached by `fetch_pleiades_dump.py`
(places + names) and emits `data/generated/galen/pleiades_gazetteer.json`,
a lemma-keyed lookup of every Pleiades place that has at least one
Greek-script name.

The output structure:
{
  "schema_version": "0.1",
  "source": "pleiades-names-latest.csv.gz / pleiades-places-latest.csv.gz",
  "fetched_at": "...",
  "place_count": N,
  "name_count": M,
  "places": {
      "<pleiades_id>": {
          "pleiades_id": "59732",
          "pleiades_uri": "https://pleiades.stoa.org/places/59732",
          "primary_label": "Barake",
          "feature_types": ["settlement", "port"],
          "lat": 22.45, "lon": 69.11,
          "greek_names": [
              {"surface": "Βαράκη", "lemma": "Βαράκη", "lang": "grc",
               "key": "βαρακη"}
          ],
          "lookup_keys": ["βαρακη", ...]
      }
  },
  "lemma_index": {
      "λῆμνος": ["59732", ...],
      ...
  }
}

The "key" / "lookup_keys" / "lemma_index" entries are all normalized via
strip_diacritics(...).lower(), so the survey can look up TEI tokens
case- and diacritic-insensitively after lemmatizing them with grc_lemma.
"""
from __future__ import annotations

import csv
import gzip
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DUMP_DIR = ROOT / "data" / "pleiades" / "dumps"
OUT_PATH = ROOT / "data" / "generated" / "galen" / "pleiades_gazetteer.json"

PLACES_CSV = DUMP_DIR / "pleiades-places-latest.csv.gz"
NAMES_CSV = DUMP_DIR / "pleiades-names-latest.csv.gz"

# Allow the field-size limit to grow — Pleiades has a few enormous
# bbox/description rows that exceed the default 131072.
csv.field_size_limit(sys.maxsize)


def has_greek_script(s: str) -> bool:
    """True if any character is in Greek/Coptic or Greek Extended block."""
    if not s:
        return False
    for ch in s:
        cp = ord(ch)
        if 0x0370 <= cp <= 0x03FF:  # Greek and Coptic
            return True
        if 0x1F00 <= cp <= 0x1FFF:  # Greek Extended
            return True
    return False


def normalize(s: str) -> str:
    """Diacritic-strip + lowercase + collapse internal whitespace."""
    import unicodedata
    nfd = unicodedata.normalize("NFD", s)
    stripped = "".join(ch for ch in nfd if unicodedata.category(ch) != "Mn")
    return " ".join(stripped.lower().split())


def parse_pid(pid: str | None) -> str | None:
    """`pid` in names CSV is e.g. "/places/265876"; extract the numeric id."""
    if not pid:
        return None
    s = pid.strip().rstrip("/")
    if not s:
        return None
    return s.rsplit("/", 1)[-1] or None


def open_csv_gz(path: Path):
    return gzip.open(path, "rt", encoding="utf-8", newline="")


def main() -> int:
    if not PLACES_CSV.exists() or not NAMES_CSV.exists():
        print(
            f"ERROR: missing dumps. Run scripts/galen/fetch_pleiades_dump.py first.",
            file=sys.stderr,
        )
        return 1

    # Lazy CLTK init
    from scripts.galen.grc_lemma import Lemmatizer
    lem = Lemmatizer()
    print(f"Lemmatizer ready (CLTK={lem.have_cltk})")

    # Pass 1: load places metadata + index by title
    print(f"Reading {PLACES_CSV.relative_to(ROOT)}...")
    places_meta: dict[str, dict] = {}
    with open_csv_gz(PLACES_CSV) as f:
        reader = csv.DictReader(f)
        for row in reader:
            pid = (row.get("id") or "").strip()
            if not pid:
                continue
            try:
                lat = float(row["reprLat"]) if row.get("reprLat") else None
                lon = float(row["reprLong"]) if row.get("reprLong") else None
            except ValueError:
                lat = lon = None
            ft_raw = (row.get("featureTypes") or "").strip()
            feature_types = [t.strip() for t in ft_raw.split(",") if t.strip()] if ft_raw else []
            title = (row.get("title") or "").strip()
            time_periods = (row.get("timePeriodsKeys") or "").strip()
            places_meta[pid] = {
                "pleiades_id": pid,
                "pleiades_uri": f"https://pleiades.stoa.org/places/{pid}",
                "title": title,
                "feature_types": feature_types,
                "time_periods": time_periods,
                "lat": lat,
                "lon": lon,
                "greek_names": [],
                "latin_keys": set(),  # Latin/transliterated forms (lowercase)
                "greek_keys": set(),  # Diacriticless lowercase Greek lemma/surface
            }
    print(f"  {len(places_meta)} places loaded")

    # Pass 2: collect names — Greek-script ones get lemmatized; transliterated/
    # title-ish forms feed the Latin index.
    print(f"Reading {NAMES_CSV.relative_to(ROOT)}...")
    grc_name_count = 0
    latin_name_count = 0
    skip_count = 0
    with open_csv_gz(NAMES_CSV) as f:
        reader = csv.DictReader(f)
        for row in reader:
            pid = parse_pid(row.get("pid"))
            if not pid or pid not in places_meta:
                skip_count += 1
                continue
            entry = places_meta[pid]
            attested = (row.get("nameAttested") or "").strip()
            translit = (row.get("nameTransliterated") or "").strip()
            lang = (row.get("nameLanguage") or "").strip().lower()

            # Greek-script attested form
            if attested and (lang.startswith("grc") or has_greek_script(attested)):
                tokens = attested.split()
                if tokens:
                    lemma_pieces: list[str] = []
                    for t in tokens:
                        analyses = lem.lemmatize(t)
                        lemma_pieces.append(analyses[0] if analyses else t)
                    lemma_full = " ".join(lemma_pieces)
                    lemma_norm = normalize(lemma_full)
                    surface_norm = normalize(attested)
                    entry["greek_names"].append({
                        "surface": attested,
                        "lemma": lemma_full,
                        "lang": lang or "grc",
                        "key": lemma_norm,
                    })
                    entry["greek_keys"].add(lemma_norm)
                    entry["greek_keys"].add(surface_norm)
                    if len(tokens) > 1:
                        first_lemma_norm = normalize(lemma_pieces[0])
                        if first_lemma_norm:
                            entry["greek_keys"].add(first_lemma_norm)
                    grc_name_count += 1

            # Transliterated form (Latin-script). Always feed it to latin_keys —
            # this is the high-recall path for places without Greek attested names.
            if translit:
                entry["latin_keys"].add(translit.lower())
                latin_name_count += 1

    # Title is also a Latin-form key for every place
    for entry in places_meta.values():
        if entry["title"]:
            entry["latin_keys"].add(entry["title"].lower())

    print(f"  {grc_name_count} Greek-script names; {latin_name_count} transliterated names")
    print(f"  skipped (orphan pid): {skip_count}")

    # Persist lemma cache so future runs skip CLTK
    lem.save_cache()

    # Build output
    places_out: dict[str, dict] = {}
    greek_lemma_index: dict[str, list[str]] = {}
    latin_index: dict[str, list[str]] = {}
    for pid, entry in places_meta.items():
        latin_keys = sorted(entry["latin_keys"])
        greek_keys = sorted(entry["greek_keys"])
        if not latin_keys and not greek_keys:
            # No usable name surface; skip
            continue
        places_out[pid] = {
            "pleiades_id": entry["pleiades_id"],
            "pleiades_uri": entry["pleiades_uri"],
            "title": entry["title"],
            "feature_types": entry["feature_types"],
            "time_periods": entry["time_periods"],
            "lat": entry["lat"],
            "lon": entry["lon"],
            "greek_names": entry["greek_names"],
            "latin_keys": latin_keys,
            "greek_keys": greek_keys,
        }
        for k in greek_keys:
            greek_lemma_index.setdefault(k, []).append(pid)
        for k in latin_keys:
            latin_index.setdefault(k, []).append(pid)

    for k, ids in greek_lemma_index.items():
        greek_lemma_index[k] = sorted(set(ids))
    for k, ids in latin_index.items():
        latin_index[k] = sorted(set(ids))

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "schema_version": "0.2",
        "source": "pleiades-names-latest.csv.gz / pleiades-places-latest.csv.gz",
        "fetched_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "lemmatizer": "cltk.GreekBackoffLemmatizer" if lem.have_cltk else "diacriticless-fallback",
        "place_count": len(places_out),
        "greek_name_count": grc_name_count,
        "transliterated_name_count": latin_name_count,
        "greek_index_size": len(greek_lemma_index),
        "latin_index_size": len(latin_index),
        "places": places_out,
        "greek_lemma_index": greek_lemma_index,
        "latin_index": latin_index,
    }
    OUT_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=2))
    size_mb = OUT_PATH.stat().st_size / (1024 * 1024)
    print(f"\nGazetteer written: {OUT_PATH.relative_to(ROOT)} ({size_mb:.1f} MiB)")
    print(f"  places: {len(places_out)}")
    print(f"  greek_index keys: {len(greek_lemma_index)}")
    print(f"  latin_index  keys: {len(latin_index)}")

    # Spot-check via lemmas the survey will produce
    from scripts.galen.transliterate import variants
    print("\nSpot-check (Greek lemma → matched Pleiades title via Latin index):")
    for lemma in [
        "Λῆμνος", "Κύπρος", "Ῥώμη", "Πέργαμον", "Ἀλεξάνδρεια",
        "Παλαιστίνη", "Λυκία", "Συρία", "Κιλικία", "Ἀντιόχεια",
        "Σικελία", "Ἰταλία", "Καππαδοκία", "Σόλοι",
    ]:
        greek_norm = normalize(lemma)
        greek_hit = greek_lemma_index.get(greek_norm, [])
        latin_hit_pids: set[str] = set()
        for v in variants(lemma):
            latin_hit_pids.update(latin_index.get(v, []))
        sample = ", ".join(places_out[p]["title"] for p in list(latin_hit_pids)[:4])
        print(f"  {lemma!r:>14}  greek={len(greek_hit):>2}  latin={len(latin_hit_pids):>3}  samples: {sample}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
