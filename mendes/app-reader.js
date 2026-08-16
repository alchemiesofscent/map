
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
      // The phone bar says where the reader is — the one thing the old
      // contents chip row was really for, now that the contents live behind
      // the hamburger.
      if (part !== lastRevealed) {
        var where = document.getElementById("mobile-bar-where");
        if (where) where.textContent = part.textContent.replace(/\s+/g, " ").trim();
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

    /* ————— The phone bar and its fullscreen contents menu —————
       Below 1080px the rail stops being a column beside the text and becomes
       a menu behind a hamburger, with a fixed bar holding the wordmark and
       the reader's current section. The rail is the same element in both
       layouts — the contents, search, page links and theme control are one
       set of nodes, so there is nothing to keep in sync — and the CSS is
       gated on the nav-ready class this sets, so a reader without JavaScript
       gets the rail inline above the dossier rather than a dead hamburger.

       Bar height is measured rather than assumed: the wordmark's face loads
       late, and anchor jumps have to clear whatever the bar actually is. */
    var mq = window.matchMedia("(max-width: 1080px)");
    var bar = document.getElementById("mobile-bar");
    var navToggle = document.getElementById("nav-toggle");

    function measureBar() {
      if (!mq.matches || !bar) {
        document.documentElement.style.setProperty("--stuck-h", "0px");
        return;
      }
      var h = bar.offsetHeight;
      document.documentElement.style.setProperty("--bar-h", h + "px");
      document.documentElement.style.setProperty("--stuck-h", h + "px");
    }

    if (bar && navToggle) {
      bar.hidden = false;
      document.documentElement.classList.add("nav-ready");
      // The closed state lands with nav-ready; the transition is armed a
      // frame later so the menu is never seen fading away on load.
      requestAnimationFrame(function () {
        document.documentElement.classList.add("nav-live");
      });

      var navReturn = null;
      function navOpen() { return navToggle.getAttribute("aria-expanded") === "true"; }

      function setNav(open) {
        navToggle.setAttribute("aria-expanded", open ? "true" : "false");
        rail.classList.toggle("is-open", open);
        document.documentElement.classList.toggle("nav-open", open);
        if (open) {
          navReturn = document.activeElement;
          // The contents are what the menu is for, and a contents link does
          // not raise the phone keyboard the way the search field would.
          var first = rail.querySelector(".rail-toc a") ||
            rail.querySelector("input, a[href], button");
          if (first) first.focus();
        } else if (navReturn) {
          navReturn.focus();
          navReturn = null;
        }
      }

      navToggle.addEventListener("click", function () { setNav(!navOpen()); });

      // Choosing a destination is the end of the menu's job.
      rail.addEventListener("click", function (event) {
        if (!navOpen()) return;
        if (event.target.closest(".rail-toc a, .rail-links a, .rail-search-result")) {
          setNav(false);
        }
      });

      document.addEventListener("keydown", function (event) {
        if (!navOpen()) return;
        if (event.key === "Escape") { event.preventDefault(); setNav(false); return; }
        if (event.key !== "Tab") return;
        var focusable = [].slice.call(rail.querySelectorAll(
          "input, a[href], button")).filter(function (node) {
            return node.offsetParent !== null && !node.disabled;
          });
        focusable.unshift(navToggle);   // the hamburger is the way back out
        if (focusable.length < 2) return;
        var first = focusable[0];
        var last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault(); last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault(); first.focus();
        }
      });

      // Growing past the breakpoint puts the rail back beside the text; a
      // menu left open would otherwise strand the page scroll-locked.
      if (mq.addEventListener) {
        mq.addEventListener("change", function () {
          if (!mq.matches && navOpen()) setNav(false);
        });
      }
    }

    if (mq.addEventListener) mq.addEventListener("change", measureBar);
    window.addEventListener("resize", measureBar);
    measureBar();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(measureBar);

    /* ————— Arriving with an anchor —————
       The dossier's content is fetched and inserted after the page loads, so
       the browser's native fragment scroll fires against an empty page: a
       reader following the map's "read in the dossier" links landed at the
       top. Scroll once the content exists (this script runs after insertion),
       flash the target for orientation, and correct once more after the fonts
       land — heights shift — unless the reader has scrolled themselves. */
    (function scrollToArrivalHash() {
      var hash = location.hash || "";
      try { hash = decodeURIComponent(hash); } catch (error) { /* leave undecoded */ }
      if (hash.length < 2) return;
      var target = document.getElementById(hash.slice(1));
      if (!target) return;
      var userScrolled = false;
      ["wheel", "touchstart", "keydown"].forEach(function (type) {
        window.addEventListener(type, function () { userScrolled = true; },
          { passive: true, once: true });
      });
      target.scrollIntoView({ behavior: "instant", block: "start" });
      target.classList.add("search-target");
      if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(function () {
          if (!userScrolled) target.scrollIntoView({ behavior: "instant", block: "start" });
        });
      }
    }());

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

    /* The claims stores join the index when they arrive: search keeps working
       over the dossier sections alone until then (and if a fetch fails).
       claims.json holds the hand-maintained records; corpus-claims.json is
       the generated wider corpus (TEI simples, Galen's materia). They load
       together because the corpus rows borrow recipe-layer membership from
       the ingredient they share with the recipes. */
    var claimEntries = [];
    function fetchJSON(url) {
      return fetch(url + "?v=" + encodeURIComponent(window.ASSET_VERSION || ""))
        .then(function (response) { return response.ok ? response.json() : null; })
        .catch(function () { return null; });
    }
    Promise.all([fetchJSON("data/claims.json"), fetchJSON("data/corpus-claims.json")])
      .then(function (loaded) {
        var data = loaded[0];
        var corpus = loaded[1];
        if (!data) return;
        var evidenceLabel = { ancient: "ancient", modern: "inference", theology: "theology" };
        var recipesByIngredient = {};
        data.ingredients.concat(data.contextIngredients, [data.theology]).forEach(function (ingredient) {
          recipesByIngredient[ingredient.id] = ingredient.recipes;
        });
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
        // Every plotted material's catalogue entry gets a jump onto the map,
        // landing with the ingredient selected and all its claims framed.
        // H3s only: that is the Part II shelf — context anchors point at
        // prose sections where a map chip would dangle oddly.
        data.ingredients.concat(data.contextIngredients, [data.theology]).forEach(function (ingredient) {
          if (!ingredient.claims.length || !ingredient.dossierAnchor) return;
          var heading = document.getElementById(ingredient.dossierAnchor);
          if (!heading || heading.tagName !== "H3") return;
          var link = document.createElement("a");
          link.className = "entry-map-link";
          link.href = "map/#ingredient-" + encodeURIComponent(ingredient.id);
          link.textContent = ingredient.claims.length + (ingredient.claims.length === 1 ? " claim" : " claims") + " on the map →";
          heading.appendChild(link);
        });
        if (corpus) {
          // TEI-verified simples claims join the provenance group; their rows
          // link out to the accepted Pleiades place.
          (corpus.simples || []).forEach(function (record) {
            claimEntries.push({
              group: "map",
              title: record.place.name,
              sub: record.lemmaEn + " — " + record.relation.replace(/_/g, " ")
                + (record.qualifier ? " (" + record.qualifier + ")" : "") + " · TEI-verified",
              cite: record.cite,
              chip: "attested",
              chipClass: "ancient",
              evidence: "ancient",
              recipes: record.ingredientRef ? (recipesByIngredient[record.ingredientRef] || []) : [],
              href: record.place.pleiadesUri,
              folded: fold([record.place.name, record.place.surface, record.lemma,
                record.lemmaEn, record.cite, record.relation, record.qualifier || ""].join(" "))
            });
          });
          // Galen's autopsy and supply testimony is its own register: the
          // Greek evidence phrase is indexed, so unaccented Greek finds it.
          (corpus.galen || []).forEach(function (record) {
            claimEntries.push({
              group: "galen",
              title: record.place.name,
              sub: record.name + " (" + record.greekName + ") — " + record.relation.replace(/_/g, " "),
              cite: record.cite,
              chip: record.relation.replace(/_/g, " "),
              chipClass: "galen",
              href: record.place.pleiadesUri,
              folded: fold([record.place.name, record.name, record.greekName,
                record.cite, record.relation, record.evidencePhrase || ""].join(" "))
            });
          });
        }
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
      measureBar();
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
      [["all", "All"], ["sections", "Text"], ["map", "Claims"], ["court", "Queens"], ["galen", "Galen"]].forEach(function (option) {
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
      measureBar();
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
      var browsing = !querying && (scope === "map" || scope === "court" || scope === "galen");
      if (!querying && !browsing) {
        summary.hidden = true;
        results.hidden = true;
        results.textContent = "";
        measureBar();
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
      var galenHits = (scope === "all" || scope === "galen")
        ? claimEntries.filter(function (e) {
            return e.group === "galen" && (!querying || e.folded.indexOf(fq) >= 0);
          })
        : [];
      var total = sectionHits.length + mapHits.length + courtHits.length + galenHits.length;
      var mapCap = browsing ? 12 : 8;
      var courtCap = browsing ? 16 : 6;
      var galenCap = browsing ? 14 : 6;
      var shown = Math.min(sectionHits.length, 8)
        + Math.min(mapHits.length, mapCap)
        + Math.min(courtHits.length, courtCap)
        + Math.min(galenHits.length, galenCap);
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
        appendGroupLabel("Provenance claims");
        mapHits.slice(0, mapCap).forEach(function (entry) { appendRow(claimRow(entry)); });
      }
      if (courtHits.length) {
        appendGroupLabel("Queens’ fragments — court records");
        courtHits.slice(0, courtCap).forEach(function (entry) { appendRow(claimRow(entry)); });
      }
      if (galenHits.length) {
        appendGroupLabel("Galen — observed, acquired, sourced");
        galenHits.slice(0, galenCap).forEach(function (entry) { appendRow(claimRow(entry)); });
      }
      measureBar();
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


  /* ————— Figure lightbox —————
     Every photograph in the dossier opens full size in one overlay
     carousel, in document order: the nineteen ingredient views first, then
     the two Louvre reliefs. One list rather than one per figure group, so a
     reader who opens a picture can keep going through all of them without
     closing and hunting for the next gallery.

     Each slide carries the name of what it belongs to — the ingredient
     heading, or the section heading for the reliefs — because at twenty-one
     images deep a bare "14 / 21" tells you nothing about where you are.

     The media area is a three-slide rail (previous, current, next) that
     follows the finger and settles, so a swipe is the gesture itself rather
     than a jump after the fact. The rail is a fixed box and the photographs
     contain inside it: twenty-one images of very different shapes would
     otherwise resize the whole dialog on every step.

     Progressive enhancement throughout: the markup ships as plain figures,
     and this pass wraps each image in a real <button> so it is focusable,
     announced, and driven by Enter/Space for free rather than by a click
     handler bolted onto an <img>. */
  (function () {
    "use strict";

    var figures = [].slice.call(document.querySelectorAll(
      ".relief-gallery figure, .ingredient-images figure"));
    if (!figures.length) return;

    /* The label for a slide: an ingredient card names itself in its copy
       heading; anything else takes the nearest heading above its gallery. */
    function labelFor(figure) {
      var card = figure.closest(".ingredient-card");
      var own = card && card.querySelector(".ingredient-copy h4");
      if (own) return own.textContent.trim();
      var gallery = figure.closest(".relief-gallery, .ingredient-images") || figure;
      var node = gallery;
      while (node) {
        while (node.previousElementSibling) {
          node = node.previousElementSibling;
          if (/^H[1-6]$/.test(node.tagName)) {
            // Section headings carry a numeral and the Greek; the English
            // name before the first bracket or dash is enough of a label.
            return node.textContent.trim().split(/[(—]/)[0]
              .replace(/^\s*\d+\.\s*/, "").trim();
          }
        }
        node = node.parentElement;
        if (node === document.body) break;
      }
      return "";
    }

    var items = figures.map(function (figure) {
      var img = figure.querySelector("img");
      if (!img) return null;
      return {
        img: img,
        caption: figure.querySelector("figcaption"),
        label: labelFor(figure)
      };
    }).filter(Boolean);
    if (!items.length) return;

    var reduceMotion = window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    /* ————— The overlay ————— */
    var box = document.createElement("div");
    box.className = "lightbox";
    box.hidden = true;
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-modal", "true");
    box.setAttribute("aria-label", "Image viewer");
    box.innerHTML =
      '<div class="lightbox-backdrop" data-lightbox-close></div>' +
      '<div class="lightbox-stage">' +
        '<div class="lightbox-bar">' +
          '<p class="lightbox-count" aria-live="polite">' +
            '<span class="lightbox-index"></span>' +
            '<span class="lightbox-label"></span>' +
          '</p>' +
          '<button type="button" class="lightbox-btn lightbox-close" ' +
            'data-lightbox-close aria-label="Close image viewer">&times;</button>' +
        '</div>' +
        '<div class="lightbox-frame">' +
          '<button type="button" class="lightbox-btn lightbox-step lightbox-prev" ' +
            'aria-label="Previous image">&lsaquo;</button>' +
          '<figure class="lightbox-figure">' +
            '<div class="lightbox-viewport">' +
              '<div class="lightbox-rail">' +
                '<img class="lightbox-slide" alt="" aria-hidden="true">' +
                '<img class="lightbox-slide lightbox-img" alt="">' +
                '<img class="lightbox-slide" alt="" aria-hidden="true">' +
              '</div>' +
            '</div>' +
            '<figcaption class="lightbox-caption"></figcaption>' +
          '</figure>' +
          '<button type="button" class="lightbox-btn lightbox-step lightbox-next" ' +
            'aria-label="Next image">&rsaquo;</button>' +
        '</div>' +
        '<div class="lightbox-thumbs" aria-label="All images in the dossier"></div>' +
      '</div>';
    document.body.appendChild(box);

    var elViewport = box.querySelector(".lightbox-viewport");
    var elRail = box.querySelector(".lightbox-rail");
    var slides = [].slice.call(box.querySelectorAll(".lightbox-slide"));
    var elCaption = box.querySelector(".lightbox-caption");
    var elIndex = box.querySelector(".lightbox-index");
    var elLabel = box.querySelector(".lightbox-label");
    var elThumbs = box.querySelector(".lightbox-thumbs");

    var openIndex = 0;
    var lastFocus = null;
    var pendingLand = null;
    var thumbs = [];

    function at(index) { return items[(index % items.length + items.length) % items.length]; }

    /* One strip of every image, built once. The thumbnails borrow the
       page's own <img> sources, so they are already in cache. */
    items.forEach(function (item, i) {
      var thumb = document.createElement("button");
      thumb.type = "button";
      thumb.className = "lightbox-thumb";
      thumb.setAttribute("aria-label",
        (i + 1) + ". " + (item.label || item.img.alt || "Image"));
      var thumbImg = document.createElement("img");
      thumbImg.src = item.img.src;
      thumbImg.alt = "";
      thumbImg.loading = "lazy";
      thumb.appendChild(thumbImg);
      thumb.addEventListener("click", function () { jump(i); });
      elThumbs.appendChild(thumb);
      thumbs.push(thumb);
    });

    /* Keep the live thumbnail in view without ever scrolling the page:
       the strip's own scrollLeft, never scrollIntoView. */
    function revealThumb(thumb) {
      var strip = elThumbs.getBoundingClientRect();
      var t = thumb.getBoundingClientRect();
      if (t.left < strip.left) {
        elThumbs.scrollLeft -= (strip.left - t.left) + 12;
      } else if (t.right > strip.right) {
        elThumbs.scrollLeft += (t.right - strip.right) + 12;
      }
    }

    /* Offset from the centred position: "34px" mid-drag, "-100%" for a
       completed step, "" to sit back on the stylesheet's own centring. */
    function setDrag(value) {
      elRail.style.transform = value
        ? "translate3d(calc(-100% + " + value + "), 0, 0)"
        : "";
    }

    /* Paint the rail for a position: the slide either side is loaded too,
       so a drag reveals a real neighbour rather than an empty gutter. */
    function paint(index) {
      openIndex = (index % items.length + items.length) % items.length;
      var item = at(openIndex);

      slides[0].src = at(openIndex - 1).img.src;
      slides[1].src = item.img.currentSrc || item.img.src;
      slides[2].src = at(openIndex + 1).img.src;
      slides[1].alt = item.img.alt || "";

      elCaption.textContent = "";
      if (item.caption) {
        [].slice.call(item.caption.cloneNode(true).childNodes)
          .forEach(function (node) { elCaption.appendChild(node); });
      }
      elCaption.hidden = !item.caption;

      elIndex.textContent = (openIndex + 1) + " / " + items.length;
      elLabel.textContent = item.label || "";

      thumbs.forEach(function (thumb, i) {
        var live = i === openIndex;
        thumb.setAttribute("aria-current", live ? "true" : "false");
        if (live) revealThumb(thumb);
      });

      elRail.classList.remove("is-sliding");
      setDrag("");
    }

    /* Animate one place along, then repaint centred on the new image.

       A step in flight is never a reason to drop the next one: a reader
       holding the arrow key, or swiping twice quickly, lands the current
       slide immediately and starts the next. The timer is a backstop for a
       transitionend that never arrives — some engines drop it for a
       compositor-driven transform — set just past the 240ms glide so the
       worst case is a beat late, not half a second. */
    function step(delta) {
      if (pendingLand) pendingLand();
      if (!delta) { settle(); return; }
      if (reduceMotion) { paint(openIndex + delta); return; }
      var from = openIndex;
      elRail.classList.add("is-sliding");
      setDrag(delta > 0 ? "-100%" : "100%");
      function land() {
        if (pendingLand !== land) return;
        pendingLand = null;
        elRail.removeEventListener("transitionend", land);
        paint(from + delta);
      }
      pendingLand = land;
      elRail.addEventListener("transitionend", land);
      setTimeout(land, 360);
    }

    /* Release below the threshold: slide back to centre. */
    function settle() {
      if (reduceMotion) { setDrag(""); return; }
      elRail.classList.add("is-sliding");
      setDrag("");
      setTimeout(function () { elRail.classList.remove("is-sliding"); }, 300);
    }

    function jump(index) {
      if (pendingLand) pendingLand();
      if (index === openIndex) return;
      paint(index);
    }

    function open(index, trigger) {
      lastFocus = trigger || null;
      box.hidden = false;
      document.documentElement.classList.add("lightbox-open");
      paint(index);
      box.querySelector(".lightbox-close").focus();
    }

    function close() {
      if (box.hidden) return;
      box.hidden = true;
      document.documentElement.classList.remove("lightbox-open");
      slides.forEach(function (slide) { slide.removeAttribute("src"); });
      if (lastFocus) lastFocus.focus();
      lastFocus = null;
    }

    box.querySelector(".lightbox-prev").addEventListener("click", function () { step(-1); });
    box.querySelector(".lightbox-next").addEventListener("click", function () { step(1); });
    box.addEventListener("click", function (event) {
      if (event.target.closest("[data-lightbox-close]")) close();
    });

    document.addEventListener("keydown", function (event) {
      if (box.hidden) return;
      if (event.key === "Escape") { event.preventDefault(); close(); return; }
      if (event.key === "ArrowRight") { event.preventDefault(); step(1); return; }
      if (event.key === "ArrowLeft") { event.preventDefault(); step(-1); return; }
      if (event.key === "Home") { event.preventDefault(); jump(0); return; }
      if (event.key === "End") { event.preventDefault(); jump(items.length - 1); return; }
      if (event.key !== "Tab") return;
      /* Focus stays inside the dialog while it is modal. The thumb strip is
         twenty-one buttons long, so it is skipped on Tab — the arrow keys
         and the strip's own click are the ways through it — and the cycle
         runs between the close button and the two step arrows. */
      var focusable = [].slice.call(box.querySelectorAll(
        ".lightbox-bar button, .lightbox-frame button, .lightbox-caption a"))
        .filter(function (node) { return node.offsetParent !== null; });
      if (!focusable.length) return;
      var first = focusable[0];
      var last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first.focus();
      }
    });

    /* ————— Drag —————
       The rail tracks the finger and settles on release: past the threshold
       it carries on to the neighbour, short of it it springs back. The
       viewport declares `touch-action: pan-y`, so the browser keeps
       vertical scrolling and hands us the horizontal axis — no
       preventDefault, and every listener stays passive.

       Axis is locked once per gesture on the first few pixels of movement,
       so a vertical drag started on the photograph scrolls the caption
       instead of dithering between the two. */
    var drag = null;

    function dragStart(x, y) {
      // A step still gliding lands now, so the finger takes over from where
      // the rail actually is rather than being ignored.
      if (pendingLand) pendingLand();
      elRail.classList.remove("is-sliding");
      drag = { x: x, y: y, dx: 0, axis: null };
    }

    function dragMove(x, y) {
      if (!drag) return;
      var dx = x - drag.x;
      var dy = y - drag.y;
      if (drag.axis === null) {
        if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
        drag.axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
      }
      if (drag.axis !== "x") return;
      drag.dx = dx;
      setDrag(dx + "px");
    }

    function dragEnd() {
      if (!drag) return;
      var dx = drag.axis === "x" ? drag.dx : 0;
      drag = null;
      if (!dx) return;
      var width = elViewport.clientWidth || 1;
      var threshold = Math.max(44, width * 0.16);
      if (dx <= -threshold) step(1);
      else if (dx >= threshold) step(-1);
      else settle();
    }

    elViewport.addEventListener("touchstart", function (event) {
      if (event.touches.length !== 1) { drag = null; return; }
      dragStart(event.touches[0].clientX, event.touches[0].clientY);
    }, { passive: true });
    elViewport.addEventListener("touchmove", function (event) {
      if (event.touches.length !== 1) return;
      dragMove(event.touches[0].clientX, event.touches[0].clientY);
    }, { passive: true });
    elViewport.addEventListener("touchend", dragEnd, { passive: true });
    elViewport.addEventListener("touchcancel", function () {
      if (drag) { drag = null; settle(); }
    }, { passive: true });

    /* The same gesture with a mouse or a trackpad-driven pointer, for a
       desktop reader who expects to be able to throw the picture aside. */
    elViewport.addEventListener("pointerdown", function (event) {
      if (event.pointerType === "touch" || event.button !== 0) return;
      dragStart(event.clientX, event.clientY);
      elViewport.setPointerCapture(event.pointerId);
    });
    elViewport.addEventListener("pointermove", function (event) {
      if (event.pointerType === "touch" || !drag) return;
      dragMove(event.clientX, event.clientY);
    });
    ["pointerup", "pointercancel"].forEach(function (type) {
      elViewport.addEventListener(type, function (event) {
        if (event.pointerType === "touch") return;
        dragEnd();
      });
    });
    // A drag that ends on the image must not also read as a click-through.
    elViewport.addEventListener("dragstart", function (event) { event.preventDefault(); });

    /* ————— Make every figure image a button ————— */
    items.forEach(function (item, index) {
      var img = item.img;
      var trigger = document.createElement("button");
      trigger.type = "button";
      trigger.className = "figure-zoom";
      trigger.setAttribute("aria-label",
        "View full size: " + (img.alt || item.label || "image " + (index + 1)));
      img.parentNode.insertBefore(trigger, img);
      trigger.appendChild(img);
      trigger.addEventListener("click", function () { open(index, trigger); });
    });
  }());

  /* ————— Theme —————
     Night follows the system by default; the toggle is an override the
     reader can set and unset, cycling system → light → dark → system.

     The stylesheet does the automatic half on its own, so a reader with no
     stored choice — and a reader with no JavaScript — still gets night on a
     dark system. This script exists for the override: it stamps data-theme,
     remembers it, keeps the browser-chrome colour in step, and returns to
     following the system when the cycle comes back round. The stamping
     itself happens in the page head, before first paint, so a stored choice
     never flashes the other palette first. */
  (function () {
    var toggle = document.getElementById("theme-toggle");
    var wrap = document.getElementById("rail-settings");
    if (!toggle || !wrap) return;

    var STORE = "mendes-theme";
    var ORDER = ["system", "light", "dark"];
    var LABEL = { system: "System", light: "Light", dark: "Dark" };
    var NEXT_SAYS = {
      system: "Switch to the light reading",
      light: "Switch to the night reading",
      dark: "Follow the system setting"
    };
    var GROUND = { light: "#F2EBDB", dark: "#0E2229" };

    var dark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)");
    var label = toggle.querySelector(".theme-toggle-label");

    function stored() {
      try {
        var value = localStorage.getItem(STORE);
        return ORDER.indexOf(value) > 0 ? value : "system";
      } catch (error) { return "system"; }
    }

    /* The colour behind the phone's own browser chrome, so the bar over the
       page matches the page rather than staying paper above a night read. */
    function paintChrome(mode) {
      var meta = document.querySelector('meta[name="theme-color"]');
      if (!meta) {
        meta = document.createElement("meta");
        meta.setAttribute("name", "theme-color");
        document.head.appendChild(meta);
      }
      var effective = mode === "system"
        ? (dark && dark.matches ? "dark" : "light")
        : mode;
      meta.setAttribute("content", GROUND[effective]);
    }

    function apply(mode) {
      if (mode === "system") document.documentElement.removeAttribute("data-theme");
      else document.documentElement.setAttribute("data-theme", mode);
      try {
        if (mode === "system") localStorage.removeItem(STORE);
        else localStorage.setItem(STORE, mode);
      } catch (error) { /* a private window still themes for this visit */ }
      label.textContent = LABEL[mode];
      toggle.setAttribute("aria-label",
        "Theme: " + LABEL[mode].toLowerCase() + ". " + NEXT_SAYS[mode] + ".");
      toggle.title = NEXT_SAYS[mode];
      paintChrome(mode);
    }

    apply(stored());
    wrap.hidden = false;

    toggle.addEventListener("click", function () {
      var mode = stored();
      apply(ORDER[(ORDER.indexOf(mode) + 1) % ORDER.length]);
    });

    // While following the system, a change of system setting moves the
    // chrome colour with it; the palette itself is the stylesheet's job.
    if (dark && dark.addEventListener) {
      dark.addEventListener("change", function () {
        if (stored() === "system") paintChrome("system");
      });
    }
  }());

  /* ————— Reading size —————
     The dossier is long and was set a notch small, so the baseline is a
     tenth larger than it was; this control moves it from there. It drives
     the root font size, so everything measured in rem — body copy, the
     headings, the rail, the captions — grows together rather than the body
     text drifting away from the furniture around it.

     Stamped in the page head before first paint, like the theme, so a
     stored size never reflows the page in front of the reader. */
  (function () {
    var toggle = document.getElementById("type-toggle");
    if (!toggle) return;

    var STORE = "mendes-type";
    var ORDER = ["standard", "large", "largest"];
    var SCALE = { standard: "1.1", large: "1.25", largest: "1.4" };
    var LABEL = { standard: "Standard", large: "Large", largest: "Largest" };
    var NEXT_SAYS = {
      standard: "Set larger text",
      large: "Set the largest text",
      largest: "Back to the standard text size"
    };

    var label = toggle.querySelector(".type-toggle-label");

    function stored() {
      try {
        var value = localStorage.getItem(STORE);
        return ORDER.indexOf(value) > 0 ? value : "standard";
      } catch (error) { return "standard"; }
    }

    function apply(size) {
      document.documentElement.setAttribute("data-type", size);
      document.documentElement.style.setProperty("--type-scale", SCALE[size]);
      try {
        if (size === "standard") localStorage.removeItem(STORE);
        else localStorage.setItem(STORE, size);
      } catch (error) { /* a private window still resizes for this visit */ }
      label.textContent = LABEL[size];
      toggle.setAttribute("aria-label",
        "Reading size: " + LABEL[size].toLowerCase() + ". " + NEXT_SAYS[size] + ".");
      toggle.title = NEXT_SAYS[size];
      // The phone bar's height is part of the type that just changed, and
      // anchor jumps have to clear whatever it now is.
      window.dispatchEvent(new Event("resize"));
    }

    apply(stored());

    toggle.addEventListener("click", function () {
      var size = stored();
      apply(ORDER[(ORDER.indexOf(size) + 1) % ORDER.length]);
    });
  }());
