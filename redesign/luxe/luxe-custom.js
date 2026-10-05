/* Custom Furniture and Design Services page behavior.
   1. Renders ONLY confirmed options from data/luxe-custom.json. Until
      SNS Furniture confirms what it offers (confirmed: true) the options
      section stays hidden: no option names, materials, fabrics or
      dimensions are ever shown, and no placeholder labels are shown to the
      public.
   2. Pre-fills the consultation form's reference field from ?reference= or ?product=. */
(function () {
  "use strict";
  var d = document;
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }

  var ref = d.getElementById("cf-ref");
  if (ref) {
    var q = new URLSearchParams(location.search), v = q.get("reference") || q.get("product");
    if (v && !ref.value) ref.value = v.slice(0, 120);
  }

  var host = d.querySelector("[data-custom-options]"), section = d.querySelector("[data-custom-options-section]");
  if (!host || !section) return;
  fetch("/data/luxe-custom.json")
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (cfg) {
      if (!cfg || cfg.confirmed !== true || !cfg.groups || !cfg.groups.length) return;
      host.innerHTML = cfg.groups.map(function (g) {
        var opts = (g.options || []).map(function (o) {
          return o.image ? '<img src="' + esc(o.image) + '" alt="' + esc(o.label || "") + '" loading="lazy" width="120" height="120">' : "";
        }).join("");
        return '<div class="lx-group lx-reveal"><h3>' + esc(g.label) + '</h3>' + (g.summary ? '<p>' + esc(g.summary) + '</p>' : "") + (opts ? '<div>' + opts + '</div>' : "") + '</div>';
      }).join("");
      section.hidden = false;
      [].forEach.call(host.querySelectorAll(".lx-reveal"), function (el) { if (window.LX) window.LX.observe(el); });
    })
    .catch(function () { /* stays hidden */ });
})();
