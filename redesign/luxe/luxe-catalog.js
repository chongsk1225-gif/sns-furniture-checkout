/* Catalog search / browse: the whole visible catalog, searchable by name,
   collection, SKU, type or finish. Room and maker filters, sort and
   incremental "view more", all URL-addressable (?q= ?room= ?brand= ?collection=).
   Reads the derived data/catalog-cards.json (built from the unchanged catalog index). */
(function () {
  "use strict";
  var d = document, grid = d.querySelector("[data-grid]");
  if (!grid || d.body.getAttribute("data-page") !== "catalog") return;
  var qEl = d.querySelector("[data-q]"), sortEl = d.querySelector("[data-sort]");
  var roomEl = d.querySelector("[data-chips-room]"), brandEl = d.querySelector("[data-chips-brand]");
  var titleEl = d.querySelector("[data-title]"), countEl = d.querySelector("[data-count]");
  var moreBtn = d.querySelector("[data-more]"), noteEl = d.querySelector("[data-more-note]");
  var PAGE = 24, all = null, hay = null;
  var state = { q: "", room: null, brand: null, collection: null, sort: "featured", shown: PAGE };
  var BRANDS = { acme: "ACME Furniture", foa: "Furniture of America" };
  var ROOM_LABEL = { "Living Room": "Living", "Dining Room": "Dining", "Bedroom": "Bedroom", "Mattresses": "Mattresses", "Accent Furniture": "Accent", "Youth": "Youth", "Office": "Office", "Outdoor": "Outdoor", "Other": "Other" };
  var ROOM_ORDER = ["Living Room", "Dining Room", "Bedroom", "Mattresses", "Accent Furniture", "Youth", "Office", "Outdoor", "Other"];
  var DIAGRAM = /_(dim|feat|draw|spec|cc)(_\d+)?\.(jpe?g|png)$/i;
  var num = function (n) { return Number(n).toLocaleString("en-US"); };
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function price(n) { if (n == null) return "Price on request"; var v = Number(n); return "$" + v.toLocaleString("en-US", { minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2 }); }

  function readUrl() {
    var q = new URLSearchParams(location.search);
    state.q = (q.get("q") || "").trim();
    if (q.get("room") && ROOM_ORDER.indexOf(q.get("room")) >= 0) state.room = q.get("room");
    if (BRANDS[q.get("brand")]) state.brand = q.get("brand");
    state.collection = q.get("collection") || null;
    if (["price-asc", "price-desc", "name"].indexOf(q.get("sort")) >= 0) state.sort = q.get("sort");
    qEl.value = state.q; sortEl.value = state.sort;
  }
  function writeUrl() {
    var q = new URLSearchParams();
    if (state.q) q.set("q", state.q);
    if (state.collection) q.set("collection", state.collection);
    if (state.room) q.set("room", state.room);
    if (state.brand) q.set("brand", state.brand);
    if (state.sort !== "featured") q.set("sort", state.sort);
    var qs = q.toString();
    history.replaceState(null, "", location.pathname + (qs ? "?" + qs : ""));
  }
  function matches(extra) {
    var toks = state.q.toLowerCase().split(/\s+/).filter(Boolean);
    return all.filter(function (p, i) {
      if (state.collection && p.collection !== state.collection) return false;
      if (extra !== "room" && state.room && p.category !== state.room) return false;
      if (extra !== "brand" && state.brand && p.brand !== BRANDS[state.brand]) return false;
      for (var t = 0; t < toks.length; t++) if (hay[i].indexOf(toks[t]) < 0) return false;
      return true;
    });
  }
  var view = [], rendered = 0;
  function sorted(list) {
    if (state.sort === "price-asc") return list.slice().sort(function (a, b) { return (a.sale == null ? 1e9 : a.sale) - (b.sale == null ? 1e9 : b.sale); });
    if (state.sort === "price-desc") return list.slice().sort(function (a, b) { return (b.sale == null ? -1 : b.sale) - (a.sale == null ? -1 : a.sale); });
    if (state.sort === "name") return list.slice().sort(function (a, b) { return a.name.localeCompare(b.name); });
    return list;
  }
  function tile(p, n) {
    var eyebrow = p.collection ? esc(p.collection) + " collection" : esc(p.type || ROOM_LABEL[p.category] || "");
    var lazy = n < 6 ? "" : ' loading="lazy"', pri = n < 3 ? ' fetchpriority="high"' : "";
    return '<a class="lx-tile lx-reveal" href="' + LX.productUrl(p.sku) + '">' +
      '<span class="lx-tile__media">' + LX.tileImg(n, p.image, p.name) + '</span>' +
      '<span class="lx-tile__meta"><span class="lx-tile__eyebrow">' + eyebrow + '</span><span class="lx-tile__name">' + esc(p.name) + '</span><span class="lx-tile__price">' + price(p.sale) + '</span></span></a>';
  }
  function paint(reset) {
    if (reset) { grid.innerHTML = ""; rendered = 0; }
    var upto = Math.min(state.shown, view.length), html = "";
    for (var n = rendered; n < upto; n++) html += tile(view[n], n);
    var tmp = d.createElement("div"); tmp.innerHTML = html;
    [].slice.call(tmp.children).forEach(function (el) { grid.appendChild(el); if (window.LX) window.LX.observe(el); });
    rendered = upto;
    if (!view.length) grid.innerHTML = '<div class="lx-empty"><p>No pieces match.</p><p style="margin-top:14px"><a class="lx-textlink" href="catalog.html">Clear search</a></p></div>';
    countEl.textContent = num(view.length) + (view.length === 1 ? " piece" : " pieces");
    noteEl.textContent = view.length ? "Showing " + num(Math.min(rendered, view.length)) + " of " + num(view.length) : "";
    moreBtn.hidden = rendered >= view.length;
  }
  function heading() {
    var t = state.collection ? state.collection + " collection" : state.q ? "“" + state.q + "”" : "All stock furniture";
    titleEl.textContent = t;
    d.title = (state.collection ? state.collection + " collection" : state.q ? "Search: " + state.q : "Furniture Catalog") + " | SNS Furniture";
  }
  function chip(label, n, attr, val, on) {
    return '<button class="lx-chip" type="button" ' + attr + '="' + esc(val) + '" aria-pressed="' + on + '">' + esc(label) + '<span class="lx-chip__n">' + num(n) + '</span></button>';
  }
  function chips() {
    var forRoom = matches("room"), counts = {};
    forRoom.forEach(function (p) { counts[p.category] = (counts[p.category] || 0) + 1; });
    var h = chip("All rooms", forRoom.length, "data-room", "", state.room == null);
    ROOM_ORDER.forEach(function (r) { if (counts[r]) h += chip(ROOM_LABEL[r], counts[r], "data-room", r, state.room === r); });
    roomEl.innerHTML = h;
    var forBrand = matches("brand"), bc = { acme: 0, foa: 0 };
    forBrand.forEach(function (p) { if (p.brand === BRANDS.acme) bc.acme++; else bc.foa++; });
    brandEl.innerHTML = chip("All makers", forBrand.length, "data-brand", "", state.brand == null) +
      Object.keys(BRANDS).map(function (k) { return bc[k] ? chip(BRANDS[k], bc[k], "data-brand", k, state.brand === k) : ""; }).join("");
  }
  function apply() { view = sorted(matches()); state.shown = PAGE; heading(); chips(); paint(true); writeUrl(); }

  roomEl.addEventListener("click", function (e) { var b = e.target.closest(".lx-chip"); if (!b) return; state.room = b.getAttribute("data-room") || null; apply(); });
  brandEl.addEventListener("click", function (e) { var b = e.target.closest(".lx-chip"); if (!b) return; state.brand = b.getAttribute("data-brand") || null; apply(); });
  sortEl.addEventListener("change", function () { state.sort = sortEl.value; apply(); });
  var t = null;
  qEl.addEventListener("input", function () { clearTimeout(t); t = setTimeout(function () { state.q = qEl.value.trim(); state.collection = state.q ? null : state.collection; apply(); }, 140); });
  d.querySelector("[data-find-form]").addEventListener("submit", function (e) { e.preventDefault(); state.q = qEl.value.trim(); apply(); });
  moreBtn.addEventListener("click", function () { state.shown += PAGE; paint(false); });

  LX.cards()
    .then(function (rows) {
      if (!rows.length) throw new Error("no data");
      // featured order: priced items with a real (non-diagram) photo first
      all = rows.slice().sort(function (a, b) { return (DIAGRAM.test(a.image) ? 1 : 0) - (DIAGRAM.test(b.image) ? 1 : 0); });
      hay = all.map(function (p) { return (p.name + " " + p.type + " " + p.sku + " " + p.category + " " + (p.collection || "") + " " + (p.finish || "") + " " + (p.brand || "")).toLowerCase(); });
      readUrl(); apply();
    })
    .catch(function () { grid.innerHTML = '<p class="lx-empty">The catalog could not be loaded. Please refresh.</p>'; });
})();
