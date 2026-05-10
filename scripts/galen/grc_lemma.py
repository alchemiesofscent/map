"""Greek lemmatizer wrapper with on-disk cache.

Wraps `cltk.lemmatize.grc.GreekBackoffLemmatizer`. Falls back gracefully when
CLTK is not installed: returns a single "lemma" that is the diacriticless
lowercase surface form, so downstream matching still works (with reduced
disambiguation).

Usage:

    from scripts.galen.grc_lemma import Lemmatizer
    lem = Lemmatizer()
    lem.lemmatize("Λῆμνον")  # -> ["Λῆμνος"]
    lem.lemmatize("ῥόδον")   # -> ["ῥόδον"]
    lem.save_cache()         # persist new entries to disk

The cache lives at `data/generated/galen/.lemma_cache.json` and is keyed by
surface form. Entries accumulate across runs.
"""
from __future__ import annotations

import json
import unicodedata
from pathlib import Path
from typing import Iterable

ROOT = Path(__file__).resolve().parents[2]
CACHE_PATH = ROOT / "data" / "generated" / "galen" / ".lemma_cache.json"


def strip_diacritics(s: str) -> str:
    nfd = unicodedata.normalize("NFD", s)
    return "".join(ch for ch in nfd if unicodedata.category(ch) != "Mn")


class Lemmatizer:
    def __init__(self, cache_path: Path = CACHE_PATH, use_cltk: bool = True) -> None:
        self.cache_path = cache_path
        self.cache: dict[str, list[str]] = {}
        self._dirty = False
        if cache_path.exists():
            try:
                self.cache = json.loads(cache_path.read_text())
            except json.JSONDecodeError:
                self.cache = {}
        self._cltk = None
        if use_cltk:
            try:
                from cltk.lemmatize.grc import GreekBackoffLemmatizer
                self._cltk = GreekBackoffLemmatizer()
            except Exception:
                self._cltk = None

    @property
    def have_cltk(self) -> bool:
        return self._cltk is not None

    def lemmatize(self, token: str) -> list[str]:
        """Return candidate lemmata for a single surface token.

        Empty input -> []. CLTK returns a single best lemma per token; we
        wrap that in a list to leave room for future multi-analysis returns.
        Cached.

        IMPORTANT: CLTK's Greek backoff lemmatizer is keyed on monotonic
        Greek (U+03xx). Polytonic precomposed characters in Greek Extended
        (U+1F00–U+1FFF) — common in 1stK TEI editions — return unchanged
        if passed in raw. We NFC-normalize the input to ensure consistent
        lookup, then store under the original surface so the cache can
        round-trip per-token.
        """
        if not token:
            return []
        if token in self.cache:
            return list(self.cache[token])
        # Normalize for CLTK lookup (polytonic → monotonic precomposed)
        nfc = unicodedata.normalize("NFC", token)
        out: list[str]
        if self._cltk is not None:
            try:
                pairs = self._cltk.lemmatize([nfc])
                out = [p[1] for p in pairs if p and p[1]]
            except Exception:
                out = []
            # If CLTK returned the input unchanged, treat that as no analysis
            # (the backoff lemmatizer's "give up" output) so we fall through
            # to the diacriticless fallback rather than caching the surface.
            if out and len(out) == 1 and out[0] == nfc:
                out = []
        else:
            out = []
        if not out:
            stripped = strip_diacritics(token).lower()
            if stripped:
                out = [stripped]
        self.cache[token] = out
        self._dirty = True
        return list(out)

    def lemmatize_many(self, tokens: Iterable[str]) -> list[list[str]]:
        return [self.lemmatize(t) for t in tokens]

    def save_cache(self) -> None:
        if not self._dirty:
            return
        self.cache_path.parent.mkdir(parents=True, exist_ok=True)
        self.cache_path.write_text(
            json.dumps(self.cache, ensure_ascii=False, sort_keys=True, indent=2)
        )
        self._dirty = False


# Module-level convenience for ad-hoc use; build a singleton lazily.
_default: Lemmatizer | None = None


def default() -> Lemmatizer:
    global _default
    if _default is None:
        _default = Lemmatizer()
    return _default


def lemmatize(token: str) -> list[str]:
    return default().lemmatize(token)


def save_cache() -> None:
    if _default is not None:
        _default.save_cache()
