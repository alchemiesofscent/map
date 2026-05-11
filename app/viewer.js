/* Periplus · Atlas viewer
 *
 * Multi-corpus map viewer. Inputs: scroll wheel (debounced step advance),
 * arrow keys, marker clicks, site-strip clicks, dossier nav arrows. Smooth
 * flyTo transitions between sites. Sea legs and land/caravan legs are
 * visually distinguished. Galen corpus adds a route selector and a reader
 * pane joining passages + materia per stop.
 */

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
};

// Periplus pin classification
const INLAND_RX = /(Inland|Metropolis|Frontier|Region)/i;
const REGION_RX = /Region/i;

// Galen place_type → land/sea pin shape
const GALEN_LAND_TYPES = new Set(["city", "mine", "sanctuary", "mountain"]);
const GALEN_SEA_TYPES = new Set(["port", "island", "sea"]);

const ROMAN = [
  [1000, "M"], [900, "CM"], [500, "D"], [400, "CD"],
  [100, "C"], [90, "XC"], [50, "L"], [40, "XL"],
  [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"],
];

const state = {
  corpusId: "periplus",
  corpusCache: new Map(), // corpusId → loaded data bundle
  data: null,
  selectedView: "all",
  focusList: [],
  currentIndex: -1,
  map: null,
  layers: {},
  markers: new Map(),
  legs: [],
  legPolys: new Map(),
  legGlowPolys: new Map(),
  highlightedPlaceKeys: new Set(),
  activeMateriaKey: null,
  reduceMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  wheelLast: 0,
  wheelAccum: 0,
  cooldownUntil: 0,
  exploreMode: false,
  hintTimer: null,
  touchStartY: null,
  touchStartX: null,
};

// ───────────────────────── helpers ─────────────────────────

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
    while (num >= v) { out += s; num -= v; }
  }
  return out;
}

function loadJson(path) {
  return fetch(path).then((r) => {
    if (!r.ok) throw new Error(`Could not fetch ${path}: ${r.status}`);
    return r.json();
  });
}

function isPeriplus() { return state.corpusId === "periplus"; }
function isGalen() { return state.corpusId === "galen"; }

function siteDisplayName(site) {
  return site?.source_name ?? site?.display_name ?? "";
}

function sitePlaceType(site) {
  return site?.periplus_place_type ?? site?.place_type ?? "";
}

function isInland(site) {
  if (isPeriplus()) return INLAND_RX.test(sitePlaceType(site));
  // Galen
  const t = sitePlaceType(site).toLowerCase();
  if (GALEN_SEA_TYPES.has(t)) return false;
  return GALEN_LAND_TYPES.has(t) || t === "region";
}

function isRegion(site) {
  if (!site) return false;
  if (isPeriplus()) {
    if (REGION_RX.test(sitePlaceType(site))) return true;
    if ((site.location_precision ?? "").toLowerCase() === "region") return true;
    return false;
  }
  // Galen: regions and seas are pin-only.
  const t = sitePlaceType(site).toLowerCase();
  return t === "region" || t === "sea";
}

/** Galen: route lines connect only `primary` stops. Context and materia
 *  pins still render but no leg passes through them. For Periplus we fall
 *  back to the existing region filter. */
function isLineEndpoint(site) {
  if (isGalen()) return site?.kind === "primary";
  return !isRegion(site);
}

function siteLatLng(site) {
  return site?.has_geometry && site.lat !== null && site.lon !== null
    ? [site.lat, site.lon]
    : null;
}

// ───────────────────────── data loading ─────────────────────────

async function loadCorpus(corpusId) {
  if (state.corpusCache.has(corpusId)) return state.corpusCache.get(corpusId);
  const cfg = CORPORA[corpusId];
  if (!cfg) throw new Error(`Unknown corpus: ${corpusId}`);
  const entries = await Promise.all(
    Object.entries(cfg.paths).map(async ([k, p]) => [k, await loadJson(p)]),
  );
  const bundle = Object.fromEntries(entries);
  bundle.placesByKey = new Map(bundle.places.map((p) => [p.place_key, p]));
  if (bundle.sections) {
    bundle.sectionsByChunkId = new Map(bundle.sections.map((s) => [s.chunk_id, s]));
  }
  if (bundle.passages) {
    bundle.passagesById = new Map(bundle.passages.map((p) => [p.passage_id, p]));
  }
  if (bundle.materia) {
    bundle.materiaByKey = new Map(bundle.materia.map((m) => [m.materia_key, m]));
    // Index: place_key → array of {materia, link}
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
  state.corpusCache.set(corpusId, bundle);
  return bundle;
}

function currentView() {
  return state.data?.routeViews?.views?.[state.selectedView] ?? null;
}

function viewIdsForCorpus() {
  const cfg = CORPORA[state.corpusId];
  const fromData = Object.keys(state.data?.routeViews?.views ?? {});
  if (cfg.viewOrder) {
    return cfg.viewOrder.filter((id) => fromData.includes(id));
  }
  // Default: put `all` first.
  const ordered = [];
  if (fromData.includes("all")) ordered.push("all");
  for (const id of fromData) if (id !== "all" && !ordered.includes(id)) ordered.push(id);
  return ordered;
}

function viewLabel(viewId) {
  const cfg = CORPORA[state.corpusId];
  return cfg.viewLabels?.[viewId]
    ?? state.data?.routeViews?.views?.[viewId]?.label
    ?? viewId;
}

/** Return a focus list — one entry per place visited in route_views order,
 *  enriched with corpus-specific reader content. */
function buildFocusList() {
  const view = currentView();
  if (!view) return [];

  const list = [];
  if (isPeriplus()) {
    const sectionFocusByOrder = new Map();
    for (const sf of view.section_focus ?? []) {
      sectionFocusByOrder.set(sf.section_order, sf);
    }
    view.sites.forEach((site, idx) => {
      const sectionOrder = (site.section_numbers ?? [])[0] ?? null;
      const reviewed = sectionFocusByOrder.get(sectionOrder);
      const section = Number.isInteger(sectionOrder)
        ? state.data.sections.find((s) => s.section_order === sectionOrder)
        : null;
      list.push({
        index: idx,
        corpus: "periplus",
        site,
        siteKey: site.site_key,
        placeKey: site.place_key ?? site.site_key,
        sectionOrder,
        kind: isInland(site) ? "land" : "sea",
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
      });
    });
  } else if (isGalen()) {
    view.sites.forEach((site, idx) => {
      const passage = site.passage_id
        ? state.data.passagesById?.get(site.passage_id)
        : null;
      const greekName = (site.ancient_names_in_galen ?? [])[0]?.surface ?? null;
      // Materia at this place, filtered to those evidenced by *this* passage
      // when one exists; otherwise show all links to the place.
      const placeMateria = state.data.materiaByPlace?.get(site.place_key) ?? [];
      const filtered = site.passage_id
        ? placeMateria.filter((row) => row.link.passage_id === site.passage_id)
        : placeMateria;
      const candidates = filtered.length > 0 ? filtered : placeMateria;
      // Dedupe by materia_key. A single substance can link to the same place
      // from multiple passages or with different relations (e.g. cadmia is
      // both `acquired` and `observed` at Cyprus across SMT 9.3.b/c/d). Show
      // one chip per materia and union the relations.
      const byKey = new Map();
      for (const row of candidates) {
        const k = row.materia.materia_key;
        if (!byKey.has(k)) {
          byKey.set(k, {
            materiaKey: k,
            displayName: row.materia.display_name,
            greekName: row.materia.greek_name,
            relations: new Set(),
            evidencePhrases: [],
          });
        }
        const entry = byKey.get(k);
        if (row.link.relation) entry.relations.add(row.link.relation);
        if (row.link.evidence_phrase) entry.evidencePhrases.push(row.link.evidence_phrase);
      }
      const materia = [...byKey.values()].map((x) => ({
        materiaKey: x.materiaKey,
        displayName: x.displayName,
        greekName: x.greekName,
        relation: [...x.relations].join(" / "),
        evidencePhrase: x.evidencePhrases.join(" — "),
      }));
      list.push({
        index: idx,
        corpus: "galen",
        site,
        siteKey: site.site_key,
        placeKey: site.place_key,
        kind: isInland(site) ? "land" : "sea",
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
        materia,
      });
    });
  }
  return list;
}

function buildLegs(sites) {
  const eligible = sites.filter((s) => isLineEndpoint(s));
  const legs = [];
  for (let i = 1; i < eligible.length; i += 1) {
    const a = eligible[i - 1];
    const b = eligible[i];
    const aLL = siteLatLng(a);
    const bLL = siteLatLng(b);
    if (!aLL || !bLL) continue;
    // Cross-route boundary in the `all` view: skip — the trips aren't
    // contiguous and Galen explicitly forbids synthetic edges between trips.
    if (a.route_key !== b.route_key && state.selectedView === "all") continue;
    const category = isInland(a) || isInland(b) ? "land" : "sea";
    legs.push({ from: a, to: b, fromLL: aLL, toLL: bLL, category });
  }
  return legs;
}

// ───────────────────────── map ─────────────────────────

function initMap() {
  const map = L.map("map", {
    scrollWheelZoom: false,
    dragging: false,
    touchZoom: false,
    doubleClickZoom: false,
    keyboard: false,
    zoomControl: false,
    attributionControl: true,
    zoomAnimation: true,
    fadeAnimation: true,
    markerZoomAnimation: true,
  }).setView([18, 50], 5);

  L.tileLayer(
    "https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png",
    {
      subdomains: "abcd",
      maxZoom: 18,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &middot; <a href="https://carto.com/attributions">CARTO</a>',
    },
  ).addTo(map);

  state.map = map;
  state.layers.legGlow = L.layerGroup().addTo(map);
  state.layers.legs = L.layerGroup().addTo(map);
  state.layers.markers = L.layerGroup().addTo(map);

  requestAnimationFrame(() => map.invalidateSize());
}

function pinHtml(kind) {
  return `<span class="site-pin site-pin--${kind === "land" ? "land" : "sea"} site-pin--inactive" aria-hidden="true"></span>`;
}

function pinIcon(kind) {
  return L.divIcon({
    className: "site-pin-wrap",
    html: pinHtml(kind),
    iconSize: kind === "land" ? [16, 16] : [18, 18],
    iconAnchor: kind === "land" ? [8, 8] : [9, 9],
    tooltipAnchor: [10, 0],
    popupAnchor: [0, -10],
  });
}

function legStyle(category, active) {
  if (category === "land") {
    return {
      color: active ? "#d97a3f" : "#b35a2a",
      weight: active ? 3.5 : 2.4,
      opacity: active ? 0.95 : 0.78,
      dashArray: active ? "2 6" : "2 7",
      lineCap: "round",
      lineJoin: "round",
    };
  }
  return {
    color: active ? "#2c8aa1" : "#1d4f5e",
    weight: active ? 3.6 : 2.6,
    opacity: active ? 0.95 : 0.82,
    dashArray: null,
    lineCap: "round",
    lineJoin: "round",
  };
}

function legGlowStyle(category, active) {
  return {
    color: category === "land" ? "#d97a3f" : "#2c8aa1",
    weight: 10,
    opacity: active ? 0.22 : 0,
    lineCap: "round",
    lineJoin: "round",
  };
}

function drawRoute() {
  state.layers.legs.clearLayers();
  state.layers.legGlow.clearLayers();
  state.layers.markers.clearLayers();
  state.markers = new Map();
  state.legPolys = new Map();
  state.legGlowPolys = new Map();

  const view = currentView();
  if (!view) return;

  state.legs = buildLegs(view.sites);

  for (const leg of state.legs) {
    const legKey = `${leg.from.site_key}->${leg.to.site_key}`;
    const glow = L.polyline([leg.fromLL, leg.toLL], legGlowStyle(leg.category, false))
      .addTo(state.layers.legGlow);
    const poly = L.polyline([leg.fromLL, leg.toLL], legStyle(leg.category, false))
      .addTo(state.layers.legs);
    state.legPolys.set(legKey, { poly, leg });
    state.legGlowPolys.set(legKey, glow);
  }

  for (const site of view.sites) {
    const ll = siteLatLng(site);
    if (!ll) continue;
    const kind = isInland(site) ? "land" : "sea";
    const name = siteDisplayName(site);
    const marker = L.marker(ll, {
      icon: pinIcon(kind),
      keyboard: true,
      title: name,
      alt: name,
      riseOnHover: true,
    });
    marker.bindTooltip(name, {
      direction: "right",
      offset: [12, 0],
      className: "site-tip",
    });
    marker.on("click", () => {
      const idx = state.focusList.findIndex((f) => f.siteKey === site.site_key);
      if (idx >= 0) goTo(idx);
    });
    marker.addTo(state.layers.markers);
    state.markers.set(site.site_key, { marker, kind, placeKey: site.place_key ?? site.site_key });
  }
}

function fitToView() {
  const view = currentView();
  const points = (view?.drawable_line_points ?? []).map((p) => [p.lat, p.lon]);
  if (points.length >= 2) {
    state.map.fitBounds(L.latLngBounds(points).pad(0.32), { maxZoom: 6, animate: false });
    return;
  }
  // Fallback: fit to all pinned sites (e.g. materia_observations view).
  const sitePoints = (view?.sites ?? [])
    .map((s) => siteLatLng(s))
    .filter(Boolean);
  if (sitePoints.length >= 2) {
    state.map.fitBounds(L.latLngBounds(sitePoints).pad(0.32), { maxZoom: 6, animate: false });
  } else if (sitePoints.length === 1) {
    state.map.setView(sitePoints[0], 6, { animate: false });
  }
}

// ───────────────────────── DOM render ─────────────────────────

function renderMasthead() {
  const cfg = CORPORA[state.corpusId];
  document.getElementById("masthead-series").textContent = cfg.series;
  const titleEl = document.getElementById("masthead-title");
  const [a, b] = cfg.title;
  titleEl.innerHTML = `
    <span>${escapeHtml(a)}</span>
    <span class="masthead__title-sep">·</span>
    <span>${escapeHtml(b)}</span>
  `;
}

function renderRouteButtons() {
  const wrap = document.getElementById("view-control-routes");
  const ids = viewIdsForCorpus();
  wrap.innerHTML = ids
    .map((id) => {
      const active = id === state.selectedView;
      return `<button type="button" data-view="${escapeHtml(id)}" aria-pressed="${active ? "true" : "false"}">${escapeHtml(viewLabel(id))}</button>`;
    })
    .join("");
}

function renderCorpusButtons() {
  document.querySelectorAll("[data-corpus]").forEach((btn) => {
    btn.setAttribute("aria-pressed", btn.dataset.corpus === state.corpusId ? "true" : "false");
  });
}

function renderStrip() {
  const rail = document.getElementById("strip-rail");
  rail.innerHTML = state.focusList
    .map((f, idx) => {
      const label = f.corpus === "galen" && Number.isFinite(f.site.route_order)
        ? `${f.site.route_order} · ${f.displayName}`
        : f.corpus === "periplus" && Number.isInteger(f.sectionOrder)
          ? `${f.sectionOrder} · ${f.displayName}`
          : f.displayName;
      return `
        <button
          type="button"
          class="strip__dot"
          data-index="${idx}"
          data-route="${escapeHtml(f.site.route_key ?? "")}"
          data-kind="${f.kind}"
          role="option"
          aria-selected="false"
          aria-label="${escapeHtml(f.displayName)}"
        >
          <span class="strip__dot__label">${escapeHtml(label)}</span>
        </button>
      `;
    })
    .join("");
  rail.querySelectorAll(".strip__dot").forEach((btn) => {
    btn.addEventListener("click", () => goTo(Number(btn.dataset.index)));
  });
}

function applyTextTransition(el, value) {
  if (state.reduceMotion) {
    el.textContent = value;
    return;
  }
  el.classList.add("is-changing");
  setTimeout(() => {
    el.textContent = value;
    requestAnimationFrame(() => el.classList.remove("is-changing"));
  }, 180);
}

function applyHtmlTransition(el, html) {
  if (state.reduceMotion) {
    el.innerHTML = html;
    return;
  }
  el.classList.add("is-changing");
  setTimeout(() => {
    el.innerHTML = html;
    requestAnimationFrame(() => el.classList.remove("is-changing"));
  }, 180);
}

function eyebrowParts(focus) {
  if (focus.corpus === "periplus") {
    const route = focus.routeLabel ? `${focus.routeLabel} route` : viewLabel(state.selectedView);
    const type = focus.placeType || (focus.kind === "land" ? "Inland" : "Coastal");
    const section = Number.isInteger(focus.sectionOrder) ? `Section ${focus.sectionOrder}` : (focus.chapter || "");
    return { route, type, section };
  }
  // Galen
  const route = focus.routeLabel || viewLabel(state.selectedView);
  const typeBits = [focus.placeType];
  if (focus.siteKind && focus.siteKind !== "primary") typeBits.push(focus.siteKind);
  const type = typeBits.filter(Boolean).join(" · ");
  return {
    route,
    type: type || (focus.kind === "land" ? "Inland" : "Coastal"),
    section: focus.kuhnCitation ? `K. ${focus.kuhnCitation}` : "",
  };
}

function renderMateriaList(focus) {
  const wrap = document.getElementById("dossier-materia");
  const list = document.getElementById("dossier-materia-list");
  if (focus.corpus !== "galen" || !focus.materia || focus.materia.length === 0) {
    wrap.hidden = true;
    list.innerHTML = "";
    return;
  }
  wrap.hidden = false;
  list.innerHTML = focus.materia
    .map((m) => {
      const greek = m.greekName ? `<span class="dossier__materia-chip__greek" lang="grc">${escapeHtml(m.greekName)}</span>` : "";
      const rel = m.relation ? `<span class="dossier__materia-chip__relation">${escapeHtml(m.relation)}</span>` : "";
      return `<li><button type="button" class="dossier__materia-chip" data-materia="${escapeHtml(m.materiaKey)}" aria-pressed="false" title="${escapeHtml(m.evidencePhrase ?? "")}">${escapeHtml(m.displayName)}${greek}${rel}</button></li>`;
    })
    .join("");
  list.querySelectorAll(".dossier__materia-chip").forEach((btn) => {
    btn.addEventListener("click", () => {
      toggleMateriaHighlight(btn.dataset.materia);
    });
    if (state.activeMateriaKey === btn.dataset.materia) {
      btn.setAttribute("aria-pressed", "true");
    }
  });
}

function renderDossier(focus) {
  if (!focus) return;
  const { route, type, section } = eyebrowParts(focus);

  document.getElementById("dossier-route").textContent = route;
  document.getElementById("dossier-type").textContent = type;
  document.getElementById("dossier-section").textContent = section;

  applyTextTransition(document.getElementById("dossier-title"), focus.displayName);
  applyTextTransition(document.getElementById("dossier-greek-name"), focus.greekName ?? "");

  const translationEl = document.getElementById("dossier-translation");
  let translationHtml;
  if (focus.translation) {
    translationHtml = escapeHtml(focus.translation);
  } else if (focus.corpus === "galen" && focus.siteKind && focus.siteKind !== "primary") {
    // Galen context / materia pins don't have a passage of their own — they
    // show up in the narrative as background mentions or material-source
    // observations. Distinguish that from a genuinely unreviewed translation.
    const role = focus.siteKind === "materia" ? "Materia-medica observation" : "Context location";
    translationHtml = `<span class="dossier__translation-placeholder">${role} — no Galen passage attached.</span>`;
  } else {
    translationHtml = `<span class="dossier__translation-placeholder">Translation pending review.</span>`;
  }
  applyHtmlTransition(translationEl, translationHtml);

  const greekEl = document.getElementById("dossier-greek");
  greekEl.textContent = focus.greekText || "";
  document.getElementById("dossier-greek-block").hidden = !focus.greekText;

  renderMateriaList(focus);

  const sourceEl = document.getElementById("dossier-source");
  let sourceBits;
  if (focus.corpus === "galen") {
    sourceBits = [focus.kuhnCitation && `K. ${focus.kuhnCitation}`, focus.orderBasis].filter(Boolean);
  } else {
    sourceBits = [focus.modernId, focus.chapter].filter(Boolean);
  }
  sourceEl.textContent = sourceBits.join(" · ");

  const link = document.getElementById("dossier-pleiades");
  if (focus.pleiadesUri) {
    link.href = focus.pleiadesUri;
    link.textContent = `Pleiades ${focus.pleiadesId ?? ""} ↗`.trim();
    link.hidden = false;
  } else {
    link.hidden = true;
  }

  document.getElementById("counter-roman").textContent = toRoman(focus.index + 1);
  document.getElementById("counter-total").textContent = toRoman(state.focusList.length);

  document.getElementById("prev-step").disabled = focus.index <= 0;
  document.getElementById("next-step").disabled = focus.index >= state.focusList.length - 1;
}

function highlightActive(focus) {
  document.querySelectorAll(".strip__dot").forEach((el) => {
    const isActive = Number(el.dataset.index) === focus.index;
    el.classList.toggle("is-active", isActive);
    el.setAttribute("aria-selected", isActive ? "true" : "false");
    if (isActive) {
      el.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  });

  for (const [key, entry] of state.markers.entries()) {
    const pin = entry.marker.getElement()?.querySelector(".site-pin");
    if (!pin) continue;
    pin.classList.toggle("site-pin--active", key === focus.siteKey);
    pin.classList.toggle("site-pin--inactive", key !== focus.siteKey);
  }

  for (const [key, { poly, leg }] of state.legPolys.entries()) {
    const isActive = leg.to.site_key === focus.siteKey;
    poly.setStyle(legStyle(leg.category, isActive));
    const glow = state.legGlowPolys.get(key);
    if (glow) glow.setStyle(legGlowStyle(leg.category, isActive));
    if (isActive) poly.bringToFront();
  }
}

function applyMateriaHighlightDecoration() {
  for (const [, entry] of state.markers.entries()) {
    const pin = entry.marker.getElement()?.querySelector(".site-pin");
    if (!pin) continue;
    pin.classList.toggle(
      "site-pin--materia-linked",
      state.highlightedPlaceKeys.has(entry.placeKey),
    );
  }
}

function toggleMateriaHighlight(materiaKey) {
  if (state.activeMateriaKey === materiaKey) {
    state.activeMateriaKey = null;
    state.highlightedPlaceKeys = new Set();
  } else {
    state.activeMateriaKey = materiaKey;
    const m = state.data.materiaByKey?.get(materiaKey);
    state.highlightedPlaceKeys = new Set((m?.place_links ?? []).map((l) => l.place_key));
  }
  applyMateriaHighlightDecoration();
  document.querySelectorAll(".dossier__materia-chip").forEach((btn) => {
    btn.setAttribute("aria-pressed", btn.dataset.materia === state.activeMateriaKey ? "true" : "false");
  });
}

// ───────────────────────── navigation ─────────────────────────

function dossierOffsetCenter(targetLatLng, zoom) {
  const target = L.latLng(targetLatLng[0], targetLatLng[1]);
  const dossierEl = document.querySelector(".dossier");
  if (!dossierEl) return target;
  const rect = dossierEl.getBoundingClientRect();
  const point = state.map.project(target, zoom);

  if (window.innerWidth < 720) {
    const offsetY = (window.innerHeight - rect.top) / 2;
    return state.map.unproject(L.point(point.x, point.y + offsetY), zoom);
  }
  const offsetX = (rect.right + window.innerWidth) / 2 - window.innerWidth / 2;
  return state.map.unproject(L.point(point.x - offsetX, point.y), zoom);
}

/** Decide the map zoom level when focusing a site.
 *
 * Periplus keeps its existing fixed zoom — the corpus spans the Red Sea
 * and Indian Ocean, and the fixed view shows the basin cleanly.
 *
 * Galen routes range from a 5 km hop (Soloi → mine) to a 90 km sea leg
 * (Alex Troas → Lemnos) to broad regional sweeps; a single fixed zoom
 * either loses local context (Lemnos cities sitting on top of each
 * other) or pulls too far back. We pick a zoom based on the distance to
 * the nearest other geometry-bearing site in the current view, so each
 * stop gets a frame proportional to its closest neighbour.
 */
function targetZoomFor(focus) {
  if (focus.corpus !== "galen") {
    return focus.kind === "land" ? 6.4 : 6.2;
  }
  if (!focus.latLng) return 7;
  const here = L.latLng(focus.latLng[0], focus.latLng[1]);
  let minDistKm = Infinity;
  for (const f of state.focusList) {
    if (f === focus || !f.latLng) continue;
    const d = here.distanceTo(L.latLng(f.latLng[0], f.latLng[1])) / 1000;
    if (d < minDistKm) minDistKm = d;
  }
  if (!Number.isFinite(minDistKm)) return 7;
  if (minDistKm < 5)    return 11;
  if (minDistKm < 15)   return 10;
  if (minDistKm < 50)   return 9;
  if (minDistKm < 150)  return 8;
  if (minDistKm < 400)  return 7;
  if (minDistKm < 1000) return 6;
  return 5;
}

function goTo(index, options = {}) {
  if (index < 0 || index >= state.focusList.length) return;
  if (index === state.currentIndex && !options.force) return;
  state.currentIndex = index;
  const focus = state.focusList[index];
  renderDossier(focus);
  highlightActive(focus);
  applyMateriaHighlightDecoration(); // markers were just re-classed; re-apply

  if (focus.latLng && !state.exploreMode) {
    const targetZoom = targetZoomFor(focus);
    const center = dossierOffsetCenter(focus.latLng, targetZoom);
    if (state.reduceMotion || options.instant) {
      state.map.setView(center, targetZoom, { animate: false });
    } else {
      state.map.flyTo(center, targetZoom, {
        duration: 1.35,
        easeLinearity: 0.28,
      });
    }
  }
}

function next() { goTo(Math.min(state.currentIndex + 1, state.focusList.length - 1)); }
function prev() { goTo(Math.max(state.currentIndex - 1, 0)); }

// ───────────────────────── input handlers ─────────────────────────

function setExploreMode(on) {
  state.exploreMode = !!on;
  document.body.dataset.explore = state.exploreMode ? "true" : "false";
  if (!state.map) return;
  if (state.exploreMode) {
    state.map.dragging.enable();
    state.map.scrollWheelZoom.enable();
    state.map.touchZoom.enable();
    state.map.doubleClickZoom.enable();
  } else {
    state.map.dragging.disable();
    state.map.scrollWheelZoom.disable();
    state.map.touchZoom.disable();
    state.map.doubleClickZoom.disable();
  }
}

function bindInputs() {
  const QUIET_MS = 280;
  const COOLDOWN_MS = 850;
  const THRESHOLD = 90;

  window.addEventListener(
    "wheel",
    (e) => {
      if (state.exploreMode) return;
      const target = e.target;
      if (target && target.closest && target.closest(".dossier")) return;
      e.preventDefault();
      const now = performance.now();
      const sincePrev = now - state.wheelLast;
      state.wheelLast = now;

      if (now < state.cooldownUntil) return;
      if (sincePrev > QUIET_MS) state.wheelAccum = 0;

      const delta =
        Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
      state.wheelAccum += delta;

      if (state.wheelAccum > THRESHOLD) {
        next();
        state.wheelAccum = 0;
        state.cooldownUntil = now + COOLDOWN_MS;
      } else if (state.wheelAccum < -THRESHOLD) {
        prev();
        state.wheelAccum = 0;
        state.cooldownUntil = now + COOLDOWN_MS;
      }
    },
    { passive: false },
  );

  window.addEventListener("keydown", (e) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const tag = document.activeElement?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
    switch (e.key) {
      case "ArrowRight":
      case "ArrowDown":
      case "PageDown":
      case " ":
        e.preventDefault();
        next();
        break;
      case "ArrowLeft":
      case "ArrowUp":
      case "PageUp":
        e.preventDefault();
        prev();
        break;
      case "Home":
        e.preventDefault();
        goTo(0);
        break;
      case "End":
        e.preventDefault();
        goTo(state.focusList.length - 1);
        break;
      case "Escape":
        if (state.activeMateriaKey) {
          toggleMateriaHighlight(state.activeMateriaKey);
        } else if (state.exploreMode) {
          document.getElementById("toggle-explore").checked = false;
          setExploreMode(false);
        }
        break;
    }
  });

  window.addEventListener("touchstart", (e) => {
    if (state.exploreMode) return;
    const target = e.target;
    if (target && target.closest && target.closest(".dossier")) {
      state.touchStartX = state.touchStartY = null;
      return;
    }
    const t = e.touches[0];
    state.touchStartX = t.clientX;
    state.touchStartY = t.clientY;
  }, { passive: true });

  window.addEventListener("touchend", (e) => {
    if (state.exploreMode) return;
    if (state.touchStartX === null) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - state.touchStartX;
    const dy = t.clientY - state.touchStartY;
    state.touchStartX = state.touchStartY = null;
    const absX = Math.abs(dx);
    const absY = Math.abs(dy);
    if (Math.max(absX, absY) < 60) return;
    if (absX > absY) {
      if (dx < 0) next();
      else prev();
    } else {
      if (dy < 0) next();
      else prev();
    }
  }, { passive: true });

  document.getElementById("prev-step").addEventListener("click", prev);
  document.getElementById("next-step").addEventListener("click", next);

  // Delegated route-view selector — buttons re-render per corpus.
  document.getElementById("view-control-routes").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-view]");
    if (btn) setView(btn.dataset.view);
  });

  // Delegated corpus selector.
  document.querySelector(".corpus-control").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-corpus]");
    if (btn) setCorpus(btn.dataset.corpus);
  });

  document.getElementById("toggle-explore").addEventListener("change", (e) => {
    setExploreMode(e.target.checked);
  });

  const hint = document.getElementById("hint-banner");
  hint.addEventListener("click", () => {
    hint.classList.remove("hint--shown");
  });

  let resizeTimer = null;
  window.addEventListener("resize", () => {
    if (state.map) state.map.invalidateSize();
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (state.currentIndex >= 0 && !state.exploreMode) {
        goTo(state.currentIndex, { force: true, instant: true });
      }
    }, 160);
  });
}

function showHintBriefly() {
  const hint = document.getElementById("hint-banner");
  requestAnimationFrame(() => hint.classList.add("hint--shown"));
  if (state.hintTimer) clearTimeout(state.hintTimer);
  state.hintTimer = setTimeout(() => hint.classList.remove("hint--shown"), 5200);
}

// ───────────────────────── view + corpus switching ─────────────────────────

function setView(viewId, options = {}) {
  if (!state.data?.routeViews?.views?.[viewId]) return;
  const previousFocus = state.focusList[state.currentIndex];
  state.selectedView = viewId;
  state.activeMateriaKey = null;
  state.highlightedPlaceKeys = new Set();

  document.querySelectorAll("[data-view]").forEach((btn) => {
    btn.setAttribute("aria-pressed", btn.dataset.view === viewId ? "true" : "false");
  });

  state.focusList = buildFocusList();
  state.currentIndex = -1;

  drawRoute();
  renderStrip();
  fitToView();

  let nextIndex = 0;
  if (previousFocus) {
    const match = state.focusList.findIndex((f) => f.siteKey === previousFocus.siteKey);
    if (match >= 0) nextIndex = match;
  }
  goTo(nextIndex, { instant: options.instant });
}

async function setCorpus(corpusId, options = {}) {
  if (!CORPORA[corpusId]) return;
  if (corpusId === state.corpusId && state.data) return;
  state.corpusId = corpusId;
  state.activeMateriaKey = null;
  state.highlightedPlaceKeys = new Set();

  state.data = await loadCorpus(corpusId);
  const cfg = CORPORA[corpusId];

  // Choose initial view: prefer a stored default, else the configured default.
  const ids = Object.keys(state.data.routeViews?.views ?? {});
  const wantedView = ids.includes(cfg.defaultView) ? cfg.defaultView : ids[0];
  state.selectedView = wantedView;

  renderMasthead();
  renderCorpusButtons();
  renderRouteButtons();

  setView(wantedView, { instant: options.instant ?? true });
}

// ───────────────────────── boot ─────────────────────────

async function main() {
  try {
    initMap();
    bindInputs();
    await setCorpus("periplus", { instant: true });
    showHintBriefly();
  } catch (err) {
    console.error(err);
    const title = document.getElementById("dossier-title");
    const trans = document.getElementById("dossier-translation");
    if (title) title.textContent = "Could not load tour data";
    if (trans) {
      trans.textContent =
        "Serve the repository root with `python3 -m http.server 8000` and open /app/.";
    }
  }
}

main();
