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
      .attr("class","route-label")
      .attr("fill", function (d) { return d.type === "sea" ? "#2c7890" : d.type === "river" ? "#4d87a5" : "#8a5f36"; })
      .text(function (d) { return d.label; });

    viewport.append("text")
      .attr("class","route-note")
      .attr("x",26)
      .attr("y",36)
      .text("ALL ROUTES ARE CONVENTIONAL CORRIDORS — NOT ATTESTED PER INGREDIENT");

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
      g.append("circle").attr("r",7).attr("fill","#fffdf8").attr("stroke","#162321").attr("stroke-width",2.5);
      g.append("circle").attr("r",2.6).attr("fill","#162321");
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

    function selectClaim(d, shouldScroll, shouldFocus, shouldOpenDetails) {
      selectedClaim = d;
      marker.classed("is-selected", function (x) { return x.id === d.id; });
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
        '<p class="detail-kicker">' + escapeHTML(d.translit) + '</p>' +
        '<h2>' + escapeHTML(d.greek) + '</h2>' +
        '<p class="detail-gloss">' + escapeHTML(d.gloss) + '</p>' +
        '<p class="detail-place">' + escapeHTML(d.place) + '</p>' +
        '<span class="evidence-pill ' + d.evidence + '">' + escapeHTML(evidenceText(d)) + '</span>' +
        '<p class="detail-copy">' + escapeHTML(d.note) + '</p>' +
        '<div class="detail-citation"><strong>Citation</strong><br>' + escapeHTML(d.cite) + '</div>' +
        '<div class="recipe-badges">' + affiliationBadges(d) + '</div>' +
        '<p class="detail-hint">' +
          (d.route ? 'The gold convergence highlight follows a conventional corridor. ' : 'No route is drawn for this point. ') +
          (exploreMode ? 'Explore mode preserves your manual view.' : 'Guided mode refocuses the map on each selection.') +
        '</p>';

      if (shouldOpenDetails && isPhoneViewport()) openMobilePanel("details");
      if (shouldFocus) focusClaim(d);

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

    function renderIndex() {
      const host = document.getElementById("claim-index");
      allIngredients.forEach(function (ingredient) {
        const details = document.createElement("details");
        details.className = "ingredient-card";
        details.dataset.recipes = ingredient.recipes.join(" ");
        const summary = document.createElement("summary");
        summary.innerHTML =
          '<span class="ingredient-name">' + escapeHTML(ingredient.greek) + '</span>' +
          '<span class="ingredient-gloss">' + escapeHTML(ingredient.translit + " — " + ingredient.gloss) + '</span>' +
          '<span class="recipe-badges">' + affiliationBadges(ingredient) + '</span>';
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
      document.getElementById("visible-count").textContent = visible;
      document.getElementById("ingredient-count").textContent = ingredients.length;
      document.getElementById("mobile-visible-count").textContent = visible;
      document.getElementById("mobile-info-visible-count").textContent = visible;
      document.getElementById("mobile-info-ingredient-count").textContent = ingredients.length;
      const selected = claims.find(function (claim) {
        return marker.filter(function (d) { return d.id === claim.id; }).classed("is-selected");
      });
      if (selected && !selected.recipes.some(function (r) { return active.has(r); })) {
        selectedRoute.attr("d",null);
        selectedLabel.style("display","none");
        marker.classed("is-selected",false);
        selectedClaim = null;
      }
    }
    document.querySelectorAll(".toggle input").forEach(function (input) {
      input.addEventListener("change",updateVisibility);
    });
    updateVisibility();

    const mapExtent = [[18,18],[width-18,height-18]];

    function visibleViewportExtent() {
      const rect = svg.node().getBoundingClientRect();
      if (!rect.width || !rect.height) return mapExtent;
      const scale = Math.max(rect.width/width,rect.height/height);
      const visibleWidth = rect.width/scale;
      const visibleHeight = rect.height/scale;
      return [
        [(width-visibleWidth)/2,(height-visibleHeight)/2],
        [(width+visibleWidth)/2,(height+visibleHeight)/2]
      ];
    }

    function transformsNear(a, b) {
      return Math.abs(a.k-b.k) < .001 && Math.abs(a.x-b.x) < .5 && Math.abs(a.y-b.y) < .5;
    }

    function homeTransform() {
      if (!isPhoneViewport()) return d3.zoomIdentity;
      const view = visibleViewportExtent();
      const center = [(view[0][0]+view[1][0])/2,(view[0][1]+view[1][1])/2];
      const corridorCenter = projection([32.5,27.0]);
      return constrainToFrame(
        d3.zoomIdentity.translate(center[0]-corridorCenter[0],center[1]-corridorCenter[1])
      );
    }

    const mapWrap = document.querySelector(".map-wrap");
    const zoomIn = document.getElementById("zoom-in");
    const zoomOut = document.getElementById("zoom-out");
    const zoomReset = document.getElementById("zoom-reset");
    const zoomLevel = document.getElementById("zoom-level");
    const exploreToggle = document.getElementById("explore-map");
    const gestureHint = document.getElementById("map-gesture-hint");
    const phoneQuery = window.matchMedia("(max-width: 720px)");
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let exploreMode = exploreToggle.checked;
    let activeMobilePanel = null;
    let lastMobilePanelTrigger = null;
    let mobilePanelScrollY = 0;

    const mobilePanels = Array.from(document.querySelectorAll("[data-mobile-panel]"));
    const mobilePanelButtons = Array.from(document.querySelectorAll("[data-mobile-panel-target]"));
    const mobilePanelBackdrop = document.querySelector(".mobile-panel-backdrop");
    const mobilePanelNav = document.querySelector(".mobile-panel-nav");
    const mobileMapHeader = document.querySelector(".mobile-map-header");
    const mobileSearchInput = document.getElementById("mobile-search-input");
    const mobileSearchSummary = document.getElementById("mobile-search-summary");
    const mobileSearchResults = document.getElementById("mobile-search-results");

    function syncMobilePanelMode() {
      const phone = isPhoneViewport();
      mobileMapHeader.setAttribute("aria-hidden",phone ? "false" : "true");
      mobilePanelNav.setAttribute("aria-hidden",phone ? "false" : "true");
      if (!phone) activeMobilePanel = null;

      mobilePanels.forEach(function (panel) {
        const mobileOnly = panel.classList.contains("mobile-only-sheet");
        if (!phone) {
          if (mobileOnly) {
            panel.setAttribute("aria-hidden","true");
            panel.inert = true;
          } else {
            panel.removeAttribute("aria-hidden");
            panel.inert = false;
          }
          return;
        }
        const open = panel.dataset.mobilePanel === activeMobilePanel;
        panel.setAttribute("aria-hidden",open ? "false" : "true");
        panel.inert = !open;
      });

      mobilePanelButtons.forEach(function (button) {
        const open = phone && button.dataset.mobilePanelTarget === activeMobilePanel;
        button.setAttribute("aria-expanded",open ? "true" : "false");
      });
      mobilePanelBackdrop.hidden = !phone || !activeMobilePanel;
      const shouldLockPage = phone && !!activeMobilePanel;
      document.querySelector(".map-experience").classList.toggle("has-mobile-panel",shouldLockPage);

      if (shouldLockPage && !document.body.classList.contains("mobile-panel-open")) {
        mobilePanelScrollY = window.scrollY;
        document.body.style.top = "-" + mobilePanelScrollY + "px";
        document.body.classList.add("mobile-panel-open");
      } else if (!shouldLockPage && document.body.classList.contains("mobile-panel-open")) {
        const restoreScrollY = mobilePanelScrollY;
        document.body.classList.remove("mobile-panel-open");
        document.body.style.removeProperty("top");
        window.requestAnimationFrame(function () {
          window.scrollTo({ top:restoreScrollY, left:0, behavior:"auto" });
        });
      }
    }

    function openMobilePanel(name, trigger) {
      if (!isPhoneViewport()) return;
      activeMobilePanel = name;
      lastMobilePanelTrigger = trigger || (document.activeElement !== document.body ? document.activeElement : null);
      syncMobilePanelMode();
      document.querySelector(".map-shell").scrollTop = 0;
      if (name === "search") {
        window.setTimeout(function () {
          mobileSearchInput.focus({ preventScroll:true });
          document.querySelector(".map-shell").scrollTop = 0;
        },60);
      }
    }

    function closeMobilePanel(restoreFocus) {
      const target = lastMobilePanelTrigger;
      const focused = document.activeElement;
      if (focused && focused !== document.body && focused.closest && focused.closest("[data-mobile-panel]")) {
        focused.blur();
      }
      activeMobilePanel = null;
      lastMobilePanelTrigger = null;
      syncMobilePanelMode();
      document.querySelector(".map-shell").scrollTop = 0;
      if (restoreFocus !== false && target && target.isConnected) {
        target.focus({ preventScroll:true });
      }
    }

    mobilePanelButtons.forEach(function (button) {
      button.addEventListener("click",function () {
        const name = button.dataset.mobilePanelTarget;
        if (activeMobilePanel === name) closeMobilePanel(true);
        else openMobilePanel(name,button);
      });
    });
    document.querySelectorAll("[data-mobile-panel-close]").forEach(function (button) {
      button.addEventListener("click",function () { closeMobilePanel(true); });
    });
    mobilePanelBackdrop.addEventListener("click",function () { closeMobilePanel(true); });

    document.querySelectorAll("[data-mobile-jump]").forEach(function (button) {
      button.addEventListener("click",function () {
        const target = document.getElementById(button.dataset.mobileJump);
        closeMobilePanel(false);
        if (target) {
          window.setTimeout(function () {
            target.scrollIntoView({ behavior:reducedMotion.matches ? "auto" : "smooth", block:"start" });
          },20);
        }
      });
    });

    function normalizedSearch(value) {
      return String(value || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g,"")
        .toLocaleLowerCase();
    }

    function claimMatchesActiveRecipes(claim) {
      const active = new Set(Array.from(document.querySelectorAll(".toolbar .toggle input:checked")).map(function (input) { return input.value; }));
      return claim.recipes.some(function (recipe) { return active.has(recipe); });
    }

    function claimSearchText(claim) {
      return normalizedSearch([
        claim.greek,
        claim.translit,
        claim.gloss,
        claim.place,
        claim.cite,
        claim.note,
        evidenceText(claim),
        claim.recipes.map(function (key) { return recipes[key].name; }).join(" ")
      ].join(" "));
    }

    function renderMobileSearch() {
      const query = normalizedSearch(mobileSearchInput.value.trim());
      let matches = claims.filter(claimMatchesActiveRecipes);
      if (query) matches = matches.filter(function (claim) { return claimSearchText(claim).includes(query); });
      if (!query && selectedClaim) {
        matches = [selectedClaim].concat(matches.filter(function (claim) { return claim.id !== selectedClaim.id; }));
      }
      const shown = matches.slice(0,30);
      mobileSearchSummary.textContent = matches.length
        ? matches.length + " matching claim" + (matches.length === 1 ? "" : "s") + (matches.length > shown.length ? " · showing first " + shown.length : "")
        : "No visible claims match this search.";
      mobileSearchResults.innerHTML = shown.map(function (claim) {
        return '<li><button type="button" class="mobile-search-result" data-claim-id="' + escapeHTML(claim.id) + '">' +
          '<span class="result-greek">' + escapeHTML(claim.greek) + '</span>' +
          '<span class="result-place">' + escapeHTML(claim.translit + " · " + claim.place) + '</span>' +
          '<span class="result-cite">' + escapeHTML(claim.cite) + '</span>' +
        '</button></li>';
      }).join("");
    }

    mobileSearchInput.addEventListener("input",renderMobileSearch);
    mobileSearchResults.addEventListener("click",function (event) {
      const button = event.target.closest("[data-claim-id]");
      if (!button) return;
      const claim = claims.find(function (item) { return item.id === button.dataset.claimId; });
      if (claim) selectClaim(claim,false,true,true);
    });
    document.querySelectorAll(".toolbar .toggle input").forEach(function (input) {
      input.addEventListener("change",renderMobileSearch);
    });

    document.getElementById("mobile-sources-list").innerHTML = document.querySelector(".sources-grid").innerHTML;
    document.getElementById("mobile-unverified-list").innerHTML = document.querySelector(".unverified ul").innerHTML;
    renderMobileSearch();

    function isPhoneViewport() {
      return phoneQuery.matches;
    }

    function updateExploreMode() {
      const gesturesEnabled = isPhoneViewport() || exploreMode;
      mapWrap.classList.toggle("is-exploring",gesturesEnabled);
      if (isPhoneViewport()) {
        gestureHint.textContent = "Tap a point for guided focus; drag, pinch, double-tap, or use +/− to explore.";
      } else if (exploreMode) {
        gestureHint.textContent = "Drag the map; use the wheel, double-click, or +/− to zoom. Press Escape for guided mode.";
      } else {
        gestureHint.textContent = "Select a point for guided focus. Use +/−, or enable Explore map to drag and wheel-zoom.";
      }
    }

    function updateZoomControls(transform) {
      const home = homeTransform();
      zoomLevel.textContent = Math.round(transform.k * 100) + "%";
      zoomIn.disabled = transform.k >= 7.999;
      zoomOut.disabled = transform.k <= 1.001;
      zoomReset.disabled = transformsNear(transform,home);
    }

    function renderZoom(transform) {
      currentZoom = transform;
      const matrix = svg.node().getScreenCTM();
      const cssPerUserUnit = matrix ? Math.hypot(matrix.a,matrix.b) : 1;
      const fullScreenScale = cssPerUserUnit > 0 ? 1/cssPerUserUnit : 1;
      overlayScale = Math.min(fullScreenScale,2.1);
      zoomLayer.attr("transform",transform);

      marker.attr("transform", function (d) {
        const p = transformedPoint(d.coord);
        return "translate(" + p[0] + "," + p[1] + ") scale(" + overlayScale + ")";
      });
      marker.select(".claim-hit").attr("r",18 * fullScreenScale / overlayScale);
      routeLabels
        .attr("x", function (d) { return transformedPoint(d.labelAt)[0]; })
        .attr("y", function (d) { return transformedPoint(d.labelAt)[1]; });
      regionLabels
        .attr("x", function (d) { return transformedPoint(d.coord)[0]; })
        .attr("y", function (d) { return transformedPoint(d.coord)[1]; });
      mapPlaceLabels
        .attr("x", function (d) { return transformedPoint(d.coord)[0] + d.dx; })
        .attr("y", function (d) { return transformedPoint(d.coord)[1] + d.dy; });
      theologyLabels
        .attr("x", function (d) { return transformedPoint([42.0,9.2])[0] + d.dx; })
        .attr("y", function (d) { return transformedPoint([42.0,9.2])[1] + d.dy; });
      hubs.attr("transform", function (d) {
        const p = transformedPoint(d.coord);
        return "translate(" + p[0] + "," + p[1] + ") scale(" + overlayScale + ")";
      });
      positionSelectedLabel();
      viewAtHome = transformsNear(transform,homeTransform());
      updateZoomControls(transform);
    }

    const zoom = d3.zoom()
      .scaleExtent([1,8])
      .extent(function () { return visibleViewportExtent(); })
      .translateExtent(mapExtent)
      .clickDistance(4)
      .filter(function (event) {
        const ordinaryPointer = (!event.ctrlKey || event.type === "wheel") && !event.button;
        return ordinaryPointer && (isPhoneViewport() || exploreMode);
      })
      .on("start", function () { svg.classed("is-zooming",true); })
      .on("zoom", function (event) { renderZoom(event.transform); })
      .on("end", function () { svg.classed("is-zooming",false); });

    svg.call(zoom);
    svg.call(zoom.transform,homeTransform());

    if (window.ResizeObserver) {
      let resizeFrame = null;
      const mapResizeObserver = new ResizeObserver(function () {
        const preserveHome = viewAtHome;
        if (resizeFrame !== null) window.cancelAnimationFrame(resizeFrame);
        resizeFrame = window.requestAnimationFrame(function () {
          resizeFrame = null;
          const target = preserveHome ? homeTransform() : constrainToFrame(currentZoom);
          svg.call(zoom.transform,target);
        });
      });
      mapResizeObserver.observe(mapWrap);
    } else {
      window.addEventListener("resize", function () {
        svg.call(zoom.transform,viewAtHome ? homeTransform() : constrainToFrame(currentZoom));
      });
    }

    function constrainToFrame(transform, visibleOverride) {
      const visible = visibleOverride || visibleViewportExtent();
      const dx0 = transform.invertX(visible[0][0]) - mapExtent[0][0];
      const dx1 = transform.invertX(visible[1][0]) - mapExtent[1][0];
      const dy0 = transform.invertY(visible[0][1]) - mapExtent[0][1];
      const dy1 = transform.invertY(visible[1][1]) - mapExtent[1][1];
      return transform.translate(
        dx1 > dx0 ? (dx0 + dx1) / 2 : Math.min(0,dx0) || Math.max(0,dx1),
        dy1 > dy0 ? (dy0 + dy1) / 2 : Math.min(0,dy0) || Math.max(0,dy1)
      );
    }

    function focusScaleForClaim(d) {
      if (isPhoneViewport()) {
        return d.evidence === "theology" || d.subtype === "correction" ? 1.25 : 1.8;
      }
      return d.evidence === "theology" || d.subtype === "correction" ? 1.8 : 2.8;
    }

    function focusViewportExtent() {
      const full = visibleViewportExtent();
      if (!isPhoneViewport() || activeMobilePanel !== "details") return full;
      const svgRect = svg.node().getBoundingClientRect();
      const detailPanel = document.getElementById("detail");
      const navTop = mobilePanelNav.getBoundingClientRect().top;
      const finalPanelTop = navTop - detailPanel.offsetHeight;
      const screenScale = Math.max(svgRect.width/width,svgRect.height/height);
      const usablePixels = Math.max(150,finalPanelTop-svgRect.top-18);
      const logicalBottom = full[0][1] + usablePixels/screenScale;
      return [
        full[0],
        [full[1][0],Math.min(full[1][1],logicalBottom)]
      ];
    }

    function focusClaim(d) {
      if (exploreMode) return;
      const p = projection(d.coord);
      const targetScale = focusScaleForClaim(d);
      const visible = focusViewportExtent();
      const targetX = (visible[0][0]+visible[1][0])/2;
      const targetY = (visible[0][1]+visible[1][1])/2;
      const target = constrainToFrame(
        d3.zoomIdentity
          .translate(targetX,targetY)
          .scale(targetScale)
          .translate(-p[0],-p[1]),
        visible
      );
      zoomTarget(520).call(zoom.transform,target);
    }

    function zoomTarget(duration) {
      return reducedMotion.matches ? svg : svg.transition().duration(duration || 180).ease(d3.easeCubicOut);
    }

    zoomIn.addEventListener("click", function () {
      zoomTarget().call(zoom.scaleBy,1.6);
    });
    zoomOut.addEventListener("click", function () {
      zoomTarget().call(zoom.scaleBy,1/1.6);
    });
    zoomReset.addEventListener("click", function () {
      zoomTarget().call(zoom.transform,homeTransform());
    });
    exploreToggle.addEventListener("change", function () {
      exploreMode = exploreToggle.checked;
      updateExploreMode();
    });
    document.addEventListener("keydown", function (event) {
