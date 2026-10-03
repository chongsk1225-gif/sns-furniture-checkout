/* Custom Furniture page: renders ONLY confirmed options from
   data/luxe-custom.json. Until confirmed, the public page shows nothing about
   specific options; review mode (default in this prototype, hidden with
   ?clean=1) shows labeled empty slots so the intended structure is visible. */
(function () {
  "use strict";
  var host = document.querySelector("[data-custom-options]");
  if (!host) return;
  var REVIEW_GROUPS = ["Dimensions", "Fabric & upholstery", "Leather", "Finish", "Configuration", "Other selections"];
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }

  function review() {
    host.innerHTML = REVIEW_GROUPS.map(function (g) {
      return '<div class="lx-slot" data-review-only>Option group slot<br>' + esc(g) + '<br>(pending confirmation)</div>';
    }).join("");
  }
  fetch("data/luxe-custom.json")
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (cfg) {
      if (cfg && cfg.confirmed === true && cfg.groups && cfg.groups.length) {
        host.innerHTML = cfg.groups.map(function (g) {
          var opts = (g.options || []).map(function (o) {
            return o.image ? '<img src="' + esc(o.image) + '" alt="' + esc(o.label || "") + '" loading="lazy" width="120" height="120">' : "";
          }).join("");
          return '<div class="lx-group lx-reveal"><h3>' + esc(g.label) + '</h3>' + (g.summary ? '<p>' + esc(g.summary) + '</p>' : "") + (opts ? '<div>' + opts + '</div>' : "") + '</div>';
        }).join("");
        [].forEach.call(host.querySelectorAll(".lx-reveal"), function (el) { window.LX && window.LX.observe(el); });
      } else {
        review();
      }
    })
    .catch(review);
})();
