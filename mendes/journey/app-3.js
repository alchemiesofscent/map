
    // ————— Journey engine —————
    // A flat stop list plus an integer index, after app/viewer.js. Stops are the
    // claims for one ingredient in the order its sources name them.

    const JOURNEY_MIN_STOPS = 3;
    const journeys = allIngredients.filter(function (item) { return item.claims.length >= JOURNEY_MIN_STOPS; });

    let activeIngredient = null;
    let stops = [];
    let currentIndex = -1;
    let activeStop = null;
    let exploreMode = false;
    let hintTimer = null;

    const mapWrap = document.querySelector(".map-wrap");
    const dossier = document.querySelector(".dossier");
    const strip = document.querySelector(".strip");
    const stripRail = document.getElementById("strip-rail");
    const viewControl = document.getElementById("view-control");
    const routeHost = document.getElementById("view-control-routes");
    const materialSearch = document.getElementById("material-search");
    const materialOptions = document.getElementById("material-options");
    const drawerToggle = document.getElementById("drawer-toggle");
    const drawerClose = document.getElementById("drawer-close");
    const drawerBackdrop = document.getElementById("drawer-backdrop");
    const exploreToggle = document.getElementById("toggle-explore");
    const hintBanner = document.getElementById("hint-banner");
    const guidePane = document.getElementById("guide-pane");
    const openGuideButton = document.getElementById("open-guide");
    const prevButton = document.getElementById("prev-step");
    const nextButton = document.getElementById("next-step");
    const counterRoman = document.getElementById("counter-roman");
    const counterTotal = document.getElementById("counter-total");
    const counterBlock = document.querySelector(".masthead__counter");
    const phoneQuery = window.matchMedia("(max-width: 720px)");
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

    function isPhoneViewport() { return phoneQuery.matches; }

    // ————— Camera —————
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

    function homeTransform() { return d3.zoomIdentity; }

    // The clear area is whatever the fixed furniture leaves: the dossier holds
    // the lower left, the control rail the upper right, the strip the foot.
    // Prefer the gap between dossier and rail. On a phone the dossier spans the
    // width and the rail is off-screen, so there is no gap — fall back to the
    // band above the dossier.
    function stopViewportExtent() {
      const full = visibleViewportExtent();
      const svgRect = svg.node().getBoundingClientRect();
      if (!svgRect.width || !svgRect.height) return full;
      const screenScale = Math.max(svgRect.width/width,svgRect.height/height);
      const GUTTER = 24;

      function inset(node, edge) {
        if (!node) return 0;
        const style = window.getComputedStyle(node);
        if (style.position !== "fixed" || style.display === "none") return 0;
        const r = node.getBoundingClientRect();
        if (!r.width || !r.height) return 0;
        if (edge === "left") return Math.max(0,r.right - svgRect.left) + GUTTER;
        if (edge === "right") return Math.max(0,svgRect.right - r.left) + GUTTER;
        return Math.max(0,svgRect.bottom - r.top) + GUTTER; // bottom
      }

      const left = inset(dossier,"left");
      const right = inset(viewControl,"right");
      const bottom = inset(strip,"bottom");

      if (svgRect.width - left - right > 220) {
        return [
          [full[0][0] + left/screenScale, full[0][1]],
          [full[1][0] - right/screenScale, full[1][1] - bottom/screenScale]
        ];
      }

      const dossierTop = dossier ? dossier.getBoundingClientRect().top - svgRect.top : svgRect.height;
      const usableTop = Math.max(140,dossierTop - GUTTER);
      return [full[0],[full[1][0],full[0][1] + usableTop/screenScale]];
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

    function focusScaleForStop(stop) {
      if (isPhoneViewport()) return stop.claim.evidence === "theology" ? 1.25 : 1.7;
      return stop.claim.evidence === "theology" ? 1.7 : 2.4;
    }

    function zoomTarget(duration) {
      return reducedMotion.matches ? svg : svg.transition().duration(duration || 180).ease(d3.easeCubicOut);
    }

    function moveCameraTo(stop, instant) {
      if (exploreMode || !stop) return;
      const p = projection(stop.claim.coord);
      const visible = stopViewportExtent();
      const targetX = (visible[0][0]+visible[1][0])/2;
      const targetY = (visible[0][1]+visible[1][1])/2;
      const target = constrainToFrame(
        d3.zoomIdentity.translate(targetX,targetY).scale(focusScaleForStop(stop)).translate(-p[0],-p[1]),
        visible
      );
      (instant || reducedMotion.matches ? svg : zoomTarget(560)).call(zoom.transform,target);
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
      regionLabels
        .attr("x", function (d) { return transformedPoint(d.coord)[0]; })
        .attr("y", function (d) { return transformedPoint(d.coord)[1]; });
      mapPlaceLabels
        .attr("x", function (d) { return transformedPoint(d.coord)[0] + d.dx; })
        .attr("y", function (d) { return transformedPoint(d.coord)[1] + d.dy; });
      positionSelectedLabel();
      viewAtHome = transformsNear(transform,homeTransform());
    }

    const zoom = d3.zoom()
      .scaleExtent([1,8])
      .extent(function () { return visibleViewportExtent(); })
      .translateExtent(mapExtent)
      .clickDistance(4)
      .filter(function (event) {
        const ordinaryPointer = (!event.ctrlKey || event.type === "wheel") && !event.button;
        if (!ordinaryPointer) return false;
        if (isPhoneViewport()) return true;
        return exploreMode;
      })
      .on("start", function () { svg.classed("is-zooming",true); })
      .on("zoom", function (event) { renderZoom(event.transform); })
      .on("end", function () { svg.classed("is-zooming",false); });

    // ————— Stops —————
    function buildStops(ingredient) {
      return ingredient.claims.map(function (claim, index) {
        return {
          index: index,
          claim: claim,
          ingredient: ingredient,
          displayName: claim.place,
          greekName: ingredient.greek,
          evidence: claim.evidence,
          cite: claim.cite
        };
      });
    }

    function stripLabel(stop) { return stop.displayName; }

    function renderStrip() {
      stripRail.innerHTML = stops.map(function (stop) {
        return '<button type="button" class="strip__dot" role="option" aria-selected="false"' +
          ' data-index="' + stop.index + '" data-kind="' + escapeHTML(stop.evidence) + '">' +
          '<span class="strip__dot__label">' + escapeHTML(stripLabel(stop)) + '</span>' +
        '</button>';
      }).join("");
      strip.hidden = stops.length < 2;
      stripRail.setAttribute("aria-label", isJourney()
        ? "Places in the order the source names them"
        : "Attested places");
    }

    // Fewer than three places is not a journey: the sources give nothing to
    // walk. Those ingredients still get their card, but the copy enumerates
    // rather than sequences, and the map carries no stop numbers.
    function isJourney() { return stops.length >= JOURNEY_MIN_STOPS; }

    function eyebrowParts(stop) {
      let section;
      if (isJourney()) section = "Stop " + (stop.index + 1) + " of " + stops.length;
      else if (stops.length === 1) section = "The one attested place";
      else section = "Place " + (stop.index + 1) + " of " + stops.length;
      return {
        route: stop.ingredient.gloss,
        type: evidenceText(stop.claim),
        section: section
      };
    }

    function recipeNames(claim) {
      if (claim.context) return ["Metopion name-history · not a recipe ingredient"];
      return claim.recipes.map(function (key) { return recipes[key].name; });
    }

    function renderDossier(stop) {
      const eyebrow = eyebrowParts(stop);
      document.getElementById("dossier-route").textContent = eyebrow.route;
      document.getElementById("dossier-type").textContent = eyebrow.type;
      document.getElementById("dossier-section").textContent = eyebrow.section;
      document.getElementById("dossier-title").textContent = stop.displayName;
      document.getElementById("dossier-greek-name").textContent = stop.greekName;
      document.getElementById("dossier-translation").textContent = stop.claim.note;

      const citationBlock = document.getElementById("dossier-citation");
      document.getElementById("dossier-cite").textContent = stop.cite;
      citationBlock.hidden = !stop.cite;

      const materiaBlock = document.getElementById("dossier-materia");
      const materiaList = document.getElementById("dossier-materia-list");
      const names = recipeNames(stop.claim);
      materiaList.innerHTML = names.map(function (name) {
        return '<li>' + escapeHTML(name) + '</li>';
      }).join("");
      materiaBlock.hidden = !names.length;

      document.getElementById("dossier-source").textContent =
        stop.ingredient.translit + " — " + stop.ingredient.gloss;

      prevButton.disabled = stop.index <= 0;
      nextButton.disabled = stop.index >= stops.length - 1;
      counterRoman.textContent = toRoman(stop.index + 1);
      counterTotal.textContent = stops.length ? toRoman(stops.length) : "—";
      // One place is not a position, so there is nothing for the counter to say.
      if (counterBlock) counterBlock.hidden = stops.length < 2;
    }

    function highlightActive(stop) {
      const ids = new Set(stops.map(function (item) { return item.claim.id; }));
      marker
        .classed("is-in-journey", function (d) { return ids.has(d.id); })
        .classed("is-selected", function (d) { return stop && d.id === stop.claim.id; })
        .attr("tabindex", function (d) { return ids.has(d.id) ? "0" : "-1"; });
      const numbered = isJourney();
      marker.select(".stop-number").text(function (d) {
        if (!numbered) return "";
        const match = stops.find(function (item) { return item.claim.id === d.id; });
        return match ? String(match.index + 1) : "";
      });
      Array.from(stripRail.querySelectorAll(".strip__dot")).forEach(function (dot) {
        const selected = stop && Number(dot.dataset.index) === stop.index;
        dot.setAttribute("aria-selected", selected ? "true" : "false");
        dot.classList.toggle("is-active", !!selected);
      });
      selectedLabel.style("display", stop ? null : "none").text(stop ? stop.displayName : "");
      positionSelectedLabel();
    }

    function goTo(index, options) {
      const settings = options || {};
      if (!stops.length) return;
      if (index < 0 || index >= stops.length) return;
      if (index === currentIndex && !settings.force) return;
      currentIndex = index;
      activeStop = stops[index];
      renderDossier(activeStop);
      highlightActive(activeStop);
      moveCameraTo(activeStop, settings.instant);
      if (!settings.silent) writeHash();
    }

    function next() { goTo(Math.min(currentIndex + 1, stops.length - 1)); }
    function prev() { goTo(Math.max(currentIndex - 1, 0)); }

    // ————— Choosing an ingredient —————
    function setIngredient(ingredient, options) {
      const settings = options || {};
      if (!ingredient) return;
      const previousPlace = activeStop ? activeStop.displayName : null;
      activeIngredient = ingredient;
      stops = buildStops(ingredient);
      currentIndex = -1;
      activeStop = null;
      renderStrip();
      renderRouteButtons();
      dossier.classList.toggle("dossier--single", stops.length < 2);

      if (!stops.length) {
        renderEmptyDossier(ingredient);
        highlightActive(null);
        if (!settings.silent) writeHash();
        return;
      }
      // Keep the reader's place when the same location recurs, after app/'s setView.
      let startIndex = 0;
      if (typeof settings.stopIndex === "number" && settings.stopIndex >= 0 && settings.stopIndex < stops.length) {
        startIndex = settings.stopIndex;
      } else if (previousPlace) {
        const carried = stops.findIndex(function (stop) { return stop.displayName === previousPlace; });
        if (carried >= 0) startIndex = carried;
      }
      goTo(startIndex,{ force:true, instant:settings.instant, silent:settings.silent });
      if (settings.silent) writeHash();
    }

    // Source silence is a result, not a gap: an ingredient no source locates
    // gets a card that says so, with the note that carries its reference.
    function renderEmptyDossier(ingredient) {
      document.getElementById("dossier-route").textContent = ingredient.gloss;
      document.getElementById("dossier-type").textContent = "Source silence";
      document.getElementById("dossier-section").textContent = "No place attested";
      document.getElementById("dossier-title").textContent = ingredient.gloss;
      document.getElementById("dossier-greek-name").textContent = ingredient.greek;
      document.getElementById("dossier-translation").textContent =
        ingredient.unlocated || "No source gives this material a provenance that can be mapped.";
      document.getElementById("dossier-citation").hidden = true;

      const materiaBlock = document.getElementById("dossier-materia");
      const names = (ingredient.recipes || []).map(function (key) { return recipes[key].name; });
      document.getElementById("dossier-materia-list").innerHTML = names.map(function (name) {
        return '<li>' + escapeHTML(name) + '</li>';
      }).join("");
      materiaBlock.hidden = !names.length;

      document.getElementById("dossier-source").textContent = ingredient.translit + " — " + ingredient.gloss;
      prevButton.disabled = true;
      nextButton.disabled = true;
      counterRoman.textContent = "—";
      counterTotal.textContent = "—";
      if (counterBlock) counterBlock.hidden = true;
    }

    function renderRouteButtons() {
      routeHost.innerHTML = journeys.map(function (item) {
        const active = activeIngredient && item.id === activeIngredient.id;
        return '<button type="button" data-ingredient="' + escapeHTML(item.id) + '"' +
          ' aria-pressed="' + (active ? "true" : "false") + '">' +
          escapeHTML(item.gloss.split(" / ")[0]) +
          '<span class="view-control__count">' + item.claims.length + '</span>' +
        '</button>';
      }).join("");
    }

    function renderMaterialOptions() {
      materialOptions.innerHTML = orderedIngredients.map(function (item) {
        const count = item.claims.length;
        const suffix = count >= JOURNEY_MIN_STOPS ? count + " places" : (count === 1 ? "1 place" : count + " places");
        return '<option value="' + escapeHTML(item.gloss) + '">' + escapeHTML(item.greek + " · " + suffix) + '</option>';
      }).join("");
    }

    function ingredientByGloss(value) {
      const needle = String(value || "").trim().toLocaleLowerCase();
      if (!needle) return null;
      return orderedIngredients.find(function (item) {
        return item.gloss.toLocaleLowerCase() === needle;
      }) || orderedIngredients.find(function (item) {
        return item.gloss.toLocaleLowerCase().includes(needle) || item.translit.toLocaleLowerCase().includes(needle);
      }) || null;
    }

    // ————— Deep links —————
    function writeHash() {
      if (!activeIngredient) return;
      const stopPart = activeStop ? "/" + (activeStop.index + 1) : "";
      const next = "#" + activeIngredient.id + stopPart;
      if (window.location.hash !== next) {
        window.history.replaceState(null,"",next);
      }
    }

    function readHash() {
      const raw = String(window.location.hash || "").replace(/^#/,"");
      if (!raw) return null;
      const parts = raw.split("/");
      const ingredient = ingredientById.get(parts[0]);
      if (!ingredient) return null;
      const stopNumber = Number(parts[1]);
      return { ingredient: ingredient, stopIndex: Number.isFinite(stopNumber) ? stopNumber - 1 : 0 };
    }

    // ————— Input —————
    const WHEEL_THRESHOLD = 90;
    const WHEEL_QUIET_MS = 280;
    const WHEEL_COOLDOWN_MS = 850;
    let wheelAccumulator = 0;
    let wheelLastTime = 0;
    let wheelLockedUntil = 0;

    window.addEventListener("wheel", function (event) {
      if (exploreMode || isPhoneViewport() || stops.length < 2) return;
      if (event.target.closest && event.target.closest(".dossier, .mobile-menu, .pane")) return;
      const now = event.timeStamp;
      if (now < wheelLockedUntil) { event.preventDefault(); return; }
      if (now - wheelLastTime > WHEEL_QUIET_MS) wheelAccumulator = 0;
      wheelLastTime = now;
      wheelAccumulator += event.deltaY;
      event.preventDefault();
      if (Math.abs(wheelAccumulator) < WHEEL_THRESHOLD) return;
      if (wheelAccumulator > 0) next(); else prev();
      wheelAccumulator = 0;
      wheelLockedUntil = now + WHEEL_COOLDOWN_MS;
    },{ passive:false });

    document.addEventListener("keydown", function (event) {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const tag = document.activeElement ? document.activeElement.tagName : "";
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
        if (event.key !== "Escape") return;
      }
      if (event.key === "Escape") {
        if (guidePane && guidePane.open) return;
        if (document.body.classList.contains("menu-open")) { setDrawer(false); return; }
        if (exploreMode) { exploreToggle.checked = false; setExploreMode(false); return; }
        return;
      }
      if (stops.length < 2) return;
      if (event.key === "ArrowRight" || event.key === "ArrowDown" || event.key === "PageDown" || event.key === " ") {
        event.preventDefault(); next();
      } else if (event.key === "ArrowLeft" || event.key === "ArrowUp" || event.key === "PageUp") {
        event.preventDefault(); prev();
      } else if (event.key === "Home") {
        event.preventDefault(); goTo(0);
      } else if (event.key === "End") {
        event.preventDefault(); goTo(stops.length - 1);
      }
    });

    let swipeStart = null;
    mapWrap.addEventListener("pointerdown", function (event) {
      if (isPhoneViewport() || event.pointerType === "mouse") return;
      swipeStart = { x:event.clientX, y:event.clientY, id:event.pointerId };
    });
    mapWrap.addEventListener("pointerup", function (event) {
      if (!swipeStart || swipeStart.id !== event.pointerId) return;
      const dx = event.clientX - swipeStart.x;
      const dy = event.clientY - swipeStart.y;
      swipeStart = null;
      if (Math.max(Math.abs(dx),Math.abs(dy)) < 60) return;
      if (Math.abs(dx) >= Math.abs(dy)) { if (dx < 0) next(); else prev(); }
      else if (dy < 0) next(); else prev();
    });

    stripRail.addEventListener("click", function (event) {
      const dot = event.target.closest("[data-index]");
      if (dot) goTo(Number(dot.dataset.index));
    });

    routeHost.addEventListener("click", function (event) {
      const button = event.target.closest("[data-ingredient]");
      if (!button) return;
      const ingredient = ingredientById.get(button.dataset.ingredient);
      if (ingredient) { setIngredient(ingredient); setDrawer(false); }
    });

    materialSearch.addEventListener("change", function () {
      const ingredient = ingredientByGloss(materialSearch.value);
      if (ingredient) { setIngredient(ingredient); setDrawer(false); materialSearch.blur(); }
    });

    marker.on("click", function (event, d) {
      const index = stops.findIndex(function (stop) { return stop.claim.id === d.id; });
      if (index >= 0) { goTo(index); return; }
      const ingredient = ingredientById.get(d.ingredient);
      if (ingredient) setIngredient(ingredient);
    });
    marker.on("keydown", function (event, d) {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      const index = stops.findIndex(function (stop) { return stop.claim.id === d.id; });
      if (index >= 0) goTo(index);
    });

    prevButton.addEventListener("click", prev);
    nextButton.addEventListener("click", next);

    function setExploreMode(on) {
      exploreMode = on;
      document.body.dataset.explore = on ? "true" : "false";
      mapWrap.classList.toggle("is-exploring",on || isPhoneViewport());
    }
    exploreToggle.addEventListener("change", function () { setExploreMode(exploreToggle.checked); });

    function setDrawer(open) {
      document.body.classList.toggle("menu-open",open);
      drawerToggle.setAttribute("aria-expanded",open ? "true" : "false");
      if (open) {
        const first = document.querySelector("#view-control-routes button");
        if (first) first.focus({ preventScroll:true });
      } else {
        drawerToggle.focus({ preventScroll:true });
      }
    }
    drawerToggle.addEventListener("click", function () { setDrawer(!document.body.classList.contains("menu-open")); });
    drawerClose.addEventListener("click", function () { setDrawer(false); });
    drawerBackdrop.addEventListener("click", function () { setDrawer(false); });

    if (openGuideButton && guidePane) {
      let guideOpener = null;
      openGuideButton.addEventListener("click", function () {
        guideOpener = openGuideButton;
        guidePane.showModal();
      });
      guidePane.addEventListener("close", function () {
        if (guideOpener && guideOpener.isConnected) guideOpener.focus({ preventScroll:true });
        guideOpener = null;
      });
      guidePane.addEventListener("click", function (event) {
        if (event.target === guidePane) guidePane.close();
      });
    }

    hintBanner.addEventListener("click", function () { hintBanner.hidden = true; });
    function showHintBriefly() {
      hintBanner.hidden = false;
      if (hintTimer !== null) window.clearTimeout(hintTimer);
      hintTimer = window.setTimeout(function () { hintBanner.hidden = true; },5200);
    }

    window.addEventListener("hashchange", function () {
      const target = readHash();
      if (!target) return;
      if (!activeIngredient || target.ingredient.id !== activeIngredient.id) {
        setIngredient(target.ingredient,{ stopIndex:target.stopIndex, silent:true });
      } else if (target.stopIndex !== currentIndex) {
        goTo(target.stopIndex,{ silent:true });
      }
    });

    if (window.ResizeObserver) {
      let resizeFrame = null;
      const observer = new ResizeObserver(function () {
        if (resizeFrame !== null) window.cancelAnimationFrame(resizeFrame);
        resizeFrame = window.requestAnimationFrame(function () {
          resizeFrame = null;
          if (activeStop) moveCameraTo(activeStop,true);
          else svg.call(zoom.transform,constrainToFrame(currentZoom));
        });
      });
      observer.observe(mapWrap);
    }

    if (phoneQuery.addEventListener) {
      phoneQuery.addEventListener("change", function () { setExploreMode(exploreMode); });
    }

    // ————— Bootstrap —————
    svg.call(zoom);
    svg.call(zoom.transform,homeTransform());
    renderMaterialOptions();
    renderRouteButtons();
    setExploreMode(false);

    const initial = readHash();
    if (initial) {
      setIngredient(initial.ingredient,{ stopIndex:initial.stopIndex, instant:true, silent:true });
    } else {
      setIngredient(journeys[0],{ instant:true });
    }
    showHintBriefly();
  }());
