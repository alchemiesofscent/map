    const svg = d3.select("#map");
    const width = 900;
    const height = 710;
    let currentZoom = d3.zoomIdentity;
    let selectedClaim = null;
    let selectedIngredientId = null;
    let selectedCourtPlot = null;
    let navigationReady = false;
    let overlayScale = 1;
    let viewAtHome = true;
    const frameGeo = { type:"Polygon", coordinates:[[[7,3],[7,48],[83,48],[83,3],[7,3]]] };
    const projection = d3.geoEquirectangular().fitExtent([[18,18],[width-18,height-18]], frameGeo);
    const geoPath = d3.geoPath(projection);
    const projectedLine = d3.line()
      .x(function (d) { return projection(d)[0]; })
      .y(function (d) { return projection(d)[1]; })
      .curve(d3.curveCatmullRom.alpha(.35));

    svg.append("defs").html(
      '<clipPath id="map-clip"><rect x="18" y="18" width="' + (width-36) + '" height="' + (height-36) + '"></rect></clipPath>' +
      '<filter id="soft-glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="5"></feGaussianBlur></filter>'
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
      console.warn("The basemap could not be loaded; research points remain available.",error);
      world = { type:"FeatureCollection", features:[] };
    }
    zoomLayer.append("g")
      .selectAll("path")
      .data(world.features || [])
      .join("path")
      .attr("class","land")
      .attr("d",geoPath);

    const theologyPoint = projection([42.0,9.2]);
    zoomLayer.append("ellipse")
      .attr("class","theology-zone")
      .attr("cx", theologyPoint[0])
      .attr("cy", theologyPoint[1])
      .attr("rx", 68)
      .attr("ry", 36);
    const theologyLabels = viewport.append("g")
      .attr("aria-hidden","true")
      .selectAll("text")
      .data([
        { text:"PUNT / tꜢ-nṯr", dx:74, dy:-16, size:null },
        { text:"THEOLOGY, NOT A BORDER", dx:74, dy:-2, size:"9px" }
      ])
      .join("text")
      .attr("class","theology-zone-label")
      .style("font-size", function (d) { return d.size; })
      .text(function (d) { return d.text; });

    const routeLayer = zoomLayer.append("g").attr("aria-label","Conventional route corridors");
    routeLayer.selectAll("path")
      .data(routes)
      .join("path")
      .attr("class", function (d) { return "route " + d.type; })
      .attr("d", function (d) { return projectedLine(d.coords); });

    const routeLabels = viewport.append("g")
      .attr("aria-hidden","true")
      .selectAll("text")
      .data(routes)
      .join("text")
      .attr("class", function (d) { return "route-label " + d.type; })
      .text(function (d) { return d.label; });

    const selectedRoute = zoomLayer.append("path").attr("class","selected-route").attr("d",null);

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

    function drawHub(coord, name, sub, dx, dy) {
      const g = labelLayer.append("g").attr("class","hub").datum({ coord:coord });
      g.append("circle").attr("class","hub-ring").attr("r",7);
      g.append("circle").attr("class","hub-core").attr("r",2.6);
      g.append("text").attr("class","hub-label").attr("x",dx).attr("y",dy).text(name);
      g.append("text").attr("class","hub-sub").attr("x",dx).attr("y",dy+12).text(sub);
    }
    drawHub([31.5,30.95],"MENDES","CONVERGENCE / DELTA",10,-10);
    drawHub([29.9,31.2],"ALEXANDRIA","MANUFACTURING HUB",-92,-9);

    const hubs = labelLayer.selectAll(".hub");
    const claimLayer = viewport.append("g").attr("aria-label","Provenance points");

    const marker = claimLayer.selectAll(".claim")
      .data(claims)
      .join("g")
      .attr("class","claim")
      .attr("data-id", function (d) { return d.id; })
      .attr("role","button")
      .attr("tabindex","0")
      .attr("aria-label", function (d) { return d.greek + ", " + d.place + ". " + d.cite; });

    const markerGlyphIds = { ancient:"glyph-ancient", modern:"glyph-inference", theology:"glyph-theology" };
    const markerShapeClasses = { ancient:"ancient-shape", modern:"modern-shape", theology:"theology-shape" };

    marker.append("circle").attr("class","claim-hit").attr("r",22);
    marker.append("circle").attr("class","focus-ring").attr("r",14);
    marker.each(function (d) {
      const g = d3.select(this);
      g.append("use")
        .attr("href","#" + markerGlyphIds[d.evidence])
        .attr("class","claim-glyph " + markerShapeClasses[d.evidence])
        .attr("x",-12).attr("y",-12).attr("width",24).attr("height",24);
    });

    // ————— The court layer —————
    // The placed reports from the Ptolemaic queens' dossier (claims.json's
    // court array): patronage, spectacle, and revenue records that name a
    // city. They are reports, never ingredient provenance, so they draw as
    // their own dashed register, off by default, and stay out of the claim
    // counter, the stop strip, and the recipe layers.
    const courtPlots = [];
    (claimsData.court || []).forEach(function (record) {
      (record.places || []).forEach(function (place, index) {
        courtPlots.push({
          id: record.places.length > 1 ? record.id + "-" + index : record.id,
          record: record,
          place: place.name,
          coord: place.coord,
          dx: 0,
          dy: 0
        });
      });
    });
    // Several records share Alexandria; spread same-coordinate dots in a small
    // fixed-size ring so each stays hittable. Screen-space offsets, applied
    // after projection, so the ring does not grow with zoom.
    (function spreadSharedCoords() {
      const byCoord = new Map();
      courtPlots.forEach(function (plot) {
        const key = plot.coord.join(",");
        if (!byCoord.has(key)) byCoord.set(key,[]);
        byCoord.get(key).push(plot);
      });
      byCoord.forEach(function (group) {
        if (group.length < 2) return;
        group.forEach(function (plot, i) {
          const angle = (Math.PI * 2 * i) / group.length - Math.PI / 2;
          plot.dx = Math.cos(angle) * 13;
          plot.dy = Math.sin(angle) * 13;
        });
      });
    }());

    const courtLayer = viewport.append("g")
      .attr("class","court-layer")
      .attr("aria-label","Court records — reports, not provenance")
      .style("display","none");
    const courtMarker = courtLayer.selectAll(".court-claim")
      .data(courtPlots)
      .join("g")
      .attr("class","court-claim")
      .attr("data-id", function (d) { return d.id; })
      .attr("role","button")
      .attr("tabindex","-1")
      .attr("aria-label", function (d) {
        return d.record.queen.join(" and ") + ", " + d.place + ". " + d.record.cite;
      });
    courtMarker.append("circle").attr("class","claim-hit").attr("r",20);
    courtMarker.append("circle").attr("class","focus-ring").attr("r",13);
    courtMarker.append("use")
      .attr("href","#glyph-court")
      .attr("class","court-glyph")
      .attr("x",-12).attr("y",-12).attr("width",24).attr("height",24);

    const selectedLabel = viewport.append("text").attr("class","selected-label").style("display","none");
    const detailContent = document.getElementById("detail-content");

    function transformedPoint(coord) {
      return currentZoom.apply(projection(coord));
    }

    function positionSelectedLabel() {
      const target = selectedClaim || selectedCourtPlot;
      if (!target) return;
      const p = transformedPoint(target.coord);
      p[0] += (target.dx || 0) * overlayScale;
      p[1] += (target.dy || 0) * overlayScale;
      // The label always typed rightward, so a point near the right edge ran
      // its name off the screen — "Vessel-dressing gum — source unst". Points
      // in the window's right half name themselves leftward instead.
      let w = 0;
      try { w = selectedLabel.node().getComputedTextLength() * overlayScale; } catch (e) { w = 0; }
      const ext = visibleViewportExtent();
      const flip = p[0] + 13 * overlayScale + w > ext[1][0] - 8;
      const x = flip ? p[0] - 13 * overlayScale : p[0] + 13 * overlayScale;
      const y = p[1] - 13 * overlayScale;
      selectedLabel
        .attr("text-anchor",flip ? "end" : null)
        .attr("x",x)
        .attr("y",y)
        .attr("transform","translate(" + x + "," + y + ") scale(" + overlayScale + ") translate(" + (-x) + "," + (-y) + ")");
    }

    function evidenceText(d) {
      if (d.context) return "Ancient-attested name tradition";
      if (d.evidence === "ancient") return "Ancient-attested claim";
      if (d.evidence === "theology") return "Theological provenance";
      if (d.subtype === "correction") return "Modern correction";
      return "Working inference / source silence";
    }

    function escapeHTML(value) {
      return String(value).replace(/[&<>"']/g, function (char) {
        return ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#039;" })[char];
      });
    }

    // ————— Perfume layers —————
    // Three loose checkboxes in a toolbar strip became the control rail the
    // journeys viewer already uses: one pressable row per recipe, carrying the
    // number of claims it accounts for. The rail is built from `recipes` rather
    // than written out in the markup, so a fourth recipe would arrive with its
    // own row and count and nothing else to edit.
    //
    // Each row keeps `value` and `checked` and emits `change` on toggle, so the
    // two places that listen for a layer change — the map's visibility pass and
    // the search results — bind to it exactly as they bound to the checkboxes.
    function renderPerfumeLayers() {
      const host = document.getElementById("view-control-routes");
      if (!host || host.childElementCount) return;
      const counts = {};
      ingredients.forEach(function (ingredient) {
        ingredient.claims.forEach(function (claim) {
          claim.recipes.forEach(function (key) { counts[key] = (counts[key] || 0) + 1; });
        });
      });
      Object.keys(recipes).forEach(function (key) {
        const button = document.createElement("button");
        button.type = "button";
        button.dataset.recipe = key;
        button.setAttribute("aria-pressed","true");
        button.style.setProperty("--route-color","var(--" + ({ m:"mendesian", t:"metopion", s:"susinum" })[key] + ")");
        button.innerHTML =
          '<span class="view-control__dot" aria-hidden="true"></span>' +
          '<span class="view-control__name">' + escapeHTML(recipes[key].name) + "</span>" +
          '<span class="view-control__count">' + (counts[key] || 0) + "</span>";
        button.addEventListener("click",function () {
          const next = button.getAttribute("aria-pressed") !== "true";
          // One layer always stays lit: an empty map reads as a loading failure
          // rather than as a choice the reader made.
          if (!next && activeRecipeKeys().size < 2) return;
          button.setAttribute("aria-pressed",next ? "true" : "false");
          button.dispatchEvent(new Event("change",{ bubbles:false }));
        });
        host.appendChild(button);
      });
      // The court register rides in the same rail but is not a recipe layer:
      // it has no data-recipe, so the visibility pass, the search, and the
      // one-layer-stays-lit rule never see it. Off by default — the map stays
      // a provenance map until the reader asks for the reports.
      if (courtPlots.length) {
        const courtButton = document.createElement("button");
        courtButton.type = "button";
        courtButton.id = "toggle-court";
        courtButton.dataset.layer = "court";
        courtButton.setAttribute("aria-pressed","false");
        courtButton.innerHTML =
          '<svg class="view-control__court-glyph" aria-hidden="true"><use href="#glyph-court"></use></svg>' +
          '<span class="view-control__name">Court records</span>' +
          '<span class="view-control__count">' + courtPlots.length + "</span>";
        courtButton.addEventListener("click",function () {
          setCourtLayer(courtButton.getAttribute("aria-pressed") !== "true");
        });
        host.appendChild(courtButton);
      }
    }

    function layerInputs() {
      return Array.from(document.querySelectorAll("#view-control-routes button[data-recipe]"))
        .map(function (button) {
          // The call sites read .checked and .value; keep that shape so they do
          // not have to know the control changed.
          Object.defineProperty(button,"checked",{
            configurable: true,
            get: function () { return button.getAttribute("aria-pressed") === "true"; }
          });
          button.value = button.dataset.recipe;
          return button;
        });
    }

    function activeRecipeKeys() {
      return new Set(
        Array.from(document.querySelectorAll('#view-control-routes button[data-recipe][aria-pressed="true"]'))
          .map(function (button) { return button.dataset.recipe; })
      );
    }

    function visibleClaimsForIngredient(ingredient) {
      const active = activeRecipeKeys();
      return ingredient.claims.filter(function (claim) {
        return claim.recipes.some(function (recipe) { return active.has(recipe); });
      });
    }

    function visibleIngredientsForGroup(group) {
      return group.ids.map(function (id) { return ingredientById.get(id); }).filter(function (ingredient) {
        return ingredient && ingredient.recipes.some(function (recipe) { return activeRecipeKeys().has(recipe); });
      });
    }

    function visibleIngredientGroups() {
      return ingredientGroups.filter(function (group) { return visibleIngredientsForGroup(group).length; });
    }

    // ————— The dossier, in the journeys viewer's shape —————
    // Eyebrow: ingredient · evidence class · stop counter. Title: the place.
    // Greek in gold beneath, the note as the reading text, the citation in the
    // gold-edged block, recipes as quiet chips, and the transliteration as the
    // foot line. The classes are the shell's, so both viewers read from the
    // same stylesheet and the colours arrive with the markup.
    function locationsFor(d) {
      const ingredient = ingredientById.get(d ? d.ingredient : selectedIngredientId);
      if (!ingredient) return { ingredient:null, locations:[], index:-1 };
      const locations = visibleClaimsForIngredient(ingredient);
      const index = d ? locations.findIndex(function (claim) { return claim.id === d.id; }) : -1;
      return { ingredient:ingredient, locations:locations, index:index };
    }

    function recipeChips(d) {
      if (d.context) {
        return '<li>Metopion name-history · not a recipe ingredient</li>';
      }
      return d.recipes.map(function (key) {
        return '<li>' + escapeHTML(recipes[key].name) + '</li>';
      }).join("");
    }

    // Each claim's ingredient carries its catalogue anchor in claims.json, so
    // the panel can hand the reader to the dossier's full entry for the
    // material — the reverse of the dossier search's links onto this map.
    function readerLink(d) {
      const ingredient = ingredientById.get(d.ingredient);
      if (!ingredient || !ingredient.dossierAnchor) return "";
      return '<p class="dossier__reader-link-row"><a class="dossier__reader-link" href="../#' +
        encodeURIComponent(ingredient.dossierAnchor) + '">Read the catalogue entry in the dossier →</a></p>';
    }

    function dossierMarkup(d, position) {
      return '<div class="dossier__top">' +
          '<p class="dossier__eyebrow">' +
            '<span>' + escapeHTML(d.gloss) + '</span>' +
            '<span class="dossier__sep" aria-hidden="true">·</span>' +
            '<span>' + escapeHTML(evidenceText(d)) + '</span>' +
            (position ? '<span class="dossier__sep" aria-hidden="true">·</span><span>Stop ' + position + '</span>' : '') +
          '</p>' +
          '<h2 class="dossier__title">' + escapeHTML(d.place) + '</h2>' +
          '<p class="dossier__greek-name" lang="grc">' + escapeHTML(d.greek) + '</p>' +
        '</div>' +
        '<div class="dossier__body">' +
          '<p class="dossier__translation">' + escapeHTML(d.note) + '</p>' +
          '<div class="dossier__citation"><span class="dossier__eyebrow dossier__eyebrow--inline">Citation</span><span>' + escapeHTML(d.cite) + '</span></div>' +
          '<div class="dossier__materia"><p class="dossier__eyebrow dossier__eyebrow--inline">Recipes</p><ul class="dossier__materia-list">' + recipeChips(d) + '</ul></div>' +
          readerLink(d) +
        '</div>' +
        '<div class="dossier__foot"><span>' + escapeHTML(d.translit) + ' — ' + escapeHTML(d.gloss) + '</span></div>';
    }

    // The arrows are persistent chrome on the dossier's right edge, and the
    // dots are the strip's rail — both the journeys viewer's furniture, fed by
    // the map's own stepper.
    // Collapsing is the reader's choice; reopening is the map's. Every path
    // that lands a claim or an ingredient in the panel runs through
    // selectClaim or selectIngredient, so those two calls are the whole
    // "open automatically" contract.
    const dossierPanel = document.querySelector(".dossier");
    const dossierCollapse = document.getElementById("dossier-collapse");

    function setDossierCollapsed(collapsed) {
      if (!dossierPanel) return;
      dossierPanel.classList.toggle("is-collapsed",collapsed);
      if (dossierCollapse) {
        dossierCollapse.setAttribute("aria-expanded",collapsed ? "false" : "true");
        dossierCollapse.setAttribute("aria-label",collapsed ? "Expand the details panel" : "Collapse the details panel");
      }
    }

    if (dossierCollapse) {
      dossierCollapse.addEventListener("click", function () {
        setDossierCollapsed(!dossierPanel.classList.contains("is-collapsed"));
      });
    }

    const prevStep = document.getElementById("prev-step");
    const nextStep = document.getElementById("next-step");
    const stripRail = document.getElementById("strip-rail");
    const stripDotKinds = { modern:"modern", theology:"theology" };

    // ————— The labelled steppers —————
    // The edge rail carries bare arrows, because it is what remains on screen
    // once the panel collapses. These carry the destination's name under the
    // arrow, and cover the ingredient axis the keyboard's ↑/↓ already drive
    // but which had no visual control at all.
    const stepButtons = {
      prevIngredient: document.getElementById("prev-ingredient"),
      nextIngredient: document.getElementById("next-ingredient"),
      prevLocation: document.getElementById("prev-location"),
      nextLocation: document.getElementById("next-location")
    };
    const stepTerms = {
      prevIngredient: document.getElementById("prev-ingredient-term"),
      nextIngredient: document.getElementById("next-ingredient-term"),
      prevLocation: document.getElementById("prev-location-term"),
      nextLocation: document.getElementById("next-location-term")
    };

    function setStep(key, term, label) {
      const button = stepButtons[key];
      if (!button) return;
      const live = Boolean(term);
      // Disabling the button under the pointer would strand focus on it.
      if (!live && document.activeElement === button) {
        const partner = stepButtons[key.indexOf("prev") === 0
          ? key.replace("prev","next") : key.replace("next","prev")];
        if (partner && !partner.disabled) partner.focus();
      }
      button.disabled = !live;
      stepTerms[key].textContent = term || "";
      button.setAttribute("aria-label", live ? label + ": " + term : "No " + label.toLowerCase());
    }

    function updateStepNav(state) {
      const havePrev = state.index > 0;
      const haveNext = state.index >= 0 && state.index < state.locations.length - 1;
      const prevPlace = havePrev ? state.locations[state.index - 1].place : null;
      const nextPlace = haveNext ? state.locations[state.index + 1].place : null;

      if (prevStep && nextStep) {
        // A button that disables under the finger strands focus; hand it across.
        if (!havePrev && document.activeElement === prevStep && haveNext) nextStep.focus();
        if (!haveNext && document.activeElement === nextStep && havePrev) prevStep.focus();
        prevStep.disabled = !havePrev;
        nextStep.disabled = !haveNext;
        prevStep.setAttribute("aria-label", prevPlace ? "Previous location: " + prevPlace : "No previous location");
        nextStep.setAttribute("aria-label", nextPlace ? "Next location: " + nextPlace : "No next location");
      }

      setStep("prevLocation", prevPlace, "Previous location");
      setStep("nextLocation", nextPlace, "Next location");
      updateIngredientStep();
    }

    // The ingredient list wraps, as ↑/↓ do, so both sides always name a
    // destination — and with nothing selected they name the ends, which is
    // how the keyboard enters the list too.
    function updateIngredientStep() {
      if (!stepButtons.prevIngredient) return;
      const list = typeof visibleOrderedIngredients === "function" ? visibleOrderedIngredients() : [];
      if (!list.length) {
        setStep("prevIngredient", null, "Previous ingredient");
        setStep("nextIngredient", null, "Next ingredient");
        return;
      }
      const index = list.findIndex(function (ingredient) { return ingredient.id === selectedIngredientId; });
      const prev = index < 0 ? list[list.length - 1] : list[(index - 1 + list.length) % list.length];
      const next = index < 0 ? list[0] : list[(index + 1) % list.length];
      setStep("prevIngredient", prev.gloss, "Previous ingredient");
      setStep("nextIngredient", next.gloss, "Next ingredient");
    }

    if (stepButtons.prevLocation) stepButtons.prevLocation.addEventListener("click", function () { stepLocation(-1); });
    if (stepButtons.nextLocation) stepButtons.nextLocation.addEventListener("click", function () { stepLocation(1); });
    if (stepButtons.prevIngredient) stepButtons.prevIngredient.addEventListener("click", function () { stepIngredient(-1); });
    if (stepButtons.nextIngredient) stepButtons.nextIngredient.addEventListener("click", function () { stepIngredient(1); });

    function renderStripRail(state) {
      if (!stripRail) return;
      // A single mapped place needs no rail, matching the journeys viewer's
      // treatment of one-stop ingredients.
      if (!state.locations || state.locations.length < 2) {
        stripRail.hidden = true;
        stripRail.innerHTML = "";
        return;
      }
      stripRail.hidden = false;
      stripRail.innerHTML = state.locations.map(function (claim, i) {
        const kind = stripDotKinds[claim.evidence];
        return '<button type="button" class="strip__dot' + (i === state.index ? ' is-active' : '') + '"' +
          (kind ? ' data-kind="' + kind + '"' : '') +
          ' role="option" aria-selected="' + (i === state.index) + '"' +
          ' data-claim-id="' + escapeHTML(claim.id) + '">' +
          '<span class="strip__dot__label">' + escapeHTML(claim.place) + '</span>' +
        '</button>';
      }).join("");
    }

    if (stripRail) {
      stripRail.addEventListener("click", function (event) {
        const dot = event.target.closest("[data-claim-id]");
        if (!dot) return;
        const claim = claims.find(function (c) { return c.id === dot.dataset.claimId; });
        if (claim) selectClaim(claim,false,true,false,true);
      });
    }

    function selectIngredient(ingredient, focusAllLocations) {
      clearCourtSelection();
      selectedIngredientId = ingredient.id;
      if (typeof updateIngredientPill === "function") updateIngredientPill();
      const locations = visibleClaimsForIngredient(ingredient);
      if (!locations.length) {
        selectedClaim = null;
        marker.classed("is-selected",false).classed("is-same-ingredient",false);
        selectedRoute.attr("d",null);
        selectedLabel.style("display","none");
        detailContent.innerHTML =
          '<div class="dossier__top">' +
            '<p class="dossier__eyebrow">' + escapeHTML(ingredient.gloss) + '</p>' +
            '<h2 class="dossier__title">No mapped provenance</h2>' +
            '<p class="dossier__greek-name" lang="grc">' + escapeHTML(ingredient.greek) + '</p>' +
          '</div>' +
          '<div class="dossier__body">' +
            '<p class="dossier__translation">' + escapeHTML(ingredient.unlocated || "No mapped provenance is available for the active perfume layers.") + '</p>' +
            '<div class="dossier__materia"><p class="dossier__eyebrow dossier__eyebrow--inline">Recipes</p><ul class="dossier__materia-list">' + recipeChips(ingredient) + '</ul></div>' +
          '</div>' +
          '<div class="dossier__foot"><span>' + escapeHTML(ingredient.translit) + '</span></div>';
        updateStepNav({ locations:[], index:-1 });
        renderStripRail({ locations:[], index:-1 });
        setDossierCollapsed(false);
        return;
      }
      selectClaim(locations[0],false,false,false);
      if (focusAllLocations) focusIngredient(ingredient,true);
    }

    function stepLocation(direction) {
      if (!selectedClaim) return;
      const ingredient = ingredientById.get(selectedClaim.ingredient);
      const locations = ingredient ? visibleClaimsForIngredient(ingredient) : [];
      const currentIndex = locations.findIndex(function (claim) { return claim.id === selectedClaim.id; });
      const nextIndex = currentIndex + direction;
      if (nextIndex < 0 || nextIndex >= locations.length) return;
      selectClaim(locations[nextIndex],false,true,false,true);
    }

    if (prevStep) prevStep.addEventListener("click", function () { stepLocation(-1); });
    if (nextStep) nextStep.addEventListener("click", function () { stepLocation(1); });

    function renderNoVisibleIngredients() {
      detailContent.innerHTML =
        '<div class="dossier__top">' +
          '<p class="dossier__eyebrow">Ingredient browser</p>' +
          '<h2 class="dossier__title">No visible ingredients</h2>' +
        '</div>' +
        '<div class="dossier__body">' +
          '<p class="dossier__translation">Turn on at least one perfume layer to browse ingredient kinds, ingredients, and mapped locations.</p>' +
        '</div>';
      updateStepNav({ locations:[], index:-1 });
      renderStripRail({ locations:[], index:-1 });
    }

    let lastDrawnRouteKey = null;

    function drawSelectedRoute(d) {
      selectedRoute.interrupt().attr("stroke-dasharray",null).attr("stroke-dashoffset",null);
      if (!d.route || !convergence[d.route]) {
        selectedRoute.attr("d",null);
        lastDrawnRouteKey = null;
        return;
      }
      const routeKey = d.route + ":" + d.id;
      selectedRoute.attr("d",projectedLine([d.coord].concat(convergence[d.route])));
      if (routeKey !== lastDrawnRouteKey && !reducedMotion.matches) {
        // Draw the course in like a plotted line. The dash pattern is in user
        // units, so it is removed as soon as the transition settles — a lasting
        // dash would visibly rescale under zoom.
        const length = selectedRoute.node().getTotalLength();
        if (length > 0) {
          selectedRoute
            .attr("stroke-dasharray",length + " " + length)
            .attr("stroke-dashoffset",length)
            .transition("route-draw").duration(600).ease(d3.easeCubicOut)
            .attr("stroke-dashoffset",0)
            .on("end interrupt", function () {
              selectedRoute.attr("stroke-dasharray",null).attr("stroke-dashoffset",null);
            });
        }
      }
      lastDrawnRouteKey = routeKey;
    }

    function stampDetailPanel() {
      const panel = document.querySelector(".dossier");
      if (!panel) return;
      panel.classList.remove("is-stamping");
      void panel.offsetWidth;
      panel.classList.add("is-stamping");
    }

    function selectClaim(d, shouldScroll, shouldFocus, shouldOpenDetails, shouldForceFocus) {
      clearCourtSelection();
      selectedClaim = d;
      selectedIngredientId = d.ingredient;
      marker.classed("is-selected", function (x) { return x.id === d.id; });
      marker.classed("is-same-ingredient", function (x) { return x.ingredient === d.ingredient; });
      drawSelectedRoute(d);
      selectedLabel
        .style("display",null)
        .text(d.place);
      positionSelectedLabel();

      setDossierCollapsed(false);
      const state = locationsFor(d);
      const position = state.locations.length
        ? (state.index + 1) + " of " + state.locations.length
        : "";
      detailContent.innerHTML = dossierMarkup(d, position);
      updateStepNav(state);
      renderStripRail(state);
      stampDetailPanel();

      if (shouldFocus) focusClaim(d,shouldForceFocus);

      if (shouldScroll) {
        // .map-shell went with the sheet-era chrome; the band itself is the
        // scroll target now. The null lookup had thrown here since then, so
        // index rows selected their claim but never carried the reader back
        // up to the map.
        const band = document.querySelector(".map-experience");
        if (band) band.scrollIntoView({ behavior:reducedMotion.matches ? "auto" : "smooth", block:"start" });
      }
    }

    marker.on("click", function (event, d) { selectClaim(d, false, true, true); });
    marker.on("keydown", function (event, d) {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        selectClaim(d, false, true, true);
      }
    });

    // Desktop tooltip: one reused dark-glass card, hover/focus only. It is
    // aria-hidden because the marker's aria-label and the detail panel carry
    // the same greek — place — citation content for assistive tech.
    const tooltip = document.createElement("div");
    tooltip.className = "map-tooltip";
    tooltip.setAttribute("aria-hidden","true");
    document.querySelector(".map-wrap").appendChild(tooltip);
    const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)");
    let tooltipClaim = null;

    function tooltipRecipes(d) {
      if (d.context) return "Metopion name-history";
      return d.recipes.map(function (key) { return recipes[key].name; }).join(" · ");
    }

    function tooltipMarkup(d) {
      return '<span class="tooltip-greek" lang="grc">' + escapeHTML(d.greek) + '</span>' +
        '<span class="tooltip-place">' +
          '<svg class="tooltip-glyph ' + d.evidence + '" aria-hidden="true"><use href="#' + markerGlyphIds[d.evidence] + '"></use></svg>' +
          escapeHTML(d.place) +
        '</span>' +
        '<span class="tooltip-recipes">' + escapeHTML(tooltipRecipes(d)) + '</span>' +
        '<span class="tooltip-cite">' + escapeHTML(d.cite) + '</span>';
    }

    function positionTooltip() {
      if (!tooltipClaim) return;
      const wrapNode = document.querySelector(".map-wrap");
      const wrapRect = wrapNode.getBoundingClientRect();
      const matrix = svg.node().getScreenCTM();
      if (!matrix || !wrapRect.width) return;
      const p = transformedPoint(tooltipClaim.coord);
      const x = matrix.a * p[0] + matrix.c * p[1] + matrix.e - wrapRect.left;
      const y = matrix.b * p[0] + matrix.d * p[1] + matrix.f - wrapRect.top;
      const box = tooltip.getBoundingClientRect();
      let left = x + 18;
      let top = y - box.height / 2;
      if (left + box.width > wrapRect.width - 12) left = x - box.width - 18;
      left = Math.max(12,Math.min(left,wrapRect.width - box.width - 12));
      top = Math.max(12,Math.min(top,wrapRect.height - box.height - 12));
      tooltip.style.left = left + "px";
      tooltip.style.top = top + "px";
    }

    function showTooltip(d) {
      if (!finePointer.matches) return;
      tooltipClaim = d;
      tooltip.innerHTML = tooltipMarkup(d);
      tooltip.classList.add("is-visible");
      positionTooltip();
    }

    function hideTooltip() {
      tooltipClaim = null;
      tooltip.classList.remove("is-visible");
    }

    marker
      .on("pointerenter", function (event, d) { showTooltip(d); })
      .on("pointerleave", hideTooltip)
      .on("focus", function (event, d) { showTooltip(d); })
      .on("blur", hideTooltip);

    let ingredientSwipeStart = null;
    detailContent.addEventListener("pointerdown", function (event) {
      if (!isPhoneViewport() || event.pointerType === "mouse" || event.target.closest("button, a, input, select, textarea")) return;
      ingredientSwipeStart = { id:event.pointerId, x:event.clientX, y:event.clientY };
    });
    detailContent.addEventListener("pointerup", function (event) {
      if (!ingredientSwipeStart || ingredientSwipeStart.id !== event.pointerId) return;
      const deltaX = event.clientX - ingredientSwipeStart.x;
      const deltaY = event.clientY - ingredientSwipeStart.y;
      ingredientSwipeStart = null;
      if (!selectedClaim || Math.abs(deltaX) < 52 || Math.abs(deltaX) < Math.abs(deltaY) * 1.35) return;
      stepLocation(deltaX < 0 ? 1 : -1);
    });
    detailContent.addEventListener("pointercancel", function () { ingredientSwipeStart = null; });

    function dominantEvidence(ingredient) {
      const counts = {};
      ingredient.claims.forEach(function (claim) { counts[claim.evidence] = (counts[claim.evidence] || 0) + 1; });
      let best = "modern";
      let bestCount = 0;
      ["ancient","theology","modern"].forEach(function (kind) {
        if ((counts[kind] || 0) > bestCount) { best = kind; bestCount = counts[kind]; }
      });
      return best;
    }

    const evidenceGlyphIds = { ancient: "glyph-ancient", modern: "glyph-inference", theology: "glyph-theology" };

    function recipeDots(d) {
      if (d.context) {
        return '<span class="recipe-dot context" title="Metopion name-history · not a recipe ingredient"></span>' +
          '<span class="visually-hidden">Metopion name-history · not a recipe ingredient</span>';
      }
      return d.recipes.map(function (key) {
        return '<span class="recipe-dot ' + key + '" title="' + escapeHTML(recipes[key].name) + '"></span>';
      }).join("") +
        '<span class="visually-hidden">Recipes: ' + escapeHTML(d.recipes.map(function (key) { return recipes[key].name; }).join(", ")) + '</span>';
    }

    function renderIndex() {
      const host = document.getElementById("claim-index");
      let previousGroupId = null;
      orderedIngredients.forEach(function (ingredient) {
        const group = ingredientGroupById.get(ingredient.id);
        if (group && group.id !== previousGroupId) {
          const heading = document.createElement("h3");
          heading.className = "ingredient-group-heading";
          heading.dataset.group = group.id;
          heading.textContent = group.label;
          host.appendChild(heading);
          previousGroupId = group.id;
        }
        const details = document.createElement("details");
        details.className = "ingredient-card";
        details.dataset.recipes = ingredient.recipes.join(" ");
        details.dataset.group = group ? group.id : "other";
        const evidence = dominantEvidence(ingredient);
        const summary = document.createElement("summary");
        summary.innerHTML =
          '<svg class="card-glyph ' + evidence + '" aria-hidden="true"><use href="#' + evidenceGlyphIds[evidence] + '"></use></svg>' +
          '<span class="ingredient-title">' +
            '<span class="ingredient-name" lang="grc">' + escapeHTML(ingredient.greek) + '</span>' +
            '<span class="ingredient-gloss">' + escapeHTML(ingredient.translit + " — " + ingredient.gloss) + '</span>' +
          '</span>' +
          '<span class="ingredient-meta">' +
            '<span class="recipe-dots">' + recipeDots(ingredient) + '</span>' +
            '<span class="claim-count" aria-label="' + ingredient.claims.length + ' plotted claims">' + ingredient.claims.length + '</span>' +
          '</span>';
        details.appendChild(summary);

        if (ingredient.claims.length) {
          const list = document.createElement("ol");
          list.className = "claim-list";
          ingredient.claims.forEach(function (claim) {
            const item = document.createElement("li");
            const button = document.createElement("button");
            button.className = "claim-jump";
            button.type = "button";
            button.textContent = claim.place;
            button.addEventListener("click", function () { selectClaim(claim, true, true); });
            const cite = document.createElement("span");
            cite.className = "claim-cite";
            cite.textContent = evidenceText(claim) + " · " + claim.cite;
            item.appendChild(button);
            item.appendChild(cite);
            list.appendChild(item);
          });
          details.appendChild(list);
        } else {
          const unresolved = document.createElement("div");
          unresolved.className = "unlocated";
          unresolved.textContent = ingredient.unlocated;
          details.appendChild(unresolved);
        }
        host.appendChild(details);
      });
    }
    renderIndex();

    function updateVisibility() {
      const active = activeRecipeKeys();
      let visible = 0;
      marker.classed("is-hidden", function (d) {
        const hidden = !d.recipes.some(function (r) { return active.has(r); });
        if (!hidden) visible += 1;
        return hidden;
      });
      document.querySelectorAll(".ingredient-card").forEach(function (card) {
        const cardRecipes = card.dataset.recipes.split(" ");
        card.hidden = !cardRecipes.some(function (r) { return active.has(r); });
      });
      const visibleGroups = new Set(Array.from(document.querySelectorAll(".ingredient-card:not([hidden])")).map(function (card) {
        return card.dataset.group;
      }));
      document.querySelectorAll(".ingredient-group-heading").forEach(function (heading) {
        heading.hidden = !visibleGroups.has(heading.dataset.group);
      });
      document.querySelectorAll("[data-visible-count]").forEach(function (node) { node.textContent = visible; });
      if (selectedClaim) {
        const selectedIngredient = ingredientById.get(selectedClaim.ingredient);
        const selectedLocations = selectedIngredient ? visibleClaimsForIngredient(selectedIngredient) : [];
        if (selectedLocations.length) {
          const replacement = selectedLocations.find(function (claim) { return claim.id === selectedClaim.id; }) || selectedLocations[0];
          selectClaim(replacement,false,false,false);
        } else {
          const fallbackGroup = visibleIngredientGroups()[0];
          const fallbackIngredient = fallbackGroup ? visibleIngredientsForGroup(fallbackGroup)[0] : null;
          if (fallbackIngredient) {
            selectIngredient(fallbackIngredient,true);
          } else {
            selectedRoute.attr("d",null);
            selectedLabel.style("display","none");
            marker.classed("is-selected",false).classed("is-same-ingredient",false);
            selectedClaim = null;
            selectedIngredientId = null;
            renderNoVisibleIngredients();
          }
        }
      } else if (selectedIngredientId) {
        const selectedIngredient = ingredientById.get(selectedIngredientId);
        const stillVisible = selectedIngredient && selectedIngredient.recipes.some(function (recipe) { return active.has(recipe); });
        if (stillVisible) {
          selectIngredient(selectedIngredient,false);
        } else {
          const fallbackGroup = visibleIngredientGroups()[0];
          const fallbackIngredient = fallbackGroup ? visibleIngredientsForGroup(fallbackGroup)[0] : null;
          if (fallbackIngredient) selectIngredient(fallbackIngredient,true);
          else {
            selectedIngredientId = null;
            renderNoVisibleIngredients();
          }
        }
      } else if (navigationReady) {
        const fallbackGroup = visibleIngredientGroups()[0];
        const fallbackIngredient = fallbackGroup ? visibleIngredientsForGroup(fallbackGroup)[0] : null;
        if (fallbackIngredient) selectIngredient(fallbackIngredient,false);
        else renderNoVisibleIngredients();
      }
    }
    renderPerfumeLayers();
    const claimTotal = document.getElementById("claim-total");
    if (claimTotal) {
      // Count the same array the visible tally counts, or the denominator ends
      // up smaller than the numerator: `claims` is the flattened plot list and
      // carries the context marks that no ingredient's own list holds.
      claimTotal.textContent = claims.length;
    }

    layerInputs().forEach(function (input) {
      input.addEventListener("change",updateVisibility);
    });

    // ————— Court record selection —————
    function clearCourtSelection() {
      if (!selectedCourtPlot) return;
      selectedCourtPlot = null;
      courtMarker.classed("is-selected",false);
    }

    function courtMarkup(d) {
      const record = d.record;
      const chips = record.aromatics.map(function (aromatic) {
        return "<li>" + escapeHTML(aromatic.name) + "</li>";
      }).join("");
      return '<div class="dossier__top">' +
          '<p class="dossier__eyebrow">Court record · report · olfactory: ' + escapeHTML(record.olfactoryRelevance) + '</p>' +
          '<h2 class="dossier__title">' + escapeHTML(d.place) + '</h2>' +
          '<p class="dossier__greek-name">' + escapeHTML(record.queen.join(" · ")) + '</p>' +
        '</div>' +
        '<div class="dossier__body">' +
          '<p class="dossier__translation">' + escapeHTML(record.commentary || "") + '</p>' +
          '<div class="dossier__citation"><span class="dossier__eyebrow dossier__eyebrow--inline">Citation</span><span>' + escapeHTML(record.cite) + '</span></div>' +
          (chips ? '<div class="dossier__materia"><p class="dossier__eyebrow dossier__eyebrow--inline">Aromatics recorded</p><ul class="dossier__materia-list">' + chips + '</ul></div>' : "") +
          '<p class="dossier__reader-link-row"><a class="dossier__reader-link" href="../#claim-' + encodeURIComponent(record.pqfId.toLowerCase()) + '">Read the record in the dossier →</a></p>' +
        '</div>' +
        '<div class="dossier__foot"><span>' + escapeHTML(record.subtype.replace(/-/g," ").replace(/:/," —")) + '</span></div>';
    }

    function selectCourtPlot(d, shouldFocus) {
      selectedClaim = null;
      selectedIngredientId = null;
      if (typeof updateIngredientPill === "function") updateIngredientPill();
      marker.classed("is-selected",false).classed("is-same-ingredient",false);
      selectedRoute.attr("d",null);
      lastDrawnRouteKey = null;
      selectedCourtPlot = d;
      courtMarker.classed("is-selected", function (x) { return x.id === d.id; });
      selectedLabel.style("display",null).text(d.place);
      positionSelectedLabel();
      setDossierCollapsed(false);
      detailContent.innerHTML = courtMarkup(d);
      updateStepNav({ locations:[], index:-1 });
      renderStripRail({ locations:[], index:-1 });
      stampDetailPanel();
      if (shouldFocus) focusClaim(d,true);
    }

    function setCourtLayer(on) {
      const courtButton = document.getElementById("toggle-court");
      if (courtButton) courtButton.setAttribute("aria-pressed",on ? "true" : "false");
      courtLayer.style("display",on ? null : "none");
      courtMarker.attr("tabindex",on ? "0" : "-1");
      if (!on && selectedCourtPlot) {
        clearCourtSelection();
        selectedLabel.style("display","none");
        updateVisibility();
      }
    }

    courtMarker.on("click", function (event, d) { selectCourtPlot(d,true); });
    courtMarker.on("keydown", function (event, d) {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        selectCourtPlot(d,true);
      }
    });
