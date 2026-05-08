const DATA_FILES = {
  places: "../../data/generated/periplus/places_authority.json",
  sections: "../../data/generated/periplus/raw_sections.json",
  journey: "../../data/generated/periplus/journey_route.json",
  routeViews: "../../data/generated/periplus/route_views.json",
};

const GREEK_PLACEHOLDER =
  "Greek text not loaded in this sample. Add First1KGreek/TEI extraction here.";

const ROUTE_MATCH_ALIASES = new Map([
  ["cane", "kane"],
  ["cane harbor", "kane"],
  ["dioscorida", "dioskouridou"],
  ["dioscorida island", "dioskouridou island"],
  ["dioscorides island", "dioskouridou island"],
  ["moscha harbor", "moscha limen"],
  ["muza", "mouza"],
  ["sabbatha", "saubatha"],
  ["syagros", "suagros"],
  ["tabae", "tabai"],
]);

const state = {
  places: [],
  sections: [],
  journey: null,
  routeViews: null,
  selectedView: "all",
  visibleSteps: [],
  visibleFocusRecords: [],
  byPlace: new Map(),
  bySection: new Map(),
  currentIndex: -1,
  observer: null,
  resizeObserver: null,
  map: null,
  layers: {},
  routeMarkers: new Map(),
  offRouteMarkers: new Map(),
  routeSegments: new Map(),
  sailDot: null,
  sailLine: null,
  sailFrame: null,
  reduceMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  coarsePointer: window.matchMedia("(pointer: coarse)").matches,
};

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function placeLatLng(place) {
  if (place && place.lat !== null && place.lon !== null) return [place.lat, place.lon];
  return null;
}

function routeLatLng(site) {
  if (site && site.has_geometry && site.lat !== null && site.lon !== null) return [site.lat, site.lon];
  return null;
}

function clamp(value, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

function legKey(from, to) {
  return `${from}->${to}`;
}

function loadJson(path) {
  return fetch(path).then((response) => {
    if (!response.ok) throw new Error(`Unable to load ${path}: ${response.status}`);
    return response.json();
  });
}

async function loadData() {
  const [places, sections, journey, routeViews] = await Promise.all([
    loadJson(DATA_FILES.places),
    loadJson(DATA_FILES.sections),
    loadJson(DATA_FILES.journey),
    loadJson(DATA_FILES.routeViews),
  ]);

  state.places = places;
  state.sections = sections;
  state.journey = journey;
  state.routeViews = routeViews;
  state.byPlace = new Map(places.map((place) => [place.place_key, place]));
  state.bySection = new Map(sections.map((section) => [section.chunk_id, section]));
  state.visibleSteps = stepsForView("all");
}

function normalizeForMatch(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/ē/g, "e")
    .replace(/ō/g, "o")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/([a-z])\1+/g, "$1")
    .trim();
}

function matchTermVariants(term) {
  const normalized = normalizeForMatch(term);
  if (!normalized) return [];
  const variants = [normalized];
  const alias = ROUTE_MATCH_ALIASES.get(normalized);
  if (alias) variants.push(normalizeForMatch(alias));
  return uniqueBy(variants, (variant) => variant);
}

function uniqueBy(items, keyFn) {
  const seen = new Set();
  const result = [];
  for (const item of items) {
    const key = keyFn(item);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

/**
 * Build linked HTML from a plain text translation and a list of place mentions.
 *
 * Strategy:
 *  1. HTML-escape the entire string so user/data text cannot inject markup.
 *  2. Sort mentions by descending surface length so "Ptolemais of the Hunts"
 *     wins over a stray "Ptolemais" that might appear as part of a longer form.
 *  3. Walk the escaped string left-to-right; for each occurrence of an unused
 *     surface, splice in a <button class="place-link"> and skip past it so we
 *     do not double-link the same characters.
 */
function linkifyText(text, placeMentions) {
  const escaped = escapeHtml(text ?? "");
  if (!placeMentions || !placeMentions.length) return escaped;

  const mentions = [...placeMentions]
    .filter((m) => m && m.surface)
    .sort((a, b) => b.surface.length - a.surface.length);

  const tokens = [];
  let cursor = 0;

  while (cursor < escaped.length) {
    let bestIndex = -1;
    let bestMention = null;

    for (const mention of mentions) {
      const surface = escapeHtml(mention.surface);
      if (!surface) continue;
      const idx = escaped.indexOf(surface, cursor);
      if (idx === -1) continue;
      if (bestIndex === -1 || idx < bestIndex || (idx === bestIndex && surface.length > escapeHtml(bestMention.surface).length)) {
        bestIndex = idx;
        bestMention = mention;
      }
    }

    if (bestIndex === -1 || !bestMention) {
      tokens.push(escaped.slice(cursor));
      break;
    }

    if (bestIndex > cursor) tokens.push(escaped.slice(cursor, bestIndex));
    const surface = escapeHtml(bestMention.surface);
    const kind = escapeHtml(bestMention.kind ?? "off_route");
    const placeKey = escapeHtml(bestMention.place_key);
    tokens.push(
      `<button type="button" class="place-link place-link--${kind}" data-place-key="${placeKey}" data-kind="${kind}">${surface}</button>`,
    );
    cursor = bestIndex + surface.length;
  }

  return tokens.join("");
}

function popupHtml(place) {
  const greek = Array.isArray(place.greek_names) && place.greek_names.length
    ? `<p class="popup-meta">${escapeHtml(place.greek_names.join(", "))}</p>`
    : "";
  const pleiades = place.pleiades_uri
    ? `<p class="popup-meta"><a href="${escapeHtml(place.pleiades_uri)}" target="_blank" rel="noreferrer">Pleiades ${escapeHtml(place.pleiades_id)}</a></p>`
    : "";
  return `
    <div class="popup-title">${escapeHtml(place.display_name)}</div>
    ${greek}
    <p class="popup-meta">Type: ${escapeHtml(place.place_type)}</p>
    <p class="popup-meta">Certainty: ${escapeHtml(place.certainty)}</p>
    <p class="popup-meta">${escapeHtml(place.notes)}</p>
    ${pleiades}
  `;
}

function routeSitePopupHtml(site) {
  const pleiades = site.pleiades_uri
    ? `<p class="popup-meta"><a href="${escapeHtml(site.pleiades_uri)}" target="_blank" rel="noreferrer">Pleiades ${escapeHtml(site.pleiades_id)}</a></p>`
    : "";
  const location = [site.modern_identification, site.modern_country].filter(Boolean).join(", ");
  const locationLine = location ? `<p class="popup-meta">${escapeHtml(location)}</p>` : "";
  const source = site.github_location_url
    ? `<p class="popup-meta"><a href="${escapeHtml(site.github_location_url)}" target="_blank" rel="noreferrer">Reviewed webmap page</a></p>`
    : "";
  return `
    <div class="popup-title">${escapeHtml(site.source_name)}</div>
    <p class="popup-meta">${escapeHtml(site.route_label)} route · ${escapeHtml(site.periplus_chapter)}</p>
    <p class="popup-meta">Type: ${escapeHtml(site.periplus_place_type)}</p>
    <p class="popup-meta">Precision: ${escapeHtml(site.location_precision)}</p>
    ${locationLine}
    ${pleiades}
    ${source}
  `;
}

function routeMarkerIcon(active = false) {
  return L.divIcon({
    className: `route-pin-icon${active ? " route-pin-icon--active" : ""}`,
    html: '<span class="route-pin__dot" aria-hidden="true"></span>',
    iconSize: [22, 22],
    iconAnchor: [11, 11],
    popupAnchor: [0, -13],
    tooltipAnchor: [14, 0],
  });
}

function offRouteMarkerIcon() {
  return L.divIcon({
    className: "offroute-pin-icon",
    html: '<span class="offroute-pin__dot" aria-hidden="true"></span>',
    iconSize: [14, 14],
    iconAnchor: [7, 7],
    popupAnchor: [0, -9],
    tooltipAnchor: [10, 0],
  });
}

function routeViewLegStyle(active) {
  return {
    color: active ? "#1f7989" : "#2f8fa0",
    weight: active ? 3.5 : 2,
    opacity: active ? 0.48 : 0.26,
    dashArray: "5 8",
    lineCap: "round",
    lineJoin: "round",
  };
}

function initMap() {
  const map = L.map("map", {
    scrollWheelZoom: false,
    dragging: !state.coarsePointer,
    touchZoom: !state.coarsePointer,
    doubleClickZoom: true,
    zoomControl: true,
    zoomAnimation: false,
    markerZoomAnimation: false,
  }).setView([20.5, 37], 6);

  L.tileLayer(
    "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png",
    {
      subdomains: "abcd",
      maxZoom: 18,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    },
  ).addTo(map);

  let tileErrorWarned = false;
  map.on("tileerror", () => {
    if (tileErrorWarned) return;
    tileErrorWarned = true;
    console.warn(
      "Basemap tiles failed to load. Check the network/CDN; the route overlay still renders.",
    );
  });

  state.map = map;
  state.layers.legs = L.layerGroup().addTo(map);
  state.layers.offRoute = L.layerGroup().addTo(map);
  state.layers.routeMarkers = L.layerGroup().addTo(map);
  state.layers.sailing = L.layerGroup().addTo(map);

  // First invalidateSize on the next animation frame so the map measures the
  // sticky container after layout has settled.
  requestAnimationFrame(() => map.invalidateSize());

  // Re-measure if the .map-stage box changes (e.g., desktop ↔ mobile toggle).
  if (typeof ResizeObserver !== "undefined") {
    const stage = document.querySelector(".map-stage");
    if (stage) {
      state.resizeObserver = new ResizeObserver(() => map.invalidateSize());
      state.resizeObserver.observe(stage);
    }
  }
}

function currentView() {
  return state.routeViews?.views?.[state.selectedView] ?? null;
}

function stepSectionOrder(step) {
  const ref = step?.section_refs?.[0];
  return state.bySection.get(ref)?.section_order ?? null;
}

function sectionInRange(sectionOrder, range) {
  return (
    Number.isInteger(sectionOrder) &&
    sectionOrder >= range.start_section &&
    sectionOrder <= range.end_section
  );
}

function stepsForView(viewId) {
  const view = state.routeViews?.views?.[viewId];
  if (!view) return [];
  return state.journey.steps.filter((step) => sectionInRange(stepSectionOrder(step), view.section_range));
}

function currentFocusRecord(index = state.currentIndex) {
  return state.visibleFocusRecords[index] ?? null;
}

function stepForFocus(index = state.currentIndex) {
  const focus = currentFocusRecord(index);
  if (!focus) return null;
  return state.visibleSteps.find((step) => step.step_id === focus.step_id) ?? null;
}

function routeSiteByKey(siteKey) {
  if (!siteKey) return null;
  return (currentView()?.sites ?? []).find((site) => site.site_key === siteKey) ?? null;
}

function reviewedFocusForStep(step) {
  const sectionOrder = stepSectionOrder(step);
  return (currentView()?.section_focus ?? []).find((section) => section.section_order === sectionOrder) ?? null;
}

function fallbackFocusForStep(step) {
  const sectionOrder = stepSectionOrder(step);
  const routeSites = routeSitesForStep(step);
  const site = routeSites.find((candidate) => routeLatLng(candidate)) ?? routeSites[0] ?? null;
  const title = displayTitleForStep(step);
  return {
    focus_id: `${step.step_id}_focus_01`,
    step_id: step.step_id,
    section_refs: step.section_refs ?? [],
    section_order: sectionOrder,
    focus_order: 1,
    display_name: title,
    source_name: site?.source_name ?? title,
    card_title: step.title,
    route_site_key: site?.site_key ?? null,
    geometry_policy: site?.has_geometry ? "mapped" : "needs_followup",
    mapping_status: site?.has_geometry ? "mapped" : "needs_followup",
    note: routeContextForStep(step),
    context_places: [],
    reviewed: false,
  };
}

function buildFocusRecordsForStep(step) {
  const reviewed = reviewedFocusForStep(step);
  if (!reviewed?.focus_sequence?.length) return [fallbackFocusForStep(step)];

  return reviewed.focus_sequence.map((focus) => ({
    ...focus,
    step_id: step.step_id,
    section_refs: step.section_refs ?? [],
    card_title: reviewed.card_title || step.title,
    context_places: reviewed.context_places ?? [],
    reviewed: true,
  }));
}

function rebuildVisibleFocusRecords() {
  state.visibleFocusRecords = state.visibleSteps.flatMap((step) => buildFocusRecordsForStep(step));
}

function focusRecordsForStep(step) {
  return state.visibleFocusRecords.filter((focus) => focus.step_id === step.step_id);
}

function routeSitesForSection(sectionOrder) {
  const view = currentView();
  if (!view || !Number.isInteger(sectionOrder)) return [];
  return view.sites.filter((site) => site.section_numbers.includes(sectionOrder));
}

function rawSectionForStep(step) {
  const ref = step?.section_refs?.[0];
  return state.bySection.get(ref) ?? null;
}

function siteSectionDistance(site, sectionOrder) {
  const sections = site.section_numbers || [];
  if (!sections.length || !Number.isInteger(sectionOrder)) return Number.POSITIVE_INFINITY;
  return Math.min(...sections.map((section) => Math.abs(section - sectionOrder)));
}

function routeSiteTerms(site) {
  const values = [
    site.source_name,
    site.input_name,
    site.page_metadata?.page_title,
    site.page_metadata?.page_ancient_toponym,
  ];
  return values.flatMap(matchTermVariants).filter((term) => term.length >= 4);
}

function stepPlaceTerms(step) {
  const section = rawSectionForStep(step);
  const values = [
    step.title,
    step.translation,
    ...(section?.places ?? []).flatMap((place) => [
      place.english_label,
      place.greek_surface,
    ]),
  ];
  return values.flatMap(matchTermVariants).filter((term) => term.length >= 4);
}

function siteMatchesStep(site, step) {
  const siteTerms = routeSiteTerms(site);
  const placeTerms = stepPlaceTerms(step);
  if (!siteTerms.length || !placeTerms.length) return false;
  return siteTerms.some((siteTerm) => {
    return placeTerms.some((placeTerm) => {
      if (placeTerm === siteTerm) return true;
      if (placeTerm.includes(siteTerm) || siteTerm.includes(placeTerm)) return true;
      return false;
    });
  });
}

function routeSitesForStep(step) {
  const view = currentView();
  const sectionOrder = stepSectionOrder(step);
  if (!view || !step || !Number.isInteger(sectionOrder)) return [];

  const exact = routeSitesForSection(sectionOrder);
  if (exact.length) return exact;

  const mentioned = view.sites
    .filter((site) => siteMatchesStep(site, step))
    .sort((a, b) => {
      const diff = siteSectionDistance(a, sectionOrder) - siteSectionDistance(b, sectionOrder);
      if (diff !== 0) return diff;
      return a.source_order - b.source_order;
    });
  const close = mentioned.filter((site) => siteSectionDistance(site, sectionOrder) <= 2);
  return uniqueBy(close.length ? close : mentioned.slice(0, 1), (site) => site.site_key);
}

function fallbackPlaceTitleForStep(step) {
  const section = rawSectionForStep(step);
  const places = section?.places ?? [];
  const scored = places
    .map((place, index) => {
      const role = normalizeForMatch(place.role);
      let score = 0;
      if (/(emporium|emporia|port|harbor|harbour|market|city|island|frontier)/.test(role)) score += 4;
      if (/(destination|source|route|previous)/.test(role)) score += 2;
      if (/(region|territory|country|mainland|comparison|alternate)/.test(role)) score -= 1;
      return { place, score, index };
    })
    .filter((item) => item.place.english_label)
    .sort((a, b) => b.score - a.score || a.index - b.index);
  const best = scored.filter((item) => item.score > 0).slice(0, 2);
  return best.map((item) => item.place.english_label).join(" · ");
}

function displayTitleForStep(step) {
  const routeSites = routeSitesForStep(step);
  if (routeSites.length) return routeSites.map((site) => site.source_name.trim()).join(" · ");
  if (/trade goods/i.test(step.title)) return fallbackPlaceTitleForStep(step) || step.title;
  return step.title;
}

function routeContextForStep(step) {
  const routeSites = routeSitesForStep(step);
  if (!routeSites.length) return "";
  return routeSites
    .map((site) => {
      const parts = [site.periplus_place_type, site.periplus_chapter].filter(Boolean);
      return `${site.source_name}${parts.length ? ` (${parts.join(", ")})` : ""}`;
    })
    .join(" · ");
}

function nearestPreviousMappedRouteSite(sectionOrder) {
  const view = currentView();
  if (!view) return null;
  let fallback = null;
  for (const site of view.sites) {
    const latLng = routeLatLng(site);
    if (!latLng) continue;
    const sections = site.section_numbers || [];
    const siteSection = sections.length ? Math.min(...sections) : null;
    if (Number.isInteger(siteSection) && siteSection < sectionOrder) {
      fallback = { site, latLng };
      continue;
    }
    if (!fallback) return { site, latLng };
    break;
  }
  return fallback;
}

function previousMappedFocus(index) {
  for (let i = index - 1; i >= 0; i -= 1) {
    const focus = currentFocusRecord(i);
    const site = routeSiteByKey(focus?.route_site_key);
    const latLng = routeLatLng(site);
    if (site && latLng) return { site, latLng };
  }
  return null;
}

function routeFocusForStep(index) {
  const focus = currentFocusRecord(index);
  const sectionOrder = focus?.section_order;
  if (!focus || !Number.isInteger(sectionOrder)) return null;

  const site = routeSiteByKey(focus.route_site_key);
  const latLng = routeLatLng(site);
  if (site && latLng) return { site, latLng, routeSites: [site], focus };

  const fallback = previousMappedFocus(index) ?? nearestPreviousMappedRouteSite(sectionOrder);
  if (!fallback) {
    return site
      ? { site, latLng: null, routeSites: [site], focus, unmappedFocus: focus }
      : { site: null, latLng: null, routeSites: [], focus, unmappedFocus: focus };
  }
  return {
    site: fallback.site,
    latLng: fallback.latLng,
    routeSites: site ? [site] : [],
    unmappedSite: site && !latLng ? site : null,
    unmappedFocus: !site || !latLng ? focus : null,
    focus,
  };
}

function lineEligibleSite(site) {
  const text = normalizeForMatch(`${site.periplus_place_type} ${site.source_name}`);
  return !/(inland|metropolis|frontier)/.test(text);
}

function scrollToSite(site) {
  const focusMatch = state.visibleFocusRecords.findIndex((focus) => focus.route_site_key === site.site_key);
  if (focusMatch !== -1) {
    scrollToStep(focusMatch);
    return;
  }

  const sectionNumbers = site.section_numbers ?? [];
  const candidates = state.visibleFocusRecords
    .map((focus, index) => ({ focus, index, sectionOrder: focus.section_order }))
    .filter((item) => Number.isInteger(item.sectionOrder));
  const exact = candidates.find((item) => sectionNumbers.includes(item.sectionOrder));
  if (exact) {
    scrollToStep(exact.index);
    return;
  }
  const matched = candidates.find((item) => item.focus.route_site_key === site.site_key);
  if (matched) scrollToStep(matched.index);
}

function drawMainRoute() {
  const view = currentView();
  state.layers.legs.clearLayers();
  state.layers.routeMarkers.clearLayers();
  state.routeMarkers = new Map();
  state.routeSegments = new Map();

  const routeSites = view?.sites ?? [];
  for (let i = 1; i < routeSites.length; i += 1) {
    const a = routeSites[i - 1];
    const b = routeSites[i];
    const aLatLng = routeLatLng(a);
    const bLatLng = routeLatLng(b);
    if (!aLatLng || !bLatLng || !lineEligibleSite(a) || !lineEligibleSite(b)) continue;
    const key = legKey(a.site_key, b.site_key);
    const polyline = L.polyline([aLatLng, bLatLng], routeViewLegStyle(false));
    polyline._legKey = key;
    polyline.bindPopup(
      `<strong>${escapeHtml(a.source_name)} → ${escapeHtml(b.source_name)}</strong><br>${escapeHtml(view.label)} route order from reviewed webmap scrape.`,
    );
    polyline.addTo(state.layers.legs);
    state.routeSegments.set(key, {
      fromKey: a.site_key,
      toKey: b.site_key,
      fromLatLng: aLatLng,
      toLatLng: bLatLng,
      leg: { certainty: "reviewed_webmap_sequence" },
    });
  }

  for (const site of view?.sites ?? []) {
    const latLng = routeLatLng(site);
    if (!latLng) continue;
    const marker = L.marker(latLng, {
      icon: routeMarkerIcon(false),
      keyboard: true,
      title: site.source_name,
      alt: site.source_name,
    })
      .bindPopup(routeSitePopupHtml(site))
      .bindTooltip(site.source_name, { direction: "right", offset: [10, 0] });
    marker.on("click", () => {
      clearOffRouteStatus();
      scrollToSite(site);
    });
    marker.addTo(state.layers.routeMarkers);
    state.routeMarkers.set(site.site_key, marker);
  }
}

function initSailingLayer() {
  state.layers.sailing.clearLayers();
  state.sailLine = null;
  state.sailDot = null;
}

function drawOffRouteContext() {
  state.layers.offRoute.clearLayers();
  state.offRouteMarkers = new Map();

  const mainSet = new Set(state.journey.main_route_place_keys);
  const seen = new Set();

  for (const step of state.visibleSteps) {
    for (const mention of step.place_mentions) {
      if (mainSet.has(mention.place_key)) continue;
      if (seen.has(mention.place_key)) continue;
      seen.add(mention.place_key);

      const place = state.byPlace.get(mention.place_key);
      const latLng = placeLatLng(place);
      if (!place || !latLng) continue;

      const marker = L.marker(latLng, {
        icon: offRouteMarkerIcon(),
        keyboard: true,
        title: place.display_name,
        alt: place.display_name,
      })
        .bindPopup(popupHtml(place))
        .bindTooltip(place.display_name, { direction: "right", offset: [8, 0] });
      marker.addTo(state.layers.offRoute);
      state.offRouteMarkers.set(mention.place_key, marker);
    }
  }
}

function highlightActiveStep(index) {
  if (!currentFocusRecord(index)) return;
  const segment = sailingSegmentForStep(index);
  const progress = triggerProgress(index);
  const sailingNow = segment && !segment.stationary && progress > 0.45;
  const routeFocus = routeFocusForStep(index);
  const activeKeys = new Set((routeFocus?.routeSites ?? []).map((site) => site.site_key));
  if (routeFocus?.site) activeKeys.add(routeFocus.site.site_key);

  for (const [key, marker] of state.routeMarkers.entries()) {
    marker.setIcon(routeMarkerIcon(activeKeys.has(key)));
  }

  state.layers.legs.eachLayer((layer) => {
    if (!layer._legKey) return;
    const isActive = sailingNow && layer._legKey === legKey(segment.fromKey, segment.toKey);
    layer.setStyle(routeViewLegStyle(isActive));
  });
}

function nextMappedRouteSite(currentSiteKey) {
  const sites = currentView()?.sites ?? [];
  const currentIndex = sites.findIndex((site) => site.site_key === currentSiteKey);
  if (currentIndex === -1) return null;
  for (let i = currentIndex + 1; i < sites.length; i += 1) {
    const latLng = routeLatLng(sites[i]);
    if (latLng) return { site: sites[i], latLng };
  }
  return null;
}

function sailingSegmentForStep(index) {
  const routeFocus = routeFocusForStep(index);
  if (!routeFocus?.site || !routeFocus.latLng) return null;

  const currentKey = routeFocus.site.site_key;
  const currentLatLng = routeFocus.latLng;
  const next = nextMappedRouteSite(currentKey);
  if (!next) {
    return {
      fromKey: currentKey,
      toKey: currentKey,
      fromLatLng: currentLatLng,
      toLatLng: currentLatLng,
      stationary: true,
    };
  }

  const keyed = state.routeSegments.get(legKey(currentKey, next.site.site_key));
  if (keyed) return keyed;

  return {
    fromKey: currentKey,
    toKey: next.site.site_key,
    fromLatLng: currentLatLng,
    toLatLng: next.latLng,
    stationary: false,
  };
}

function triggerProgress(index) {
  const trigger = document.querySelector(`.story-trigger[data-index="${index}"]`);
  if (!trigger) return 1;

  const rect = trigger.getBoundingClientRect();
  const start = window.innerHeight * 0.78;
  const end = -rect.height + window.innerHeight * 0.22;
  return clamp((start - rect.top) / (start - end));
}

function updateSailingProgress() {
  state.sailFrame = null;
  if (!state.map || state.currentIndex < 0) return;

  const segment = sailingSegmentForStep(state.currentIndex);
  if (!segment) return;
  highlightActiveStep(state.currentIndex);
}

function scheduleSailingProgress() {
  if (state.sailFrame !== null) return;
  state.sailFrame = requestAnimationFrame(updateSailingProgress);
}

function activeIndexFromScroll() {
  const triggers = [...document.querySelectorAll(".story-trigger")];
  if (!triggers.length) return 0;

  const activationLine = window.innerHeight * 0.25;
  let activeIndex = 0;
  for (const trigger of triggers) {
    if (trigger.getBoundingClientRect().top <= activationLine) {
      activeIndex = Number(trigger.dataset.index);
    } else {
      break;
    }
  }
  return activeIndex;
}

function handleScrollProgress() {
  activateStep(activeIndexFromScroll(), { move: true });
  scheduleSailingProgress();
}

function focusStepOnMap(index, options = {}) {
  const routeFocus = routeFocusForStep(index);
  const latLng = routeFocus?.latLng;
  if (!latLng) {
    if (routeFocus?.unmappedFocus) showUnmappedFocusStatus(routeFocus.unmappedFocus, routeFocus.site);
    return;
  }

  const target = L.latLng(latLng[0], latLng[1]);
  const zoom = Math.max(state.map.getZoom(), 7);

  if (state.reduceMotion || options.instant) {
    state.map.setView(target, zoom);
  } else {
    state.map.setView(target, zoom, { animate: false });
  }

  if (routeFocus.unmappedFocus) showUnmappedFocusStatus(routeFocus.unmappedFocus, routeFocus.site);
  else if (routeFocus.unmappedSite) showUnmappedRouteStatus(routeFocus.unmappedSite, routeFocus.site);
  else clearOffRouteStatus();
}

function showOffRouteStatus(place, mention, options = {}) {
  const node = document.getElementById("off-route-status");
  document.getElementById("route-status-kicker").textContent = options.kicker || "Off route";
  document.getElementById("off-route-name").textContent = place
    ? place.display_name
    : mention.surface;
  const noteParts = [];
  if (options.reason) noteParts.push(`Context: ${options.reason.replaceAll("_", " ")}`);
  if (place && place.notes) noteParts.push(place.notes);
  if (place && place.certainty) noteParts.push(`Certainty: ${place.certainty}`);
  if (!place || !placeLatLng(place)) noteParts.push("Unmapped in current data; route line unchanged.");
  document.getElementById("off-route-note").textContent = noteParts.join(" · ");
  node.hidden = false;
}

function showUnmappedRouteStatus(site, fallbackSite) {
  const node = document.getElementById("off-route-status");
  document.getElementById("route-status-kicker").textContent = "Unmapped route site";
  document.getElementById("off-route-name").textContent = site.source_name;
  const fallbackText = fallbackSite
    ? `Map remains on nearest previous mapped route site: ${fallbackSite.source_name}.`
    : "Map remains on the nearest mapped route site.";
  document.getElementById("off-route-note").textContent =
    `${site.source_name} is present in route metadata but has no drawable geometry. ${fallbackText}`;
  node.hidden = false;
}

function showUnmappedFocusStatus(focus, fallbackSite) {
  const node = document.getElementById("off-route-status");
  document.getElementById("route-status-kicker").textContent = focus.mapping_status === "needs_followup"
    ? "Needs follow-up"
    : "Unmapped route focus";
  document.getElementById("off-route-name").textContent = focus.display_name;
  const fallbackText = fallbackSite
    ? `Map remains on nearest previous mapped route site: ${fallbackSite.source_name}.`
    : "Map remains on the nearest mapped route site.";
  document.getElementById("off-route-note").textContent =
    `${focus.note || `${focus.display_name} has no reviewed drawable geometry yet.`} ${fallbackText}`;
  node.hidden = false;
}

function clearOffRouteStatus() {
  const node = document.getElementById("off-route-status");
  node.hidden = true;
  document.getElementById("route-status-kicker").textContent = "Off route";
  document.getElementById("off-route-name").textContent = "—";
  document.getElementById("off-route-note").textContent = "";
}

function termsOverlap(a, b) {
  const aTerms = matchTermVariants(a);
  const bTerms = matchTermVariants(b);
  return aTerms.some((aTerm) => bTerms.some((bTerm) => aTerm === bTerm));
}

function focusMatchesLink(focus, text) {
  return [focus.display_name, focus.source_name]
    .filter(Boolean)
    .some((value) => termsOverlap(value, text));
}

function focusForPlaceLink(button) {
  const activeStep = stepForFocus();
  const candidates = activeStep
    ? focusRecordsForStep(activeStep)
    : state.visibleFocusRecords;
  return candidates.find((focus) => focusMatchesLink(focus, button.textContent));
}

function contextPlaceForLink(button) {
  const activeFocus = currentFocusRecord();
  const contextPlaces = activeFocus?.context_places ?? [];
  return contextPlaces.find((place) => termsOverlap(place.display_name, button.textContent)) ?? null;
}

function handlePlaceLinkClick(button) {
  const placeKey = button.dataset.placeKey;
  const kind = button.dataset.kind;
  const place = state.byPlace.get(placeKey);
  const matchingFocus = focusForPlaceLink(button);

  if (matchingFocus) {
    const index = state.visibleFocusRecords.findIndex((focus) => focus.focus_id === matchingFocus.focus_id);
    if (index !== -1) scrollToStep(index);
    return;
  }

  const contextPlace = contextPlaceForLink(button);
  const contextOptions = contextPlace
    ? { kicker: "Off route/context", reason: contextPlace.reason }
    : {};

  if (kind === "main_route") {
    const marker = state.routeMarkers.get(placeKey);
    if (marker) {
      state.map.setView(marker.getLatLng(), Math.max(state.map.getZoom(), 7), { animate: false });
      marker.openPopup();
      clearOffRouteStatus();
    } else {
      showOffRouteStatus(place, { surface: button.textContent, place_key: placeKey }, contextOptions);
    }
    return;
  }

  // Off-route or comparison/forward reference.
  const offMarker = state.offRouteMarkers.get(placeKey);
  if (offMarker) {
    state.map.setView(offMarker.getLatLng(), Math.max(state.map.getZoom(), 7), { animate: false });
    offMarker.openPopup();
    showOffRouteStatus(place, { surface: button.textContent, place_key: placeKey }, contextOptions);
    return;
  }

  // Unmapped: do not move the map; show a status note instead.
  showOffRouteStatus(place, { surface: button.textContent, place_key: placeKey }, contextOptions);
}

function sourceRefForStep(step) {
  const refs = step.section_refs
    .map((id) => state.bySection.get(id)?.source_ref ?? id)
    .filter(Boolean);
  return refs.join(" · ");
}

function routeLabelForStep(step) {
  const sectionOrder = stepSectionOrder(step);
  const view = currentView();
  return `${view?.label ?? "All"} view · Section ${sectionOrder ?? "?"} of 66`;
}

function renderFocusChips(step) {
  const focusRecords = focusRecordsForStep(step);
  if (focusRecords.length <= 1) return "";
  const chips = focusRecords
    .map((focus) => {
      const index = state.visibleFocusRecords.findIndex((record) => record.focus_id === focus.focus_id);
      const status = focus.mapping_status && focus.mapping_status !== "mapped"
        ? ` <span class="focus-chip__status">${escapeHtml(focus.mapping_status.replaceAll("_", " "))}</span>`
        : "";
      return `
        <button type="button" class="focus-chip" data-focus-index="${index}">
          <span>${escapeHtml(focus.display_name)}</span>${status}
        </button>
      `;
    })
    .join("");
  return `<div class="focus-chips" aria-label="Reviewed place sequence">${chips}</div>`;
}

function renderStorySteps() {
  const node = document.getElementById("story-steps");
  const cards = state.visibleSteps
    .map((step, index) => {
      const translationHtml = linkifyText(step.translation, step.place_mentions);
      const greekText = step.greek_text ?? step.section_refs
        .map((id) => state.bySection.get(id)?.greek_text)
        .filter(Boolean)
        .join("\n\n");
      const greekBody = greekText
        ? linkifyText(greekText, step.place_mentions)
        : `<span class="greek-placeholder">${escapeHtml(GREEK_PLACEHOLDER)}</span>`;
      const sourceRef = sourceRefForStep(step);

      return `
        <article class="tour-step" id="${escapeHtml(step.step_id)}" data-index="${index}" data-step-id="${escapeHtml(step.step_id)}" tabindex="-1" aria-hidden="true" inert>
          <p class="eyebrow">${escapeHtml(routeLabelForStep(step))}</p>
          <h2>${escapeHtml(reviewedFocusForStep(step)?.card_title || displayTitleForStep(step))}</h2>
          ${routeContextForStep(step) ? `<p class="route-context">${escapeHtml(routeContextForStep(step))}</p>` : ""}
          ${renderFocusChips(step)}

          <div class="reading-block">
            <h3>Translation</h3>
            <p class="translation">${translationHtml}</p>
          </div>

          <div class="reading-block reading-block--greek" lang="grc">
            <h3>Greek</h3>
            <p class="greek-text">${greekBody}</p>
          </div>

          <p class="source-ref">${escapeHtml(sourceRef)}</p>
        </article>
      `;
    })
    .join("");

  const triggers = state.visibleSteps
    .flatMap((step) => focusRecordsForStep(step))
    .map((focus, index) => {
      return `<div class="story-trigger" data-index="${index}" aria-hidden="true" data-focus-id="${escapeHtml(focus.focus_id)}" data-step-id="${escapeHtml(focus.step_id)}"></div>`;
    })
    .join("");

  node.innerHTML = `
    <div class="story-card-stage" aria-live="polite">
      ${cards}
    </div>
    <div class="story-trigger-track">
      ${triggers}
    </div>
  `;

  node.querySelectorAll(".place-link").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      handlePlaceLinkClick(button);
    });
  });

  node.querySelectorAll(".focus-chip").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      scrollToStep(Number(button.dataset.focusIndex));
    });
  });
}

function updateHud(step) {
  const focus = currentFocusRecord();
  document.getElementById("active-kicker").textContent = routeLabelForStep(step);
  document.getElementById("active-title").textContent = focus?.display_name || displayTitleForStep(step);
  const routeFocus = routeFocusForStep(state.currentIndex);
  const subtitle = focus?.note || focus?.card_title || routeFocus?.site?.source_name || step.title;
  document.getElementById("active-route-label").textContent = subtitle;
}

function setStepInteractivity(el, isActive) {
  el.setAttribute("aria-hidden", isActive ? "false" : "true");
  el.toggleAttribute("inert", !isActive);
}

function activateStep(index, options = {}) {
  if (index < 0 || index >= state.visibleFocusRecords.length) return;
  const changed = index !== state.currentIndex;
  state.currentIndex = index;
  const step = stepForFocus(index);
  if (!step) return;

  document.querySelectorAll(".tour-step").forEach((el) => {
    const isActive = el.dataset.stepId === step.step_id;
    el.classList.toggle("active", isActive);
    setStepInteractivity(el, isActive);
  });

  document.querySelectorAll(".focus-chip").forEach((el) => {
    const isActive = Number(el.dataset.focusIndex) === index;
    el.classList.toggle("active", isActive);
    el.setAttribute("aria-current", isActive ? "true" : "false");
  });

  updateHud(step);
  highlightActiveStep(index);
  scheduleSailingProgress();
  updateNavigation();

  if (options.move !== false && changed) {
    focusStepOnMap(index, { instant: options.instant });
  }

  // Re-measure the map after the first activation in case the sticky container
  // only resolved its height on this paint.
  if (state.map) requestAnimationFrame(() => state.map.invalidateSize());
}

function setupObserver() {
  if (state.observer) state.observer.disconnect();
  const observer = new IntersectionObserver(
    () => {
      handleScrollProgress();
    },
    {
      root: null,
      rootMargin: "-22% 0px -74% 0px",
      threshold: 0,
    },
  );

  document.querySelectorAll(".story-trigger").forEach((trigger) => observer.observe(trigger));
  state.observer = observer;
}

function scrollToStep(index, options = {}) {
  const trigger = document.querySelector(`.story-trigger[data-index="${index}"]`);
  if (trigger && !options.instant) {
    trigger.scrollIntoView({ block: "start", behavior: state.reduceMotion ? "auto" : "smooth" });
  }
  activateStep(index, { move: true, instant: options.instant });
}

function updateNavigation() {
  const previous = document.getElementById("nav-previous-step");
  const next = document.getElementById("nav-next-step");
  const count = document.getElementById("step-count");
  const total = state.visibleFocusRecords.length;
  if (!previous || !next || !count) return;
  previous.disabled = state.currentIndex <= 0;
  next.disabled = state.currentIndex < 0 || state.currentIndex >= total - 1;
  count.textContent = total ? `${state.currentIndex + 1} / ${total}` : "0 / 0";
}

function setSelectedView(viewId, options = {}) {
  if (!state.routeViews?.views?.[viewId]) return;
  const previousFocus = currentFocusRecord();
  const previousStep = stepForFocus();
  state.selectedView = viewId;
  state.visibleSteps = stepsForView(viewId);
  rebuildVisibleFocusRecords();
  state.currentIndex = -1;

  document.querySelectorAll("[data-route-view]").forEach((button) => {
    const active = button.dataset.routeView === viewId;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", active ? "true" : "false");
  });

  renderStorySteps();
  drawMainRoute();
  initSailingLayer();
  drawOffRouteContext();
  fitToMainRoute();
  setupObserver();

  const oldSection = stepSectionOrder(previousStep);
  const range = currentView()?.section_range;
  const nextIndex = previousStep && range && sectionInRange(oldSection, range)
    ? state.visibleFocusRecords.findIndex((focus) => {
      if (previousFocus?.focus_id && focus.focus_id === previousFocus.focus_id) return true;
      return focus.step_id === previousStep.step_id;
    })
    : 0;
  scrollToStep(Math.max(0, nextIndex), { instant: options.instant });
}

function setupControls() {
  document.getElementById("toggle-map-gestures").addEventListener("change", (event) => {
    if (!state.map) return;
    if (event.target.checked) {
      state.map.scrollWheelZoom.enable();
      state.map.dragging.enable();
      state.map.touchZoom.enable();
    } else {
      state.map.scrollWheelZoom.disable();
      if (state.coarsePointer) {
        state.map.dragging.disable();
        state.map.touchZoom.disable();
      }
    }
  });

  document.getElementById("off-route-clear").addEventListener("click", () => {
    clearOffRouteStatus();
    if (state.currentIndex >= 0) {
      focusStepOnMap(state.currentIndex);
    }
  });

  document.querySelectorAll("[data-route-view]").forEach((button) => {
    button.addEventListener("click", () => setSelectedView(button.dataset.routeView));
  });

  document.getElementById("nav-previous-step").addEventListener("click", () => {
    scrollToStep(Math.max(0, state.currentIndex - 1));
  });
  document.getElementById("nav-next-step").addEventListener("click", () => {
    scrollToStep(Math.min(state.visibleFocusRecords.length - 1, state.currentIndex + 1));
  });

  window.addEventListener("keydown", (event) => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const tag = document.activeElement?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      scrollToStep(Math.max(0, state.currentIndex - 1));
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      scrollToStep(Math.min(state.visibleFocusRecords.length - 1, state.currentIndex + 1));
    }
  });

  const externalToggle = document.getElementById("toggle-external-reference");
  externalToggle.addEventListener("change", (event) => {
    if (!state.external) return;
    if (event.target.checked) state.external.enable();
    else state.external.disable();
  });

  window.addEventListener("resize", () => {
    if (state.map) state.map.invalidateSize();
    scheduleSailingProgress();
  });
  window.addEventListener("scroll", handleScrollProgress, { passive: true });
}

async function setupExternalReferenceLayer() {
  if (typeof window.createExternalReferenceLayer !== "function") return;
  state.external = window.createExternalReferenceLayer(state.map);
  const ready = await state.external.load();
  const toggle = document.getElementById("toggle-external-reference");
  toggle.disabled = !ready;
  toggle.title = ready
    ? "Toggle the imported Google My Map as a non-authoritative reference layer."
    : "No external reference data found. Export a KML from your My Map and run scripts/import_mymaps_kml.py.";
}

function fitToMainRoute() {
  const latLngs = (currentView()?.drawable_line_points ?? [])
    .map((point) => [point.lat, point.lon]);
  if (latLngs.length >= 2) {
    state.map.fitBounds(L.latLngBounds(latLngs).pad(0.4), { maxZoom: 6 });
  }
}

async function main() {
  try {
    await loadData();
    initMap();
    setupControls();
    setSelectedView("all", { instant: true });
    await setupExternalReferenceLayer();
  } catch (error) {
    console.error(error);
    const title = document.getElementById("active-title");
    const subtitle = document.getElementById("active-route-label");
    if (title) title.textContent = "Could not load tour data";
    if (subtitle) {
      subtitle.textContent =
        "Serve the repository root with `python3 -m http.server 8001` and open /features/scrollytelling-viewer/.";
    }
    const steps = document.getElementById("story-steps");
    if (steps) {
      steps.innerHTML = `<article class="tour-step active"><h2>Data loading failed</h2><p>${escapeHtml(error.message)}</p></article>`;
    }
  }
}

main();
