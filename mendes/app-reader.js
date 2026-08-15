
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

    var searchBox = document.getElementById("rail-search");
    var input = document.getElementById("dossier-search");
    var summary = document.getElementById("rail-search-summary");
    var results = document.getElementById("rail-search-results");
    if (!searchBox || !input) return;
    searchBox.hidden = false;

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
    function jumpTo(section) {
      section.el.scrollIntoView({ block: "start" });
      section.el.classList.remove("search-target");
      void section.el.offsetWidth;
      section.el.classList.add("search-target");
      if (history.replaceState) history.replaceState(null, "", "#" + section.id);
    }
    function runSearch() {
      var q = input.value.trim();
      if (q.length < 2) {
        summary.hidden = true;
        results.hidden = true;
        results.textContent = "";
        return;
      }
      var fq = fold(q);
      var hits = [];
      sections.forEach(function (s) {
        var inTitle = s.foldedTitle.indexOf(fq) >= 0;
        var inBody = s.foldedBody.indexOf(fq) >= 0;
        if (inTitle || inBody) hits.push({ s: s, weight: inTitle ? 0 : 1 });
      });
      hits.sort(function (a, b) { return a.weight - b.weight; });
      summary.hidden = false;
      summary.textContent = hits.length
        ? hits.length + (hits.length === 1 ? " section" : " sections")
        : "No matches";
      results.textContent = "";
      results.hidden = hits.length === 0;
      hits.slice(0, 12).forEach(function (hit) {
        var li = document.createElement("li");
        var btn = document.createElement("button");
        btn.type = "button";
        btn.className = "rail-search-result";
        var title = document.createElement("span");
        title.className = "result-title";
        title.textContent = hit.s.title;
        btn.appendChild(title);
        btn.appendChild(highlight(snippet(hit.s, fq, q), q));
        btn.addEventListener("click", function () { jumpTo(hit.s); });
        li.appendChild(btn);
        results.appendChild(li);
      });
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
