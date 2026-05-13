/* Atlas viewer data helpers.
 *
 * This file owns corpus configuration, generated JSON loading, and the
 * normalized focus-list contract consumed by viewer.js. The runtime viewer
 * remains responsible for Leaflet, DOM rendering, and input state.
 */

(function () {
  "use strict";

  const CORPORA = {
    periplus: {
      title: ["Periplvs", "Maris Erythraei"],
      series: "Periplus Tour · Red Sea Atlas",
      paths: {
        places: "../data/generated/periplus/places_authority.json",
        sections: "../data/generated/periplus/raw_sections.json",
        journey: "../data/generated/periplus/journey_route.json",
        routeViews: "../data/generated/periplus/route_views.json",
      },
      defaultView: "all",
      viewLabels: {
        all: "All",
        western: "Occidens",
        eastern: "Oriens",
      },
    },
    galen: {
      title: ["Galenvs", "Itinera Medicinalia"],
      series: "Galen · Pharmacological Itineraries",
      paths: {
        places: "../data/generated/galen/places_authority.json",
        passages: "../data/generated/galen/passages.json",
        materia: "../data/generated/galen/materia.json",
        routeViews: "../data/generated/galen/route_views.json",
      },
      defaultView: "all",
      viewLabels: {
        all: "All",
        "lemnos-alexandria-troas-to-thessalonica-context": "Lemnos via Troas",
        "lemnos-italy-to-troas-via-thasos": "Lemnos via Thasos",
        "cyprus-soloi-mines": "Cyprus / Soloi",
        "coele-syria-dead-sea-materials": "Coele Syria",
        "pergamum-ergasteria-mines": "Pergamum",
        materia_observations: "Materia",
      },
      viewOrder: [
        "all",
        "lemnos-alexandria-troas-to-thessalonica-context",
        "lemnos-italy-to-troas-via-thasos",
        "cyprus-soloi-mines",
        "coele-syria-dead-sea-materials",
        "pergamum-ergasteria-mines",
        "materia_observations",
      ],
    },
    materia_medica: {
      title: ["Materia", "Medica"],
      series: "Simples Provenance · Materia Medica",
      paths: {
        places: "../data/generated/materia_medica/places_authority.json",
        passages: "../data/generated/materia_medica/passages.json",
        materia: "../data/generated/materia_medica/materia.json",
        routeViews: "../data/generated/materia_medica/route_views.json",
      },
      defaultView: "all",
      viewLabels: {
        all: "All",
      },
    },
  };

  const INLAND_RX = /(Inland|Metropolis|Frontier|Region)/i;
  const REGION_RX = /Region/i;
  const GALEN_LAND_TYPES = new Set(["city", "mine", "sanctuary", "mountain"]);
  const GALEN_SEA_TYPES = new Set(["port", "island", "sea"]);

  const ROMAN = [
    [1000, "M"], [900, "CM"], [500, "D"], [400, "CD"],
    [100, "C"], [90, "XC"], [50, "L"], [40, "XL"],
    [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"],
  ];

  const GREEK_TERMINATORS = /[.;·]/;
  const ENGLISH_TERMINATORS = /[.!?]/;

  function corpusIsPeriplus(corpusId) {
    return corpusId === "periplus";
  }

  function corpusIsGalen(corpusId) {
    return corpusId === "galen";
  }

  function corpusIsMateria(corpusId) {
    return corpusId === "materia_medica";
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function toRoman(n) {
    if (!Number.isFinite(n) || n <= 0) return "—";
    let num = Math.floor(n);
    let out = "";
    for (const [v, s] of ROMAN) {
      while (num >= v) {
        out += s;
        num -= v;
      }
    }
    return out;
  }

  function loadJson(path) {
    return fetch(path).then((r) => {
      if (!r.ok) throw new Error(`Could not fetch ${path}: ${r.status}`);
      return r.json();
    });
  }

  function siteDisplayName(site) {
    return site?.source_name ?? site?.display_name ?? "";
  }

  function sitePlaceType(site) {
    return site?.periplus_place_type ?? site?.place_type ?? "";
  }

  function isInland(corpusId, site) {
    if (corpusIsPeriplus(corpusId)) return INLAND_RX.test(sitePlaceType(site));
    if (corpusIsMateria(corpusId)) return true;
    const t = sitePlaceType(site).toLowerCase();
    if (GALEN_SEA_TYPES.has(t)) return false;
    return GALEN_LAND_TYPES.has(t) || t === "region";
  }

  function isRegion(corpusId, site) {
    if (!site) return false;
    if (corpusIsPeriplus(corpusId)) {
      if (REGION_RX.test(sitePlaceType(site))) return true;
      return (site.location_precision ?? "").toLowerCase() === "region";
    }
    if (corpusIsMateria(corpusId)) {
      return Boolean(site.is_broad_region) || sitePlaceType(site).toLowerCase() === "region";
    }
    const t = sitePlaceType(site).toLowerCase();
    return t === "region" || t === "sea";
  }

  function isLineEndpoint(corpusId, site) {
    if (corpusIsMateria(corpusId)) return false;
    if (corpusIsGalen(corpusId)) return site?.kind === "primary";
    return !isRegion(corpusId, site);
  }

  function siteLatLng(site) {
    return site?.has_geometry && site.lat !== null && site.lon !== null
      ? [site.lat, site.lon]
      : null;
  }

  async function loadCorpus(corpusId, cache) {
    if (cache.has(corpusId)) return cache.get(corpusId);
    const cfg = CORPORA[corpusId];
    if (!cfg) throw new Error(`Unknown corpus: ${corpusId}`);
    const entries = await Promise.all(
      Object.entries(cfg.paths).map(async ([k, p]) => [k, await loadJson(p)]),
    );
    const bundle = Object.fromEntries(entries);
    bundle.placesByKey = new Map(bundle.places.map((p) => [p.place_key, p]));
    if (bundle.sections) {
      bundle.sectionsByChunkId = new Map(bundle.sections.map((s) => [s.chunk_id, s]));
      bundle.sectionsByOrder = new Map(bundle.sections.map((s) => [s.section_order, s]));
    }
    if (bundle.passages) {
      bundle.passagesById = new Map(bundle.passages.map((p) => [p.passage_id, p]));
      bundle.mentionsByPlace = new Map();
      for (const p of bundle.passages) {
        for (const m of p.place_mentions ?? []) {
          if (!bundle.mentionsByPlace.has(m.place_key)) {
            bundle.mentionsByPlace.set(m.place_key, []);
          }
          bundle.mentionsByPlace.get(m.place_key).push({ passage: p, surface: m.surface });
        }
      }
    }
    if (bundle.materia) {
      bundle.materiaByKey = new Map(bundle.materia.map((m) => [m.materia_key, m]));
      bundle.materiaByPlace = new Map();
      for (const m of bundle.materia) {
        for (const link of m.place_links ?? []) {
          if (!bundle.materiaByPlace.has(link.place_key)) {
            bundle.materiaByPlace.set(link.place_key, []);
          }
          bundle.materiaByPlace.get(link.place_key).push({ materia: m, link });
        }
      }
    }
    cache.set(corpusId, bundle);
    return bundle;
  }

  function currentView(data, selectedView) {
    return data?.routeViews?.views?.[selectedView] ?? null;
  }

  function formatKuhn(p) {
    if (!p) return "";
    const vol = p.kuhn_volume ?? "";
    const ps = p.kuhn_page_start, ls = p.kuhn_line_start;
    const pe = p.kuhn_page_end, le = p.kuhn_line_end;
    if (!Number.isInteger(ps)) return vol ? `K. ${vol}` : "";
    if (ps === pe) {
      if (ls === le) return `K. ${vol} ${ps}.${ls}`;
      return `K. ${vol} ${ps}.${ls}–${le}`;
    }
    return `K. ${vol} ${ps}.${ls}–${pe}.${le}`;
  }

  function extractSentenceAround(text, pos, terminatorsRegex) {
    if (!text || pos < 0 || pos >= text.length) return text || "";
    let start = 0;
    for (let i = pos - 1; i >= 0; i -= 1) {
      if (terminatorsRegex.test(text[i])) {
        start = i + 1;
        break;
      }
    }
    let end = text.length;
    for (let i = pos + 1; i < text.length; i += 1) {
      if (terminatorsRegex.test(text[i])) {
        end = i + 1;
        break;
      }
    }
    return text.slice(start, end).trim();
  }

  function englishSnippetByProportion(english, greek, greekMentionPos) {
    if (!english) return "";
    if (!greek || greekMentionPos < 0 || greek.length === 0) return english;
    const ratio = greekMentionPos / greek.length;
    const estPos = Math.min(english.length - 1, Math.max(0, Math.floor(ratio * english.length)));
    return extractSentenceAround(english, estPos, ENGLISH_TERMINATORS) || english;
  }

  function collectContextMentions(data, placeKey, currentPassageId, limit = 4) {
    const rows = data?.mentionsByPlace?.get(placeKey) ?? [];
    if (rows.length === 0) return [];
    const seenSentence = new Set();
    const out = [];
    for (const { passage, surface } of rows) {
      if (currentPassageId && passage.passage_id === currentPassageId) continue;
      const greek = passage.greek || "";
      const pos = greek.indexOf(surface);
      const greekSentence = pos >= 0
        ? extractSentenceAround(greek, pos, GREEK_TERMINATORS)
        : greek;
      const dedupKey = `${passage.passage_id}::${greekSentence}`;
      if (seenSentence.has(dedupKey)) continue;
      seenSentence.add(dedupKey);
      out.push({
        passageId: passage.passage_id,
        citation: formatKuhn(passage),
        surface,
        greekSentence,
        englishSentence: englishSnippetByProportion(passage.translation_en || "", greek, pos),
      });
      if (out.length >= limit) break;
    }
    return out;
  }

  function viewIdsForCorpus(corpusId, data) {
    const cfg = CORPORA[corpusId];
    const fromData = Object.keys(data?.routeViews?.views ?? {});
    if (cfg.viewOrder) {
      return cfg.viewOrder.filter((id) => fromData.includes(id));
    }
    const ordered = [];
    if (fromData.includes("all")) ordered.push("all");
    for (const id of fromData) {
      if (id !== "all" && !ordered.includes(id)) ordered.push(id);
    }
    return ordered;
  }

  function viewLabel(corpusId, data, viewId) {
    const cfg = CORPORA[corpusId];
    return cfg.viewLabels?.[viewId]
      ?? data?.routeViews?.views?.[viewId]?.label
      ?? viewId;
  }

  function periplusFocusList(data, view) {
    const sectionFocusByOrder = new Map();
    for (const sf of view.section_focus ?? []) {
      sectionFocusByOrder.set(sf.section_order, sf);
    }

    return view.sites.map((site, idx) => {
      const sectionOrder = (site.section_numbers ?? [])[0] ?? null;
      const reviewed = sectionFocusByOrder.get(sectionOrder);
      const section = Number.isInteger(sectionOrder)
        ? data.sectionsByOrder?.get(sectionOrder)
        : null;
      return {
        index: idx,
        corpus: "periplus",
        site,
        siteKey: site.site_key,
        placeKey: site.place_key ?? site.site_key,
        sectionOrder,
        kind: isInland("periplus", site) ? "land" : "sea",
        displayName: siteDisplayName(site),
        greekName: site.page_metadata?.page_ancient_toponym ?? null,
        placeType: sitePlaceType(site),
        routeLabel: site.route_label ?? "",
        chapter: site.periplus_chapter ?? "",
        pleiadesUri: site.pleiades_uri ?? null,
        pleiadesId: site.pleiades_id ?? null,
        modernId: [site.modern_identification, site.modern_country].filter(Boolean).join(", "),
        translation: section?.draft_translation ?? "",
        greekText: section?.greek_text ?? "",
        reviewedNote: reviewed?.context_places?.length
          ? `${reviewed.context_places.length} context place${reviewed.context_places.length === 1 ? "" : "s"}`
          : "",
        latLng: siteLatLng(site),
        materia: [],
      };
    });
  }

  function materiaForSite(data, site) {
    const placeMateria = data.materiaByPlace?.get(site.place_key) ?? [];
    const filtered = placeMateria.filter((row) => {
      if (site.materia_key && row.materia.materia_key !== site.materia_key) return false;
      if (site.passage_id && row.link.passage_id !== site.passage_id) return false;
      return true;
    });
    const candidates = filtered.length > 0 ? filtered : placeMateria;
    const byKey = new Map();
    for (const row of candidates) {
      const k = row.materia.materia_key;
      if (!byKey.has(k)) {
        byKey.set(k, {
          materiaKey: k,
          displayName: row.materia.display_name,
          greekName: row.materia.greek_name,
          sourceCitation: row.materia.source_citation,
          relations: new Set(),
          evidencePhrases: [],
        });
      }
      const entry = byKey.get(k);
      if (row.link.relation) entry.relations.add(row.link.relation);
      if (row.link.evidence_phrase) entry.evidencePhrases.push(row.link.evidence_phrase);
    }
    return [...byKey.values()].map((x) => ({
      materiaKey: x.materiaKey,
      displayName: x.displayName,
      greekName: x.greekName,
      sourceCitation: x.sourceCitation,
      relation: [...x.relations].join(" / "),
      evidencePhrase: x.evidencePhrases.join(" — "),
    }));
  }

  function galenFocusList(data, view, isPhoneViewport) {
    const mentionLimit = isPhoneViewport ? 2 : 4;
    return view.sites.map((site, idx) => {
      const passage = site.passage_id
        ? data.passagesById?.get(site.passage_id)
        : null;
      const greekName = (site.ancient_names_in_galen ?? [])[0]?.surface ?? null;
      return {
        index: idx,
        corpus: "galen",
        site,
        siteKey: site.site_key,
        placeKey: site.place_key,
        kind: isInland("galen", site) ? "land" : "sea",
        displayName: siteDisplayName(site),
        greekName,
        placeType: sitePlaceType(site),
        routeLabel: site.route_label ?? "",
        kuhnCitation: site.kuhn_citation ?? "",
        passageId: site.passage_id ?? null,
        evidencePhrase: site.evidence_phrase ?? "",
        narrativeNote: site.narrative_note ?? "",
        orderBasis: site.order_basis ?? "",
        siteKind: site.kind ?? "",
        pleiadesUri: site.pleiades_uri ?? null,
        pleiadesId: site.pleiades_id ?? null,
        translation: passage?.translation_en ?? "",
        greekText: passage?.greek ?? "",
        latLng: siteLatLng(site),
        materia: materiaForSite(data, site),
        contextMentions: site.passage_id
          ? []
          : collectContextMentions(data, site.place_key, site.passage_id, mentionLimit),
      };
    });
  }

  function materiaMedicaFocusList(data, view) {
    return view.sites.map((site, idx) => {
      const passage = site.passage_id
        ? data.passagesById?.get(site.passage_id)
        : null;
      const material = site.materia_key
        ? data.materiaByKey?.get(site.materia_key)
        : null;
      return {
        index: idx,
        corpus: "materia_medica",
        site,
        siteKey: site.site_key,
        placeKey: site.place_key,
        kind: "materia",
        displayName: material?.display_name ?? site.display_name,
        greekName: material?.greek_name ?? site.greek_name ?? null,
        placeLabel: site.place_label ?? "",
        placeType: sitePlaceType(site),
        routeLabel: site.route_label ?? "",
        sourceCitation: site.source_citation ?? passage?.source_citation ?? "",
        passageId: site.passage_id ?? null,
        entryId: site.entry_id ?? site.passage_id ?? null,
        materiaKey: site.materia_key ?? null,
        relation: site.relation ?? "",
        evidencePhrase: site.evidence_phrase ?? "",
        consensusConfidence: site.consensus_confidence ?? null,
        reviewDecisionSource: site.review_decision_source ?? "",
        candidateId: site.candidate_id ?? "",
        broadRegionLabel: site.broad_region_label ?? "",
        isBroadRegion: Boolean(site.is_broad_region),
        hasUncertainCoordinates: Boolean(site.has_uncertain_coordinates),
        locationPrecision: site.location_precision ?? "",
        coordinateSource: site.coordinates_source ?? "",
        pleiadesUri: site.pleiades_uri ?? null,
        pleiadesId: site.pleiades_id ?? null,
        translation: passage?.translation_en ?? "",
        greekText: passage?.greek ?? "",
        latLng: siteLatLng(site),
        materia: materiaForSite(data, site),
        acceptedLinks: site.accepted_links ?? [],
      };
    });
  }

  function buildFocusList({ corpusId, data, selectedView, isPhoneViewport }) {
    const view = currentView(data, selectedView);
    if (!view) return [];
    if (corpusIsPeriplus(corpusId)) return periplusFocusList(data, view);
    if (corpusIsGalen(corpusId)) return galenFocusList(data, view, isPhoneViewport);
    if (corpusIsMateria(corpusId)) return materiaMedicaFocusList(data, view);
    return [];
  }

  function buildLegs({ corpusId, sites, selectedView }) {
    if (corpusIsMateria(corpusId)) return [];
    const eligible = sites.filter((s) => isLineEndpoint(corpusId, s));
    const legs = [];
    for (let i = 1; i < eligible.length; i += 1) {
      const a = eligible[i - 1];
      const b = eligible[i];
      const aLL = siteLatLng(a);
      const bLL = siteLatLng(b);
      if (!aLL || !bLL) continue;
      if (a.route_key !== b.route_key && selectedView === "all") continue;
      const category = isInland(corpusId, a) || isInland(corpusId, b) ? "land" : "sea";
      legs.push({ from: a, to: b, fromLL: aLL, toLL: bLL, category });
    }
    return legs;
  }

  window.PeriplusAtlasData = {
    CORPORA,
    corpusIsPeriplus,
    corpusIsGalen,
    corpusIsMateria,
    escapeHtml,
    toRoman,
    siteDisplayName,
    sitePlaceType,
    isInland,
    siteLatLng,
    loadCorpus,
    currentView,
    viewIdsForCorpus,
    viewLabel,
    buildFocusList,
    buildLegs,
  };
}());
