"""Greek → Latin transliteration used to match Greek lemmata against Pleiades
titles and transliterated names (which are mostly Latin / scholarly-Hellenized).

Pleiades's Greek-script `nameAttested` field is sparse (~3000 of 42000 places),
so the most reliable cross-reference is title → Latin form. We generate a set
of Latin variants per Greek lemma to maximize recall:

  Λῆμνος   -> {"lemnos"}
  Κύπρος   -> {"kypros", "cypros", "kyprus", "cyprus"}
  Ῥώμη     -> {"rhome", "rhomai"}    # Roma is the Pleiades title
  Πέργαμον -> {"pergamon", "pergamum"}
  Λυκία    -> {"lykia", "lycia"}

Strategy: deterministic Greek → ASCII map (drop diacritics, no breathings) +
a small set of well-known variants (κ↔c, υ↔u, -ον↔-um, -ος↔-us, etc.).
"""
from __future__ import annotations

import unicodedata


_BASE_MAP = {
    "α": "a", "β": "b", "γ": "g", "δ": "d", "ε": "e", "ζ": "z",
    "η": "e", "θ": "th", "ι": "i", "κ": "k", "λ": "l", "μ": "m",
    "ν": "n", "ξ": "x", "ο": "o", "π": "p", "ρ": "r", "σ": "s",
    "ς": "s", "τ": "t", "υ": "y", "φ": "ph", "χ": "ch", "ψ": "ps",
    "ω": "o",
}


def _strip_diacritics(s: str) -> str:
    nfd = unicodedata.normalize("NFD", s)
    return "".join(c for c in nfd if unicodedata.category(c) != "Mn")


def _transliterate_letters(s: str) -> str:
    s = _strip_diacritics(s).lower()
    out: list[str] = []
    for ch in s:
        out.append(_BASE_MAP.get(ch, ch))
    return "".join(out)


def _detect_rough_breathing(original: str) -> bool:
    """True if original token starts with a rough-breathing rho or vowel.

    Rough breathing is the combining char U+0314 (̔). Used to add an 'h'
    prefix in scholarly transliterations: Ῥώμη → Rhome.
    """
    if not original:
        return False
    nfd = unicodedata.normalize("NFD", original)
    # Look at the first 3 characters of the NFD form for a breathing mark.
    for ch in nfd[:3]:
        if ch == "̔":  # combining reversed comma above (rough breathing)
            return True
    return False


def variants(lemma: str) -> list[str]:
    """Return a small set of Latin transliteration variants for a Greek lemma.

    All variants are lowercase ASCII. Designed to match Pleiades titles +
    transliterated names. Order is deterministic (sorted) so callers can
    cache results stably.
    """
    if not lemma:
        return []
    rough = _detect_rough_breathing(lemma)
    base = _transliterate_letters(lemma)
    if not base:
        return []

    candidates: set[str] = set()
    candidates.add(base)
    # Rough breathing -> "h" prefix on initial vowel or "rh" on initial r
    if rough:
        if base.startswith("r"):
            candidates.add("rh" + base[1:])
        elif base[0] in "aeiouy":
            candidates.add("h" + base)

    # κ ↔ c variants (Latinizing): swap initial 'k' or all 'k'
    def add_kc(form: str) -> set[str]:
        out = {form}
        if "k" in form:
            out.add(form.replace("k", "c"))
        return out

    def add_yu(form: str) -> set[str]:
        out = {form}
        if "y" in form:
            out.add(form.replace("y", "u"))
        return out

    def add_suffix(form: str) -> set[str]:
        out = {form}
        # -on -> -um (Pergamon -> Pergamum, Ilion -> Ilium)
        if form.endswith("on"):
            out.add(form[:-2] + "um")
        # -os -> -us (Lesbos -> Lesbus is rare; mostly preserved, but generate)
        if form.endswith("os"):
            out.add(form[:-2] + "us")
        # -e -> -a (Rhome -> Roma) — restricted, but useful
        if form.endswith("e") and len(form) >= 4:
            out.add(form[:-1] + "a")
        # -eia -> -ia (Alexandreia -> Alexandria, Antiocheia -> Antiochia)
        if form.endswith("eia"):
            out.add(form[:-3] + "ia")
        # -eias -> -ias (genitive of -eia)
        if form.endswith("eias"):
            out.add(form[:-4] + "ias")
        return out

    def add_ai_ae(form: str) -> set[str]:
        # Internal αι → ae (Παλαιστίνη → Palaestina, καῖσαρ → caesar)
        out = {form}
        if "ai" in form:
            out.add(form.replace("ai", "ae"))
        return out

    expanded = set(candidates)
    for f in candidates:
        expanded |= add_kc(f)
    candidates = expanded

    expanded = set(candidates)
    for f in candidates:
        expanded |= add_yu(f)
    candidates = expanded

    expanded = set(candidates)
    for f in candidates:
        expanded |= add_suffix(f)
    candidates = expanded

    expanded = set(candidates)
    for f in candidates:
        expanded |= add_ai_ae(f)
    candidates = expanded

    return sorted(c for c in candidates if c)
