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
    color: "#1f1a15",
    fillColor: active ? "#8c4c2f" : "#fefefe",
    opacity: 1,
    fillOpacity: active ? 0.9 : 0.85,
  };
}

function offRouteMarkerStyle() {
  return {
    radius: 4.5,
    weight: 1,
    color: "#7b674f",
    fillColor: "#fff4dc",
    opacity: 0.85,
    fillOpacity: 0.8,
    dashArray: "3 3",
  };
}

function legStyle(leg, active) {
  const inferred = leg.certainty !== "text_explicit";
  return {
    color: active ? "#8c4c2f" : "#2c6f8f",
    weight: active ? 5.5 : 3.5,
    opacity: active ? 0.95 : 0.7,
    dashArray: inferred ? "8 7" : null,
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

  for (const leg of journey.legs) {
    const a = state.byPlace.get(leg.from_place_key);
    const b = state.byPlace.get(leg.to_place_key);
    const aLatLng = placeLatLng(a);
    const bLatLng = placeLatLng(b);
    if (!aLatLng || !bLatLng) continue;

    const polyline = L.polyline([aLatLng, bLatLng], legStyle(leg, false));
    polyline._legKey = `${leg.from_place_key}->${leg.to_place_key}`;
    polyline.bindPopup(
      `<strong>${escapeHtml(a.display_name)} → ${escapeHtml(b.display_name)}</strong><br>${escapeHtml(leg.distance_text)}<br>Certainty: ${escapeHtml(leg.certainty)}`,
    );
    polyline.addTo(state.layers.legs);
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

  for (const [key, marker] of state.routeMarkers.entries()) {
    marker.setStyle(mainRouteMarkerStyle(key === step.focus_place_key));
  }

  const activeKeys = new Set();
  if (index > 0) activeKeys.add(journey.steps[index - 1].focus_place_key);
  activeKeys.add(step.focus_place_key);

  state.layers.legs.eachLayer((layer) => {
    if (!layer._legKey) return;
    const [from, to] = layer._legKey.split("->");
    const isActive =
      activeKeys.has(from) && activeKeys.has(to) && from !== to && index > 0;
    const leg = journey.legs.find((l) => l.from_place_key === from && l.to_place_key === to);
    if (leg) layer.setStyle(legStyle(leg, isActive));
  });
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
  node.innerHTML = state.journey.steps
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
        <article class="tour-step" id="${escapeHtml(step.step_id)}" data-index="${index}" data-step-id="${escapeHtml(step.step_id)}" tabindex="-1">
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

function activateStep(index, options = {}) {
  if (index < 0 || index >= state.journey.steps.length) return;
  const changed = index !== state.currentIndex;
  state.currentIndex = index;
  const step = state.journey.steps[index];

  document.querySelectorAll(".tour-step").forEach((el) => {
    el.classList.toggle("active", Number(el.dataset.index) === index);
  });

  updateHud(step);
  highlightActiveStep(index);

  if (options.move !== false && changed) {
    focusStepOnMap(step, { instant: options.instant });
  }

  // Re-measure the map after the first activation in case the sticky container
  // only resolved its height on this paint.
  if (state.map) requestAnimationFrame(() => state.map.invalidateSize());
}

function setupObserver() {
  const observer = new IntersectionObserver(
    (entries) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      if (!visible) return;
      activateStep(Number(visible.target.dataset.index), { move: true });
    },
    {
      root: null,
      rootMargin: "-30% 0px -45% 0px",
      threshold: [0.15, 0.4, 0.7],
    },
  );

  document.querySelectorAll(".tour-step").forEach((step) => observer.observe(step));
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
  });
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
