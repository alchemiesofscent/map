/*
 * Optional reference layer that renders a Google My Maps GeoJSON export.
 *
 * Treated as non-authoritative: features here are drawn in a muted style and
 * popups are explicitly labeled "External reference map". Toggling this layer
 * never alters the curated route, the active step, or the off-route status.
 *
 * The layer fetches `data/external/google_mymaps/periplus_mymap.geojson`. If
 * the file is missing or returns a non-2xx response, the layer marks itself
 * unavailable and stays silent — no thrown errors, no console spam.
 */

(function () {
  const GEOJSON_PATH = "../../data/external/google_mymaps/periplus_mymap.geojson";

  const POINT_STYLE = {
    radius: 4,
    color: "#6b6258",
    weight: 1.2,
    fillColor: "#fff8ec",
    fillOpacity: 0.4,
    dashArray: "2 2",
  };

  const LINE_STYLE = {
    color: "#6b6258",
    weight: 2,
    opacity: 0.7,
    dashArray: "4 5",
    lineCap: "round",
    lineJoin: "round",
  };

  const POLYGON_STYLE = {
    color: "#6b6258",
    weight: 1.2,
    opacity: 0.6,
    fillColor: "#cdb799",
    fillOpacity: 0.18,
    dashArray: "2 4",
  };

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function popupHtml(feature) {
    const props = feature.properties ?? {};
    const lines = ["<strong class=\"external-popup__kicker\">External reference map</strong>"];
    if (props.name) {
      lines.push(`<div class="external-popup__name">${escapeHtml(props.name)}</div>`);
    }
    if (props.folder) {
      lines.push(`<div class="external-popup__folder">${escapeHtml(props.folder)}</div>`);
    }
    if (props.description) {
      lines.push(`<div class="external-popup__desc">${escapeHtml(props.description)}</div>`);
    }
    return lines.join("");
  }

  function buildLayer(featureCollection) {
    const group = L.layerGroup();

    L.geoJSON(featureCollection, {
      pointToLayer: (_feature, latlng) => L.circleMarker(latlng, POINT_STYLE),
      style: (feature) => {
        if (!feature || !feature.geometry) return LINE_STYLE;
        if (feature.geometry.type === "Polygon" || feature.geometry.type === "MultiPolygon") {
          return POLYGON_STYLE;
        }
        return LINE_STYLE;
      },
      onEachFeature: (feature, layer) => {
        layer.bindPopup(popupHtml(feature), { className: "external-popup" });
      },
    }).addTo(group);

    return group;
  }

  window.createExternalReferenceLayer = function createExternalReferenceLayer(map) {
    let group = null;
    let available = false;
    let attached = false;

    async function load() {
      try {
        const response = await fetch(GEOJSON_PATH, { cache: "no-cache" });
        if (!response.ok) return false;
        const data = await response.json();
        if (!data || !Array.isArray(data.features) || data.features.length === 0) {
          return false;
        }
        group = buildLayer(data);
        available = true;
        return true;
      } catch (_error) {
        // Network error or non-JSON body. Stay silent — this layer is optional.
        return false;
      }
    }

    function enable() {
      if (!available || !group || attached) return;
      group.addTo(map);
      attached = true;
    }

    function disable() {
      if (!attached || !group) return;
      map.removeLayer(group);
      attached = false;
    }

    function isAvailable() {
      return available;
    }

    return { load, enable, disable, isAvailable };
  };
})();
