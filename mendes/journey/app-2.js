
    // ————— Journey viewer: map layer —————
    // Shares its data with ../map/app-1.js, which opens the async IIFE that
    // app-3.js closes. Deliberately draws no corridors and no line between an
    // ingredient's places: the sources attest origins, not travel between them.

    const svg = d3.select("#map");
    const width = 900;
    const height = 710;
    let currentZoom = d3.zoomIdentity;
    let overlayScale = 1;
    let viewAtHome = true;

    const frameGeo = { type:"Polygon", coordinates:[[[7,3],[7,48],[83,48],[83,3],[7,3]]] };
    const projection = d3.geoEquirectangular().fitExtent([[18,18],[width-18,height-18]], frameGeo);
    const geoPath = d3.geoPath(projection);

    svg.append("defs").html(
      '<clipPath id="map-clip"><rect x="18" y="18" width="' + (width-36) + '" height="' + (height-36) + '"></rect></clipPath>'
    );

    const viewport = svg.append("g").attr("clip-path", "url(#map-clip)");
    const zoomLayer = viewport.append("g").attr("class","zoom-layer");
    zoomLayer.append("path").datum(d3.geoGraticule10()).attr("class","graticule").attr("d",geoPath);

    let world;
    try {
      const topologyResponse = await fetch("https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json");
      if (!topologyResponse.ok) throw new Error("Basemap request failed: " + topologyResponse.status);
      const topology = await topologyResponse.json();
      world = topojson.feature(topology,topology.objects.countries);
    } catch (error) {
      console.warn("The basemap could not be loaded; the places remain available.",error);
      world = { type:"FeatureCollection", features:[] };
    }
    zoomLayer.append("g")
      .selectAll("path")
      .data(world.features || [])
      .join("path")
      .attr("class","land")
      .attr("d",geoPath);

    const labelLayer = viewport.append("g").attr("aria-hidden","true");
    const regionLabels = labelLayer.selectAll(".region-label")
      .data(ancientLabels)
      .join("text")
      .attr("class", function (d) { return d.cls; })
      .attr("text-anchor","middle")
      .text(function (d) { return d.text; });

    const mapPlaceLabels = labelLayer.selectAll(".place-label")
      .data(placeLabels)
      .join("text")
      .attr("class","place-label")
      .text(function (d) { return d.text; });

    // ————— Stops —————
    // Every claim gets a marker so the whole evidence base stays visible; the
    // active journey's stops are raised and numbered, the rest recede.
    const claimLayer = viewport.append("g").attr("aria-label","Attested places");
    const markerGlyphIds = { ancient:"glyph-ancient", modern:"glyph-inference", theology:"glyph-theology" };
    const markerShapeClasses = { ancient:"ancient-shape", modern:"modern-shape", theology:"theology-shape" };

    const marker = claimLayer.selectAll(".claim")
      .data(claims)
      .join("g")
      .attr("class","claim")
      .attr("data-id", function (d) { return d.id; })
      .attr("role","button")
      .attr("tabindex","-1")
      .attr("aria-label", function (d) { return d.greek + ", " + d.place + ". " + d.cite; });

    marker.append("circle").attr("class","claim-hit").attr("r",22);
    marker.append("circle").attr("class","focus-ring").attr("r",14);
    marker.each(function (d) {
      const g = d3.select(this);
      g.append("use")
        .attr("href","#" + markerGlyphIds[d.evidence])
        .attr("class","claim-glyph " + markerShapeClasses[d.evidence])
        .attr("x",-12).attr("y",-12).attr("width",24).attr("height",24);
      g.append("text")
        .attr("class","stop-number")
        .attr("text-anchor","middle")
        .attr("dy",-15)
        .text("");
    });

    const selectedLabel = viewport.append("text").attr("class","selected-label").style("display","none");

    function transformedPoint(coord) {
      const p = projection(coord);
      return [currentZoom.applyX(p[0]), currentZoom.applyY(p[1])];
    }

    function positionSelectedLabel() {
      if (!activeStop) { selectedLabel.style("display","none"); return; }
      const p = transformedPoint(activeStop.claim.coord);
      selectedLabel
        .attr("x", p[0])
        .attr("y", p[1] - 22 * overlayScale)
        .attr("text-anchor","middle");
    }

    function escapeHTML(value) {
      return String(value).replace(/[&<>"']/g, function (char) {
        return ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#039;" })[char];
      });
    }

    function evidenceText(d) {
      if (d.context) return "Ancient-attested name tradition";
      if (d.evidence === "ancient") return "Ancient-attested claim";
      if (d.evidence === "theology") return "Theological provenance";
      if (d.subtype === "correction") return "Modern correction";
      return "Working inference / source silence";
    }

    function toRoman(value) {
      if (!Number.isFinite(value) || value < 1) return "—";
      const table = [[1000,"M"],[900,"CM"],[500,"D"],[400,"CD"],[100,"C"],[90,"XC"],[50,"L"],[40,"XL"],[10,"X"],[9,"IX"],[5,"V"],[4,"IV"],[1,"I"]];
      let remaining = Math.floor(value);
      let out = "";
      table.forEach(function (pair) {
        while (remaining >= pair[0]) { out += pair[1]; remaining -= pair[0]; }
      });
      return out;
    }
