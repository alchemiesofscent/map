const DATA_FILES = {
  places: "../data/places_authority.sample.json",
  sections: "../data/raw_sections.sample.json",
  cards: "../data/tour_cards.sample.json",
  stops: "../data/tour_stops.sample.json",
  routeLegs: "../data/route_legs.sample.json",
  movements: "../data/movements.sample.json",
};

let state = {
  places: [],
  sections: [],
  cards: [],
  stops: [],
  routeLegs: [],
  movements: [],
  byPlace: new Map(),
  bySection: new Map(),
  currentIndex: 0,
  layers: {},
};

function placeLatLng(place) {
  if (place && place.lat !== null && place.lon !== null) return [place.lat, place.lon];
  return null;
}

function placePopup(place) {
  const pleiades = place.pleiades_uri
    ? `<p class="popup-meta"><a href="${place.pleiades_uri}" target="_blank" rel="noreferrer">Pleiades ${place.pleiades_id}</a></p>`
    : "";
  const greek = place.greek_names.length ? `<p class="popup-meta">${place.greek_names.join(", ")}</p>` : "";
  return `
    <div class="popup-title">${place.display_name}</div>
    ${greek}
    <p class="popup-meta">Type: ${place.place_type}</p>
    <p class="popup-meta">Certainty: ${place.certainty}</p>
    <p class="popup-meta">${place.notes}</p>
    ${pleiades}
  `;
}

function markerStyle(place, active = false) {
  const low = place.certainty === "low" || place.certainty === "medium";
  return {
    radius: active ? 9 : 6,
    weight: low ? 2 : 1,
    opacity: 1,
    fillOpacity: active ? 0.9 : 0.65,
    dashArray: low ? "4 3" : null,
  };
}

async function loadJson(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`Unable to load ${path}: ${response.status}`);
  return response.json();
}

async function loadData() {
  const [places, sections, cards, stops, routeLegs, movements] = await Promise.all([
    loadJson(DATA_FILES.places),
    loadJson(DATA_FILES.sections),
    loadJson(DATA_FILES.cards),
    loadJson(DATA_FILES.stops),
    loadJson(DATA_FILES.routeLegs),
    loadJson(DATA_FILES.movements),
  ]);

  state.places = places;
  state.sections = sections;
  state.cards = cards.sort((a, b) => a.section_order - b.section_order);
  state.stops = stops.sort((a, b) => a.sequence_index - b.sequence_index);
  state.routeLegs = routeLegs;
  state.movements = movements;
  state.byPlace = new Map(places.map((p) => [p.place_key, p]));
  state.bySection = new Map(sections.map((s) => [s.chunk_id, s]));
}

function initMap() {
  const map = L.map("map", { scrollWheelZoom: true }).setView([20.5, 38], 5);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 12,
    attribution: "&copy; OpenStreetMap contributors",
  }).addTo(map);

  state.layers.map = map;
  state.layers.route = L.layerGroup().addTo(map);
  state.layers.movements = L.layerGroup().addTo(map);
  state.layers.markers = L.layerGroup().addTo(map);
  state.layers.active = L.layerGroup().addTo(map);

  drawStaticLayers();
}

function drawStaticLayers() {
  drawMarkers();
  drawRoute();
  drawMovements();
}

function drawMarkers() {
  state.layers.markers.clearLayers();
  for (const place of state.places) {
    const latLng = placeLatLng(place);
    if (!latLng) continue;
    if (!document.getElementById("toggle-uncertain").checked && ["low", "medium"].includes(place.certainty)) continue;
    L.circleMarker(latLng, markerStyle(place)).bindPopup(placePopup(place)).addTo(state.layers.markers);
  }
}

function drawRoute() {
  state.layers.route.clearLayers();
  for (const leg of state.routeLegs) {
    const a = state.byPlace.get(leg.from_place_key);
    const b = state.byPlace.get(leg.to_place_key);
    const aLL = placeLatLng(a);
    const bLL = placeLatLng(b);
    if (!aLL || !bLL) continue;
    const style = leg.certainty === "text_explicit"
      ? { weight: 4, opacity: 0.75 }
      : { weight: 3, opacity: 0.65, dashArray: "6 6" };
    L.polyline([aLL, bLL], style)
      .bindPopup(`<strong>${a.display_name} → ${b.display_name}</strong><br>${leg.distance_text}<br>${leg.notes}`)
      .addTo(state.layers.route);
  }
}

function drawMovements() {
  state.layers.movements.clearLayers();
  for (const movement of state.movements) {
    const latLngs = movement.polyline_place_keys
      .map((key) => placeLatLng(state.byPlace.get(key)))
      .filter(Boolean);
    if (latLngs.length < 2) continue;
    L.polyline(latLngs, { weight: 3, opacity: 0.7, dashArray: "4 7" })
      .bindPopup(`<strong>${movement.goods.join(", ")}</strong><br>${movement.movement_type}<br>${movement.notes}`)
      .addTo(state.layers.movements);
  }
}

function layerToggle(layerName, checked) {
  const map = state.layers.map;
  const layer = state.layers[layerName];
  if (checked) layer.addTo(map);
  else map.removeLayer(layer);
}

function badge(text) {
  return `<span class="badge ${String(text).replaceAll(" ", "_")}">${text}</span>`;
}

function renderList(id, values, empty = "None in this section.") {
  const node = document.getElementById(id);
  node.innerHTML = "";
  if (!values.length) {
    const li = document.createElement("li");
    li.textContent = empty;
    node.appendChild(li);
    return;
  }
  for (const value of values) {
    const li = document.createElement("li");
    li.innerHTML = value;
    node.appendChild(li);
  }
}

function renderGoods(goods) {
  const node = document.getElementById("goods-list");
  node.innerHTML = "";
  if (!goods.length) {
    node.textContent = "None listed.";
    return;
  }
  for (const good of goods) {
    const span = document.createElement("span");
    span.className = "pill";
    span.textContent = good;
    node.appendChild(span);
  }
}

function matchingMovements(card) {
  return state.movements.filter((m) => m.chunk_id === card.chunk_id || m.section_order === card.section_order);
}

function setCard(index) {
  state.currentIndex = Math.max(0, Math.min(index, state.cards.length - 1));
  const card = state.cards[state.currentIndex];
  const section = state.bySection.get(card.chunk_id);

  document.getElementById("section-kicker").textContent = `Section ${card.section_order}`;
  document.getElementById("card-title").textContent = card.title;
  document.getElementById("card-subtitle").textContent = card.subtitle;
  document.getElementById("card-summary").textContent = card.summary;
  document.getElementById("translation").textContent = section ? section.draft_translation : "";
  document.getElementById("source-ref").textContent = section ? section.source_ref : card.chunk_id;

  const placeItems = card.place_keys.map((key) => {
    const p = state.byPlace.get(key);
    if (!p) return `${key} ${badge("missing")}`;
    const mapped = placeLatLng(p) ? "mapped" : "unmapped";
    const link = p.pleiades_uri ? ` <a href="${p.pleiades_uri}" target="_blank" rel="noreferrer">Pleiades</a>` : "";
    return `<strong>${p.display_name}</strong> ${badge(p.certainty)} ${badge(mapped)}<br><span>${p.notes}</span>${link}`;
  });
  renderList("places-list", placeItems);
  renderGoods(card.goods);

  const moveItems = matchingMovements(card).map((m) => {
    const from = state.byPlace.get(m.source_place_key)?.display_name ?? m.source_place_key;
    const to = state.byPlace.get(m.destination_place_key)?.display_name ?? m.destination_place_key;
    return `<strong>${m.goods.join(", ")}</strong>: ${from} → ${to} ${badge(m.certainty)}<br><span>${m.notes}</span>`;
  });
  renderList("movement-list", moveItems, "No movement overlay for this section.");

  document.getElementById("prev-button").disabled = state.currentIndex === 0;
  document.getElementById("next-button").disabled = state.currentIndex === state.cards.length - 1;

  highlightCardPlaces(card);
  updateRouteStrip();
}

function highlightCardPlaces(card) {
  state.layers.active.clearLayers();
  const latLngs = [];
  for (const key of card.place_keys) {
    const place = state.byPlace.get(key);
    const latLng = placeLatLng(place);
    if (!place || !latLng) continue;
    latLngs.push(latLng);
    L.circleMarker(latLng, markerStyle(place, true)).bindPopup(placePopup(place)).addTo(state.layers.active);
  }
  if (latLngs.length) {
    state.layers.map.fitBounds(L.latLngBounds(latLngs).pad(0.35), { maxZoom: 7 });
  }
}

function buildRouteStrip() {
  const node = document.getElementById("route-strip-list");
  node.innerHTML = "";
  for (const stop of state.stops) {
    const li = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.placeKey = stop.place_key;
    button.textContent = `${stop.sequence_index} ${stop.title}`;
    button.addEventListener("click", () => {
      const idx = state.cards.findIndex((card) => card.place_keys.includes(stop.place_key));
      if (idx >= 0) setCard(idx);
    });
    li.appendChild(button);
    node.appendChild(li);
  }
}

function updateRouteStrip() {
  const card = state.cards[state.currentIndex];
  document.querySelectorAll("#route-strip-list button").forEach((button) => {
    const active = card.place_keys.includes(button.dataset.placeKey);
    button.classList.toggle("active", active);
  });
}

function initControls() {
  document.getElementById("prev-button").addEventListener("click", () => setCard(state.currentIndex - 1));
  document.getElementById("next-button").addEventListener("click", () => setCard(state.currentIndex + 1));
  document.addEventListener("keydown", (event) => {
    if (event.key === "ArrowLeft") setCard(state.currentIndex - 1);
    if (event.key === "ArrowRight") setCard(state.currentIndex + 1);
  });

  document.getElementById("toggle-route").addEventListener("change", (event) => layerToggle("route", event.target.checked));
  document.getElementById("toggle-movements").addEventListener("change", (event) => layerToggle("movements", event.target.checked));
  document.getElementById("toggle-uncertain").addEventListener("change", () => drawMarkers());
}

async function main() {
  try {
    await loadData();
    initMap();
    initControls();
    buildRouteStrip();
    setCard(0);
  } catch (error) {
    console.error(error);
    document.getElementById("card-title").textContent = "Could not load tour data";
    document.getElementById("card-summary").textContent = "Serve the repository root with `python3 -m http.server 8000` and open /app/.";
  }
}

main();
