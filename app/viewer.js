/* Periplus · Atlas viewer
 *
 * Multi-corpus map viewer. Inputs: scroll wheel (debounced step advance),
 * arrow keys, marker clicks, site-strip clicks, dossier nav arrows. Smooth
 * flyTo transitions between sites. Sea legs and land/caravan legs are
 * visually distinguished. Galen corpus adds a route selector and a reader
 * pane joining passages + materia per stop.
 */

const AtlasData = window.PeriplusAtlasData;
const {
  CORPORA,
  escapeHtml,
  toRoman,
  siteDisplayName,
  sitePlaceType,
  siteLatLng,
  corpusIsMateria,
} = AtlasData;

const state = {
  corpusId: "periplus",
  corpusCache: new Map(), // corpusId -> loaded data bundle
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
  materialSearchValue: "",
  reduceMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  wheelLast: 0,
  wheelAccum: 0,
  cooldownUntil: 0,
  exploreMode: false,
  hintTimer: null,
  lastViewportPhone: typeof window !== "undefined" && window.innerWidth <= 720,
  touchStartY: null,
  touchStartX: null,
};

// ───────────────────────── helpers ─────────────────────────

function isPhoneViewport() { return window.innerWidth <= 720; }

function openDrawer() {
  document.body.classList.add("menu-open");
  const toggle = document.getElementById("drawer-toggle");
  if (toggle) toggle.setAttribute("aria-expanded", "true");
}
function closeDrawer() {
  document.body.classList.remove("menu-open");
  const toggle = document.getElementById("drawer-toggle");
  if (toggle) toggle.setAttribute("aria-expanded", "false");
}

function isInland(site) {
  return AtlasData.isInland(state.corpusId, site);
}

function loadCorpus(corpusId) {
  return AtlasData.loadCorpus(corpusId, state.corpusCache);
}

function currentView() {
  return AtlasData.currentView(state.data, state.selectedView);
}

function viewIdsForCorpus() {
  return AtlasData.viewIdsForCorpus(state.corpusId, state.data);
}

function viewLabel(viewId) {
  return AtlasData.viewLabel(state.corpusId, state.data, viewId);
}

function buildFocusList() {
  return AtlasData.buildFocusList({
    corpusId: state.corpusId,
    data: state.data,
    selectedView: state.selectedView,
    isPhoneViewport: isPhoneViewport(),
  });
}

function buildLegs(sites) {
  return AtlasData.buildLegs({
    corpusId: state.corpusId,
    sites,
    selectedView: state.selectedView,
  });
}

// ───────────────────────── map ─────────────────────────

function initMap() {
  // On phones the user expects to pan and pinch-zoom the map directly —
  // gating that behind an "Explore" toggle the way desktop does is
  // unnatural. So mobile starts with map gestures enabled; the explore
  // toggle becomes a no-op there. Mobile also gets Leaflet's built-in
  // +/− zoom buttons (positioned bottom-left so they don't fight with
  // the drawer toggle), in addition to one-finger double-tap-to-zoom-in.
  const phone = isPhoneViewport();
  const map = L.map("map", {
    scrollWheelZoom: false,
    dragging: phone,
    touchZoom: phone,
    doubleClickZoom: phone,
    keyboard: false,
    zoomControl: phone,
    attributionControl: true,
    zoomAnimation: true,
    fadeAnimation: true,
    markerZoomAnimation: true,
  }).setView([18, 50], 5);
  if (phone && map.zoomControl) {
    map.zoomControl.setPosition("bottomleft");
  }

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

function pinHtml(kind, options = {}) {
  const markerKind = ["land", "sea", "materia"].includes(kind) ? kind : "sea";
  const classes = ["site-pin", `site-pin--${markerKind}`, "site-pin--inactive"];
  if (options.broad) classes.push("site-pin--broad");
  return `<span class="${classes.join(" ")}" aria-hidden="true"></span>`;
}

function pinIcon(kind, options = {}) {
  const markerKind = ["land", "sea", "materia"].includes(kind) ? kind : "sea";
  const size = markerKind === "materia" ? [20, 20] : markerKind === "land" ? [16, 16] : [18, 18];
  const anchor = markerKind === "materia" ? [10, 10] : markerKind === "land" ? [8, 8] : [9, 9];
  return L.divIcon({
    className: "site-pin-wrap",
    html: pinHtml(markerKind, options),
    iconSize: size,
    iconAnchor: anchor,
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
    const kind = corpusIsMateria(state.corpusId) ? "materia" : isInland(site) ? "land" : "sea";
    const isBroad = Boolean(site.is_broad_region || site.has_uncertain_coordinates);
    const name = corpusIsMateria(state.corpusId) && site.place_label
      ? `${siteDisplayName(site)} · ${site.place_label}`
      : siteDisplayName(site);
    const marker = L.marker(ll, {
      icon: pinIcon(kind, { broad: isBroad }),
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
      const idx = state.focusList.findIndex((f) => {
        if (f.siteKey === site.site_key) return true;
        return (f.siteKeys ?? []).includes(site.site_key);
      });
      if (idx >= 0) goTo(idx);
    });
    marker.addTo(state.layers.markers);
    state.markers.set(site.site_key, {
      marker,
      kind,
      placeKey: site.place_key ?? site.site_key,
      isBroad,
    });
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

function materialRows() {
  return [...(state.data?.materia ?? [])]
    .filter((m) => m.view_id && state.data.routeViews?.views?.[m.view_id]);
}

function renderMaterialOptions(value = "") {
  const options = document.getElementById("material-options");
  const input = document.getElementById("material-search");
  if (!options || !input) return;
  const minChars = Number(input.dataset.suggestMinChars ?? 1);
  const query = value.trim().toLowerCase();
  if (query.length < minChars) {
    options.innerHTML = "";
    return;
  }
  const rows = materialRows().filter((m) => {
    const haystack = `${m.display_name ?? ""} ${m.greek_name ?? ""}`.toLowerCase();
    return haystack.includes(query);
  });
  options.innerHTML = rows
    .map((m) => `<option value="${escapeHtml(m.display_name)}" data-view="${escapeHtml(m.view_id)}">${escapeHtml(m.greek_name ?? "")}</option>`)
    .join("");
}

function renderMaterialSelector() {
  const control = document.getElementById("material-control");
  const input = document.getElementById("material-search");
  const options = document.getElementById("material-options");
  if (!control || !input || !options) return;
  if (!corpusIsMateria(state.corpusId) || !state.data?.materia) {
    control.hidden = true;
    input.value = "";
    options.innerHTML = "";
    return;
  }
  control.hidden = false;
  const rows = materialRows();
  const selectedMateriaKey = currentView()?.materia_key ?? "";
  const selected = rows.find((m) => m.ingredient_key === selectedMateriaKey || m.materia_key === selectedMateriaKey);
  input.value = state.selectedView === "all" ? "" : selected?.display_name ?? "";
  renderMaterialOptions(input.value);
}

function renderCorpusButtons() {
  document.querySelectorAll("[data-corpus]").forEach((btn) => {
    btn.setAttribute("aria-pressed", btn.dataset.corpus === state.corpusId ? "true" : "false");
  });
}

function renderStripLegend() {
  const legend = document.querySelector(".strip__legend");
  if (!legend) return;
  if (corpusIsMateria(state.corpusId)) {
    legend.innerHTML = `
      <span class="strip__swatch strip__swatch--materia"></span>
      <span class="strip__legend-label">Materia</span>
      <span class="strip__swatch strip__swatch--broad"></span>
      <span class="strip__legend-label">Broad</span>
    `;
    return;
  }
  legend.innerHTML = `
    <span class="strip__swatch strip__swatch--sea"></span>
    <span class="strip__legend-label">Sea</span>
    <span class="strip__swatch strip__swatch--land"></span>
    <span class="strip__legend-label">Caravan</span>
  `;
}

function renderStrip() {
  renderStripLegend();
  const rail = document.getElementById("strip-rail");
  rail.innerHTML = state.focusList
    .map((f, idx) => {
      const label = f.corpus === "materia_medica"
        ? `${idx + 1} · ${f.displayName}${f.placeLabel ? ` · ${f.placeLabel}` : ""}`
        : f.corpus === "galen" && Number.isFinite(f.site.route_order)
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
          data-broad="${f.isBroadRegion ? "true" : "false"}"
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
  if (focus.corpus === "materia_medica") {
    return {
      route: "Materia Medica",
      type: focus.relation || focus.placeType || "Provenance",
      section: focus.sourceCitation || "",
    };
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

function renderContextMentionsHtml(mentions) {
  const items = mentions.map((m) => {
    const meta = [m.citation, m.surface ? `“${escapeHtml(m.surface)}”` : ""]
      .filter(Boolean).join(" · ");
    return `
      <div class="dossier-mention">
        <p class="dossier-mention__meta">${meta}</p>
        ${m.englishSentence ? `<p class="dossier-mention__english">${escapeHtml(m.englishSentence)}</p>` : ""}
        ${m.greekSentence ? `<p class="dossier-mention__greek" lang="grc">${escapeHtml(m.greekSentence)}</p>` : ""}
      </div>
    `;
  }).join("");
  const lead = mentions.length === 1
    ? "Mentioned in 1 passage:"
    : `Mentioned in ${mentions.length} passages:`;
  return `
    <p class="dossier-mention__lead">${lead}</p>
    ${items}
  `;
}

function claimWarningLabel(warning) {
  if (warning === "bosporus_target_ambiguous") {
    return "Bosporus target reviewed as ambiguous";
  }
  if (warning === "broad_region_representative_point") {
    return "";
  }
  if (warning === "uncertain_coordinate_precision") {
    return "";
  }
  return warning.replaceAll("_", " ");
}

function renderMateriaList(focus) {
  const wrap = document.getElementById("dossier-materia");
  const list = document.getElementById("dossier-materia-list");
  if (!focus.materia || focus.materia.length === 0) {
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

function renderMateriaMedicaHtml(focus) {
  const claims = focus.placeClaims ?? [];
  const active = focus.activeClaim ?? claims.find((claim) => claim.isActive) ?? claims[0] ?? {};
  const warning = focus.isBroadRegion || focus.hasUncertainCoordinates
    ? `<p class="dossier-warning">${escapeHtml(focus.broadRegionLabel || "Broad or uncertain place; marker is representative.")}</p>`
    : "";
  const rows = [
    ["Source", focus.sourceCitation],
    ["Place", active.placeLabel],
    ["Claim", claims.length > 1 && active.claimOrder ? `${active.claimOrder} of ${claims.length}` : ""],
    ["Relation", active.relationLabel || focus.relation],
    ["Relation group", active.relationGroupLabel],
    ["English", focus.translation ? "Draft display text" : ""],
  ].filter(([, value]) => value);
  const meta = rows.map(([label, value]) => `
    <div class="dossier-provenance__row">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
    </div>
  `).join("");
  const chips = claims.length ? `
    <div class="dossier-place-chips" aria-label="Place claims">
      ${claims.map((claim) => {
        const label = [claim.placeLabel, claim.relationGroupLabel].filter(Boolean).join(" · ");
        const href = claim.pleiadesUri || "#";
        const activeClass = claim.isActive ? " dossier-place-chip--active" : "";
        return `<a class="dossier-place-chip${activeClass}" href="${escapeHtml(href)}" target="_blank" rel="noreferrer">${escapeHtml(label)}</a>`;
      }).join("")}
    </div>
  ` : "";
  const claimList = claims.length ? `
    <ol class="dossier-claims">
      ${claims.map((claim, index) => {
        const confidence = Number.isFinite(claim.consensusConfidence)
          ? `${Math.round(claim.consensusConfidence * 100)}%`
          : "";
        const qualifier = [claim.qualifier, claim.relationLabel].filter(Boolean).join(" · ");
        const group = claim.relationGroupLabel
          ? `<span class="dossier-claim__group">${escapeHtml(claim.relationGroupLabel)}</span>`
          : "";
        const precision = [claim.locationPrecision, claim.coordinateSource]
          .filter(Boolean)
          .join(" · ");
        const broad = claim.isBroadRegion || claim.hasUncertainCoordinates
          ? `<p class="dossier-claim__warning">${escapeHtml(claim.broadRegionLabel || "Representative Pleiades point")}</p>`
          : "";
        const warningLabels = (claim.warnings ?? [])
          .map(claimWarningLabel)
          .filter(Boolean);
        const warnings = warningLabels.length
          ? `<p class="dossier-claim__warning">${escapeHtml(warningLabels.join(" · "))}</p>`
          : "";
        const pleiades = claim.pleiadesUri
          ? `<a class="dossier-claim__link" href="${escapeHtml(claim.pleiadesUri)}" target="_blank" rel="noreferrer">Pleiades ${escapeHtml(claim.pleiadesId ?? "")} ↗</a>`
          : "";
        return `
          <li class="dossier-claim${claim.isActive ? " dossier-claim--active" : ""}">
            <div class="dossier-claim__head">
              <span class="dossier-claim__num">${String(index + 1).padStart(2, "0")}</span>
              <strong>${escapeHtml(claim.placeLabel)}</strong>
              ${group}
              ${qualifier ? `<span class="dossier-claim__qualifier">${escapeHtml(qualifier)}</span>` : ""}
            </div>
            ${claim.placeSurface ? `<p class="dossier-claim__surface" lang="grc">${escapeHtml(claim.placeSurface)}</p>` : ""}
            ${claim.evidencePhrase ? `<p class="dossier-claim__evidence" lang="grc">${escapeHtml(claim.evidencePhrase)}</p>` : ""}
            ${claim.claimNote ? `<p class="dossier-claim__note">${escapeHtml(claim.claimNote)}</p>` : ""}
            <div class="dossier-claim__meta">
              ${confidence ? `<span>${escapeHtml(confidence)} confidence</span>` : ""}
              ${precision ? `<span>${escapeHtml(precision)}</span>` : ""}
              ${pleiades}
            </div>
            ${broad}
            ${warnings}
          </li>
        `;
      }).join("")}
    </ol>
  ` : "";
  const text = focus.translation
    ? `<p class="dossier-provenance__entry">${escapeHtml(focus.translation)}</p>`
    : `<p class="dossier__translation-placeholder">Translation pending review.</p>`;
  return `
    <div class="dossier-provenance">
      ${meta}
      ${warning}
      ${chips}
      ${claimList}
      ${text}
    </div>
  `;
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
  const greekBlock = document.getElementById("dossier-greek-block");
  const greekEl = document.getElementById("dossier-greek");

  let translationHtml;
  if (focus.corpus === "materia_medica") {
    translationHtml = renderMateriaMedicaHtml(focus);
    greekEl.textContent = focus.greekText || "";
    greekBlock.hidden = !focus.greekText;
  } else if (focus.translation) {
    translationHtml = escapeHtml(focus.translation);
    greekEl.textContent = focus.greekText || "";
    greekBlock.hidden = !focus.greekText;
  } else if (focus.corpus === "galen" && focus.contextMentions && focus.contextMentions.length > 0) {
    // Context / materia pin without its own passage — render snippets
    // from every passage that names this place.
    translationHtml = renderContextMentionsHtml(focus.contextMentions);
    // The snippets carry their own Greek inline; hide the standalone
    // "Greek source" details to avoid duplicating it.
    greekEl.textContent = "";
    greekBlock.hidden = true;
  } else if (focus.corpus === "galen" && focus.siteKind && focus.siteKind !== "primary") {
    const role = focus.siteKind === "materia" ? "Materia-medica observation" : "Context location";
    translationHtml = `<span class="dossier__translation-placeholder">${role} — no Galen passage attached.</span>`;
    greekEl.textContent = "";
    greekBlock.hidden = true;
  } else {
    translationHtml = `<span class="dossier__translation-placeholder">Translation pending review.</span>`;
    greekEl.textContent = focus.greekText || "";
    greekBlock.hidden = !focus.greekText;
  }
  applyHtmlTransition(translationEl, translationHtml);

  renderMateriaList(focus);

  const sourceEl = document.getElementById("dossier-source");
  let sourceBits;
  if (focus.corpus === "galen") {
    sourceBits = [focus.kuhnCitation && `K. ${focus.kuhnCitation}`, focus.orderBasis].filter(Boolean);
  } else if (focus.corpus === "materia_medica") {
    const claimCount = focus.placeClaims?.length ?? 0;
    sourceBits = [
      claimCount > 1 ? `${claimCount} places` : focus.placeLabel,
      focus.relation,
      focus.isBroadRegion ? "representative point" : "",
    ].filter(Boolean);
  } else {
    sourceBits = [focus.modernId, focus.chapter].filter(Boolean);
  }
  sourceEl.textContent = sourceBits.join(" · ");

  const link = document.getElementById("dossier-pleiades");
  if (focus.pleiadesUri) {
    link.href = focus.pleiadesUri;
    link.textContent = `Pleiades ${focus.pleiadesId ?? ""} ↗`.trim();
    link.hidden = false;
  } else if (focus.corpus === "materia_medica" && (focus.placeClaims?.length ?? 0) > 1) {
    link.hidden = true;
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
    const activeKeys = focus.siteKeys ?? [focus.siteKey];
    const isActive = activeKeys.includes(key);
    pin.classList.toggle("site-pin--active", isActive);
    pin.classList.toggle("site-pin--inactive", !isActive);
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
  if (focus.corpus === "materia_medica") {
    return focus.isBroadRegion || focus.hasUncertainCoordinates ? 5.4 : 6.6;
  }
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

  if (
    focus.corpus === "materia_medica"
    && (focus.boundsLatLngs?.length ?? 0) > 1
    && !state.exploreMode
  ) {
    const bounds = L.latLngBounds(focus.boundsLatLngs).pad(0.42);
    const fitOptions = { maxZoom: 5.8, animate: !state.reduceMotion && !options.instant };
    if (state.reduceMotion || options.instant) {
      state.map.fitBounds(bounds, { ...fitOptions, animate: false });
    } else {
      state.map.flyToBounds(bounds, { ...fitOptions, duration: 1.2, easeLinearity: 0.28 });
    }
    return;
  }

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
  // On phones the map gestures are always on; explore mode is desktop-only.
  if (isPhoneViewport()) {
    state.map.dragging.enable();
    state.map.touchZoom.enable();
    state.map.doubleClickZoom.enable();
    return;
  }
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
      // On phones, wheel events shouldn't drive site advance — the user
      // navigates by buttons only and is free to scroll inside the dossier.
      if (isPhoneViewport()) return;
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
        if (document.body.classList.contains("menu-open")) {
          closeDrawer();
        } else if (state.activeMateriaKey) {
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
    // On phones, touch belongs to the map (drag/pinch) and the dossier
    // (scroll). Don't capture swipes to advance the site list.
    if (isPhoneViewport()) return;
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
    if (isPhoneViewport()) return;
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
  // Closes the mobile drawer after a selection so the user lands back
  // on the map immediately.
  document.getElementById("view-control-routes").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-view]");
    if (btn) {
      setView(btn.dataset.view);
      closeDrawer();
    }
  });

  const materialSearch = document.getElementById("material-search");
  if (materialSearch) {
    materialSearch.addEventListener("input", (e) => {
      if (!corpusIsMateria(state.corpusId)) return;
      const value = e.target.value.trim();
      state.materialSearchValue = value;
      renderMaterialOptions(value);
      if (!value) {
        setView("all");
        return;
      }
      const match = [...(state.data?.materia ?? [])].find((m) => {
        return String(m.display_name).toLowerCase() === value.toLowerCase()
          || String(m.greek_name ?? "").toLowerCase() === value.toLowerCase();
      });
      if (match?.view_id) {
        setView(match.view_id);
      }
    });
    materialSearch.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        materialSearch.value = "";
        state.materialSearchValue = "";
        renderMaterialOptions("");
        setView("all");
      }
    });
  }

  // Delegated corpus selector.
  document.querySelector(".corpus-control").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-corpus]");
    if (btn) {
      setCorpus(btn.dataset.corpus);
      // Leave the drawer open so the user can pick a route in the new
      // corpus without an extra tap.
    }
  });

  // Mobile drawer toggle.
  const drawerToggle = document.getElementById("drawer-toggle");
  const drawerClose = document.getElementById("drawer-close");
  const drawerBackdrop = document.getElementById("drawer-backdrop");
  if (drawerToggle) drawerToggle.addEventListener("click", openDrawer);
  if (drawerClose) drawerClose.addEventListener("click", closeDrawer);
  if (drawerBackdrop) drawerBackdrop.addEventListener("click", closeDrawer);

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
      // Crossing the phone/desktop breakpoint changes the context-mention
      // limit AND the map's gesture defaults (drag always-on for phones,
      // gated by explore-mode on desktop). Re-apply both.
      const isPhone = isPhoneViewport();
      if (isPhone !== state.lastViewportPhone) {
        state.lastViewportPhone = isPhone;
        // Re-evaluate map gestures for the new viewport class.
        setExploreMode(state.exploreMode);
        // The drawer only exists on mobile — collapse it if we left.
        if (!isPhone) closeDrawer();
        if (state.data && !state.exploreMode) {
          setView(state.selectedView, { instant: true });
        }
        return;
      }
      if (state.exploreMode) return;
      if (state.currentIndex >= 0) {
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
  renderMaterialSelector();
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
  state.materialSearchValue = "";

  state.data = await loadCorpus(corpusId);
  const cfg = CORPORA[corpusId];

  // Choose initial view: prefer a stored default, else the configured default.
  const ids = Object.keys(state.data.routeViews?.views ?? {});
  const wantedView = ids.includes(cfg.defaultView) ? cfg.defaultView : ids[0];
  state.selectedView = wantedView;

  renderMasthead();
  renderCorpusButtons();
  renderRouteButtons();
  renderMaterialSelector();

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
