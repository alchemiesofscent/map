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
    // Layout and input are two questions, and the viewport only answers the
    // first. A tablet is wider than the phone breakpoint but has no pointer to
    // hover with, so gating gestures on width handed every tablet the desktop's
    // click-to-activate: the reader dragged, nothing moved, and nothing said
    // why. Width still decides the drawer, the framing and the padding; whether
    // the map should wait for a click is a question about the pointer.
    const coarsePointerQuery = window.matchMedia("(pointer: coarse)");
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let exploreMode = false;
    let mapToastTimer = null;
    const searchPane = document.getElementById("search-pane");
    const guidePane = document.getElementById("guide-pane");
    const openSearchButton = document.getElementById("open-search");
    const openGuideButton = document.getElementById("open-guide");
    const mobileSearchInput = document.getElementById("mobile-search-input");
    const mobileSearchSummary = document.getElementById("mobile-search-summary");
    const mobileSearchResults = document.getElementById("mobile-search-results");
    const ingredientBrowse = document.getElementById("ingredient-browse");

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

    document.querySelectorAll("[data-mobile-jump]").forEach(function (button) {
      button.addEventListener("click",function () {
        const target = document.getElementById(button.dataset.mobileJump);
        if (guidePane && guidePane.open) { paneOpener = null; guidePane.close(); }
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
    });
    ingredientBrowse.addEventListener("click", function (event) {
      const button = event.target.closest("[data-ingredient-id]");
      if (!button) return;
      const ingredient = ingredientById.get(button.dataset.ingredientId);
      if (!ingredient) return;
      if (searchPane && searchPane.open) { paneOpener = null; searchPane.close(); }
      selectIngredient(ingredient,true);
      updateIngredientPill();
    });
    layerInputs().forEach(function (input) {
      input.addEventListener("change",renderMobileSearch);
    });

    renderMobileSearch();

    function isPhoneViewport() {
      return phoneQuery.matches;
    }

    // Touch and pen get the gestures directly; only a fine pointer has to ask.
    function isTouchInput() {
      return coarsePointerQuery.matches;
    }

    const exploreToggle = document.getElementById("toggle-explore");

    function updateExploreMode() {
      const gesturesEnabled = isTouchInput() || exploreMode;
      mapWrap.classList.toggle("is-exploring",gesturesEnabled);
      // The rail's checkbox arrived with the journeys viewer's markup in the
      // shell rebuild and was never wired here — a control that read as the
      // way to enable zoom, checked or not, while the filter ignored it.
      if (exploreToggle) exploreToggle.checked = exploreMode;
      if (isTouchInput()) {
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

    if (exploreToggle) {
      exploreToggle.addEventListener("change", function () {
        if (exploreToggle.checked) activateMap();
        else releaseMap();
      });
    }

    // Click once to activate wheel-zoom and drag (desktop only). Marker taps
    // keep guided focus, so they do not activate the map by themselves.
    svg.node().addEventListener("pointerdown", function (event) {
      if (isTouchInput() || exploreMode) return;
      if (event.button) return;
      if (event.target && event.target.closest && event.target.closest(".claim")) return;
      activateMap();
    }, true);
    document.addEventListener("pointerdown", function (event) {
      if (isTouchInput() || !exploreMode) return;
      if (mapExperience && event.target instanceof Node && !mapExperience.contains(event.target)) releaseMap();
    });
    if (mapExperience) {
      mapExperience.addEventListener("focusout", function (event) {
        if (isTouchInput() || !exploreMode) return;
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

    // ————— Keeping labels inside the window —————
    // slice crops the viewBox horizontally on a narrow screen, and every label
    // was painted wherever its anchor landed — including half off the crop,
    // which is how MEDIA rendered as EDIA and ALEXANDRIA lost its head. Each
    // label's box is measured once (and again when the webfonts arrive, since
    // the fallback face measures differently), and a label whose box would
    // cross the window's edge is hidden whole: no label is better than a
    // fragment of one.
    const labelBoxes = new Map();

    function measureLabels() {
      function measure(selection) {
        selection.each(function () {
          let w = 0;
          try { w = this.getComputedTextLength(); } catch (e) { w = 0; }
          labelBoxes.set(this,w);
        });
      }
      measure(routeLabels);
      measure(regionLabels);
      measure(mapPlaceLabels);
      measure(theologyLabels);
      hubs.each(function () { measure(d3.select(this).selectAll("text")); });
    }

    function cullLabels() {
      const ext = visibleViewportExtent();
      const pad = 6;

      function boxVisible(left, right, y) {
        return left >= ext[0][0] + pad && right <= ext[1][0] - pad &&
          y >= ext[0][1] + 12 && y <= ext[1][1] - pad;
      }

      // Region labels are middle-anchored; the rest run rightward from x.
      regionLabels.attr("opacity", function () {
        const w = labelBoxes.get(this) || 0;
        const x = parseFloat(this.getAttribute("x"));
        const y = parseFloat(this.getAttribute("y"));
        return boxVisible(x - w / 2, x + w / 2, y) ? 1 : 0;
      });
      routeLabels.merge(theologyLabels).attr("opacity", function () {
        const w = labelBoxes.get(this) || 0;
        const x = parseFloat(this.getAttribute("x"));
        const y = parseFloat(this.getAttribute("y"));
        return boxVisible(x, x + w, y) ? 1 : 0;
      });

      // Place labels are also culled when the selected point already names the
      // same place: the selection label repeats the text a few pixels away.
      const selectedAt = selectedClaim ? transformedPoint(selectedClaim.coord) : null;
      mapPlaceLabels.attr("opacity", function () {
        const w = labelBoxes.get(this) || 0;
        const x = parseFloat(this.getAttribute("x"));
        const y = parseFloat(this.getAttribute("y"));
        if (selectedAt && Math.hypot(x - selectedAt[0],y - selectedAt[1]) < 30 * overlayScale) return 0;
        return boxVisible(x, x + w, y) ? 1 : 0;
      });

      // Hub text sits inside a group scaled by overlayScale, so its box scales
      // with it. The ring stays: a marker clipped by the edge is honest in a
      // way half a word is not.
      hubs.each(function (d) {
        const p = transformedPoint(d.coord);
        d3.select(this).selectAll("text").attr("opacity", function () {
          const w = (labelBoxes.get(this) || 0) * overlayScale;
          const lx = parseFloat(this.getAttribute("x")) * overlayScale;
          const ly = parseFloat(this.getAttribute("y")) * overlayScale;
          return boxVisible(p[0] + lx, p[0] + lx + w, p[1] + ly) ? 1 : 0;
        });
      });
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
      courtMarker.attr("transform", function (d) {
        // The ring offset for shared cities is screen-space, applied after
        // projection, so the spread stays finger-sized at every zoom.
        const p = transformedPoint(d.coord);
        return "translate(" + (p[0] + d.dx * overlayScale) + "," + (p[1] + d.dy * overlayScale) + ") scale(" + overlayScale + ")";
      });
      courtMarker.select(".claim-hit").attr("r",20 * fullScreenScale / overlayScale);
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
      if (!labelBoxes.size) measureLabels();
      cullLabels();
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
      /* d3's own touch double-tap cannot tell a marker tap from a map tap and
         counts a drag as a first tap; a negative tap distance disables it, and
         the hand-rolled gesture below owns the double-tap instead. The mouse
         dblclick.zoom stays: it is gated by the same filter as every other
         desktop gesture. */
      .tapDistance(-1)
      .filter(function (event) {
        const ordinaryPointer = (!event.ctrlKey || event.type === "wheel") && !event.button;
        if (!ordinaryPointer) return false;
        // A trackpad pinch arrives as ctrl+wheel. Unlike a plain scroll it
        // cannot be an attempt to move down the page, so it zooms without
        // asking for explore mode first.
        if (event.type === "wheel" && event.ctrlKey) return true;
        // Browsers synthesize dblclick from a double-tap, so without this the
        // built-in dblclick.zoom stacks on the hand-rolled gesture below and a
        // double-tap lands at 2.9x instead of 2x. Mouse double-click keeps it.
        if (event.type === "dblclick" && isTouchInput()) return false;
        if (!isTouchInput()) return exploreMode;
        return true;
      })
      .on("start", function () { svg.classed("is-zooming",true); })
      .on("zoom", function (event) { renderZoom(event.transform); })
      .on("end", function () { svg.classed("is-zooming",false); });

    // ————— Double-tap zoom —————
    // Registered BEFORE svg.call(zoom), and that order is load-bearing: d3's
    // zoom behaviour calls stopImmediatePropagation on every touch event its
    // filter accepts, so a listener added after it never hears a touch at all.
    // Same-node listeners fire in registration order; these must be first.
    // One finger, tapped twice: zoom in one level, centred on the tap — not on
    // the viewport, which is what makes the gesture worth having. Two fingers,
    // tapped once: zoom out one level, the platform's own convention (the
    // review that asked for this said "two-finger double-tap", but a single
    // two-finger tap is what iOS and Google Maps both ship, and thumbs expect).
    //
    // Hand-rolled rather than d3's dblclick handling because the taps must not
    // fight the existing arbitration: pinch stays the zoom behaviour's, taps on
    // claim markers stay selections (a double-tap on a marker would otherwise
    // select AND zoom, compounding with guided focus), and iOS's page-level
    // double-tap zoom is already suppressed by the map's touch-action rules.
    const TAP_MS = 300;      // a tap is a touch shorter than this
    const TAP_LINK_MS = 320; // two taps this close make a double
    const TAP_SLOP = 24;     // CSS px of drift allowed within and between taps
    let tapCandidate = null; // { time, x, y } of the last completed single tap
    let touchTracking = null;

    function zoomStep(factor, point) {
      const target = reducedMotion.matches
        ? svg
        : svg.transition("dbltap").duration(240).ease(d3.easeCubicOut);
      target.call(zoom.scaleBy, factor, point);
    }

    svg.node().addEventListener("touchstart", function (event) {
      // Marker taps are selections; leave them out of the gesture entirely.
      if (event.target && event.target.closest && event.target.closest(".claim")) {
        touchTracking = null;
        tapCandidate = null;
        return;
      }
      if (!touchTracking) {
        const n = event.touches.length;
        const x = n === 2
          ? (event.touches[0].clientX + event.touches[1].clientX) / 2
          : event.touches[0].clientX;
        const y = n === 2
          ? (event.touches[0].clientY + event.touches[1].clientY) / 2
          : event.touches[0].clientY;
        touchTracking = { time: Date.now(), x: x, y: y, fingers: n, moved: n > 2 };
      } else {
        touchTracking.fingers = Math.max(touchTracking.fingers, event.touches.length);
        if (event.touches.length === 2) {
          // Midpoint, for centring a two-finger zoom-out.
          touchTracking.x = (event.touches[0].clientX + event.touches[1].clientX) / 2;
          touchTracking.y = (event.touches[0].clientY + event.touches[1].clientY) / 2;
        }
      }
    }, { passive: true });

    svg.node().addEventListener("touchmove", function (event) {
      if (!touchTracking) return;
      const t = event.touches[0];
      if (touchTracking.fingers === 1 &&
          Math.hypot(t.clientX - touchTracking.x, t.clientY - touchTracking.y) > TAP_SLOP) {
        touchTracking.moved = true;
      }
      if (touchTracking.fingers > 1) {
        // Any real two-finger movement is a pinch; the zoom behaviour owns it.
        touchTracking.moved = true;
      }
    }, { passive: true });

    svg.node().addEventListener("touchend", function (event) {
      if (!touchTracking || event.touches.length > 0) return;
      const tap = touchTracking;
      touchTracking = null;
      const now = Date.now();
      if (tap.moved || now - tap.time > TAP_MS) { tapCandidate = null; return; }
      const point = d3.pointer({ clientX: tap.x, clientY: tap.y }, svg.node());

      if (tap.fingers >= 2) {
        tapCandidate = null;
        zoomStep(1 / 2, point);
        return;
      }
      if (tapCandidate && now - tapCandidate.time < TAP_LINK_MS &&
          Math.hypot(tap.x - tapCandidate.x, tap.y - tapCandidate.y) < TAP_SLOP * 2) {
        tapCandidate = null;
        zoomStep(2, point);
        return;
      }
      tapCandidate = { time: now, x: tap.x, y: tap.y };
    }, { passive: true });

    svg.node().addEventListener("touchcancel", function () {
      touchTracking = null;
      tapCandidate = null;
    }, { passive: true });

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

    // ————— Where a selection is allowed to land —————
    // Focus must aim at the part of the map the reader can actually see, which
    // is whatever the furniture is not covering. Both panels are measured
    // rather than assumed: this function used to compute from #detail and from
    // the sheet's height, and when the dossier replaced them it kept returning
    // the full extent — #detail no longer exists and the sheet stand-in is
    // zero-height — so every selection was centred in the whole viewport and
    // the point it centred on landed behind the glass.
    function focusViewportExtent() {
      const full = visibleViewportExtent();
      const svgRect = svg.node().getBoundingClientRect();
      if (!svgRect.width || !svgRect.height) return full;
      const screenScale = Math.max(svgRect.width/width,svgRect.height/height);
      const min = [full[0][0],full[0][1]];
      const max = [full[1][0],full[1][1]];

      // The dossier is bottom-anchored at every width, so it always eats the
      // foot of the map.
      const dossier = document.querySelector(".dossier");
      if (dossier) {
        const rect = dossier.getBoundingClientRect();
        if (rect.height) {
          const usablePixels = Math.max(150,rect.top - svgRect.top - 18);
          max[1] = Math.min(max[1],min[1] + usablePixels/screenScale);
        }
      }

      // The rail only takes the right edge while it is a rail; on a phone it is
      // a drawer sitting off-screen and should not shrink the target at all.
      if (!isPhoneViewport()) {
        const rail = document.querySelector(".view-control");
        if (rail) {
          const rect = rail.getBoundingClientRect();
          if (rect.width && rect.left > svgRect.left + 120) {
            const usablePixels = Math.max(200,rect.left - svgRect.left - 24);
            max[0] = Math.min(max[0],min[0] + usablePixels/screenScale);
          }
        }
      }

      return [min,max];
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
      if (exploreMode) releaseMap();
    });
    if (phoneQuery.addEventListener) {
      phoneQuery.addEventListener("change",function () {
        updateExploreMode();
      });
    } else {
      phoneQuery.addListener(function () {
        updateExploreMode();
      });
    }
    updateExploreMode();

    svg.append("path").datum(frameGeo).attr("class","frame").attr("d",geoPath);

    // Bootstrap: every helper above is defined, so the first paint is safe here.
    updateVisibility();

    navigationReady = true;
    const defaultClaim = claims.find(function (d) { return d.id === "bal-petra"; });
    if (defaultClaim) {
      selectClaim(defaultClaim, false);
      renderMobileSearch();
    }

    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(function () {
        measureLabels();
        cullLabels();
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
    // A detached keyboard or a paired mouse changes the answer mid-session.
    if (coarsePointerQuery.addEventListener) {
      coarsePointerQuery.addEventListener("change",function () {
        if (isTouchInput()) releaseMap();
        updateExploreMode();
      });
    }

    // ————— The phone's ingredient pill —————
    // Reads the DOM fresh rather than closing over an element, so app-2.js can
    // call it during its first render, before this file's own consts exist.
    function updateIngredientPill() {
      const label = document.getElementById("ingredient-pill-label");
      if (!label) return;
      const ingredient = selectedIngredientId ? ingredientById.get(selectedIngredientId) : null;
      // The gloss reads better on a pill than the full Greek, which runs long
      // and is already the first line of every row in the picker itself.
      label.textContent = ingredient ? ingredient.gloss.split(" / ")[0] : "All ingredients";
      label.parentElement.setAttribute("aria-label",
        ingredient ? "Ingredient: " + ingredient.gloss + ". Choose another" : "Choose an ingredient");
    }

    const ingredientPill = document.getElementById("ingredient-pill");
    if (ingredientPill && searchPane) {
      ingredientPill.addEventListener("click", function () {
        openPane(searchPane, ingredientPill);
        renderIngredientBrowse();
      });
    }
    updateIngredientPill();

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

    // ————— Site menu —————
    // The page links behind the top-right hamburger. Click toggles, a click
    // anywhere else closes, and Escape closes before the rest of the ladder.
    const siteMenuToggle = document.getElementById("site-menu-toggle");
    const siteMenuPanel = document.getElementById("site-menu-panel");
    if (siteMenuToggle && siteMenuPanel) {
      const setSiteMenu = function (open) {
        siteMenuPanel.hidden = !open;
        siteMenuToggle.setAttribute("aria-expanded",open ? "true" : "false");
      };
      siteMenuToggle.addEventListener("click",function () {
        setSiteMenu(siteMenuPanel.hidden);
      });
      document.addEventListener("click",function (event) {
        if (siteMenuPanel.hidden) return;
        if (!event.target.closest(".site-menu")) setSiteMenu(false);
      });
      document.addEventListener("keydown",function (event) {
        if (event.key !== "Escape" || siteMenuPanel.hidden) return;
        event.preventDefault();
        setSiteMenu(false);
        siteMenuToggle.focus();
      });
    }

    // ————— Deep links —————
    // ../#claim-<id> selects that claim on load, so the dossier's search can
    // land a reader on the exact dot. Also on hashchange, so back and forward
    // walk between linked claims.
    function selectClaimFromHash() {
      let hash = location.hash || "";
      try { hash = decodeURIComponent(hash); } catch (error) { /* leave undecoded */ }
      const match = /^#claim-(.+)$/.exec(hash);
      if (!match) return;
      const claim = claims.find(function (c) { return c.id === match[1]; });
      if (claim) { selectClaim(claim, false, true, false, true); return; }
      // Court ids arrive from the dossier too; a court link switches the
      // layer on rather than landing on an invisibly selected dot.
      const plot = courtPlots.find(function (p) {
        return p.id === match[1] || p.record.id === match[1];
      });
      if (plot) {
        setCourtLayer(true);
        selectCourtPlot(plot,true);
      }
    }
    window.addEventListener("hashchange", selectClaimFromHash);
    selectClaimFromHash();
  }());
