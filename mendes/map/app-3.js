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
    const gestureHint = document.getElementById("map-gesture-hint");
    const mapToast = document.getElementById("map-toast");
    const mapExperience = document.querySelector(".map-experience");
    const phoneQuery = window.matchMedia("(max-width: 720px)");
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let exploreMode = false;
    let mapToastTimer = null;
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
          '<span class="result-greek" lang="grc">' + escapeHTML(claim.greek) + '</span>' +
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
        gestureHint.textContent = "Map active — scroll to zoom, drag to pan, Escape to release.";
      } else {
        gestureHint.textContent = "Click the map to activate scroll-zoom and drag; press Escape to release. The +/− controls always work.";
      }
    }

    function showMapToast() {
      if (!mapToast) return;
      mapToast.textContent = "Map active — scroll to zoom, drag to pan, Esc to release";
      mapToast.classList.add("is-visible");
      if (mapToastTimer !== null) window.clearTimeout(mapToastTimer);
      mapToastTimer = window.setTimeout(hideMapToast,2600);
    }

    function hideMapToast() {
      if (!mapToast) return;
      if (mapToastTimer !== null) { window.clearTimeout(mapToastTimer); mapToastTimer = null; }
      mapToast.classList.remove("is-visible");
      window.setTimeout(function () {
        if (!mapToast.classList.contains("is-visible")) mapToast.textContent = "";
      },300);
    }

    function activateMap() {
      if (exploreMode) return;
      exploreMode = true;
      updateExploreMode();
      showMapToast();
    }

    function releaseMap() {
      if (!exploreMode) return;
      exploreMode = false;
      updateExploreMode();
      hideMapToast();
    }

    // Click once to activate wheel-zoom and drag (desktop only). Marker taps
    // keep guided focus, so they do not activate the map by themselves.
    svg.node().addEventListener("pointerdown", function (event) {
      if (isPhoneViewport() || exploreMode) return;
      if (event.button) return;
      if (event.target && event.target.closest && event.target.closest(".claim")) return;
      activateMap();
    }, true);
    document.addEventListener("pointerdown", function (event) {
      if (isPhoneViewport() || !exploreMode) return;
      if (mapExperience && event.target instanceof Node && !mapExperience.contains(event.target)) releaseMap();
    });
    if (mapExperience) {
      mapExperience.addEventListener("focusout", function (event) {
        if (isPhoneViewport() || !exploreMode) return;
        if (!event.relatedTarget || !mapExperience.contains(event.relatedTarget)) releaseMap();
      });
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
      const svgRect = svg.node().getBoundingClientRect();
      const screenScale = Math.max(svgRect.width/width,svgRect.height/height);
      const detailPanel = document.getElementById("detail");
      if (!isPhoneViewport()) {
        // The detail panel floats over the map's right edge: focus targets the
        // clear area to its left so the selection is never covered.
        if (!detailPanel) return full;
        const panelRect = detailPanel.getBoundingClientRect();
        if (!panelRect.width || panelRect.left <= svgRect.left + 120) return full;
        const usablePixels = Math.max(200,panelRect.left-svgRect.left-24);
        const logicalRight = full[0][0] + usablePixels/screenScale;
        return [
          full[0],
          [Math.min(full[1][0],logicalRight),full[1][1]]
        ];
      }
      if (activeMobilePanel !== "details") return full;
      const navTop = mobilePanelNav.getBoundingClientRect().top;
      const finalPanelTop = navTop - detailPanel.offsetHeight;
      const usablePixels = Math.max(150,finalPanelTop-svgRect.top-18);
      const logicalBottom = full[0][1] + usablePixels/screenScale;
      return [
        full[0],
        [full[1][0],Math.min(full[1][1],logicalBottom)]
      ];
    }

    function focusClaim(d, forceFocus) {
      if (exploreMode && !forceFocus) return;
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

    function focusIngredient(ingredient, forceFocus) {
      if (exploreMode && !forceFocus) return;
      const ingredientClaims = visibleClaimsForIngredient(ingredient);
      if (!ingredientClaims.length) return;
      if (ingredientClaims.length === 1) {
        focusClaim(ingredientClaims[0],forceFocus);
        return;
      }
      const points = ingredientClaims.map(function (claim) { return projection(claim.coord); });
      const xExtent = d3.extent(points,function (point) { return point[0]; });
      const yExtent = d3.extent(points,function (point) { return point[1]; });
      const visible = focusViewportExtent();
      const visibleWidth = visible[1][0] - visible[0][0];
      const visibleHeight = visible[1][1] - visible[0][1];
      const pointWidth = Math.max(1,xExtent[1] - xExtent[0]);
      const pointHeight = Math.max(1,yExtent[1] - yExtent[0]);
      const padding = isPhoneViewport() ? 92 : 130;
      const targetScale = Math.max(1,Math.min(4.2,
        (visibleWidth-padding)/pointWidth,
        (visibleHeight-padding)/pointHeight
      ));
      const targetX = (visible[0][0]+visible[1][0])/2;
      const targetY = (visible[0][1]+visible[1][1])/2;
      const ingredientX = (xExtent[0]+xExtent[1])/2;
      const ingredientY = (yExtent[0]+yExtent[1])/2;
      const target = constrainToFrame(
        d3.zoomIdentity
          .translate(targetX,targetY)
          .scale(targetScale)
          .translate(-ingredientX,-ingredientY),
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
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && activeMobilePanel && isPhoneViewport()) {
        closeMobilePanel(true);
        return;
      }
      if (event.key === "Escape" && exploreMode) releaseMap();
    });
    if (phoneQuery.addEventListener) {
      phoneQuery.addEventListener("change",function () {
        updateExploreMode();
        syncMobilePanelMode();
      });
    } else {
      phoneQuery.addListener(function () {
        updateExploreMode();
        syncMobilePanelMode();
      });
    }
    updateExploreMode();
    syncMobilePanelMode();

    svg.append("path").datum(frameGeo).attr("class","frame").attr("d",geoPath);

    navigationReady = true;
    const defaultClaim = claims.find(function (d) { return d.id === "bal-petra"; });
    if (defaultClaim) {
      selectClaim(defaultClaim, false);
      renderMobileSearch();
    }
  }());
