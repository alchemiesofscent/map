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
    let sheetSnap = "peek";
    let sheetScrollY = 0;

    // The selection now reads in the shared dossier at every width, so the
    // bottom sheet is gone from the markup. The snap machinery below is left in
    // place rather than unpicked from the drag and gesture code it interleaves
    // with: a detached stand-in keeps every lookup total, and sheetEnabled gates
    // the behaviour at its entry points. Removing it outright is a separate
    // pass, and one worth doing on its own.
    const sheet = document.getElementById("map-sheet") || document.createElement("section");
    const sheetEnabled = sheet.isConnected;
    const sheetGrab = sheet.querySelector(".sheet-grab");
    const sheetPeek = sheet.querySelector(".sheet-peek");
    const sheetBackdrop = document.querySelector(".sheet-backdrop");
    const safeProbe = sheet.querySelector(".safe-probe");
    const peekLabels = Array.from(document.querySelectorAll("[data-peek-label]"));
    const searchPane = document.getElementById("search-pane");
    const guidePane = document.getElementById("guide-pane");
    const openSearchButton = document.getElementById("open-search");
    const openGuideButton = document.getElementById("open-guide");
    const mobileSearchInput = document.getElementById("mobile-search-input");
    const mobileSearchSummary = document.getElementById("mobile-search-summary");
    const mobileSearchResults = document.getElementById("mobile-search-results");
    const ingredientBrowse = document.getElementById("ingredient-browse");

    // ————— One bottom sheet, three snap points —————
    // peek: the selection line stays legible over the map
    // half: the detail panel is readable with the map still visible above
    // full: reading depth, with a strip of map always showing
    // Measure the band the sheet actually lives in rather than the visual
    // viewport: the band is sized in svh, so it already excludes the browser's
    // own chrome and does not shift as that chrome expands and collapses.
    function viewportHeight() {
      if (mapExperience && mapExperience.clientHeight) return mapExperience.clientHeight;
      return window.visualViewport ? window.visualViewport.height : window.innerHeight;
    }

    function safeAreaBottom() {
      if (!safeProbe) return 0;
      const value = parseFloat(window.getComputedStyle(safeProbe).paddingBottom);
      return isNaN(value) ? 0 : value;
    }

    function snapOffsets() {
      const height = viewportHeight();
      const sheetHeight = sheet.offsetHeight || height;
      const peekVisible = 104 + safeAreaBottom();
      return {
        peek: Math.max(0,sheetHeight - peekVisible),
        half: Math.max(0,Math.min(sheetHeight - peekVisible,sheetHeight - height * 0.48)),
        full: Math.max(0,sheetHeight - (height - 128))
      };
    }

    function applySheetOffset(offset) {
      sheet.style.setProperty("--sheet-y",offset + "px");
    }

    // The zoom cluster rides just above the sheet rather than hiding behind it.
    function positionMapTools(name) {
      if (!sheetEnabled) return;
      if (!mapExperience) return;
      mapExperience.dataset.sheetSnap = name;
      if (!isPhoneViewport()) {
        mapExperience.style.removeProperty("--fab-bottom");
        return;
      }
      const visible = Math.max(0,(sheet.offsetHeight || 0) - snapOffsets()[name]);
      mapExperience.style.setProperty("--fab-bottom",(visible + 14) + "px");
    }

    function setSnap(name, options) {
      if (!sheetEnabled) return;
      const settings = options || {};
      if (!isPhoneViewport()) {
        sheetSnap = name;
        sheet.dataset.snap = name;
        sheet.style.removeProperty("--sheet-y");
        if (sheetBackdrop) sheetBackdrop.hidden = true;
        unlockPageScroll();
        positionMapTools("docked");
        return;
      }
      sheetSnap = name;
      sheet.dataset.snap = name;
      if (settings.animate === false) sheet.classList.add("is-dragging");
      applySheetOffset(snapOffsets()[name]);
      if (settings.animate === false) {
        void sheet.offsetWidth;
        sheet.classList.remove("is-dragging");
      }
      if (sheetBackdrop) sheetBackdrop.hidden = name !== "full";
      if (name === "full") lockPageScroll();
      else unlockPageScroll();
      positionMapTools(name);
      syncMapGestures();
    }

    function lockPageScroll() {
      if (!sheetEnabled) return;
      if (document.body.classList.contains("mobile-panel-open")) return;
      sheetScrollY = window.scrollY;
      document.body.style.top = "-" + sheetScrollY + "px";
      document.body.classList.add("mobile-panel-open");
    }

    function unlockPageScroll() {
      if (!sheetEnabled) return;
      if (!document.body.classList.contains("mobile-panel-open")) return;
      const restore = sheetScrollY;
      document.body.classList.remove("mobile-panel-open");
      document.body.style.removeProperty("top");
      window.requestAnimationFrame(function () {
        window.scrollTo({ top:restore, left:0, behavior:"auto" });
      });
    }

    // At peek the map owns single-finger drags; at half and full the sheet does,
    // but pinch keeps zooming the map at every snap.
    function syncMapGestures() {
      const mapOwnsDrag = !isPhoneViewport() || sheetSnap === "peek";
      mapWrap.classList.toggle("sheet-owns-drag",!mapOwnsDrag);
    }

    const peekGlyphIds = { ancient:"glyph-ancient", modern:"glyph-inference", theology:"glyph-theology" };

    function updatePeekLabel() {
      if (!sheetEnabled) return;
      const visible = document.getElementById("visible-count");
      const count = visible ? visible.textContent : "0";
      peekLabels.forEach(function (node) {
        if (selectedClaim) {
          node.innerHTML =
            '<span class="peek-title" lang="grc">' + escapeHTML(selectedClaim.greek) + '</span>' +
            '<span class="peek-sub">' +
              '<svg class="peek-glyph ' + selectedClaim.evidence + '" aria-hidden="true"><use href="#' + peekGlyphIds[selectedClaim.evidence] + '"></use></svg>' +
              '<span class="peek-place">' + escapeHTML(selectedClaim.place) + '</span>' +
              '<span class="peek-class">' + escapeHTML(evidenceText(selectedClaim)) + '</span>' +
            '</span>';
        } else {
          node.innerHTML =
            '<span class="peek-title">' + escapeHTML(count) + ' claims visible</span>' +
            '<span class="peek-sub"><span class="peek-place">Tap a point on the map</span></span>';
        }
      });
    }

    // Tapping a marker: raise the sheet to half and pan the point into the map
    // still visible above it. On desktop the panel is docked, so this is a no-op.
    function presentSelection(d) {
      if (!isPhoneViewport()) return;
      if (sheetSnap === "peek") setSnap("half");
    }

    // ————— Search and Guide panes —————
    // Both are modal dialogs, so the platform handles the focus trap, the
    // backdrop, and Escape; we only manage what opens them and where focus lands.
    let paneOpener = null;

    function openPane(pane, trigger) {
      if (!pane || pane.open) return;
      paneOpener = trigger || null;
      hideTooltip();
      pane.showModal();
    }

    function panesOpen() {
      return (searchPane && searchPane.open) || (guidePane && guidePane.open);
    }

    [searchPane,guidePane].forEach(function (pane) {
      if (!pane) return;
      pane.addEventListener("close", function () {
        const target = paneOpener;
        paneOpener = null;
        if (target && target.isConnected) target.focus({ preventScroll:true });
      });
      // A click on the backdrop lands on the dialog element itself.
      pane.addEventListener("click", function (event) {
        if (event.target === pane) pane.close();
      });
    });

    if (openSearchButton) {
      openSearchButton.addEventListener("click", function () {
        renderMobileSearch();
        openPane(searchPane,openSearchButton);
        window.setTimeout(function () { mobileSearchInput.focus({ preventScroll:true }); },40);
      });
    }
    if (openGuideButton) {
      openGuideButton.addEventListener("click", function () { openPane(guidePane,openGuideButton); });
    }

    if (sheetBackdrop) {
      sheetBackdrop.addEventListener("click", function () { setSnap("half"); });
    }

    // Sheet drag: pointer events only, transform-driven, with a velocity bias so
    // a flick moves one snap in the direction of travel.
    let drag = null;

    function snapNames() { return ["full","half","peek"]; }

    function nearestSnap(offset, velocity) {
      const offsets = snapOffsets();
      const order = snapNames();
      let closest = order[0];
      order.forEach(function (name) {
        if (Math.abs(offsets[name] - offset) < Math.abs(offsets[closest] - offset)) closest = name;
      });
      if (Math.abs(velocity) > 0.5) {
        const index = order.indexOf(closest);
        const direction = velocity > 0 ? 1 : -1;
        const nextIndex = Math.max(0,Math.min(order.length - 1,index + direction));
        return order[nextIndex];
      }
      return closest;
    }

    function beginDrag(event, fromBody) {
      if (!sheetEnabled) return;
      if (!isPhoneViewport() || event.pointerType === "mouse" && event.button) return;
      drag = {
        id: event.pointerId,
        startY: event.clientY,
        startOffset: snapOffsets()[sheetSnap],
        lastY: event.clientY,
        lastTime: event.timeStamp,
        velocity: 0,
        fromBody: !!fromBody,
        active: !fromBody
      };
      if (!fromBody) {
        sheet.classList.add("is-dragging");
        if (event.target.setPointerCapture) event.target.setPointerCapture(event.pointerId);
      }
    }

    function moveDrag(event) {
      if (!drag || drag.id !== event.pointerId) return;
      const delta = event.clientY - drag.startY;
      if (!drag.active) {
        // A drag that starts inside the scrolling body only takes over the sheet
        // when the body is already at the top and the gesture is downward.
        if (delta <= 6) return;
        drag.active = true;
        sheet.classList.add("is-dragging");
      }
      const offsets = snapOffsets();
      const next = Math.max(offsets.full,Math.min(offsets.peek,drag.startOffset + delta));
      const elapsed = event.timeStamp - drag.lastTime;
      if (elapsed > 0) drag.velocity = (event.clientY - drag.lastY) / elapsed;
      drag.lastY = event.clientY;
      drag.lastTime = event.timeStamp;
      drag.offset = next;
      applySheetOffset(next);
      event.preventDefault();
    }

    function endDrag(event) {
      if (!drag || drag.id !== event.pointerId) return;
      const wasActive = drag.active;
      const offset = drag.offset;
      const velocity = drag.velocity;
      drag = null;
      sheet.classList.remove("is-dragging");
      if (!wasActive || typeof offset !== "number") {
        setSnap(sheetSnap);
        return;
      }
      setSnap(nearestSnap(offset,velocity));
    }

    [sheetGrab,sheetPeek].forEach(function (handle) {
      if (!handle) return;
      handle.addEventListener("pointerdown", function (event) { beginDrag(event,false); });
    });
    const sheetPanelsHost = sheet.querySelector(".sheet-panels");
    if (sheetPanelsHost) {
      sheetPanelsHost.addEventListener("pointerdown", function (event) {
        if (event.pointerType === "mouse") return;
        if (sheetPanelsHost.scrollTop > 0) return;
        if (event.target.closest("button, a, input, select, textarea")) return;
        beginDrag(event,true);
      });
    }
    document.addEventListener("pointermove",moveDrag,{ passive:false });
    document.addEventListener("pointerup",endDrag);
    document.addEventListener("pointercancel",endDrag);

    function syncSheetMode() {
      if (!sheetEnabled) { syncMapGestures(); return; }
      const phone = isPhoneViewport();
      if (!phone) {
        sheet.style.removeProperty("--sheet-y");
        sheet.dataset.snap = "docked";
        if (sheetBackdrop) sheetBackdrop.hidden = true;
        unlockPageScroll();
      } else {
        sheet.dataset.snap = sheetSnap;
        setSnap(sheetSnap,{ animate:false });
      }
      syncMapGestures();
    }

    document.querySelectorAll("[data-mobile-jump]").forEach(function (button) {
      button.addEventListener("click",function () {
        const target = document.getElementById(button.dataset.mobileJump);
        if (guidePane && guidePane.open) { paneOpener = null; guidePane.close(); }
        if (isPhoneViewport()) setSnap("peek");
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
      const active = activeRecipeKeys();
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

    // With no query the pane browses the ingredients by kind — this is what
    // replaced the cramped dropdowns that used to sit in the sheet. Typing
    // switches to matching individual claims.
    function renderIngredientBrowse() {
      const active = activeRecipeKeys();
      const markup = ingredientGroups.map(function (group) {
        const members = group.ids
          .map(function (id) { return ingredientById.get(id); })
          .filter(function (item) { return item && item.recipes.some(function (r) { return active.has(r); }); });
        if (!members.length) return "";
        return '<h3 class="browse-group">' + escapeHTML(group.label) + '</h3>' +
          '<ul class="browse-list">' + members.map(function (item) {
            const count = item.claims.filter(function (claim) {
              return claim.recipes.some(function (r) { return active.has(r); });
            }).length;
            return '<li><button type="button" class="browse-item" data-ingredient-id="' + escapeHTML(item.id) + '">' +
              '<span class="browse-name" lang="grc">' + escapeHTML(item.greek) + '</span>' +
              '<span class="browse-gloss">' + escapeHTML(item.gloss) + '</span>' +
              '<span class="browse-count">' + count + '</span>' +
            '</button></li>';
          }).join("") + '</ul>';
      }).join("");
      ingredientBrowse.innerHTML = markup;
    }

    function renderMobileSearch() {
      const query = normalizedSearch(mobileSearchInput.value.trim());
      if (!query) {
        mobileSearchResults.innerHTML = "";
        mobileSearchResults.hidden = true;
        ingredientBrowse.hidden = false;
        renderIngredientBrowse();
        mobileSearchSummary.textContent = "Browse every ingredient, or type to search claims.";
        return;
      }
      ingredientBrowse.hidden = true;
      mobileSearchResults.hidden = false;
      const matches = claims
        .filter(claimMatchesActiveRecipes)
        .filter(function (claim) { return claimSearchText(claim).includes(query); });
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
      if (!claim) return;
      if (searchPane && searchPane.open) {
        paneOpener = null; // focus belongs to the selection now, not the trigger
        searchPane.close();
      }
      selectClaim(claim,false,true,true);
      if (isPhoneViewport()) setSnap("half");
    });
    ingredientBrowse.addEventListener("click", function (event) {
      const button = event.target.closest("[data-ingredient-id]");
      if (!button) return;
      const ingredient = ingredientById.get(button.dataset.ingredientId);
      if (!ingredient) return;
      if (searchPane && searchPane.open) { paneOpener = null; searchPane.close(); }
      selectIngredient(ingredient,true);
      if (isPhoneViewport()) setSnap("half");
    });
    layerInputs().forEach(function (input) {
      input.addEventListener("change",renderMobileSearch);
    });

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
      marker.select(".claim-hit").attr("r",22 * fullScreenScale / overlayScale);
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
      positionTooltip();
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
        if (!ordinaryPointer) return false;
        if (!isPhoneViewport()) return exploreMode;
        const touches = event.touches ? event.touches.length : 0;
        return touches > 1 || sheetSnap === "peek";
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
      // The sheet will sit at half after a selection: keep the point in the
      // map still visible above it.
      const offsets = snapOffsets();
      const sheetTop = svgRect.top + Math.max(0,viewportHeight() - (sheet.offsetHeight - offsets.half));
      const usablePixels = Math.max(150,sheetTop-svgRect.top-18);
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
      if (event.key !== "Escape") return;
      if (panesOpen()) return; // the open dialog closes itself
      hideTooltip();
      if (isPhoneViewport() && sheetSnap !== "peek") {
        setSnap("peek");
        return;
      }
      if (exploreMode) releaseMap();
    });
    if (phoneQuery.addEventListener) {
      phoneQuery.addEventListener("change",function () {
        updateExploreMode();
        syncSheetMode();
      });
    } else {
      phoneQuery.addListener(function () {
        updateExploreMode();
        syncSheetMode();
      });
    }
    updateExploreMode();

    svg.append("path").datum(frameGeo).attr("class","frame").attr("d",geoPath);

    // Bootstrap: every helper above is defined, so the first paint is safe here.
    updateVisibility();
    setSnap("peek",{ animate:false });
    syncSheetMode();

    navigationReady = true;
    const defaultClaim = claims.find(function (d) { return d.id === "bal-petra"; });
    if (defaultClaim) {
      selectClaim(defaultClaim, false);
      renderMobileSearch();
    }
    updatePeekLabel();

    if (window.visualViewport) {
      window.visualViewport.addEventListener("resize", function () {
        if (isPhoneViewport()) setSnap(sheetSnap,{ animate:false });
      });
    }

    // ————— The phone drawer —————
    // The control rail is a fixed panel on the desktop and a drawer on a phone,
    // the same trade the journeys viewer makes; shell.css carries both states
    // and this only opens and closes them.
    const drawerToggle = document.getElementById("drawer-toggle");
    const drawerClose = document.getElementById("drawer-close");
    const drawerBackdrop = document.getElementById("drawer-backdrop");

    function setDrawer(open) {
      document.body.classList.toggle("menu-open",open);
      if (drawerToggle) drawerToggle.setAttribute("aria-expanded",open ? "true" : "false");
      if (open) {
        const first = document.querySelector("#view-control-routes button");
        if (first) first.focus();
      } else if (drawerToggle && isPhoneViewport()) {
        drawerToggle.focus();
      }
    }

    if (drawerToggle) drawerToggle.addEventListener("click",function () {
      setDrawer(!document.body.classList.contains("menu-open"));
    });
    if (drawerClose) drawerClose.addEventListener("click",function () { setDrawer(false); });
    if (drawerBackdrop) drawerBackdrop.addEventListener("click",function () { setDrawer(false); });
    phoneQuery.addEventListener("change",function () {
      if (!isPhoneViewport()) setDrawer(false);
    });

    // ————— The rail's search field —————
    // The rail carries a real search field rather than a button that says
    // "Search", so the affordance matches the journeys viewer. The pane still
    // owns the results and the ingredient browse, so the field hands its query
    // over and lets the pane do the work.
    const railSearch = document.getElementById("map-search");
    if (railSearch && searchPane) {
      const handOver = function () {
        if (mobileSearchInput) {
          mobileSearchInput.value = railSearch.value;
          mobileSearchInput.dispatchEvent(new Event("input",{ bubbles:true }));
        }
        if (!searchPane.open) openPane(searchPane,railSearch);
        if (mobileSearchInput) mobileSearchInput.focus();
      };
      railSearch.addEventListener("focus",handOver);
      railSearch.addEventListener("input",handOver);
      railSearch.addEventListener("keydown",function (event) {
        if (event.key === "Enter") { event.preventDefault(); handOver(); }
      });
      // The pane is the one that searches; leaving the rail field holding a
      // stale query would show a filter the map is no longer applying.
      searchPane.addEventListener("close",function () { railSearch.value = ""; });
    }

    // The drawer is the outermost layer of the Escape ladder on a phone: panes
    // close first, then the drawer, then the map releases its gestures.
    document.addEventListener("keydown",function (event) {
      if (event.key !== "Escape") return;
      if (panesOpen()) return;
      if (document.body.classList.contains("menu-open")) {
        event.preventDefault();
        setDrawer(false);
      }
    });
  }());
