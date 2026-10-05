/* Collection page: loads the slim per-room dataset, renders restrained tiles,
   type filter + sort (URL-addressable), and incremental "view more". */
(function () {
  "use strict";
  var d = document, slug = d.body.getAttribute("data-collection");
  if (!slug) return;
  var grid = d.querySelector("[data-grid]"), chipsEl = d.querySelector("[data-chips]"), sortEl = d.querySelector("[data-sort]");
  var countEl = d.querySelector("[data-count]"), moreBtn = d.querySelector("[data-more]"), noteEl = d.querySelector("[data-more-note]");
  var PAGE = 24, INTERLUDE_AFTER = 12;
  var data = null, state = { type: null, sort: "featured", shown: PAGE };

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function price(n) { if (n == null) return "Price on request"; var v = Number(n); return "$" + v.toLocaleString("en-US", { minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2 }); }
  function slugify(s) { return s.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""); }
  var num = function (n) { return Number(n).toLocaleString("en-US"); };

  function readUrl() {
    var q = new URLSearchParams(location.search), t = q.get("type"), s = q.get("sort");
    if (s === "price-asc" || s === "price-desc") state.sort = s;
    if (t) { var i = data.buckets.findIndex(function (b) { return slugify(b) === t; }); if (i >= 0) state.type = i; }
  }
  function writeUrl() {
    var q = new URLSearchParams();
    if (state.type != null) q.set("type", slugify(data.buckets[state.type]));
    if (state.sort !== "featured") q.set("sort", state.sort);
    var qs = q.toString();
    history.replaceState(null, "", location.pathname + (qs ? "?" + qs : ""));
  }

  function filtered() {
    var items = data.items;
    if (state.type != null) items = items.filter(function (i) { return i[6] === state.type; });
    if (state.sort === "price-asc") items = items.slice().sort(function (a, b) { return (a[4] || 0) - (b[4] || 0); });
    else if (state.sort === "price-desc") items = items.slice().sort(function (a, b) { return (b[4] || 0) - (a[4] || 0); });
    return items;
  }

  function tile(i, n) {
    var eyebrow = i[3] ? esc(i[3]) + " collection" : esc(i[2]);
    var pri = n < 3 ? ' fetchpriority="high"' : "";
    var lazy = n < 6 ? "" : ' loading="lazy"';
    return '<a class="lx-tile lx-reveal" href="' + LX.productUrl(i[0]) + '">' +
      '<span class="lx-tile__media">' + LX.tileImg(n, i[5], i[1]) + '</span>' +
      '<span class="lx-tile__meta"><span class="lx-tile__eyebrow">' + eyebrow + '</span><span class="lx-tile__name">' + esc(i[1]) + '</span><span class="lx-tile__price">' + price(i[4]) + '</span></span></a>';
  }
  function interlude() {
    var src = grid.getAttribute("data-interlude-src");
    if (!src) return "";
    return '<figure class="lx-interlude lx-reveal"><img src="' + esc(src) + '" width="1600" height="686" alt="' + esc(grid.getAttribute("data-interlude-alt") || "") + '" loading="lazy" decoding="async">' +
      '<span class="lx-interlude__scrim"></span><figcaption class="lx-interlude__copy"><p>' + esc(grid.getAttribute("data-interlude-text") || "") + '</p>' +
      '<a class="lx-btn lx-btn--light" href="/' + esc(grid.getAttribute("data-interlude-href") || "#") + '">' + esc(grid.getAttribute("data-interlude-cta") || "Explore") + '</a></figcaption></figure>';
  }

  var view = [], rendered = 0;
  function paint(reset) {
    if (reset) { grid.innerHTML = ""; rendered = 0; }
    var upto = Math.min(state.shown, view.length), html = "";
    for (var n = rendered; n < upto; n++) {
      html += tile(view[n], n);
      if (n === INTERLUDE_AFTER - 1 && view.length > INTERLUDE_AFTER + 3) html += interlude();
    }
    var tmp = d.createElement("div"); tmp.innerHTML = html;
    var added = [].slice.call(tmp.children);
    added.forEach(function (el) { grid.appendChild(el); if (window.LX) window.LX.observe(el); });
    rendered = upto;
    if (!view.length) grid.innerHTML = '<p class="lx-empty">No pieces match this selection.</p>';
    countEl.textContent = num(view.length) + (view.length === 1 ? " piece" : " pieces");
    noteEl.textContent = view.length ? "Showing " + num(Math.min(rendered, view.length)) + " of " + num(view.length) : "";
    moreBtn.hidden = rendered >= view.length;
  }
  function apply() { view = filtered(); state.shown = PAGE; paint(true); writeUrl(); }

  function buildChips() {
    var counts = data.buckets.map(function () { return 0; });
    data.items.forEach(function (i) { if (i[6] >= 0) counts[i[6]]++; });
    var h = '<button class="lx-chip" type="button" data-t="" aria-pressed="' + (state.type == null) + '">All<span class="lx-chip__n">' + num(data.items.length) + '</span></button>';
    data.buckets.forEach(function (b, idx) {
      if (!counts[idx]) return;
      h += '<button class="lx-chip" type="button" data-t="' + idx + '" aria-pressed="' + (state.type === idx) + '">' + esc(b) + '<span class="lx-chip__n">' + num(counts[idx]) + '</span></button>';
    });
    chipsEl.innerHTML = h;
  }
  chipsEl.addEventListener("click", function (e) {
    var b = e.target.closest(".lx-chip"); if (!b) return;
    state.type = b.getAttribute("data-t") === "" ? null : Number(b.getAttribute("data-t"));
    [].forEach.call(chipsEl.querySelectorAll(".lx-chip"), function (c) { c.setAttribute("aria-pressed", String(c === b)); });
    apply();
  });
  sortEl.addEventListener("change", function () { state.sort = sortEl.value; apply(); });
  moreBtn.addEventListener("click", function () { state.shown += PAGE; paint(false); });

  fetch("/data/collection-" + slug + ".json")
    .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(function (j) {
      data = j; readUrl(); sortEl.value = state.sort; buildChips();
      // The first rows are already real HTML from the server: adopt them instead of redrawing
      var ssr = grid.querySelectorAll(".lx-tile").length;
      if (ssr && state.type == null && state.sort === "featured") { view = filtered(); state.shown = PAGE; rendered = ssr; paint(false); }
      else apply();
    })
    .catch(function () {
      grid.innerHTML = '<p class="lx-empty">This collection could not be loaded. <a class="lx-textlink" href="catalog.html">View the full catalog</a></p>';
    });
})();
