    const svg = d3.select("#map");
    const width = 900;
    const height = 710;
    let currentZoom = d3.zoomIdentity;
    let selectedClaim = null;
    let selectedIngredientId = null;
    let navigationReady = false;
    let ingredientPickerOpen = false;
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
    const recipeOffsets = { m:[-8,-8], t:[8,-8], s:[0,10] };
    const recipeRadius = 3.5;

    const marker = claimLayer.selectAll(".claim")
      .data(claims)
      .join("g")
      .attr("class","claim")
      .attr("data-id", function (d) { return d.id; })
      .attr("role","button")
      .attr("tabindex","0")
      .attr("aria-label", function (d) { return d.greek + ", " + d.place + ". " + d.cite; });

    marker.append("circle").attr("class","claim-hit").attr("r",16);
    marker.append("circle").attr("class","focus-ring").attr("r",14);
    marker.each(function (d) {
      const g = d3.select(this);
      if (d.evidence === "ancient") {
        g.append("circle").attr("class","ancient-shape").attr("r",6.5);
      } else if (d.evidence === "modern") {
        g.append("rect").attr("class","modern-shape").attr("x",-6).attr("y",-6).attr("width",12).attr("height",12).attr("transform","rotate(45)");
      } else {
        g.append("circle").attr("class","theology-shape").attr("r",9);
        g.append("circle").attr("class","theology-shape").attr("r",5);
      }
      d.recipes.forEach(function (key) {
        g.append("circle")
          .attr("class","recipe-satellite")
          .attr("cx",recipeOffsets[key][0])
          .attr("cy",recipeOffsets[key][1])
          .attr("r",recipeRadius)
          .attr("fill",recipes[key].color);
      });
      g.append("title").text(d.greek + " — " + d.place + " — " + d.cite);
    });

    const selectedLabel = viewport.append("text").attr("class","selected-label").style("display","none");
    const detailContent = document.getElementById("detail-content");

    function transformedPoint(coord) {
      return currentZoom.apply(projection(coord));
    }

    function positionSelectedLabel() {
      if (!selectedClaim) return;
      const p = transformedPoint(selectedClaim.coord);
      const x = p[0] + 13 * overlayScale;
      const y = p[1] - 13 * overlayScale;
      selectedLabel
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

    function recipeBadges(keys) {
      return keys.map(function (key) {
        return '<span class="badge ' + key + '">' + recipes[key].name + '</span>';
      }).join("");
    }

    function affiliationBadges(d) {
      if (d.context) {
        return '<span class="badge context">Metopion name-history · not a recipe ingredient</span>';
      }
      return recipeBadges(d.recipes);
    }

    function escapeHTML(value) {
      return String(value).replace(/[&<>"']/g, function (char) {
        return ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#039;" })[char];
      });
    }

    function activeRecipeKeys() {
      return new Set(Array.from(document.querySelectorAll(".toolbar .toggle input:checked")).map(function (input) {
        return input.value;
      }));
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

    function optionMarkup(value, label, selected) {
      return '<option value="' + escapeHTML(value) + '"' + (selected ? ' selected' : '') + '>' + escapeHTML(label) + '</option>';
    }

    function ingredientBrowserMarkup(d) {
      const ingredientId = d ? d.ingredient : selectedIngredientId;
      const ingredient = ingredientById.get(ingredientId);
      if (!ingredient) return "";
      const group = ingredientGroupById.get(ingredient.id);
      const groups = visibleIngredientGroups();
      const selectedGroup = group && groups.some(function (item) { return item.id === group.id; }) ? group : groups[0];
      if (!selectedGroup) return "";
      const groupIngredients = visibleIngredientsForGroup(selectedGroup);
      const selectedIngredient = groupIngredients.find(function (item) { return item.id === ingredient.id; }) || groupIngredients[0];
      if (!selectedIngredient) return "";
      const locations = visibleClaimsForIngredient(selectedIngredient);
      const locationIndex = d ? locations.findIndex(function (claim) { return claim.id === d.id; }) : -1;
      const currentLocationIndex = locationIndex < 0 ? 0 : locationIndex;
      const currentLocation = locations[currentLocationIndex] || null;
      const previous = currentLocationIndex > 0 ? locations[currentLocationIndex - 1] : null;
      const next = currentLocationIndex < locations.length - 1 ? locations[currentLocationIndex + 1] : null;
      const groupOptions = groups.map(function (item) {
        return optionMarkup(item.id,item.label,item.id === selectedGroup.id);
      }).join("");
      const ingredientOptions = groupIngredients.map(function (item) {
        return optionMarkup(item.id,item.gloss,item.id === selectedIngredient.id);
      }).join("");
      const compactGroupLabel = ingredientGroupShortLabels[selectedGroup.id] || selectedGroup.label;
      const currentPlaceLabel = currentLocation ? currentLocation.place : "No mapped place";
      const locationPosition = locations.length ? (currentLocationIndex + 1) + " of " + locations.length : "No locations";
      return '<div class="ingredient-browser" aria-label="Browse ingredient kinds, ingredients, and locations">' +
        '<div class="ingredient-browser-row">' +
          '<button type="button" class="ingredient-picker-toggle" aria-expanded="' + (ingredientPickerOpen ? 'true' : 'false') + '" aria-controls="ingredient-picker-panel" aria-label="Change ingredient. ' + escapeHTML(selectedGroup.label) + '. ' + escapeHTML(selectedIngredient.gloss) + '" title="Change ingredient: ' + escapeHTML(selectedIngredient.gloss) + '">' +
            '<span class="ingredient-picker-kind">' + escapeHTML(compactGroupLabel) + '</span>' +
            '<span class="ingredient-picker-name">' + escapeHTML(selectedIngredient.gloss) + '</span>' +
            '<span class="ingredient-picker-chevron" aria-hidden="true">⌄</span>' +
          '</button>' +
          '<nav class="location-nav" aria-label="Browse mapped locations for ' + escapeHTML(selectedIngredient.gloss) + '" aria-describedby="location-swipe-instructions">' +
            '<button type="button" data-location-step="-1"' + (previous ? ' aria-label="Previous location: ' + escapeHTML(previous.place) + '"' : ' disabled aria-label="No previous location"') + '><span aria-hidden="true">←</span></button>' +
            '<div class="location-nav-status" tabindex="-1" aria-live="polite" aria-atomic="true" title="' + escapeHTML(currentPlaceLabel) + '">' +
              '<strong>' + escapeHTML(currentPlaceLabel) + '</strong>' +
              '<span class="location-nav-position">' + escapeHTML(locationPosition) + '</span>' +
            '</div>' +
            '<button type="button" data-location-step="1"' + (next ? ' aria-label="Next location: ' + escapeHTML(next.place) + '"' : ' disabled aria-label="No next location"') + '><span aria-hidden="true">→</span></button>' +
          '</nav>' +
        '</div>' +
        '<div class="ingredient-picker-panel" id="ingredient-picker-panel"' + (ingredientPickerOpen ? '' : ' hidden') + '>' +
          '<div class="ingredient-switchers">' +
            '<label class="ingredient-switcher-label" for="ingredient-kind-select"><span>Ingredient kind</span>' +
              '<select class="ingredient-switcher" id="ingredient-kind-select">' + groupOptions + '</select>' +
            '</label>' +
            '<label class="ingredient-switcher-label" for="ingredient-select"><span>Ingredient</span>' +
              '<select class="ingredient-switcher" id="ingredient-select">' + ingredientOptions + '</select>' +
            '</label>' +
          '</div>' +
        '</div>' +
        '<p class="visually-hidden" id="location-swipe-instructions">On a phone, swipe right or left in the details to move through this ingredient\'s mapped locations.</p>' +
      '</div>';
    }

    function selectIngredient(ingredient, focusAllLocations) {
      selectedIngredientId = ingredient.id;
      const locations = visibleClaimsForIngredient(ingredient);
      if (!locations.length) {
        selectedClaim = null;
        marker.classed("is-selected",false).classed("is-same-ingredient",false);
        selectedRoute.attr("d",null);
        selectedLabel.style("display","none");
        detailContent.innerHTML =
          ingredientBrowserMarkup(null) +
          '<p class="detail-kicker">' + escapeHTML(ingredient.translit) + '</p>' +
          '<h2 lang="grc">' + escapeHTML(ingredient.greek) + '</h2>' +
          '<p class="detail-gloss">' + escapeHTML(ingredient.gloss) + '</p>' +
          '<div class="unlocated">' + escapeHTML(ingredient.unlocated || "No mapped provenance is available for the active perfume layers.") + '</div>' +
          '<div class="recipe-badges">' + affiliationBadges(ingredient) + '</div>';
        bindIngredientBrowser();
        return;
      }
      selectClaim(locations[0],false,false,false);
      if (focusAllLocations) focusIngredient(ingredient,true);
    }

    function selectIngredientGroup(groupId) {
      const group = ingredientGroups.find(function (item) { return item.id === groupId; });
      const ingredient = group ? visibleIngredientsForGroup(group)[0] : null;
      if (ingredient) selectIngredient(ingredient,true);
    }

    function stepLocation(direction) {
      if (!selectedClaim) return;
      const ingredient = ingredientById.get(selectedClaim.ingredient);
      const locations = ingredient ? visibleClaimsForIngredient(ingredient) : [];
      const currentIndex = locations.findIndex(function (claim) { return claim.id === selectedClaim.id; });
      const nextIndex = currentIndex + direction;
      if (nextIndex < 0 || nextIndex >= locations.length) return;
      ingredientPickerOpen = false;
      selectClaim(locations[nextIndex],false,true,false,true);
      window.requestAnimationFrame(function () {
        const preferred = detailContent.querySelector('[data-location-step="' + direction + '"]:not(:disabled)');
        const alternate = detailContent.querySelector('[data-location-step="' + (-direction) + '"]:not(:disabled)');
        const target = preferred || alternate || detailContent.querySelector(".location-nav-status");
        if (target) target.focus({ preventScroll:true });
      });
    }

    function setIngredientPickerOpen(open, returnFocus) {
      ingredientPickerOpen = open;
      const toggle = detailContent.querySelector(".ingredient-picker-toggle");
      const panel = document.getElementById("ingredient-picker-panel");
      if (toggle) toggle.setAttribute("aria-expanded",open ? "true" : "false");
      if (panel) panel.hidden = !open;
      if (returnFocus && toggle) toggle.focus();
    }

    function bindIngredientBrowser() {
      const kindSelect = document.getElementById("ingredient-kind-select");
      const ingredientSelect = document.getElementById("ingredient-select");
      const pickerToggle = detailContent.querySelector(".ingredient-picker-toggle");
      const pickerPanel = document.getElementById("ingredient-picker-panel");
      if (pickerToggle) pickerToggle.addEventListener("click", function () {
        setIngredientPickerOpen(!ingredientPickerOpen,false);
      });
      if (kindSelect) kindSelect.addEventListener("change", function () {
        ingredientPickerOpen = true;
        selectIngredientGroup(kindSelect.value);
        window.requestAnimationFrame(function () {
          const refreshedIngredientSelect = document.getElementById("ingredient-select");
          if (refreshedIngredientSelect) refreshedIngredientSelect.focus();
        });
      });
      if (ingredientSelect) ingredientSelect.addEventListener("change", function () {
        const ingredient = ingredientById.get(ingredientSelect.value);
        if (ingredient) {
          ingredientPickerOpen = false;
          selectIngredient(ingredient,true);
          window.requestAnimationFrame(function () {
            const refreshedPickerToggle = detailContent.querySelector(".ingredient-picker-toggle");
            if (refreshedPickerToggle) refreshedPickerToggle.focus({ preventScroll:true });
          });
        }
      });
      if (pickerPanel) pickerPanel.addEventListener("keydown", function (event) {
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        setIngredientPickerOpen(false,true);
      });
      detailContent.querySelectorAll("[data-location-step]").forEach(function (button) {
        button.addEventListener("click", function () { stepLocation(Number(button.dataset.locationStep)); });
      });
    }

    function renderNoVisibleIngredients() {
      detailContent.innerHTML =
        '<p class="detail-kicker">Ingredient browser</p>' +
        '<h2>No visible ingredients</h2>' +
        '<p class="detail-gloss">Turn on at least one perfume layer to browse ingredient kinds, ingredients, and mapped locations.</p>';
    }

    function selectClaim(d, shouldScroll, shouldFocus, shouldOpenDetails, shouldForceFocus) {
      if (shouldOpenDetails) ingredientPickerOpen = false;
      selectedClaim = d;
      selectedIngredientId = d.ingredient;
      marker.classed("is-selected", function (x) { return x.id === d.id; });
      marker.classed("is-same-ingredient", function (x) { return x.ingredient === d.ingredient; });
      if (d.route && convergence[d.route]) {
        selectedRoute.attr("d",projectedLine([d.coord].concat(convergence[d.route])));
      } else {
        selectedRoute.attr("d",null);
      }
      selectedLabel
        .style("display",null)
        .text(d.place);
      positionSelectedLabel();

      detailContent.innerHTML =
        ingredientBrowserMarkup(d) +
        '<p class="detail-kicker">' + escapeHTML(d.translit) + '</p>' +
        '<h2 lang="grc">' + escapeHTML(d.greek) + '</h2>' +
        '<p class="detail-gloss">' + escapeHTML(d.gloss) + '</p>' +
        '<p class="detail-place">' + escapeHTML(d.place) + '</p>' +
        '<span class="evidence-pill ' + d.evidence + '">' + escapeHTML(evidenceText(d)) + '</span>' +
        '<p class="detail-copy">' + escapeHTML(d.note) + '</p>' +
        '<div class="detail-citation"><strong>Citation</strong><br>' + escapeHTML(d.cite) + '</div>' +
        '<div class="recipe-badges">' + affiliationBadges(d) + '</div>' +
        '<p class="detail-hint">' +
          (d.route ? 'The gold convergence highlight follows a conventional corridor. ' : 'No route is drawn for this point. ') +
          (exploreMode ? 'Map active — your manual view is preserved.' : 'Guided mode refocuses the map on each selection.') +
        '</p>';

      bindIngredientBrowser();

      if (shouldOpenDetails && isPhoneViewport()) openMobilePanel("details");
      if (shouldFocus) focusClaim(d,shouldForceFocus);

      if (shouldScroll) {
        document.querySelector(".map-shell").scrollIntoView({ behavior:reducedMotion.matches ? "auto" : "smooth", block:"start" });
      }
    }

    marker.on("click", function (event, d) { selectClaim(d, false, true, true); });
    marker.on("keydown", function (event, d) {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        selectClaim(d, false, true, true);
      }
    });

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
      ingredientPickerOpen = false;
      const active = new Set(Array.from(document.querySelectorAll(".toggle input:checked")).map(function (input) { return input.value; }));
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
      document.getElementById("visible-count").textContent = visible;
      document.getElementById("ingredient-count").textContent = ingredients.length;
      document.getElementById("mobile-visible-count").textContent = visible;
      document.getElementById("mobile-info-visible-count").textContent = visible;
      document.getElementById("mobile-info-ingredient-count").textContent = ingredients.length;
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
    document.querySelectorAll(".toggle input").forEach(function (input) {
      input.addEventListener("change",updateVisibility);
    });
