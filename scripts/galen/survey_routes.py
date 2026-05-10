#!/usr/bin/env python3
"""Survey Galen TEI for candidate route passages (v2: Pleiades-seeded).

Walks both TEI files (SMT = tlg075, De antidotis = tlg078) in document order,
tracking Kühn citations (volume + page from <pb>, line counted via <lb>) and
the textpart hierarchy (book.chapter[.section]).

Differences vs v1:
- Place detection uses CLTK Greek lemmatization + the Pleiades-seeded gazetteer
  (data/generated/galen/pleiades_gazetteer.json) with curator overrides from
  data/galen/lexicon/places.json. Capitalized tokens not in the persons lexicon
  are checked against both the Greek lemma index and (via Greek→Latin
  transliteration) the Latin/title index of Pleiades.
- Emits annotated TEI copies under data/tei/annotated/ with <placeName
  ref="..." cert="..."/> wrapping detected mentions. Original TEI files are
  not modified.
- Emits curator review surfaces docs/galen_unmatched_capitals.md and
  docs/galen_ambiguous_places.md alongside the existing route_candidates files.

Outputs:
  data/tei/annotated/tlg0057.tlg075.annotated.xml
  data/tei/annotated/tlg0057.tlg078.annotated.xml
  data/generated/galen/place_mentions.json
  data/generated/galen/route_candidates.json
  docs/galen_route_candidates.md
  docs/galen_unmatched_capitals.md
  docs/galen_ambiguous_places.md
"""
from __future__ import annotations

import json
import re
import unicodedata
import xml.etree.ElementTree as ET
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from pathlib import Path

from scripts.galen.grc_lemma import Lemmatizer, strip_diacritics
from scripts.galen.transliterate import variants as latin_variants

ROOT = Path(__file__).resolve().parents[2]
TEI_DIR = ROOT / "data" / "tei"
ANNOT_DIR = ROOT / "data" / "tei" / "annotated"
GEN_DIR = ROOT / "data" / "generated" / "galen"
DOCS_DIR = ROOT / "docs"
GAZETTEER_PATH = GEN_DIR / "pleiades_gazetteer.json"
LEXICON_DIR = ROOT / "data" / "galen" / "lexicon"

TEI_NS = "http://www.tei-c.org/ns/1.0"
TEI = "{" + TEI_NS + "}"
ET.register_namespace("", TEI_NS)


WORKS = [
    {
        "work": "SMT",
        "file": "tlg0057.tlg075.1st1K-grc1.xml",
        "annotated_file": "tlg0057.tlg075.annotated.xml",
        "kuhn_volume_for_book": lambda n: "XI" if int(n) <= 5 else "XII",
        "tei_id": "urn:cts:greekLit:tlg0057.tlg075.1st1K-grc1",
    },
    {
        "work": "De_antidotis",
        "file": "tlg0057.tlg078.1st1K-grc1.xml",
        "annotated_file": "tlg0057.tlg078.annotated.xml",
        "kuhn_volume_for_book": lambda n: "XIV",
        "tei_id": "urn:cts:greekLit:tlg0057.tlg078.1st1K-grc1",
    },
]


# ---------------------------------------------------------------------------
# First-person verb lexicon (carried over from v1; place detection is what
# changed).
# ---------------------------------------------------------------------------

FIRST_PERSON_VERBS: dict[str, str] = {
    "επορευθην": "movement",
    "επλευσα": "movement",
    "εισεπλευσα": "movement",
    "ανεπλευσα": "movement",
    "απεπλευσα": "movement",
    "διεπλευσα": "movement",
    "παρεπλευσα": "movement",
    "αφικομην": "movement",
    "ηκον": "movement",
    "διηλθον": "movement",
    "επεδημησα": "movement",
    "διετριψα": "movement",
    "παρεγενομην": "movement",
    "παρην": "movement",
    "ανηλθον": "movement",
    "κατηλθον": "movement",
    "εξηλθον": "movement",
    "ηλθον": "movement",
    "επανηλθον": "movement",
    "απηλθον": "movement",
    "ωρμησα": "movement",
    "ανεβην": "movement",
    "κατεβην": "movement",
    "εχωρησα": "movement",
    "απεχωρησα": "movement",
    "εβαδισα": "movement",
    "εβαδιζον": "movement",
    "ηπειγομην": "movement",
    "ειδον": "autopsy",
    "εθεασαμην": "autopsy",
    "εθεωρησα": "autopsy",
    "κατενοησα": "autopsy",
    "παρεθεασαμην": "autopsy",
    "εωρακα": "autopsy",
    "εκομισα": "acquisition",
    "εκομισαμην": "acquisition",
    "ανεκομισα": "acquisition",
    "ελαβον": "acquisition",
    "ευρον": "acquisition",
    "εχρησαμην": "acquisition",
    "εσκευασαμην": "acquisition",
    "επριαμην": "acquisition",
    "εσκεψαμην": "acquisition",
    "εποιησαμην": "acquisition",
    "ηγαγον": "acquisition",
}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def normalize_key(s: str) -> str:
    nfd = unicodedata.normalize("NFD", s)
    stripped = "".join(c for c in nfd if unicodedata.category(c) != "Mn")
    return stripped.lower().strip()


# Greek-letter ranges used to detect proper-noun candidates and to tokenize.
GREEK_RANGES = (
    (0x0370, 0x03FF),
    (0x1F00, 0x1FFF),
)


def is_greek_letter(ch: str) -> bool:
    if not ch:
        return False
    cp = ord(ch)
    if cp in (0x02BC,):  # modifier apostrophe sometimes used as elision mark
        return False
    if "A" <= ch <= "Z" or "a" <= ch <= "z":
        return False
    for lo, hi in GREEK_RANGES:
        if lo <= cp <= hi:
            return True
    return False


def is_uppercase_greek(ch: str) -> bool:
    if not ch:
        return False
    if "A" <= ch <= "Z":
        return True
    base = strip_diacritics(ch)
    if not base:
        return False
    return base.isupper() and is_greek_letter(base)


# Tokenizer: a token is a maximal run of Greek letters (with diacritics
# preserved) plus the elision mark ' / ’ that classics editions use.
# Range covers the full Greek+Coptic block (U+0370–U+03FF) and Greek
# Extended (U+1F00–U+1FFF). NB: the literal char Ͽ is U+037F, not U+03FF,
# so the previous regex `[Ͱ-Ͽἀ-῿]` silently dropped κ/π/ρ/etc. Use explicit
# escapes.
GREEK_CHARCLASS = "\u0370-\u03ff\u1f00-\u1fff"
TOKEN_RE = re.compile(rf"[{GREEK_CHARCLASS}]+(?:[ʼ'’][{GREEK_CHARCLASS}]+)*")


# Sentence-start function words and grammatical particles that get capitalized
# only because they're at the start of a sentence/colon — not proper nouns.
# Stored as diacriticless lowercase (matches normalize_key).
GRAMMATICAL_STOPLIST: set[str] = {
    # prepositions
    "περι", "προς", "δια", "εν", "εκ", "εξ", "επι", "υπο", "υπερ", "παρα",
    "κατα", "μετα", "προ", "συν", "ξυν", "ανα", "αμφι", "αντι", "απο",
    # conjunctions / adverbs
    "και", "ει", "εαν", "ινα", "οτε", "οταν", "οπερ", "ωσπερ", "ωσαυτως",
    "ουτως", "ουτος", "αρα", "γαρ", "δε", "δι", "ουν", "μεν", "οτι", "ως",
    "εως", "οπως", "αλλα", "πλην", "ομως",
    # pronouns / demonstratives (already in 1p list, but sentence-start uses too)
    "εγω", "ημεις", "ημων", "ημιν", "ημας",
    "εμοι", "εμε", "εμου", "ημετερ",
    "εκεινος", "εκεινου", "εκεινον", "εκεινη", "εκεινους", "εκεινα",
    "ουτος", "ουτου", "τουτου", "τουτον", "ταυτα", "τουτο", "τουτων",
    "οστις", "οσον", "οσοι",
    # articles in any case
    "ο", "η", "το", "οι", "αι", "τα", "του", "της", "των", "τω", "τη",
    "τον", "την",
    # very common verbs whose 1sg/finite forms get sentence-start capitalized
    "εστι", "εισι", "εστιν", "εισιν", "εν", "ην", "ησαν",
    # imperatives / recipe headers (book-titling)
    "σκευαζε", "ποιει", "λαμβανε", "λεγε", "λεγει",
    # generic chapter/recipe header nouns
    "αντιδοτος", "αντιδοτου", "αντιδοτον", "αντιδοτων",
    "ονομαζομενη", "ονομαζομενος", "ονομαζομενον",
    "βιβλιον", "βιβλιου", "βιβλια",
    "γαλην", "γαληνου",  # author tag in headers
    "απλων", "απλος",     # "simple" in book titles
    "δις", "τρις", "ολιγον",
    "αλλη", "αλλου", "αλλα", "αλλος",
    # ethnonym adjectives that often head a "BRAND substance" recipe — these
    # are category-B (region context) and shouldn't trigger a hit in route
    # candidates without a co-occurring travel verb anyway. Listed here so
    # they don't pollute the unmatched_capitals review.
    "ποντικος", "ποντικου", "ποντικον",
    "κρητικος", "κρητικου", "κρητικον", "κρητικη",
    "αττικος", "αττικου", "αττικον", "αττικη",
    "αιθιοπικος", "αιθιοπικου", "αιθιοπικον",
    "κελτικη", "κελτικος",
    "κυρηναικος", "κυρηναικου",
    "ινδικος", "ινδικη", "ινδικον",
    "ιλλυρικη", "ιλλυρικος",
    "ιουδαικος", "ιουδαικη",
    "συριακος", "συριακη",
    "λημνιος", "λημνιας", "λημνια",  # ethnonym; the Lemnian-earth signal still
    # comes through the place name Λῆμνος elsewhere in the same sentence.
    "σμυρνης",  # Σμύρνα = myrrh (homonym with Smyrna); excluded from places
    # Common Greek nouns that get capitalized as recipe-section headers but
    # collide with Pleiades title-fragments under transliteration.
    "εργαστηρια", "εργαστηριον", "εργαστηριου",  # workshops
    "ηφαιστιαδα", "ηφαιστιας",   # epithet (of Lemnos)
    "καμινου", "καμινον",  # furnace
    "μεταλλον", "μεταλλου", "μεταλλω",
    "πολις", "πολεως", "πολιν",
    "ορος", "ορη",
    "ιστορια", "ιστοριας",
    "δυναμις", "δυναμιν",
    "ποιοτης", "ποιοτητος",
    # Drug / mineral names; some incidentally match Pleiades small-place titles
    "διφρυγες", "διφρυγους", "διφρυγος",
    "καδμεια", "καδμειαν", "καδμειας",
    "μολυβδαινα", "μολυβδαιναν",
    "πομφολυξ", "πομφολυγος",
    "σανδαρακη", "σανδαρακης",
    "χαλκιτις", "χαλκιτιν",
    "τιτανος", "τιτανου",  # lime
    "ιος", "ιου",  # rust / verdigris
    # Ethnonym noun
    "ελληνες", "ελληνας", "ελληνων",
}


# All-caps detection: a token of length >= 3 where every base Greek letter is
# uppercase indicates a header (e.g. ΓΑΛΗΝΟΥ, ΠΕΡΙ, ΒΙΒΛΙΟΝ).
def is_all_caps(token: str) -> bool:
    if len(token) < 3:
        return False
    base = strip_diacritics(token)
    letters = [c for c in base if c.isalpha()]
    return bool(letters) and all(c.isupper() for c in letters)


def has_initial_capital_only(token: str) -> bool:
    """True if first letter is uppercase and the rest aren't all uppercase."""
    if not token:
        return False
    base = strip_diacritics(token)
    return bool(base) and base[0].isupper() and not all(c.isupper() for c in base if c.isalpha())


# ---------------------------------------------------------------------------
# Gazetteer / lexicon loading
# ---------------------------------------------------------------------------

@dataclass
class Gazetteer:
    places: dict[str, dict]
    greek_lemma_index: dict[str, list[str]]
    latin_index: dict[str, list[str]]
    person_lemmata: set[str]
    person_surface: set[str]
    curator_overrides: list[dict]
    curator_lemma_index: dict[str, list[str]] = field(default_factory=dict)

    @classmethod
    def load(cls) -> "Gazetteer":
        gaz = json.loads(GAZETTEER_PATH.read_text())
        persons_path = LEXICON_DIR / "persons.json"
        places_lex_path = LEXICON_DIR / "places.json"
        persons = json.loads(persons_path.read_text()) if persons_path.exists() else []
        places_overrides = json.loads(places_lex_path.read_text()) if places_lex_path.exists() else []

        person_lemmata: set[str] = set()
        person_surface: set[str] = set()
        for p in persons:
            for n in p.get("greek_names", []):
                person_lemmata.add(normalize_key(n))
                person_surface.add(normalize_key(n))

        curator_lemma_index: dict[str, list[str]] = {}
        for entry in places_overrides:
            keys: set[str] = set()
            for n in entry.get("ancient_names_in_galen", []):
                if isinstance(n, dict):
                    keys.add(normalize_key(n.get("surface", "")))
                elif isinstance(n, str):
                    keys.add(normalize_key(n))
            for k in keys:
                if k:
                    curator_lemma_index.setdefault(k, []).append(entry["place_key"])

        return cls(
            places=gaz["places"],
            greek_lemma_index=gaz["greek_lemma_index"],
            latin_index=gaz["latin_index"],
            person_lemmata=person_lemmata,
            person_surface=person_surface,
            curator_overrides=places_overrides,
            curator_lemma_index=curator_lemma_index,
        )

    def is_person(self, lemma: str, surface: str) -> bool:
        if normalize_key(lemma) in self.person_lemmata:
            return True
        if normalize_key(surface) in self.person_surface:
            return True
        # Stem prefix match for inflected forms not analysed by CLTK.
        # Match if a known person nominative shares its stem (≥5 chars) with
        # the input. e.g. Ἀνδρομάχου (CLTK no-op) → stem ανδρομαχ → matches
        # ανδρομαχος (Andromachus).
        nl = normalize_key(lemma) or normalize_key(surface)
        if not nl or len(nl) < 5:
            return False
        for pl in self.person_lemmata:
            stem_len = min(len(pl) - 1, len(nl) - 1, 8)
            if stem_len < 5:
                continue
            if nl[:stem_len] == pl[:stem_len]:
                return True
        return False

    def lookup(self, lemma: str) -> tuple[str, list[str]]:
        """Return (match_type, list_of_pleiades_ids).

        match_type: 'greek' (exact Greek-script lemma match), 'latin' (matched
        via transliteration), 'none'. Curator overrides return type 'curator'.
        """
        lemma_norm = normalize_key(lemma)
        if not lemma_norm:
            return "none", []
        if lemma_norm in self.curator_lemma_index:
            return "curator", list(self.curator_lemma_index[lemma_norm])
        ids = self.greek_lemma_index.get(lemma_norm)
        if ids:
            return "greek", list(ids)
        for v in latin_variants(lemma):
            ids = self.latin_index.get(v)
            if ids:
                return "latin", list(ids)
        return "none", []


# ---------------------------------------------------------------------------
# TEI walking with sentence assembly + inline annotation
# ---------------------------------------------------------------------------

@dataclass
class Mention:
    surface: str
    lemma: str
    pleiades_ids: list[str]
    match_type: str  # 'greek' | 'latin' | 'curator' | 'ambiguous'
    cert: str        # 'secure' | 'probable' | 'ambiguous'


@dataclass
class Sentence:
    work: str
    book: str
    chapter: str | None
    section: str | None
    kuhn_volume: str
    kuhn_page_start: int
    kuhn_line_start: int
    kuhn_page_end: int
    kuhn_line_end: int
    greek: str
    place_mentions: list[Mention] = field(default_factory=list)
    verb_hits: list[tuple[str, str]] = field(default_factory=list)  # (form, category)

    @property
    def kuhn_citation(self) -> str:
        if self.kuhn_page_start == self.kuhn_page_end:
            if self.kuhn_line_start == self.kuhn_line_end:
                return f"K. {self.kuhn_volume} {self.kuhn_page_start}.{self.kuhn_line_start}"
            return f"K. {self.kuhn_volume} {self.kuhn_page_start}.{self.kuhn_line_start}–{self.kuhn_line_end}"
        return (
            f"K. {self.kuhn_volume} {self.kuhn_page_start}.{self.kuhn_line_start}–"
            f"{self.kuhn_page_end}.{self.kuhn_line_end}"
        )

    @property
    def chapter_ref(self) -> str:
        parts = [self.book]
        if self.chapter:
            parts.append(self.chapter)
        if self.section:
            parts.append(self.section)
        return ".".join(parts)

    @property
    def is_hit(self) -> bool:
        return bool(self.place_mentions) and bool(self.verb_hits)


def detect_token_spans_in_text(
    text: str,
    lem: Lemmatizer,
    gaz: Gazetteer,
    capitalized_unmatched: Counter,
) -> list[tuple[int, int, Mention]]:
    """Find token positions in `text` that match a place lookup.

    Returns a list of (start, end, Mention) sorted by start.
    Side-effect: updates `capitalized_unmatched` with capitalized tokens that
    didn't match anything (potential missed places).

    Lookup order (first match wins):
      1. Multi-word curator lexicon match anywhere in `text` (catches phrases
         like Coele Syria, Alexandria Troas, νεκρὰ θάλασσα).
      2. Per-token curator lookup — explicit lexicon entries beat the
         grammatical stoplist (so Ergasteria / Hephaistia register as places
         even though their lemmata sit in the stoplist as common nouns).
      3. Per-token stoplist + person filter + Pleiades lookup (greek/latin).
    """
    spans: list[tuple[int, int, Mention]] = []
    consumed: list[tuple[int, int]] = []  # (start, end) ranges already wrapped

    def overlaps_consumed(s: int, e: int) -> bool:
        return any(not (e <= cs or s >= ce) for cs, ce in consumed)

    # ---- Phase 1: multi-word curator entries -----------------------------
    norm_text = normalize_key(text)
    for key, place_keys in gaz.curator_lemma_index.items():
        if " " not in key:
            continue  # single-token entries handled in phase 2
        idx = 0
        while True:
            pos = norm_text.find(key, idx)
            if pos < 0:
                break
            # Map the normalized position back to original text. Since
            # normalize_key strips combining marks but preserves base char
            # count for our purposes (and lowercases Latin/Greek 1:1), the
            # offsets align — but to be safe we walk and find the
            # corresponding span by re-normalizing prefixes. For pragmatic
            # speed: search the original (case-insensitive, diacritic-blind)
            # using the first char of the key as an anchor.
            # Simpler: search original text for any case/diacritic variant
            # whose normalize_key equals the key.
            # Implementation: scan original text characters until the
            # accumulated normalized prefix length matches `pos`.
            orig_start = _norm_offset_to_original(text, pos)
            orig_end = _norm_offset_to_original(text, pos + len(key))
            if orig_start is None or orig_end is None:
                idx = pos + 1
                continue
            ids = list(place_keys)  # curator place_keys, not Pleiades ids
            mention = Mention(
                surface=text[orig_start:orig_end],
                lemma=key,
                pleiades_ids=ids,
                match_type="curator",
                cert="secure" if len(ids) == 1 else "ambiguous",
            )
            spans.append((orig_start, orig_end, mention))
            consumed.append((orig_start, orig_end))
            idx = pos + len(key)

    # ---- Phase 2 & 3: per-token --------------------------------------------
    for m in TOKEN_RE.finditer(text):
        token = m.group(0)
        if not token:
            continue
        if overlaps_consumed(m.start(), m.end()):
            continue
        if is_all_caps(token):
            continue
        if not has_initial_capital_only(token):
            continue
        if len(strip_diacritics(token)) < 3:
            continue
        analyses = lem.lemmatize(token)
        lemma = analyses[0] if analyses else token

        # Phase 2: curator override first (bypasses stoplist + person filter)
        match_type, ids = gaz.lookup(lemma)
        if match_type == "curator":
            cert = "secure" if len(ids) == 1 else "ambiguous"
            spans.append(
                (m.start(), m.end(), Mention(
                    surface=token, lemma=lemma, pleiades_ids=ids,
                    match_type="curator", cert=cert,
                ))
            )
            continue

        # Phase 3: normal pipeline
        norm = normalize_key(token)
        if norm in GRAMMATICAL_STOPLIST or normalize_key(lemma) in GRAMMATICAL_STOPLIST:
            continue
        if gaz.is_person(lemma, token):
            continue
        if not ids:
            capitalized_unmatched[token] += 1
            continue
        cert = "secure" if (match_type == "greek" and len(ids) == 1) else (
            "probable" if (match_type == "latin" and len(ids) == 1) else "ambiguous"
        )
        spans.append(
            (m.start(), m.end(), Mention(
                surface=token, lemma=lemma, pleiades_ids=ids,
                match_type=match_type if cert != "ambiguous" else "ambiguous",
                cert=cert,
            ))
        )

    spans.sort(key=lambda t: t[0])
    return spans


def _norm_offset_to_original(text: str, norm_pos: int) -> int | None:
    """Map a position in normalize_key(text) back to a position in text.

    normalize_key strips combining marks and lowercases; we walk the original
    text character-by-character, tracking the normalized cumulative length,
    until we hit norm_pos. Whitespace runs collapse to a single space in the
    normalized form, mirrored here.
    """
    nfd_buf = []
    i = 0
    n = len(text)
    norm_len = 0
    last_was_space = False
    # Walk and find the original index whose normalized prefix is norm_pos.
    while i < n:
        if norm_len == norm_pos:
            return i
        ch = text[i]
        if ch.isspace():
            if not last_was_space and norm_len > 0:
                norm_len += 1  # collapsed single space
                last_was_space = True
            i += 1
            continue
        last_was_space = False
        # Compute normalized contribution of this char
        nfd = unicodedata.normalize("NFD", ch)
        for sub in nfd:
            if unicodedata.category(sub) == "Mn":
                continue
            norm_len += 1
        i += 1
    if norm_len == norm_pos:
        return n
    return None


def annotate_run(
    text: str,
    spans: list[tuple[int, int, Mention]],
) -> tuple[str, list[ET.Element]]:
    """Wrap detected spans in <placeName>; return (text_before_first_span,
    list_of_inserted_children_with_tails)."""
    if not spans:
        return text, []
    children: list[ET.Element] = []
    leading = text[: spans[0][0]]
    for i, (start, end, mention) in enumerate(spans):
        token = text[start:end]
        ref = " ".join(f"https://pleiades.stoa.org/places/{p}" for p in mention.pleiades_ids)
        pn = ET.Element(TEI + "placeName", attrib={"ref": ref, "cert": mention.cert})
        pn.text = token
        next_start = spans[i + 1][0] if i + 1 < len(spans) else len(text)
        pn.tail = text[end:next_start]
        children.append(pn)
    return leading, children


@dataclass
class WalkState:
    work: str
    book: str | None = None
    chapter: str | None = None
    section: str | None = None
    page: int | None = None
    line: int = 0
    buf: list[str] = field(default_factory=list)
    buf_start: tuple[int | None, int] = (None, 0)
    sentences: list[Sentence] = field(default_factory=list)
    work_spec: dict | None = None


SENT_TERMINATORS = ".·;"


def push_text(state: WalkState, s: str | None) -> None:
    if not s:
        return
    if not state.buf:
        state.buf_start = (state.page, state.line)
    state.buf.append(s)


def flush_buffer(state: WalkState) -> None:
    text = " ".join(state.buf).strip()
    state.buf = []
    if not text:
        return
    # Split on sentence terminators while preserving them
    pieces = re.split(r"(?<=[.·;])\s+", text)
    for raw in pieces:
        raw = re.sub(r"\s+", " ", raw).strip()
        if not raw:
            continue
        page_s, line_s = state.buf_start if state.buf_start[0] else (state.page, state.line)
        if page_s is None:
            page_s = state.page or 0
        sent = Sentence(
            work=state.work,
            book=str(state.book or "?"),
            chapter=str(state.chapter) if state.chapter else None,
            section=str(state.section) if state.section else None,
            kuhn_volume=(
                state.work_spec["kuhn_volume_for_book"](state.book)
                if state.work_spec and state.book and state.book.isdigit()
                else "?"
            ),
            kuhn_page_start=page_s or 0,
            kuhn_line_start=line_s,
            kuhn_page_end=state.page or 0,
            kuhn_line_end=state.line,
            greek=raw,
        )
        state.sentences.append(sent)
    state.buf_start = (state.page, state.line)


def walk_to_sentences(work_spec: dict, tree: ET.ElementTree) -> list[Sentence]:
    """First pass: walk TEI to build the sentence list with Kühn citations.

    Pure read; no mutation. Sentence boundaries are `.`/`·`/`;`. Each
    sentence carries an empty place_mentions / verb_hits list to be filled
    by the detection pass.
    """
    root = tree.getroot()
    body = root.find(f".//{TEI}text/{TEI}body")
    if body is None:
        return []
    edition = body.find(f"{TEI}div")
    if edition is None:
        return []

    state = WalkState(work=work_spec["work"], work_spec=work_spec)
    div_stack: list[str] = []

    def walk(node: ET.Element):
        nonlocal div_stack
        opened_div = False
        if node.tag == TEI + "div" and node.get("type") == "textpart":
            n = node.get("n") or "?"
            depth = len(div_stack)
            flush_buffer(state)
            if depth == 0:
                state.book = n; state.chapter = None; state.section = None
            elif depth == 1:
                state.chapter = n; state.section = None
            elif depth == 2:
                state.section = n
            div_stack.append(n)
            opened_div = True
        elif node.tag == TEI + "pb":
            n = node.get("n")
            if n is not None:
                try:
                    state.page = int(n)
                    state.line = 0
                except ValueError:
                    pass
        elif node.tag == TEI + "lb":
            state.line += 1
        push_text(state, node.text)
        for child in list(node):
            walk(child)
            push_text(state, child.tail)
        if opened_div:
            flush_buffer(state)
            div_stack.pop()
            depth = len(div_stack)
            if depth == 0:
                state.book = None; state.chapter = None; state.section = None
            elif depth == 1:
                state.chapter = None; state.section = None
            elif depth == 2:
                state.section = None

    walk(edition)
    flush_buffer(state)
    return state.sentences


def detect_in_sentences(
    sentences: list[Sentence],
    lem: Lemmatizer,
    gaz: Gazetteer,
    capitalized_unmatched: Counter,
) -> None:
    """Second pass: scan each sentence's greek text for place + verb hits.

    Mutates sentences in place by populating place_mentions and verb_hits.
    """
    for s in sentences:
        spans = detect_token_spans_in_text(s.greek, lem, gaz, capitalized_unmatched)
        # Deduplicate by (lemma, sorted pleiades_ids tuple) within a sentence
        seen: set[tuple[str, tuple[str, ...]]] = set()
        for _start, _end, mention in spans:
            key = (mention.lemma, tuple(sorted(mention.pleiades_ids)))
            if key in seen:
                continue
            seen.add(key)
            s.place_mentions.append(mention)
        # First-person verb detection
        norm = normalize_key(s.greek)
        for form, category in FIRST_PERSON_VERBS.items():
            if re.search(rf"(?:^|[^{GREEK_CHARCLASS}]){re.escape(form)}(?![{GREEK_CHARCLASS}])", norm):
                s.verb_hits.append((form, category))


def annotate_tree(
    tree: ET.ElementTree,
    lem: Lemmatizer,
    gaz: Gazetteer,
    capitalized_unmatched: Counter,
) -> None:
    """Third pass: walk tree and inject <placeName ref> wrappers around
    detected mentions in every text/tail run. Mutates the tree in place.

    Uses the same detection function as the sentence pass — re-runs it on
    each text fragment. The lemma cache makes this fast.
    """
    root = tree.getroot()

    def annotate(elem: ET.Element):
        # Process elem.text: insert any new <placeName> children at front
        if elem.text:
            spans = detect_token_spans_in_text(elem.text, lem, gaz, capitalized_unmatched)
            new_text, inserted = annotate_run(elem.text, spans)
            elem.text = new_text
            for j, ins in enumerate(inserted):
                elem.insert(j, ins)
        # Recurse into ORIGINAL children (snapshot, since we may insert siblings).
        original_children = [c for c in list(elem) if c.tag != TEI + "placeName"]
        for child in original_children:
            annotate(child)
            if child.tail:
                spans = detect_token_spans_in_text(child.tail, lem, gaz, capitalized_unmatched)
                new_tail, inserted = annotate_run(child.tail, spans)
                child.tail = new_tail
                if inserted:
                    idx = list(elem).index(child)
                    for j, ins in enumerate(inserted):
                        elem.insert(idx + 1 + j, ins)

    annotate(root)


def process_work(
    work_spec: dict,
    lem: Lemmatizer,
    gaz: Gazetteer,
    capitalized_unmatched: Counter,
) -> tuple[ET.ElementTree, list[Sentence]]:
    path = TEI_DIR / work_spec["file"]
    tree = ET.parse(path)
    sentences = walk_to_sentences(work_spec, tree)
    detect_in_sentences(sentences, lem, gaz, capitalized_unmatched)
    annotate_tree(tree, lem, gaz, capitalized_unmatched)
    return tree, sentences


# ---------------------------------------------------------------------------
# Clustering
# ---------------------------------------------------------------------------

@dataclass
class Candidate:
    work: str
    book: str
    chapter: str | None
    sentences: list[Sentence] = field(default_factory=list)


def cluster_hits(sentences: list[Sentence], gap_tolerance: int = 1) -> list[Candidate]:
    candidates: list[Candidate] = []
    current: Candidate | None = None
    gap = 0
    for s in sentences:
        same_chapter = (
            current is not None
            and current.work == s.work
            and current.book == s.book
            and current.chapter == s.chapter
        )
        if s.is_hit:
            if current and same_chapter:
                current.sentences.append(s)
                gap = 0
            else:
                if current and current.sentences:
                    candidates.append(current)
                current = Candidate(work=s.work, book=s.book, chapter=s.chapter, sentences=[s])
                gap = 0
        else:
            if current and same_chapter and gap < gap_tolerance:
                current.sentences.append(s)
                gap += 1
            elif current:
                candidates.append(current)
                current = None
                gap = 0
    if current and current.sentences:
        candidates.append(current)
    return [c for c in candidates if any(s.place_mentions for s in c.sentences)]


# ---------------------------------------------------------------------------
# Output
# ---------------------------------------------------------------------------

def candidate_to_dict(c: Candidate) -> dict:
    seen_ids: set[str] = set()
    places_in_order: list[dict] = []
    for s in c.sentences:
        for m in s.place_mentions:
            tag = "+".join(m.pleiades_ids)
            if tag in seen_ids:
                continue
            seen_ids.add(tag)
            places_in_order.append(
                {
                    "surface": m.surface,
                    "lemma": m.lemma,
                    "pleiades_ids": m.pleiades_ids,
                    "match_type": m.match_type,
                    "cert": m.cert,
                }
            )
    verbs = sorted({(v[0], v[1]) for s in c.sentences for v in s.verb_hits})
    first, last = c.sentences[0], c.sentences[-1]
    return {
        "work": c.work,
        "book": c.book,
        "chapter": c.chapter,
        "chapter_ref": ".".join(p for p in [c.book, c.chapter] if p),
        "kuhn_citation_start": first.kuhn_citation,
        "kuhn_citation_end": last.kuhn_citation,
        "places_in_order": places_in_order,
        "first_person_verbs": [{"form": f, "category": cat} for f, cat in verbs],
        "sentence_count": len(c.sentences),
        "sentences": [
            {
                "kuhn_citation": s.kuhn_citation,
                "chapter_ref": s.chapter_ref,
                "greek": s.greek,
                "is_hit": s.is_hit,
                "place_mentions": [
                    {
                        "surface": m.surface,
                        "lemma": m.lemma,
                        "pleiades_ids": m.pleiades_ids,
                        "match_type": m.match_type,
                        "cert": m.cert,
                    }
                    for m in s.place_mentions
                ],
                "verb_hits": [{"form": f, "category": cat} for f, cat in s.verb_hits],
            }
            for s in c.sentences
        ],
    }


def render_candidates_md(candidates_by_work: dict[str, list[Candidate]], gaz: Gazetteer) -> str:
    lines: list[str] = []
    lines.append("# Galen route candidates — Stage 2 v2 checkpoint")
    lines.append("")
    lines.append("Auto-generated by `scripts/galen/survey_routes.py`. Each section below is a")
    lines.append("**candidate route segment**: a contiguous run of sentences (within a single")
    lines.append("book.chapter) where Galen pairs first-person travel/autopsy/acquisition")
    lines.append("language with named places. Place detection: CLTK Greek lemmatizer + Pleiades")
    lines.append("(greek_lemma_index + Latin/title transliteration variants) + curator")
    lines.append("`data/galen/lexicon/places.json` overrides.")
    lines.append("")
    lines.append("**Action requested**: for each candidate, record an **ACCEPT**, **REJECT**,")
    lines.append("or **MERGE WITH ...** decision in **`docs/galen_route_decisions.md`**.")
    lines.append("That file is hand-authored and is **not** regenerated by the survey, so")
    lines.append("decisions there persist across re-runs. Do not write decisions inline in")
    lines.append("this document — it is overwritten whenever `survey_routes.py` runs.")
    lines.append("")
    lines.append("Also review:")
    lines.append("- `docs/galen_unmatched_capitals.md` — capitalized lemmata with no Pleiades")
    lines.append("  match. Confirm none are obvious place misses.")
    lines.append("- `docs/galen_ambiguous_places.md` — mentions resolving to multiple Pleiades")
    lines.append("  IDs. Pick the right ID for each (or mark unresolved).")
    lines.append("")
    total = sum(len(cs) for cs in candidates_by_work.values())
    lines.append(f"**Total candidate segments**: {total}")
    lines.append("")
    lines.append("> **Curator decisions live in `docs/galen_route_decisions.md`** — that file")
    lines.append("> is hand-authored and never overwritten by the survey. This file (the")
    lines.append("> auto-generated candidates) is regenerated whenever `survey_routes.py`")
    lines.append("> runs, which is why we don't write decisions inline here.")
    lines.append("")
    for work, cands in candidates_by_work.items():
        lines.append(f"## {work} — {len(cands)} candidate(s)")
        lines.append("")
        for i, c in enumerate(cands, 1):
            chapter_ref = ".".join(p for p in [c.book, c.chapter] if p)
            first, last = c.sentences[0], c.sentences[-1]
            lines.append(f"### {work} candidate {i}: {chapter_ref} ({first.kuhn_citation} – {last.kuhn_citation})")
            lines.append("")
            seen: set[str] = set()
            place_summary: list[str] = []
            for s in c.sentences:
                for m in s.place_mentions:
                    tag = "+".join(m.pleiades_ids)
                    if tag in seen:
                        continue
                    seen.add(tag)
                    titles = [gaz.places[pid]["title"] for pid in m.pleiades_ids if pid in gaz.places]
                    if not titles:
                        # curator override may not be in gaz.places; show place_key
                        titles = m.pleiades_ids
                    label = f"{m.surface} → {' / '.join(titles[:3])}"
                    if len(m.pleiades_ids) > 1:
                        label += f" [ambiguous, {len(m.pleiades_ids)} candidates]"
                    place_summary.append(label)
            lines.append(f"- **Places**: {'; '.join(place_summary) or '(none)'}")
            verbs = sorted({(v[0], v[1]) for s in c.sentences for v in s.verb_hits})
            lines.append(f"- **First-person verbs**: {', '.join(f'{f} ({cat})' for f, cat in verbs) or '(none)'}")
            lines.append(f"- **Sentence count**: {len(c.sentences)}")
            lines.append("")
            lines.append("**Greek excerpt:**")
            lines.append("")
            for s in c.sentences:
                marker = " ←" if s.is_hit else ""
                lines.append(f"> [{s.kuhn_citation}]{marker} {s.greek}")
            lines.append("")
            lines.append("**Decision:** ☐ ACCEPT  ☐ REJECT  ☐ MERGE WITH __  ☐ NOTES: __")
            lines.append("")
    return "\n".join(lines) + "\n"


def render_unmatched_md(counter: Counter, threshold: int = 3) -> str:
    items = [(tok, n) for tok, n in counter.items() if n >= threshold]
    items.sort(key=lambda kv: (-kv[1], kv[0]))
    lines: list[str] = []
    lines.append("# Galen — unmatched capitalized lemmata")
    lines.append("")
    lines.append("Generated by `scripts/galen/survey_routes.py`. These are capitalized Greek")
    lines.append("tokens occurring **at least %d time(s)** that did NOT match the Pleiades" % threshold)
    lines.append("gazetteer (or its Latin/title variants) and are not in the persons lexicon.")
    lines.append("Likely contents: persons (drop into `data/galen/lexicon/persons.json`),")
    lines.append("ethnonyms, divinities, or — most importantly — **place names the gazetteer")
    lines.append("missed**. Confirmed places should be added to `data/galen/lexicon/places.json`")
    lines.append("for the next survey run.")
    lines.append("")
    lines.append(f"**Total unmatched lemmata** (≥{threshold} occurrences): {len(items)}")
    lines.append("")
    lines.append("| Surface | Count | Decision (place / person / ethnonym / other) |")
    lines.append("|---------|-------|----------------------------------------------|")
    for tok, n in items:
        lines.append(f"| `{tok}` | {n} | |")
    lines.append("")
    return "\n".join(lines) + "\n"


def render_ambiguous_md(
    candidates_by_work: dict[str, list[Candidate]], gaz: Gazetteer
) -> str:
    rows: list[tuple[str, str, str, list[str], list[str], str]] = []
    # (lemma, surface, kuhn_citation, pleiades_ids, titles, sentence)
    seen: set[tuple[str, str]] = set()
    for cands in candidates_by_work.values():
        for c in cands:
            for s in c.sentences:
                for m in s.place_mentions:
                    if len(m.pleiades_ids) <= 1:
                        continue
                    key = (m.lemma, "+".join(m.pleiades_ids))
                    if key in seen:
                        continue
                    seen.add(key)
                    titles = [gaz.places[pid]["title"] for pid in m.pleiades_ids if pid in gaz.places]
                    rows.append(
                        (m.lemma, m.surface, s.kuhn_citation, m.pleiades_ids, titles, s.greek)
                    )

    lines: list[str] = []
    lines.append("# Galen — ambiguous place mentions")
    lines.append("")
    lines.append("Generated by `scripts/galen/survey_routes.py`. These are place mentions in")
    lines.append("**route-candidate sentences** that resolve to more than one Pleiades record.")
    lines.append("For each row, pick the correct Pleiades ID (or mark `unresolved` → the")
    lines.append("mention will be treated as category C in Stage 3).")
    lines.append("")
    lines.append(f"**Total ambiguous mentions in route candidates**: {len(rows)}")
    lines.append("")
    for lemma, surface, kuhn, pids, titles, sent in rows:
        lines.append(f"### {surface} (lemma {lemma}) — {kuhn}")
        lines.append("")
        lines.append("Candidate Pleiades records:")
        for pid, title in zip(pids[:8], titles[:8]):
            lines.append(f"  - [{title}](https://pleiades.stoa.org/places/{pid}) (id {pid})")
        if len(pids) > 8:
            lines.append(f"  - ... and {len(pids) - 8} more")
        lines.append("")
        lines.append(f"Sentence: > {sent}")
        lines.append("")
        lines.append("**Decision:** Pleiades ID = ____ / unresolved")
        lines.append("")
    return "\n".join(lines) + "\n"


def write_annotated_tree(tree: ET.ElementTree, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    # ElementTree writes the declaration if xml_declaration=True
    tree.write(path, encoding="utf-8", xml_declaration=True)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> int:
    if not GAZETTEER_PATH.exists():
        print("ERROR: gazetteer missing. Run scripts/galen/build_gazetteer.py first.")
        return 1

    print("Loading lemmatizer + gazetteer + lexicon...")
    lem = Lemmatizer()
    gaz = Gazetteer.load()
    print(f"  CLTK={lem.have_cltk}, places={len(gaz.places)}, persons={len(gaz.person_lemmata)}, curator overrides={len(gaz.curator_overrides)}")

    capitalized_unmatched: Counter[str] = Counter()
    persons_seen: Counter[str] = Counter()
    candidates_by_work: dict[str, list[Candidate]] = {}
    summary: dict[str, dict] = {}
    all_mentions: list[dict] = []

    for spec in WORKS:
        print(f"\nProcessing {spec['work']} ({spec['file']})")
        tree, sentences = process_work(spec, lem, gaz, capitalized_unmatched)
        cands = cluster_hits(sentences)
        candidates_by_work[spec["work"]] = cands
        hit_count = sum(1 for s in sentences if s.is_hit)
        summary[spec["work"]] = {
            "tei_id": spec["tei_id"],
            "sentence_count": len(sentences),
            "hit_sentence_count": hit_count,
            "candidate_count": len(cands),
            "annotated_path": str((ANNOT_DIR / spec["annotated_file"]).relative_to(ROOT)),
        }
        print(f"  {len(sentences)} sentences, {hit_count} hits, {len(cands)} candidates")
        write_annotated_tree(tree, ANNOT_DIR / spec["annotated_file"])
        # accumulate mention sidecar
        for s in sentences:
            for m in s.place_mentions:
                all_mentions.append({
                    "work": spec["work"],
                    "book": s.book,
                    "chapter": s.chapter,
                    "section": s.section,
                    "kuhn_citation": s.kuhn_citation,
                    "surface": m.surface,
                    "lemma": m.lemma,
                    "pleiades_ids": m.pleiades_ids,
                    "match_type": m.match_type,
                    "cert": m.cert,
                    "in_route_hit_sentence": s.is_hit,
                })

    # Persist lemma cache
    lem.save_cache()

    # Outputs
    GEN_DIR.mkdir(parents=True, exist_ok=True)
    DOCS_DIR.mkdir(parents=True, exist_ok=True)
    (GEN_DIR / "place_mentions.json").write_text(
        json.dumps({"schema_version": "0.2", "mentions": all_mentions}, ensure_ascii=False, indent=2)
    )
    (GEN_DIR / "route_candidates.json").write_text(
        json.dumps(
            {
                "schema_version": "0.2",
                "stage": "2-candidate-survey-v2",
                "summary": summary,
                "candidates": {
                    work: [candidate_to_dict(c) for c in cs]
                    for work, cs in candidates_by_work.items()
                },
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    (DOCS_DIR / "galen_route_candidates.md").write_text(
        render_candidates_md(candidates_by_work, gaz)
    )
    (DOCS_DIR / "galen_unmatched_capitals.md").write_text(
        render_unmatched_md(capitalized_unmatched, threshold=3)
    )
    (DOCS_DIR / "galen_ambiguous_places.md").write_text(
        render_ambiguous_md(candidates_by_work, gaz)
    )

    print("\n--- Summary ---")
    for work, s in summary.items():
        print(f"  {work}: {s['sentence_count']} sentences, {s['hit_sentence_count']} hits, "
              f"{s['candidate_count']} candidates, annotated={s['annotated_path']}")
    print(f"\nUnmatched capitalized lemmata (≥3 occurrences): "
          f"{sum(1 for v in capitalized_unmatched.values() if v >= 3)}")
    print("Stage 2 v2 outputs written. Stop here for user review.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
