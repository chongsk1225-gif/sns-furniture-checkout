/* Collections index: one tile per named collection (lifestyle cover image),
   room filter, name search, incremental "view more". Data is the slim derived
   file data/collections-index.json; collection names are shown exactly as in
   the catalog. */
(function () {
  "use strict";
  var d = document, grid = d.querySelector("[data-cgrid]");
  if (!grid) return;
  var chipsEl = d.querySelector("[data-chips]"), findEl = d.querySelector("[data-find]");
  var countEl = d.querySelector("[data-count]"), moreBtn = d.querySelector("[data-more]"), noteEl = d.querySelector("[data-more-note]");
  var PAGE = 24, data = null, state = { room: null, q: "", shown: PAGE }, view = [], rendered = 0;
  var num = function (n) { return Number(n).toLocaleString("en-US"); };
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  var ORDER = ["Living", "Dining", "Bedroom", "Mattresses", "Accent", "Youth", "Office"];

  function readUrl() {
    var q = new URLSearchParams(location.search);
    if (q.get("room") && data.rooms.indexOf(q.get("room")) >= 0) state.room = q.get("room");
    if (q.get("find")) { state.q = q.get("find"); findEl.value = state.q; }
  }
  function writeUrl() {
    var q = new URLSearchParams();
    if (state.room) q.set("room", state.room);
    if (state.q) q.set("find", state.q);
    var qs = q.toString();
    history.replaceState(null, "", location.pathname + (qs ? "?" + qs : ""));
  }
  function filtered() {
    var q = state.q.trim().toLowerCase();
    return data.items.filter(function (r) {
      return (!state.room || r[2].indexOf(state.room) >= 0) && (!q || r[0].toLowerCase().indexOf(q) >= 0);
    });
  }
  function tile(r, n) {
    var lazy = n < 6 ? "" : ' loading="lazy"', pri = n < 3 ? ' fetchpriority="high"' : "";
    return '<a class="lx-tile lx-reveal" href="catalog.html?collection=' + encodeURIComponent(r[0]) + '">' +
      '<span class="lx-tile__media">' + LX.tileImg(n, r[3], r[0] + " collection") + '</span>' +
      '<span class="lx-tile__meta"><span class="lx-tile__eyebrow">' + esc(r[2].slice().sort(function (a, b) { return ORDER.indexOf(a) - ORDER.indexOf(b); }).join(" · ")) + '</span>' +
      '<span class="lx-tile__name">' + esc(r[0]) + '</span><span class="lx-tile__price">' + num(r[1]) + ' pieces</span></span></a>';
  }
  function paint(reset) {
    if (reset) { grid.innerHTML = ""; rendered = 0; }
    var upto = Math.min(state.shown, view.length), html = "";
    for (var n = rendered; n < upto; n++) html += tile(view[n], n);
    var tmp = d.createElement("div"); tmp.innerHTML = html;
    [].slice.call(tmp.children).forEach(function (el) { grid.appendChild(el); if (window.LX) window.LX.observe(el); });
    rendered = upto;
    if (!view.length) grid.innerHTML = '<p class="lx-empty">No collections match.</p>';
    countEl.textContent = num(view.length) + (view.length === 1 ? " collection" : " collections");
    noteEl.textContent = view.length ? "Showing " + num(Math.min(rendered, view.length)) + " of " + num(view.length) : "";
    moreBtn.hidden = rendered >= view.length;
  }
  function apply() { view = filtered(); state.shown = PAGE; paint(true); writeUrl(); }
  function chips() {
    var rooms = data.rooms.filter(function (r) { return ORDER.indexOf(r) >= 0; }).sort(function (a, b) { return ORDER.indexOf(a) - ORDER.indexOf(b); });
    var h = '<button class="lx-chip" type="button" data-r="" aria-pressed="' + (state.room == null) + '">All<span class="lx-chip__n">' + num(data.items.length) + '</span></button>';
    rooms.forEach(function (r) {
      var n = data.items.filter(function (x) { return x[2].indexOf(r) >= 0; }).length;
      h += '<button class="lx-chip" type="button" data-r="' + esc(r) + '" aria-pressed="' + (state.room === r) + '">' + esc(r) + '<span class="lx-chip__n">' + num(n) + '</span></button>';
    });
    chipsEl.innerHTML = h;
  }
  chipsEl.addEventListener("click", function (e) {
    var b = e.target.closest(".lx-chip"); if (!b) return;
    state.room = b.getAttribute("data-r") || null;
    [].forEach.call(chipsEl.querySelectorAll(".lx-chip"), function (c) { c.setAttribute("aria-pressed", String(c === b)); });
    apply();
  });
  var t = null;
  findEl.addEventListener("input", function () { clearTimeout(t); t = setTimeout(function () { state.q = findEl.value; apply(); }, 120); });
  moreBtn.addEventListener("click", function () { state.shown += PAGE; paint(false); });

  fetch("data/collections-index.json")
    .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(function (j) { data = j; readUrl(); chips(); apply(); })
    .catch(function () { grid.innerHTML = '<p class="lx-empty">Collections could not be loaded. <a class="lx-textlink" href="catalog.html">View all stock furniture</a></p>'; });
})();
