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
      if (event.key === "Escape" && activeMobilePanel && isPhoneViewport()) {
        closeMobilePanel(true);
        return;
      }
      if (event.key === "Escape" && exploreMode) {
        exploreToggle.checked = false;
        exploreMode = false;
        updateExploreMode();
      }
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

    const defaultClaim = claims.find(function (d) { return d.id === "bal-petra"; });
    if (defaultClaim) {
      selectClaim(defaultClaim, false);
      renderMobileSearch();
    }
  }());
  