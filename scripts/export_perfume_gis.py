#!/usr/bin/env python3
"""Export per-perfume GIS packages (GeoJSON + CSV) from the Mendes claims.

Writes mendes/map/gis/<perfume>/ with:
  points.geojson / points.csv         — ancient provenance-claim points
  modern-points.geojson / modern-points.csv — modern-identification range points
  routes.geojson                      — the map's conventional trade corridors
                                        traversed by that perfume's claims

The nardinon perfume is not in mendes/data/claims.json; its extra simples
(nard, malabathron, kostos, amomon) are compiled here from Dioscorides
(1st1K/Wellmann chapters, verified against data/tei/tlg0656.tlg001) with
Pleiades representative points, and its shared simples reuse the project's
ingredient-level claims. All coordinates are WGS 84 (EPSG:4326).
"""

import csv
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "mendes" / "map" / "gis"

PLEIADES_BASE = "https://pleiades.stoa.org/places/"

# place -> (pleiades_id, pleiades_title, note) resolved against the local
# gazetteer (data/generated/simples/pleiades_gazetteer.json), homonyms
# disambiguated by distance to the project's plotted point.
PLEIADES = {
    "Aegae in Aeolis": ("550404", "Aegae", None),
    "Aegean supply — working inference": (None, None, "working inference; conventional plotting point"),
    "Arabia": ("29475", "Arabia (region)", None),
    "Arabia between Judaea and Egypt": ("29677", "Nabataea (region)", "Pliny's phrase; the Nabataean zone is the referent"),
    "Arabia — ancient claim": ("29475", "Arabia (region)", None),
    "Armenia": ("874350", "Armenia (region)", None),
    "Attica": ("579888", "Attica", None),
    "Bosporus — textual referent unresolved": ("520977", "Bosphorus", "textual referent unresolved"),
    "Campania — reported": ("432742", "Campania", None),
    "Commagene": ("658443", "Commagene", None),
    "Corycus in Cilicia": ("648612", "Corycus", None),
    "Corycus near Lycia and Olympus": ("638939", "Korykos", None),
    "Cyclades": ("560353", "Cyclades Islands", None),
    "Cyprus": ("707498", "Cyprus (island)", None),
    "Cyrene": ("373778", "Cyrene", None),
    "Egypt": ("981503", "Ancient Egypt (region)", None),
    "Egypt — finished Susinum": ("981503", "Ancient Egypt (region)", None),
    "Egypt — oil expression / manufacture": ("981503", "Ancient Egypt (region)", None),
    "Egyptian workshop context — source unstated": (None, None, "workshop context; conventional plotting point"),
    "Ethiopia": ("39274", "Aethiopia", None),
    "Ethiopia / Troglodytic cinnamon fields": ("39361", "Kinnamomophoros Chora", "project point is a conventional Red Sea anchor; the Pleiades region sits at the Horn of Africa"),
    "Ethiopia among the Troglodytes": ("39435", "Trogodytice", None),
    "India": ("50004", "India", None),
    "Jericho": ("687917", "Jericho", None),
    "Judaea": ("687934", "Iudaea (region)", None),
    "Libya": ("716588", "Libya", None),
    "Local flower supply — working inference": (None, None, "working inference; conventional plotting point"),
    "Media": ("903080", "Media (region)", None),
    "Nabataea": ("29677", "Nabataea (region)", None),
    "Petra": ("697725", "Petra", None),
    "Petra in Arabia": ("697725", "Petra", None),
    "Phoenicia — finished Susinum": ("678334", "Phoenice (region)", None),
    "Sicily": ("462492", "Sicilia (island)", None),
    "Side in Pamphylia": ("639105", "Side", None),
    "South / Southeast Asia — modern correction zone": (None, None, "modern botanical correction zone; no ancient place referent"),
    "South Arabia": ("39417", "Saba", "generic 'South Arabia'; Saba is the nearest Pleiades region (cf. Minaei, 39386)"),
    "Syria": ("981550", "Syria (Roman imperial province)", None),
    "Syria / Lebanon valley": ("668288", "Koile Syria/Massyas", None),
    "Syria / Mount Amanus": ("658376", "Amanus (mountain range)", None),
    "Thebaid": ("786131", "Thebais", None),
    "Troglodytic coast": ("39435", "Trogodytice", None),
    "Valley beyond Lebanon": ("668288", "Koile Syria/Massyas", None),
    "Vessel-dressing gum — source unstated": (None, None, "workshop context; conventional plotting point"),
    "Workshop oil — source unstated": (None, None, "workshop context; conventional plotting point"),
    "Workshop salt — source unstated": (None, None, "workshop context; conventional plotting point"),
    "Workshop water — source unstated": (None, None, "workshop context; conventional plotting point"),
    "Susinum workshop context — source unstated": (None, None, "workshop context; conventional plotting point"),
}

# Susinum membership qualifications: cassia and karpesion enter only through
# Paul of Aegina's substitution rule; cinnamon's membership is text-critical.
SUSINUM_MEMBERSHIP = {
    "cassia": ("substitution-register", "No witness lists cassia in susinum; it enters only through Paul of Aegina's substitution rule (7.20.8, with Galen): cassia at double weight stands in for cinnamon."),
    "karpesion": ("substitution-register", "Third permitted substitute for cinnamon in Paul's susinum (7.20.8); no witness lists it as an ingredient."),
    "cinnamon": ("conjectural", "In Dioscorides 1.52 the finishing-triad cinnamon is an editorial conjecture (the paradosis carries cardamom throughout); cinnamon is canonical only in Paul of Aegina's susinum, at 3 oz."),
}

# Nardinon (Dioscorides 1.62): shared simples reuse the project's claims;
# the four simples the dataset does not carry are compiled here.
NARDINON_SHARED = {
    "balanos": "base oil (Dsc 1.62: mixed for the most part with balanos oil)",
    "omphacine": "alternative base oil (Dsc 1.62)",
    "schoinos": "styptic thickening of the oil (Dsc 1.62)",
    "myrrh": "fragrance (Dsc 1.62)",
    "balsam": "fragrance (Dsc 1.62)",
}

NARDINON_EXTRA = [
    # ingredient_id, gloss, greek, place, cite, lat, lon, pleiades_id, pleiades_title
    ("nardos", "spikenard", "νάρδος", "India",
     "Dioscorides, De materia medica 1.7 (Indian nard; the 'Syrian' kind is named for the Syria-facing slope of the same mountain); Pliny, Naturalis historia 12.42–46",
     20.6367, 79.5333, "50004", "India"),
    ("nardos", "spikenard", "νάρδος", "Ganges",
     "Dioscorides, De materia medica 1.7.2 (Gangitis nard, from the river Ganges flowing past the mountain)",
     25.9323, 83.7799, "59822", "Ganges (river)"),
    ("malabathron", "malabathron", "μαλάβαθρον", "India",
     "Dioscorides, De materia medica 1.12 (grows in the Indian marshes, a leaf floating on the water); cf. Pliny, Naturalis historia 12.129",
     20.6367, 79.5333, "50004", "India"),
    ("kostos", "kostos", "κόστος", "Arabia",
     "Dioscorides, De materia medica 1.16 (the Arabian, white and light, is best)",
     24.1490, 46.5515, "29475", "Arabia (region)"),
    ("kostos", "kostos", "κόστος", "Patalene (Indus delta)",
     "Pliny, Naturalis historia 12.41 (the island of Patale at the mouth of the Indus)",
     25.0056, 68.5448, "59988", "Patalene"),
    ("amomon", "amomon", "ἄμωμον", "Armenia",
     "Dioscorides, De materia medica 1.15 (the Armenian, golden in colour, is best)",
     38.7401, 42.1670, "874350", "Armenia (region)"),
    ("amomon", "amomon", "ἄμωμον", "Media",
     "Dioscorides, De materia medica 1.15 (the Median, from plains and watery ground, is weaker)",
     35.0482, 48.9193, "903080", "Media (region)"),
    ("amomon", "amomon", "ἄμωμον", "Pontus",
     "Dioscorides, De materia medica 1.15 (the Pontic, yellowish and grape-cluster-like)",
     40.2214, 37.9234, "857287", "Pontus"),
]

# Modern identification layer: ingredient -> (taxon, range_summary, [(label, lat, lon)])
MODERN = {
    "nardos": ("Nardostachys jatamansi",
        "Alpine Himalaya c. 3000–5000 m: Uttarakhand–Sikkim (India), Nepal, Bhutan, SE Xizang and NW Yunnan (China). CITES App. II.",
        [("Central Nepal Himalaya", 28.5, 84.0)]),
    "malabathron": ("Cinnamomum tamala",
        "Himalayan foothills and NE India: N India, Nepal, Bhutan, Myanmar, SW China (tejpat leaf).",
        [("Eastern Himalayan foothills", 27.5, 88.5)]),
    "kostos": ("Saussurea costus (accepted: Dolomiaea costus)",
        "Western Himalaya: Kashmir, Himachal Pradesh, Uttarakhand; cultivated in India and China. CITES App. I.",
        [("Kashmir Himalaya", 33.5, 76.0)]),
    "amomon": ("Amomum subulatum",
        "Eastern Himalaya: Nepal, Sikkim/Darjeeling, Bhutan (large/black cardamom).",
        [("Sikkim", 27.3, 88.4)]),
    "balanos": ("Moringa peregrina",
        "Red Sea basin and adjacent deserts: Eastern Desert and Sinai, Sudan, Eritrea, Horn of Africa, W and S Arabia, Dead Sea/Wadi Araba, east to S Iran.",
        [("Sinai / Hijaz Red Sea coasts", 27.0, 35.0)]),
    "omphacine": ("Olea europaea",
        "Native and anciently cultivated across the Mediterranean basin; Ptolemaic-period pressing attested in the Fayum.",
        [("Mediterranean basin (representative)", 37.0, 22.0)]),
    "schoinos": ("Cymbopogon schoenanthus",
        "Saharo-Arabian dry belt: North Africa and the Sahara through Arabia to NW India.",
        [("Hijaz, W Arabia", 22.0, 40.0)]),
    "myrrh": ("Commiphora myrrha",
        "Horn of Africa (Somalia/Somaliland, E Ethiopia, Djibouti, N Kenya) and S Arabia (Yemen, SW Saudi Arabia, Dhofar).",
        [("Somaliland", 9.5, 45.5), ("Yemen highland margin", 13.8, 44.8)]),
    "balsam": ("unknown — Commiphora gileadensis?",
        "If the identification holds: S Arabian Peninsula and parts of the Horn; anciently estate-grown at Jericho and En Gedi. Identification open.",
        [("SW Arabia", 13.5, 44.5)]),
    "cassia": ("Cinnamomum cassia",
        "Native to S China (Guangxi, Guangdong, Yunnan) and N Vietnam; cultivated across S China and mainland SE Asia.",
        [("Guangxi, China", 22.8, 108.3)]),
    "cinnamon": ("Cinnamomum verum",
        "Native to Sri Lanka (with SW Indian Western Ghats populations); cultivated pantropically.",
        [("SW Sri Lanka", 6.9, 80.0)]),
    "resin": ("Pistacia terebinthus",
        "Mediterranean basin, Iberia to the Aegean and Anatolia; Levantine terebinth resin also from P. atlantica / P. palaestina.",
        [("Aegean / W Anatolia", 38.0, 27.0)]),
    "cardamom": ("Elettaria cardamomum",
        "Western Ghats of SW India (the 'Cardamom Hills'); major modern cultivation also in Guatemala.",
        [("Cardamom Hills, Kerala", 9.8, 77.1)]),
    "kalamos": ("Cymbopogon martinii or Acorus calamus",
        "C. martinii: Indian subcontinent. A. calamus: S and E Asian wetlands, anciently spread west. Identification disputed.",
        [("C. martinii — Deccan, India", 20.0, 76.0), ("A. calamus — Gangetic plain", 25.5, 85.0)]),
    "honey": ("Attic honey — place-defined product (not a taxon)",
        "Mount Hymettus and Attica, Greece; modern Greek thyme-honey production continues in the same landscape.",
        [("Mount Hymettus, Attica", 37.95, 23.80)]),
    "wine": ("fragrant wine — product, no taxon imposed (Vitis vinifera)",
        "No modern range claim beyond Mediterranean viticulture generally.", []),
    "saffron": ("Crocus sativus",
        "Sterile cultigen with no wild range; all occurrences are cultivation. Wild progenitor C. cartwrightianus is native to Attica and the Cyclades/Crete.",
        [("Kozani, Greece (cultivation)", 40.3, 21.8), ("Khorasan, Iran (cultivation)", 35.5, 59.5), ("C. cartwrightianus — Attica", 37.9, 23.8)]),
    "lily": ("Lilium candidum",
        "East Mediterranean native: Lebanon, Israel/Palestine, W Syria, S Turkey, with Balkan outliers; long naturalized more widely.",
        [("Mount Lebanon", 34.0, 35.8)]),
    "karpesion": ("no secure modern identification",
        "Galen compares it to valerian-family drugs; no taxon imposed, no modern range asserted.", []),
}

# The interactive map's corridors (mendes/map/app-1.js), coords as [lon, lat].
# These are drawn for legibility: conventional corridors, not researched
# route geometries.
ROUTES = [
    ("india-sea", "sea", "India → Red Sea", [[72.5, 19.0], [61.0, 15.5], [49.2, 12.7], [43.3, 12.6], [39.5, 17.0], [35.5, 23.9]]),
    ("red-sea", "sea", "Red Sea ports", [[43.3, 12.6], [40.0, 16.0], [37.7, 20.0], [35.5, 23.9], [33.6, 27.2]]),
    ("berenice-coptos", "land", "Berenice → Coptos", [[35.5, 23.9], [34.2, 25.0], [32.8, 26.0]]),
    ("myos-coptos", "land", "Myos Hormos → Coptos", [[33.6, 27.2], [32.8, 26.0]]),
    ("nile", "river", "Nile (conventional)", [[32.8, 26.0], [31.7, 28.4], [31.2, 30.1], [31.5, 30.95]]),
    ("incense-road", "land", "Incense road: South Arabia → Petra → Gaza → Egypt", [[44.2, 15.4], [39.7, 21.4], [37.4, 26.6], [35.44, 30.33], [34.47, 31.5], [31.5, 30.95]]),
    ("med-sea", "sea", "Mediterranean", [[14.0, 37.5], [23.7, 37.9], [30.0, 36.2], [33.3, 35.0], [29.9, 31.2], [31.5, 30.95]]),
    ("syria-land", "land", "Syria → Egypt", [[36.3, 36.6], [36.3, 33.5], [34.47, 31.5], [31.5, 30.95]]),
]

# claim route key -> corridor ids it traverses
ROUTE_KEY_TO_CORRIDORS = {
    "redsea": ["red-sea", "berenice-coptos", "myos-coptos", "nile"],
    "nile": ["nile"],
    "incense": ["incense-road"],
    "med": ["med-sea"],
    "med-sea": ["med-sea"],
    "syria": ["syria-land"],
    "india": ["india-sea", "red-sea", "berenice-coptos", "nile"],
}

POINT_FIELDS = [
    "perfume", "ingredient_id", "ingredient", "greek", "membership",
    "membership_note", "claim_id", "place", "evidence", "cite", "note",
    "route", "point_source", "pleiades_id", "pleiades_title", "pleiades_uri",
    "lat", "lon",
]

MODERN_FIELDS = [
    "perfume", "ingredient_id", "ingredient", "taxon", "range_summary",
    "label", "point_kind", "powo", "gbif", "lat", "lon",
]


def claim_point(perfume, ing, c, membership="member", membership_note=""):
    pid, ptitle, pnote = PLEIADES.get(c["place"], (None, None, None))
    lon, lat = c["coord"]
    note = c.get("note", "") or ""
    if pnote:
        note = (note + " " if note else "") + "[Pleiades match: " + pnote + "]"
    return {
        "perfume": perfume,
        "ingredient_id": ing["id"],
        "ingredient": ing["gloss"],
        "greek": ing["greek"],
        "membership": membership,
        "membership_note": membership_note,
        "claim_id": c["id"],
        "place": c["place"],
        "evidence": "attested-ancient" if c["evidence"] == "ancient" else "inference-modern",
        "cite": c["cite"],
        "note": note,
        "route": c.get("route") or "",
        "point_source": "project-plot",
        "pleiades_id": pid or "",
        "pleiades_title": ptitle or "",
        "pleiades_uri": (PLEIADES_BASE + pid) if pid else "",
        "lat": lat,
        "lon": lon,
    }


PERFUME_TITLES = {
    "mendesian": ("The Mendesian (the Dark Mendesian)",
        "Ingredient provenance from the House of Mendes evidence records (`mendes/data/claims.json`)."),
    "susinum": ("Susinum",
        "Ingredient provenance from the House of Mendes evidence records (`mendes/data/claims.json`). "
        "Entries marked *substitution register* or *conjectural* are not recipe members in any witness — see each note."),
    "nardinon": ("The nard perfume (νάρδινον μύρον)",
        "Composition per Dioscorides, *De materia medica* 1.62 (Wellmann): made variously with or without malabathron "
        "leaf; the base is balanos oil or omphacine oil, styptically thickened with schoinos; for fragrance kostos, "
        "amōmon, nard, myrrh, and balsam are added. Shared simples reuse the project's ingredient-level claims; "
        "the four simples not yet in the dataset are compiled from Dioscorides 1.7, 1.12, 1.15 and 1.16 "
        "(verified against `data/tei/tlg0656.tlg001.1st1K-grc1.xml`) with Pleiades representative coordinates (†)."),
}


def write_readme(folder, name, points, modern_rows):
    title, intro = PERFUME_TITLES[name]
    L = [f"# {title}", "", intro, "",
         "Human-readable companion to `points.geojson`/`points.csv` (ancient claims), "
         "`modern-points.geojson`/`.csv` (modern identifications) and `routes.geojson` in this folder. "
         "Coordinates are decimal degrees, WGS 84, given `lat, lon`. See `../README.md` for field "
         "definitions and the caveats on route geometry.", ""]

    modern_by_ing = {}
    for m in modern_rows:
        modern_by_ing.setdefault(m["ingredient_id"], []).append(m)

    order, by_ing = [], {}
    for p in points:
        if p["ingredient_id"] not in by_ing:
            order.append(p["ingredient_id"])
            by_ing[p["ingredient_id"]] = []
        by_ing[p["ingredient_id"]].append(p)

    for iid in order:
        rows = by_ing[iid]
        first = rows[0]
        L.append(f"### {first['ingredient'].capitalize()} ({first['greek']})")
        L.append("")
        if first["membership"] != "member":
            label = "Substitution register, not recipe membership" \
                if first["membership"] == "substitution-register" else "Membership is text-critical"
            L.append(f"**{label}.** {first['membership_note']}")
            L.append("")
        elif first["membership_note"]:
            L.append(f"*{first['membership_note']}*")
            L.append("")
        L.append("| Place | Evidence | GIS (lat, lon) | Pleiades |")
        L.append("|---|---|---|---|")
        for p in rows:
            ev = ("Attested (ancient)" if p["evidence"] == "attested-ancient"
                  else "Inference (modern)") + " — " + p["cite"]
            gis = f"{p['lat']}, {p['lon']}" + (" †" if p["point_source"] == "pleiades-representative" else "")
            pl = (f"[{p['pleiades_title']} ({p['pleiades_id']})]({p['pleiades_uri']})"
                  if p["pleiades_id"] else "—")
            note = p["note"]
            place = p["place"] + (f" *({note})*" if note and p["evidence"] != "attested-ancient" else "")
            L.append(f"| {place} | {ev} | {gis} | {pl} |")
        L.append("")
        mods = modern_by_ing.get(iid)
        if mods:
            m0 = mods[0]
            L.append(f"**Modern — assumed identification:** *{m0['taxon']}* "
                     f"([POWO]({m0['powo']}) · [GBIF]({m0['gbif']})). {m0['range_summary']}")
            L.append("")
            L.append("| Modern representative point | GIS (lat, lon) |")
            L.append("|---|---|")
            for m in mods:
                L.append(f"| {m['label']} | {m['lat']}, {m['lon']} ‡ |")
            L.append("")

    L += ["---", "",
          "† Pleiades representative point (no hand-set project point for this claim yet).", "",
          "‡ Range-representative point for the assumed modern taxon (native range, or production zone "
          "for cultigens); not an occurrence record — see the POWO/GBIF links above.", ""]
    (folder / "README.md").write_text("\n".join(L))


def write_package(name, points, modern_rows, route_keys):
    folder = OUT / name
    folder.mkdir(parents=True, exist_ok=True)

    fc = {"type": "FeatureCollection", "features": [
        {"type": "Feature",
         "geometry": {"type": "Point", "coordinates": [p["lon"], p["lat"]]},
         "properties": {k: p[k] for k in POINT_FIELDS if k not in ("lat", "lon")}}
        for p in points]}
    (folder / "points.geojson").write_text(json.dumps(fc, ensure_ascii=False, indent=1) + "\n")
    with open(folder / "points.csv", "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=POINT_FIELDS)
        w.writeheader()
        w.writerows(points)

    mfc = {"type": "FeatureCollection", "features": [
        {"type": "Feature",
         "geometry": {"type": "Point", "coordinates": [m["lon"], m["lat"]]},
         "properties": {k: m[k] for k in MODERN_FIELDS if k not in ("lat", "lon")}}
        for m in modern_rows]}
    (folder / "modern-points.geojson").write_text(json.dumps(mfc, ensure_ascii=False, indent=1) + "\n")
    with open(folder / "modern-points.csv", "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=MODERN_FIELDS)
        w.writeheader()
        w.writerows(modern_rows)

    corridor_ids = []
    for key in route_keys:
        for cid in ROUTE_KEY_TO_CORRIDORS.get(key, []):
            if cid not in corridor_ids:
                corridor_ids.append(cid)
    rfc = {"type": "FeatureCollection", "features": [
        {"type": "Feature",
         "geometry": {"type": "LineString", "coordinates": coords},
         "properties": {"id": rid, "mode": mode, "label": label,
                        "geometry_status": "conventional corridor drawn for map legibility; not a researched route geometry"}}
        for rid, mode, label, coords in ROUTES if rid in corridor_ids]}
    (folder / "routes.geojson").write_text(json.dumps(rfc, ensure_ascii=False, indent=1) + "\n")

    write_readme(folder, name, points, modern_rows)

    return len(points), len(modern_rows), len(rfc["features"])


def modern_rows_for(perfume, ing_ids, ing_lookup):
    rows = []
    for iid in ing_ids:
        if iid not in MODERN:
            continue
        taxon, summary, pts = MODERN[iid]
        gloss = ing_lookup.get(iid, iid)
        q = taxon.split("(")[0].strip().replace(" ", "+")
        for label, lat, lon in pts:
            rows.append({
                "perfume": perfume, "ingredient_id": iid, "ingredient": gloss,
                "taxon": taxon, "range_summary": summary, "label": label,
                "point_kind": "range-representative (not an occurrence record)",
                "powo": "https://powo.science.kew.org/results?q=" + q,
                "gbif": "https://www.gbif.org/species/search?q=" + q,
                "lat": lat, "lon": lon,
            })
    return rows


def main():
    data = json.loads((ROOT / "mendes" / "data" / "claims.json").read_text())
    ingredients = data["ingredients"]
    by_id = {i["id"]: i for i in ingredients}
    gloss = {i["id"]: i["gloss"] for i in ingredients}
    gloss.update({"nardos": "spikenard", "malabathron": "malabathron",
                  "kostos": "kostos", "amomon": "amomon"})

    for key, name in (("m", "mendesian"), ("s", "susinum")):
        points, route_keys, ing_ids = [], [], []
        for i in ingredients:
            if key not in i["recipes"]:
                continue
            ing_ids.append(i["id"])
            membership, mnote = "member", ""
            if key == "s" and i["id"] in SUSINUM_MEMBERSHIP:
                membership, mnote = SUSINUM_MEMBERSHIP[i["id"]]
            for c in i["claims"]:
                if key not in c["recipes"]:
                    continue
                points.append(claim_point(name, i, c, membership, mnote))
                if c.get("route"):
                    route_keys.append(c["route"])
        counts = write_package(name, points, modern_rows_for(name, ing_ids, gloss), route_keys)
        print(name, "points/modern/routes:", counts)

    # Nardinon: shared simples from the dataset + the four compiled ones.
    points, route_keys = [], []
    for iid, role in NARDINON_SHARED.items():
        i = by_id[iid]
        for c in i["claims"]:
            p = claim_point("nardinon", i, c, "member",
                            "Role in nardinon: " + role + ". Ingredient-level claim reused from the project dataset.")
            points.append(p)
            if c.get("route"):
                route_keys.append(c["route"])
    for iid, g, greek, place, cite, lat, lon, pid, ptitle in NARDINON_EXTRA:
        points.append({
            "perfume": "nardinon", "ingredient_id": iid, "ingredient": g,
            "greek": greek, "membership": "member",
            "membership_note": "Composition per Dioscorides 1.62; simple not yet in the project dataset — compiled for this export.",
            "claim_id": "nardinon-" + iid + "-" + pid,
            "place": place, "evidence": "attested-ancient", "cite": cite,
            "note": "", "route": "india" if pid in ("50004", "59822", "59988") else "",
            "point_source": "pleiades-representative",
            "pleiades_id": pid, "pleiades_title": ptitle,
            "pleiades_uri": PLEIADES_BASE + pid, "lat": lat, "lon": lon,
        })
        if pid in ("50004", "59822", "59988"):
            route_keys.append("india")
    nard_ids = list(NARDINON_SHARED) + ["nardos", "malabathron", "kostos", "amomon"]
    counts = write_package("nardinon", points, modern_rows_for("nardinon", nard_ids, gloss), route_keys)
    print("nardinon points/modern/routes:", counts)


if __name__ == "__main__":
    main()
