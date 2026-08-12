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
  