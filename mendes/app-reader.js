
  // Reader enhancements for the dossier page. The markup works without this
  // file: the rail's part-level contents and every anchor are static HTML.
  // This script adds what needs a runtime — the h2-depth contents entries,
  // the scroll position marker, the diacritic-insensitive search, the Greek
  // face on untagged Greek runs, and the compact sticky bar on a phone.
  (function () {
    "use strict";

    var main = document.getElementById("dossier-main");
    var rail = document.getElementById("reader-rail");
    if (!main || !rail) return;

    /* ————— Greek runs get the project's Greek face —————
       The dossier's Greek is typed inline without lang attributes. Wrapping
       each Greek run (plus the marks, spaces, and punctuation between Greek
       letters) keeps Gentium Plus exactly where the Greek is and nowhere
       else. Escapes, not literals, so no editor or tool can re-normalize the
       character classes into invalid ranges. */
    var GREEK = "\\u0370-\\u03FF\\u1F00-\\u1FFF";
    var GREEK_ONE = new RegExp("[" + GREEK + "]");
    var GREEK_RE = new RegExp(
      "[" + GREEK + "](?:[" + GREEK +
      "\\u0300-\\u036F\\u1FBD-\\u1FC1\\u1FCD-\\u1FCF\\u1FDD-\\u1FDF\\u1FED-\\u1FEF\\u1FFD\\u1FFE" +
      "\\u02BC\\u2019'\\s.,\\u00B7;\\u2014\\u2013-]*[" + GREEK + "])?",
      "g");
    function greekify(root) {
      var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode: function (node) {
          if (!node.nodeValue || !GREEK_ONE.test(node.nodeValue)) {
            return NodeFilter.FILTER_REJECT;
          }
          var p = node.parentNode;
          if (!p || p.closest(".greek, [lang='grc'], script, style")) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        }
      });
      var nodes = [];
      while (walker.nextNode()) nodes.push(walker.currentNode);
      nodes.forEach(function (node) {
        var text = node.nodeValue;
        var frag = document.createDocumentFragment();
        var last = 0, m;
        GREEK_RE.lastIndex = 0;
        while ((m = GREEK_RE.exec(text))) {
          if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
          var span = document.createElement("span");
          span.className = "greek";
          span.setAttribute("lang", "grc");
          span.textContent = m[0];
          frag.appendChild(span);
          last = m.index + m[0].length;
        }
        if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
        node.parentNode.replaceChild(frag, node);
      });
    }
    greekify(main);

    /* ————— Contents: add the h2 depth under each static part entry ————— */
    var toc = document.getElementById("rail-toc");
    var partLinks = Array.prototype.slice.call(toc.querySelectorAll("a"));
    var partById = {};
    partLinks.forEach(function (a) { partById[decodeURIComponent(a.hash.slice(1))] = a; });

    var headings = Array.prototype.slice.call(main.querySelectorAll("h1[id], h2[id]"))
      .filter(function (h) {
        return !h.closest(".map-launch") && !h.classList.contains("dek");
      });

    // Walk the document order: h2s that follow a part-level heading listed in
    // the rail are appended after that part's rail entry.
    var currentPart = null;
    headings.forEach(function (h) {
      var id = h.id;
      if (partById[id]) { currentPart = partById[id]; return; }
      if (h.tagName === "H1") { currentPart = null; return; }
      if (!currentPart) return;
      var a = document.createElement("a");
      a.href = "#" + id;
      a.className = "toc-sub";
      a.textContent = h.textContent.replace(/\s+/g, " ").trim();
      var anchor = currentPart;
      while (anchor.nextElementSibling && anchor.nextElementSibling.classList.contains("toc-sub")) {
        anchor = anchor.nextElementSibling;
      }
      anchor.insertAdjacentElement("afterend", a);
    });

    /* ————— Scroll position marker ————— */
    var tocLinks = Array.prototype.slice.call(toc.querySelectorAll("a"));
    var linkByHash = {};
    tocLinks.forEach(function (a) { linkByHash[decodeURIComponent(a.hash.slice(1))] = a; });
    var spied = headings.filter(function (h) { return linkByHash[h.id]; });

    var lastRevealed = null;
    function markActive(id) {
      tocLinks.forEach(function (a) { a.removeAttribute("aria-current"); });
      var link = linkByHash[id];
      if (!link) return;
      link.setAttribute("aria-current", "true");
      // Keep the part entry lit while reading its subsections.
      var part = link;
      if (link.classList.contains("toc-sub")) {
        var p = link.previousElementSibling;
        while (p && p.classList.contains("toc-sub")) p = p.previousElementSibling;
        if (p) { p.setAttribute("aria-current", "true"); part = p; }
      }
      // In the phone chip row, bring the active part chip into view. Only on
      // a change of part, so the reader's own horizontal scrolling is not
      // fought mid-gesture.
      if (part !== lastRevealed && toc.scrollWidth > toc.clientWidth + 4) {
        var lead = part.offsetLeft - 16;
        toc.scrollLeft = Math.max(0, Math.min(lead, toc.scrollWidth - toc.clientWidth));
      }
      lastRevealed = part;
    }
    var ticking = false;
    function spy() {
      ticking = false;
      var line = (parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--stuck-h")) || 0) + 90;
      var active = spied.length ? spied[0] : null;
      for (var i = 0; i < spied.length; i++) {
        if (spied[i].getBoundingClientRect().top <= line) active = spied[i];
        else break;
      }
      if (active) markActive(active.id);
    }
    window.addEventListener("scroll", function () {
      if (!ticking) { ticking = true; requestAnimationFrame(spy); }
    }, { passive: true });
    spy();

    /* ————— Compact sticky bar on a phone —————
       The rail is sticky with a negative top so the brand and the search
       scroll away and the contents row stays pinned. Measured, not hardcoded,
       so a changed brand block or a late font load cannot strand the offset. */
    var mq = window.matchMedia("(max-width: 1080px)");
    function measureStick() {
      if (!mq.matches) {
        rail.style.removeProperty("--rail-stick-top");
        document.documentElement.style.setProperty("--stuck-h", "0px");
        return;
      }
      var tocTop = toc.offsetTop;
      rail.style.setProperty("--rail-stick-top", -tocTop + "px");
      document.documentElement.style.setProperty("--stuck-h", (rail.offsetHeight - tocTop) + "px");
    }
    if (mq.addEventListener) mq.addEventListener("change", measureStick);
    window.addEventListener("resize", measureStick);
    measureStick();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(measureStick);

    /* ————— Search —————
       Sections are indexed once: each heading with an id owns the text until
       the next heading. Matching is case- and diacritic-insensitive (NFD with
       combining marks stripped), so "nard", "Petra", or unaccented Greek all
       find their accented targets. */
    function fold(s) {
      return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
    }
    var sections = [];
    (function indexSections() {
      var all = Array.prototype.slice.call(main.querySelectorAll("h1[id], h2[id], h3[id]"));
      all.forEach(function (h) {
        var text = [];
        var node = h.nextElementSibling;
        while (node && !/^H[1-3]$/.test(node.tagName)) {
          text.push(node.textContent);
          node = node.nextElementSibling;
        }
        var title = h.textContent.replace(/\s+/g, " ").trim();
        var body = text.join(" ").replace(/\s+/g, " ").trim();
        sections.push({ id: h.id, el: h, title: title, body: body, foldedTitle: fold(title), foldedBody: fold(body) });
      });
    }());

    /* The claims store joins the index when it arrives: search keeps working
       over the dossier sections alone until then (and if the fetch fails). */
    var claimEntries = [];
    fetch("data/claims.json?v=" + encodeURIComponent(window.ASSET_VERSION || ""))
      .then(function (response) { return response.ok ? response.json() : null; })
      .then(function (data) {
        if (!data) return;
        var evidenceLabel = { ancient: "ancient", modern: "inference", theology: "theology" };
        data.ingredients.concat(data.contextIngredients, [data.theology]).forEach(function (ingredient) {
          ingredient.claims.forEach(function (claim) {
            claimEntries.push({
              group: "map",
              title: claim.place,
              sub: ingredient.gloss,
              cite: claim.cite,
              chip: evidenceLabel[claim.evidence] || claim.evidence,
              chipClass: claim.evidence,
              evidence: claim.evidence,
              recipes: claim.recipes,
              href: "map/#claim-" + encodeURIComponent(claim.id),
              folded: fold([claim.place, ingredient.greek, ingredient.translit,
                ingredient.gloss, claim.cite, claim.note].join(" "))
            });
          });
        });
        (data.court || []).forEach(function (record) {
          claimEntries.push({
            group: "court",
            title: record.cite,
            sub: record.subtype.replace(/-/g, " ").replace(/:/, " —") + " — " + record.queen.join(", "),
            cite: record.places.map(function (p) { return p.name; }).join(", "),
            chip: record.olfactoryRelevance,
            chipClass: "olf-" + record.olfactoryRelevance,
            queens: record.queen,
            olfactory: record.olfactoryRelevance,
            targetId: "claim-" + record.pqfId.toLowerCase(),
            folded: fold([record.cite, record.subtype, record.queen.join(" "),
              record.aromatics.map(function (a) { return a.name; }).join(" "),
              record.commentary || ""].join(" "))
          });
        });
        onClaimsLoaded();
      })
      .catch(function () { /* section search stands alone */ });

    var searchBox = document.getElementById("rail-search");
    var input = document.getElementById("dossier-search");
    var summary = document.getElementById("rail-search-summary");
    var results = document.getElementById("rail-search-results");
    if (!searchBox || !input) return;
    searchBox.hidden = false;

    /* ————— Filter chips —————
       A scope row (All · Text · Map claims · Queens), then per-scope
       refinements: evidence class and recipe layer for the map corpus, queen
       and olfactory relevance for the court records. With a scope chosen and
       no query, the search browses that corpus instead of going quiet. */
    var EVIDENCE_OPTIONS = [["ancient", "attested"], ["modern", "inference"], ["theology", "theological"]];
    var RECIPE_OPTIONS = [["m", "Mendesian", "--mendesian"], ["t", "Metopion", "--metopion"], ["s", "Susinum", "--susinum"]];
    var OLFACTORY_OPTIONS = [["direct", "direct"], ["indirect", "indirect"], ["contextual", "contextual"], ["none", "none"]];
    var scope = "all";
    var enabled = {
      evidence: new Set(EVIDENCE_OPTIONS.map(function (o) { return o[0]; })),
      recipes: new Set(RECIPE_OPTIONS.map(function (o) { return o[0]; })),
      olfactory: new Set(OLFACTORY_OPTIONS.map(function (o) { return o[0]; })),
      queens: new Set()
    };
    var queenOptions = [];
    function onClaimsLoaded() {
      var seen = [];
      claimEntries.forEach(function (entry) {
        (entry.queens || []).forEach(function (queen) {
          if (seen.indexOf(queen) < 0) seen.push(queen);
        });
      });
      queenOptions = seen.map(function (queen) { return [queen, queen]; });
      enabled.queens = new Set(seen);
      renderFilters();
    }

    var filtersHost = document.createElement("div");
    filtersHost.className = "rail-search-filters";
    filtersHost.hidden = true;
    input.insertAdjacentElement("afterend", filtersHost);
    input.addEventListener("focus", function () {
      if (claimEntries.length) filtersHost.hidden = false;
      measureStick();
    });

    function filterChip(label, pressed, dotVar, onToggle) {
      var chip = document.createElement("button");
      chip.type = "button";
      chip.className = "filter-chip";
      chip.setAttribute("aria-pressed", pressed ? "true" : "false");
      if (dotVar) {
        var dot = document.createElement("span");
        dot.className = "layer-dot";
        dot.style.background = "var(" + dotVar + ")";
        chip.appendChild(dot);
      }
      chip.appendChild(document.createTextNode(label));
      chip.addEventListener("click", onToggle);
      return chip;
    }
    function multiRow(labelText, options, set) {
      var row = document.createElement("div");
      row.className = "filter-row";
      var label = document.createElement("span");
      label.className = "filter-row-label";
      label.textContent = labelText;
      row.appendChild(label);
      options.forEach(function (option) {
        row.appendChild(filterChip(option[1], set.has(option[0]), option[2] || null, function () {
          if (set.has(option[0])) {
            if (set.size > 1) set.delete(option[0]);
          } else {
            set.add(option[0]);
          }
          renderFilters();
          runSearch();
        }));
      });
      return row;
    }
    function renderFilters() {
      filtersHost.textContent = "";
      var scopeRow = document.createElement("div");
      scopeRow.className = "filter-row";
      [["all", "All"], ["sections", "Text"], ["map", "Map claims"], ["court", "Queens"]].forEach(function (option) {
        var chip = filterChip(option[1], scope === option[0], null, function () {
          scope = option[0];
          renderFilters();
          runSearch();
        });
        chip.classList.add("filter-chip--scope");
        scopeRow.appendChild(chip);
      });
      filtersHost.appendChild(scopeRow);
      if (scope === "map") {
        filtersHost.appendChild(multiRow("Evidence", EVIDENCE_OPTIONS, enabled.evidence));
        filtersHost.appendChild(multiRow("Layer", RECIPE_OPTIONS, enabled.recipes));
      }
      if (scope === "court" && queenOptions.length) {
        filtersHost.appendChild(multiRow("Queen", queenOptions, enabled.queens));
        filtersHost.appendChild(multiRow("Olfactory", OLFACTORY_OPTIONS, enabled.olfactory));
      }
      measureStick();
    }

    function mapEntryPasses(entry) {
      if (scope !== "map") return true;
      if (!enabled.evidence.has(entry.evidence)) return false;
      return entry.recipes.length === 0 || entry.recipes.some(function (key) { return enabled.recipes.has(key); });
    }
    function courtEntryPasses(entry) {
      if (scope !== "court") return true;
      if (!enabled.olfactory.has(entry.olfactory)) return false;
      return entry.queens.some(function (queen) { return enabled.queens.has(queen); });
    }

    function snippet(section, foldedQuery, rawQuery) {
      var at = section.foldedBody.indexOf(foldedQuery);
      if (at < 0) return section.body.slice(0, 110);
      // Folding strips marks, so the raw index can drift a few characters;
      // a nearby window on the raw text still reads fine.
      var start = Math.max(0, at - 55);
      var raw = section.body.slice(start, at + rawQuery.length + 65);
      return (start > 0 ? "…" : "") + raw + "…";
    }
    function highlight(text, query) {
      var folded = fold(text);
      var q = fold(query);
      var at = folded.indexOf(q);
      var span = document.createElement("span");
      span.className = "result-snippet";
      if (at < 0) { span.textContent = text; return span; }
      span.appendChild(document.createTextNode(text.slice(0, at)));
      var mark = document.createElement("mark");
      mark.textContent = text.slice(at, at + q.length);
      span.appendChild(mark);
      span.appendChild(document.createTextNode(text.slice(at + q.length)));
      return span;
    }
    function flashTarget(el) {
      el.scrollIntoView({ block: "start" });
      el.classList.remove("search-target");
      void el.offsetWidth;
      el.classList.add("search-target");
    }
    function jumpTo(section) {
      flashTarget(section.el);
      if (history.replaceState) history.replaceState(null, "", "#" + section.id);
    }
    function appendGroupLabel(text) {
      var li = document.createElement("li");
      li.className = "rail-search-group";
      li.textContent = text;
      results.appendChild(li);
    }
    function appendRow(node) {
      var li = document.createElement("li");
      li.appendChild(node);
      results.appendChild(li);
    }
    function claimRow(entry) {
      var node = document.createElement(entry.href ? "a" : "button");
      node.className = "rail-search-result";
      if (entry.href) node.href = entry.href;
      else {
        node.type = "button";
        node.addEventListener("click", function () {
          var target = document.getElementById(entry.targetId);
          if (target) flashTarget(target);
        });
      }
      var title = document.createElement("span");
      title.className = "result-title";
      title.textContent = entry.title;
      node.appendChild(title);
      var snippetSpan = document.createElement("span");
      snippetSpan.className = "result-snippet";
      snippetSpan.textContent = entry.sub;
      node.appendChild(snippetSpan);
      var meta = document.createElement("span");
      meta.className = "result-meta";
      var chip = document.createElement("span");
      chip.className = "result-chip " + entry.chipClass;
      chip.textContent = entry.chip;
      meta.appendChild(chip);
      if (entry.cite) {
        var cite = document.createElement("span");
        cite.className = "result-cite";
        cite.textContent = entry.cite;
        meta.appendChild(cite);
      }
      node.appendChild(meta);
      return node;
    }
    function runSearch() {
      var q = input.value.trim();
      var fq = fold(q);
      var querying = q.length >= 2;
      // With a claims scope chosen and no query, browse the corpus under the
      // active refinements instead of going quiet.
      var browsing = !querying && (scope === "map" || scope === "court");
      if (!querying && !browsing) {
        summary.hidden = true;
        results.hidden = true;
        results.textContent = "";
        measureStick();
        return;
      }
      var sectionHits = [];
      if (querying && (scope === "all" || scope === "sections")) {
        sections.forEach(function (s) {
          var inTitle = s.foldedTitle.indexOf(fq) >= 0;
          var inBody = s.foldedBody.indexOf(fq) >= 0;
          if (inTitle || inBody) sectionHits.push({ s: s, weight: inTitle ? 0 : 1 });
        });
        sectionHits.sort(function (a, b) { return a.weight - b.weight; });
      }
      var mapHits = (scope === "all" || scope === "map")
        ? claimEntries.filter(function (e) {
            return e.group === "map" && mapEntryPasses(e)
              && (!querying || e.folded.indexOf(fq) >= 0);
          })
        : [];
      var courtHits = (scope === "all" || scope === "court")
        ? claimEntries.filter(function (e) {
            return e.group === "court" && courtEntryPasses(e)
              && (!querying || e.folded.indexOf(fq) >= 0);
          })
        : [];
      var total = sectionHits.length + mapHits.length + courtHits.length;
      var mapCap = browsing ? 12 : 8;
      var courtCap = browsing ? 16 : 6;
      var shown = Math.min(sectionHits.length, 8)
        + Math.min(mapHits.length, mapCap)
        + Math.min(courtHits.length, courtCap);
      summary.hidden = false;
      summary.textContent = !total ? "No matches"
        : shown < total
          ? total + " matches · showing " + shown + " — refine the search"
          : total + (total === 1 ? " match" : " matches");
      results.textContent = "";
      results.hidden = total === 0;
      if (sectionHits.length) {
        appendGroupLabel("In the dossier");
        sectionHits.slice(0, 8).forEach(function (hit) {
          var btn = document.createElement("button");
          btn.type = "button";
          btn.className = "rail-search-result";
          var title = document.createElement("span");
          title.className = "result-title";
          title.textContent = hit.s.title;
          btn.appendChild(title);
          btn.appendChild(highlight(snippet(hit.s, fq, q), q));
          btn.addEventListener("click", function () { jumpTo(hit.s); });
          appendRow(btn);
        });
      }
      if (mapHits.length) {
        appendGroupLabel("On the map — provenance claims");
        mapHits.slice(0, mapCap).forEach(function (entry) { appendRow(claimRow(entry)); });
      }
      if (courtHits.length) {
        appendGroupLabel("Queens’ fragments — court records");
        courtHits.slice(0, courtCap).forEach(function (entry) { appendRow(claimRow(entry)); });
      }
      measureStick();
    }
    var debounce;
    input.addEventListener("input", function () {
      clearTimeout(debounce);
      debounce = setTimeout(runSearch, 120);
    });
    input.addEventListener("keydown", function (event) {
      if (event.key === "Escape") {
        input.value = "";
        runSearch();
        input.blur();
      }
      if (event.key === "Enter") {
        event.preventDefault();
        var first = results.querySelector(".rail-search-result");
        if (first) first.click();
      }
    });
  }());
