const DATA_FILES = {
  places: "../../data/generated/periplus/places_authority.json",
  sections: "../../data/generated/periplus/raw_sections.json",
  journey: "../../data/generated/periplus/journey_route.json",
};

const GREEK_PLACEHOLDER =
  "Greek text not loaded in this sample. Add First1KGreek/TEI extraction here.";

const state = {
  places: [],
  sections: [],
  journey: null,
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

function clamp(value, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

function interpolateLatLng(a, b, progress) {
  const t = clamp(progress);
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
  ];
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
  const [places, sections, journey] = await Promise.all([
    loadJson(DATA_FILES.places),
    loadJson(DATA_FILES.sections),
    loadJson(DATA_FILES.journey),
  ]);

  state.places = places;
  state.sections = sections;
  state.journey = journey;
  state.byPlace = new Map(places.map((place) => [place.place_key, place]));
  state.bySection = new Map(sections.map((section) => [section.chunk_id, section]));
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

function mainRouteMarkerStyle(active) {
  return {
    radius: active ? 11 : 7,
    weight: active ? 3 : 2,
    color: active ? "#f0c36a" : "#0d1820",
    fillColor: active ? "#f0c36a" : "#e7eef0",
    opacity: 1,
    fillOpacity: active ? 0.95 : 0.86,
  };
}

function offRouteMarkerStyle() {
  return {
    radius: 4.5,
    weight: 1,
    color: "#7ba7a5",
    fillColor: "#132f36",
    opacity: 0.85,
    fillOpacity: 0.72,
    dashArray: "3 3",
  };
}

function legStyle(leg, active) {
  const inferred = leg.certainty !== "text_explicit";
  return {
    color: active ? "#1f7989" : "#2f8fa0",
    weight: active ? 5 : 3.5,
    opacity: active ? 0.72 : 0.58,
    dashArray: inferred ? "8 7" : null,
    lineCap: "round",
    lineJoin: "round",
  };
}

function sailLineStyle() {
  return {
    color: "#f0c36a",
    weight: 6.5,
    opacity: 0.95,
    lineCap: "round",
    lineJoin: "round",
    className: "sail-line",
  };
}

function sailDotStyle(visible = true) {
  return {
    radius: 8,
    weight: 4,
    color: "rgba(7, 16, 21, 0.72)",
    fillColor: "#f0c36a",
    opacity: visible ? 1 : 0,
    fillOpacity: visible ? 0.98 : 0,
    className: "sail-dot",
  };
}

function initMap() {
  const map = L.map("map", {
    scrollWheelZoom: false,
    dragging: !state.coarsePointer,
    touchZoom: !state.coarsePointer,
    doubleClickZoom: true,
    zoomControl: true,
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

function drawMainRoute() {
  const journey = state.journey;
  state.layers.legs.clearLayers();
  state.layers.routeMarkers.clearLayers();
  state.routeMarkers = new Map();
  state.routeSegments = new Map();

  for (const leg of journey.legs) {
    const a = state.byPlace.get(leg.from_place_key);
    const b = state.byPlace.get(leg.to_place_key);
    const aLatLng = placeLatLng(a);
    const bLatLng = placeLatLng(b);
    if (!aLatLng || !bLatLng) continue;

    const key = legKey(leg.from_place_key, leg.to_place_key);
    const polyline = L.polyline([aLatLng, bLatLng], legStyle(leg, false));
    polyline._legKey = key;
    polyline.bindPopup(
      `<strong>${escapeHtml(a.display_name)} → ${escapeHtml(b.display_name)}</strong><br>${escapeHtml(leg.distance_text)}<br>Certainty: ${escapeHtml(leg.certainty)}`,
    );
    polyline.addTo(state.layers.legs);
    state.routeSegments.set(key, {
      fromKey: leg.from_place_key,
      toKey: leg.to_place_key,
      fromLatLng: aLatLng,
      toLatLng: bLatLng,
      leg,
    });
  }

  for (const key of journey.main_route_place_keys) {
    const place = state.byPlace.get(key);
    const latLng = placeLatLng(place);
    if (!place || !latLng) continue;
    const marker = L.circleMarker(latLng, mainRouteMarkerStyle(false))
      .bindPopup(popupHtml(place))
      .bindTooltip(place.display_name, { direction: "right", offset: [10, 0] });
    marker.addTo(state.layers.routeMarkers);
    state.routeMarkers.set(key, marker);
  }
}

function initSailingLayer() {
  state.layers.sailing.clearLayers();
  state.sailLine = L.polyline([], sailLineStyle()).addTo(state.layers.sailing);
  state.sailDot = L.circleMarker([0, 0], sailDotStyle(false)).addTo(state.layers.sailing);
}

function drawOffRouteContext() {
  state.layers.offRoute.clearLayers();
  state.offRouteMarkers = new Map();

  const mainSet = new Set(state.journey.main_route_place_keys);
  const seen = new Set();

  for (const step of state.journey.steps) {
    for (const mention of step.place_mentions) {
      if (mainSet.has(mention.place_key)) continue;
      if (seen.has(mention.place_key)) continue;
      seen.add(mention.place_key);

      const place = state.byPlace.get(mention.place_key);
      const latLng = placeLatLng(place);
      if (!place || !latLng) continue;

      const marker = L.circleMarker(latLng, offRouteMarkerStyle())
        .bindPopup(popupHtml(place))
        .bindTooltip(place.display_name, { direction: "right", offset: [8, 0] });
      marker.addTo(state.layers.offRoute);
      state.offRouteMarkers.set(mention.place_key, marker);
    }
  }
}

function highlightActiveStep(index) {
  const journey = state.journey;
  const step = journey.steps[index];
  if (!step) return;
  const segment = sailingSegmentForStep(index);
  const progress = triggerProgress(index);
  const sailingNow = segment && !segment.stationary && progress > 0.45;

  for (const [key, marker] of state.routeMarkers.entries()) {
    marker.setStyle(mainRouteMarkerStyle(key === step.focus_place_key));
  }

  state.layers.legs.eachLayer((layer) => {
    if (!layer._legKey) return;
    const isActive = sailingNow && layer._legKey === legKey(segment.fromKey, segment.toKey);
    const [from, to] = layer._legKey.split("->");
    const leg = journey.legs.find((l) => l.from_place_key === from && l.to_place_key === to);
    if (leg) layer.setStyle(legStyle(leg, isActive));
  });
}

function nextMappedFocus(index, currentKey) {
  const steps = state.journey.steps;
  for (let i = index + 1; i < steps.length; i += 1) {
    const key = steps[i].focus_place_key;
    if (!key || key === currentKey) continue;
    const latLng = placeLatLng(state.byPlace.get(key));
    if (latLng) return { key, latLng };
  }
  return null;
}

function sailingSegmentForStep(index) {
  const step = state.journey.steps[index];
  if (!step) return null;

  const currentKey = step.focus_place_key;
  const currentLatLng = placeLatLng(state.byPlace.get(currentKey));
  if (!currentKey || !currentLatLng) return null;

  const next = nextMappedFocus(index, currentKey);
  if (!next) {
    return {
      fromKey: currentKey,
      toKey: currentKey,
      fromLatLng: currentLatLng,
      toLatLng: currentLatLng,
      stationary: true,
    };
  }

  const keyed = state.routeSegments.get(legKey(currentKey, next.key));
  if (keyed) return keyed;

  return {
    fromKey: currentKey,
    toKey: next.key,
    fromLatLng: currentLatLng,
    toLatLng: next.latLng,
    stationary: false,
  };
}

function sailingProgress(rawProgress) {
  if (state.reduceMotion) return 0;
  if (rawProgress <= 0.45) return 0;
  if (rawProgress >= 0.95) return 1;
  return (rawProgress - 0.45) / 0.5;
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
  if (!state.map || !state.sailDot || !state.sailLine || state.currentIndex < 0) return;

  const segment = sailingSegmentForStep(state.currentIndex);
  if (!segment) {
    state.sailLine.setLatLngs([]);
    state.sailDot.setStyle(sailDotStyle(false));
    return;
  }

  const rawProgress = triggerProgress(state.currentIndex);
  const progress = segment.stationary ? 0 : sailingProgress(rawProgress);
  const position = interpolateLatLng(segment.fromLatLng, segment.toLatLng, progress);
  const lineLatLngs = segment.stationary ? [] : [segment.fromLatLng, position];

  state.sailLine.setLatLngs(lineLatLngs);
  state.sailDot.setLatLng(position);
  state.sailDot.setStyle(sailDotStyle(true));
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

function focusStepOnMap(step, options = {}) {
  const place = state.byPlace.get(step.focus_place_key);
  const latLng = placeLatLng(place);
  if (!latLng) return;

  const target = L.latLng(latLng[0], latLng[1]);
  const zoom = Math.max(state.map.getZoom(), 7);

  if (state.reduceMotion || options.instant) {
    state.map.setView(target, zoom);
  } else {
    state.map.flyTo(target, zoom, { duration: 0.9 });
  }
}

function showOffRouteStatus(place, mention) {
  const node = document.getElementById("off-route-status");
  document.getElementById("off-route-name").textContent = place
    ? place.display_name
    : mention.surface;
  const noteParts = [];
  if (place && place.notes) noteParts.push(place.notes);
  if (place && place.certainty) noteParts.push(`Certainty: ${place.certainty}`);
  if (!place || !placeLatLng(place)) noteParts.push("Unmapped in current data; route line unchanged.");
  document.getElementById("off-route-note").textContent = noteParts.join(" · ");
  node.hidden = false;
}

function clearOffRouteStatus() {
  const node = document.getElementById("off-route-status");
  node.hidden = true;
  document.getElementById("off-route-name").textContent = "—";
  document.getElementById("off-route-note").textContent = "";
}

function handlePlaceLinkClick(button) {
  const placeKey = button.dataset.placeKey;
  const kind = button.dataset.kind;
  const place = state.byPlace.get(placeKey);

  if (kind === "main_route") {
    const marker = state.routeMarkers.get(placeKey);
    if (marker) {
      state.map.flyTo(marker.getLatLng(), Math.max(state.map.getZoom(), 7), {
        duration: state.reduceMotion ? 0 : 0.7,
      });
      marker.openPopup();
    }
    return;
  }

  // Off-route or comparison/forward reference.
  const offMarker = state.offRouteMarkers.get(placeKey);
  if (offMarker) {
    state.map.flyTo(offMarker.getLatLng(), Math.max(state.map.getZoom(), 7), {
      duration: state.reduceMotion ? 0 : 0.7,
    });
    offMarker.openPopup();
    showOffRouteStatus(place, { surface: button.textContent, place_key: placeKey });
    return;
  }

  // Unmapped: do not move the map; show a status note instead.
  showOffRouteStatus(place, { surface: button.textContent, place_key: placeKey });
}

function sourceRefForStep(step) {
  const refs = step.section_refs
    .map((id) => state.bySection.get(id)?.source_ref ?? id)
    .filter(Boolean);
  return refs.join(" · ");
}

function renderStorySteps() {
  const node = document.getElementById("story-steps");
  const cards = state.journey.steps
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
          <p class="eyebrow">${escapeHtml(step.route_label)}</p>
          <h2>${escapeHtml(step.title)}</h2>

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

  const triggers = state.journey.steps
    .map((step, index) => {
      return `<div class="story-trigger" data-index="${index}" aria-hidden="true" data-step-id="${escapeHtml(step.step_id)}"></div>`;
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
}

function updateHud(step) {
  document.getElementById("active-kicker").textContent = step.route_label;
  document.getElementById("active-title").textContent = step.title;
  const place = state.byPlace.get(step.focus_place_key);
  document.getElementById("active-route-label").textContent = place
    ? place.display_name
    : step.title;
}

function setStepInteractivity(el, isActive) {
  el.setAttribute("aria-hidden", isActive ? "false" : "true");
  el.toggleAttribute("inert", !isActive);
}

function activateStep(index, options = {}) {
  if (index < 0 || index >= state.journey.steps.length) return;
  const changed = index !== state.currentIndex;
  state.currentIndex = index;
  const step = state.journey.steps[index];

  document.querySelectorAll(".tour-step").forEach((el) => {
    const isActive = Number(el.dataset.index) === index;
    el.classList.toggle("active", isActive);
    setStepInteractivity(el, isActive);
  });

  updateHud(step);
  highlightActiveStep(index);
  scheduleSailingProgress();

  if (options.move !== false && changed) {
    focusStepOnMap(step, { instant: options.instant });
  }

  // Re-measure the map after the first activation in case the sticky container
  // only resolved its height on this paint.
  if (state.map) requestAnimationFrame(() => state.map.invalidateSize());
}

function setupObserver() {
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
      const step = state.journey.steps[state.currentIndex];
      focusStepOnMap(step);
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
  const latLngs = state.journey.main_route_place_keys
    .map((key) => placeLatLng(state.byPlace.get(key)))
    .filter(Boolean);
  if (latLngs.length >= 2) {
    state.map.fitBounds(L.latLngBounds(latLngs).pad(0.4), { maxZoom: 6 });
  }
}

async function main() {
  try {
    await loadData();
    renderStorySteps();
    initMap();
    drawMainRoute();
    initSailingLayer();
    drawOffRouteContext();
    fitToMainRoute();
    setupControls();
    setupObserver();
    activateStep(0, { move: true, instant: true });
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
