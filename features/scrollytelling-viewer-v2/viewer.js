/* Periplus · Atlas viewer v2
 *
 * A second prototype: full-bleed map, no scrollytelling sidebar.
 * Inputs: scroll wheel (debounced step advance), arrow keys, marker clicks,
 * site-strip clicks, dossier nav arrows. Smooth flyTo transitions between sites.
 * Sea legs and land/caravan legs are visually distinguished.
 */

const DATA = {
  places: "../../data/generated/periplus/places_authority.json",
  sections: "../../data/generated/periplus/raw_sections.json",
  journey: "../../data/generated/periplus/journey_route.json",
  routeViews: "../../data/generated/periplus/route_views.json",
};

// Sites that should display as a "land" pin (diamond, terracotta) instead of
// the default sea harbour circle. Includes regions so they get the same
// distinct silhouette on the map.
const INLAND_RX = /(Inland|Metropolis|Frontier|Region)/i;
// Regions cover broad areas, not single harbours. We render them as pins so
// the curator can click them, but the route polyline skips through them so
// the sailing line doesn't lurch inland and back.
const REGION_RX = /Region/i;

const ROMAN = [
  [1000, "M"], [900, "CM"], [500, "D"], [400, "CD"],
  [100, "C"], [90, "XC"], [50, "L"], [40, "XL"],
  [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"],
];

const VIEW_LABEL = {
  all: "All routes",
  western: "Western route",
  eastern: "Eastern route",
};

const state = {
  data: null,
  byPlace: new Map(),
  bySection: new Map(),
  selectedView: "all",
  sites: [],
  focusList: [],
  currentIndex: -1,
  map: null,
  layers: {},
  markers: new Map(),
  legs: [],
  legPolys: new Map(),
  legGlowPolys: new Map(),
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

function isInland(site) {
  return INLAND_RX.test(site?.periplus_place_type ?? "");
}

function isRegion(site) {
  if (!site) return false;
  if (REGION_RX.test(site.periplus_place_type ?? "")) return true;
  if ((site.location_precision ?? "").toLowerCase() === "region") return true;
  return false;
}

function siteLatLng(site) {
  return site?.has_geometry && site.lat !== null && site.lon !== null
    ? [site.lat, site.lon]
    : null;
}

// ───────────────────────── data shaping ─────────────────────────

async function loadAll() {
  const [places, sections, journey, routeViews] = await Promise.all([
    loadJson(DATA.places),
    loadJson(DATA.sections),
    loadJson(DATA.journey),
    loadJson(DATA.routeViews),
  ]);

  state.data = { places, sections, journey, routeViews };
  state.byPlace = new Map(places.map((p) => [p.place_key, p]));
  state.bySection = new Map(sections.map((s) => [s.chunk_id, s]));
}

function currentView() {
  return state.data?.routeViews?.views?.[state.selectedView] ?? null;
}

/** Return a focus-list — one entry per place visited in route_views order,
 *  enriched with the section's translation and Greek text where available. */
function buildFocusList() {
  const view = currentView();
  if (!view) return [];

  // Map section_order → focus sequence (reviewed) for richer titles when present.
  const sectionFocusByOrder = new Map();
  for (const sf of view.section_focus ?? []) {
    sectionFocusByOrder.set(sf.section_order, sf);
  }

  const list = [];
  view.sites.forEach((site, idx) => {
    const sectionOrder = (site.section_numbers ?? [])[0] ?? null;
    const reviewed = sectionFocusByOrder.get(sectionOrder);
    const section = Number.isInteger(sectionOrder)
      ? state.data.sections.find((s) => s.section_order === sectionOrder)
      : null;

    list.push({
      index: idx,
      site,
      siteKey: site.site_key,
      sectionOrder,
      kind: isInland(site) ? "land" : "sea",
      displayName: site.source_name,
      greekName: site.page_metadata?.page_ancient_toponym ?? null,
      placeType: site.periplus_place_type ?? "",
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
    });
  });

  return list;
}

function buildLegs(sites) {
  // Regions get a pin but no leg lines into or out of them: the route line
  // jumps over a stretch of regions to the next non-region site.
  const eligible = sites.filter((s) => !isRegion(s));
  const legs = [];
  for (let i = 1; i < eligible.length; i += 1) {
    const a = eligible[i - 1];
    const b = eligible[i];
    const aLL = siteLatLng(a);
    const bLL = siteLatLng(b);
    if (!aLL || !bLL) continue;
    // Cross-route boundary (western → eastern): skip; the two legs aren't actually contiguous.
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
    const marker = L.marker(ll, {
      icon: pinIcon(kind),
      keyboard: true,
      title: site.source_name,
      alt: site.source_name,
      riseOnHover: true,
    });
    marker.bindTooltip(site.source_name, {
      direction: "right",
      offset: [12, 0],
      className: "site-tip",
    });
    marker.on("click", () => {
      const idx = state.focusList.findIndex((f) => f.siteKey === site.site_key);
      if (idx >= 0) goTo(idx);
    });
    marker.addTo(state.layers.markers);
    state.markers.set(site.site_key, { marker, kind });
  }
}

function fitToView() {
  const view = currentView();
  const points = (view?.drawable_line_points ?? []).map((p) => [p.lat, p.lon]);
  if (points.length >= 2) {
    state.map.fitBounds(L.latLngBounds(points).pad(0.32), { maxZoom: 6, animate: false });
  }
}

// ───────────────────────── DOM render ─────────────────────────

function renderStrip() {
  const rail = document.getElementById("strip-rail");
  rail.innerHTML = state.focusList
    .map((f, idx) => {
      return `
        <button
          type="button"
          class="strip__dot"
          data-index="${idx}"
          data-route="${escapeHtml(f.site.route_key)}"
          data-kind="${f.kind}"
          role="option"
          aria-selected="false"
          aria-label="${escapeHtml(f.displayName)}"
        >
          <span class="strip__dot__label">
            ${escapeHtml(String(f.sectionOrder ?? ""))} · ${escapeHtml(f.displayName)}
          </span>
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

function renderDossier(focus) {
  if (!focus) return;
  const route = focus.routeLabel ? `${focus.routeLabel} route` : VIEW_LABEL[state.selectedView];
  const type = focus.placeType || (focus.kind === "land" ? "Inland" : "Coastal");
  const sectionTxt = Number.isInteger(focus.sectionOrder)
    ? `Section ${focus.sectionOrder}`
    : (focus.chapter || "");

  document.getElementById("dossier-route").textContent = route;
  document.getElementById("dossier-type").textContent = type;
  document.getElementById("dossier-section").textContent = sectionTxt;

  applyTextTransition(document.getElementById("dossier-title"), focus.displayName);
  applyTextTransition(document.getElementById("dossier-greek-name"), focus.greekName ?? "");

  const translationEl = document.getElementById("dossier-translation");
  applyHtmlTransition(translationEl, escapeHtml(focus.translation || ""));

  const greekEl = document.getElementById("dossier-greek");
  greekEl.textContent = focus.greekText || "";
  const greekBlock = document.getElementById("dossier-greek-block");
  greekBlock.style.display = focus.greekText ? "" : "none";

  const sourceEl = document.getElementById("dossier-source");
  const sourceBits = [focus.modernId, focus.chapter].filter(Boolean);
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

  // Active leg: the segment leading INTO the active site.
  for (const [key, { poly, leg }] of state.legPolys.entries()) {
    const isActive = leg.to.site_key === focus.siteKey;
    poly.setStyle(legStyle(leg.category, isActive));
    const glow = state.legGlowPolys.get(key);
    if (glow) glow.setStyle(legGlowStyle(leg.category, isActive));
    if (isActive) poly.bringToFront();
  }
}

// ───────────────────────── navigation ─────────────────────────

/** Compute a map-center latlng such that the given target appears in the
 *  visual centre of whatever region the dossier doesn't cover. On wide
 *  viewports the dossier is left-anchored (offset horizontally); on phones
 *  it's bottom-anchored (offset vertically). */
function dossierOffsetCenter(targetLatLng, zoom) {
  const target = L.latLng(targetLatLng[0], targetLatLng[1]);
  const dossierEl = document.querySelector(".dossier");
  if (!dossierEl) return target;
  const rect = dossierEl.getBoundingClientRect();
  const point = state.map.project(target, zoom);

  if (window.innerWidth < 720) {
    // Mobile: visual centre of unblocked area is at y = rect.top / 2.
    // Geo centre is at y = vh / 2. Target should appear above geo centre
    // by (vh - rect.top) / 2; in projected pixels (y grows southward) that
    // means the map centre sits south of the target by the same amount.
    const offsetY = (window.innerHeight - rect.top) / 2;
    return state.map.unproject(L.point(point.x, point.y + offsetY), zoom);
  }

  // Desktop: visual centre of unblocked area is at x = (rect.right + vw) / 2.
  const offsetX = (rect.right + window.innerWidth) / 2 - window.innerWidth / 2;
  return state.map.unproject(L.point(point.x - offsetX, point.y), zoom);
}

function goTo(index, options = {}) {
  if (index < 0 || index >= state.focusList.length) return;
  if (index === state.currentIndex && !options.force) return;
  state.currentIndex = index;
  const focus = state.focusList[index];
  renderDossier(focus);
  highlightActive(focus);

  if (focus.latLng && !state.exploreMode) {
    const targetZoom = focus.kind === "land" ? 6.4 : 6.2;
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
  // Wheel: deliberate step advance. The handler:
  //   1. Lets wheel events inside the dossier scroll its body natively.
  //   2. Requires a "fresh" gesture (>= QUIET_MS of silence) before counting.
  //   3. Accumulates delta until THRESHOLD is crossed, then fires once and
  //      locks. Inertial trail keeps `lastWheel` updated, so the lock holds
  //      until the user actually stops scrolling.
  const QUIET_MS = 280;
  const COOLDOWN_MS = 850;
  const THRESHOLD = 90;

  window.addEventListener(
    "wheel",
    (e) => {
      if (state.exploreMode) return;
      const target = e.target;
      if (target && target.closest && target.closest(".dossier")) {
        // Native scroll inside the reading panel; do not navigate.
        return;
      }
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

  // Keyboard.
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
        if (state.exploreMode) {
          document.getElementById("toggle-explore").checked = false;
          setExploreMode(false);
        }
        break;
    }
  });

  // Touch swipes — but never on the dossier itself, where scrolling the
  // reading panel must remain native.
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

  // Dossier nav.
  document.getElementById("prev-step").addEventListener("click", prev);
  document.getElementById("next-step").addEventListener("click", next);

  // View selector.
  document.querySelectorAll("[data-view]").forEach((btn) => {
    btn.addEventListener("click", () => setView(btn.dataset.view));
  });

  // Explore toggle.
  document.getElementById("toggle-explore").addEventListener("change", (e) => {
    setExploreMode(e.target.checked);
  });

  // Hint banner.
  const hint = document.getElementById("hint-banner");
  hint.addEventListener("click", () => {
    hint.classList.remove("hint--shown");
  });

  // Resize: re-anchor active pin in the visual centre of the unblocked area.
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

// ───────────────────────── view switching ─────────────────────────

function setView(viewId, options = {}) {
  if (!state.data?.routeViews?.views?.[viewId]) return;
  const previousFocus = state.focusList[state.currentIndex];
  state.selectedView = viewId;

  document.querySelectorAll("[data-view]").forEach((btn) => {
    const active = btn.dataset.view === viewId;
    btn.setAttribute("aria-pressed", active ? "true" : "false");
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

// ───────────────────────── boot ─────────────────────────

async function main() {
  try {
    await loadAll();
    initMap();
    bindInputs();
    setView("all", { instant: true });
    showHintBriefly();
  } catch (err) {
    console.error(err);
    const title = document.getElementById("dossier-title");
    const trans = document.getElementById("dossier-translation");
    if (title) title.textContent = "Could not load tour data";
    if (trans) {
      trans.textContent =
        "Serve the repository root with `python3 -m http.server 8000` and open /features/scrollytelling-viewer-v2/.";
    }
  }
}

main();
