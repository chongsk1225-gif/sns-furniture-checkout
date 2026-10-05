/* Product page behavior. The page itself (name, price, specifications, gallery,
   structured data, related products) is server-rendered HTML from lib/product-view.mjs, so
   it is fully readable without JavaScript. This script only adds: full-screen viewer
   (keyboard, touch, focus trap), add to cart, thumbnail navigation, the mobile buy bar and
   the swipe counter. */
(function () {
  "use strict";
  var d = document, main = d.querySelector("[data-pdp]");
  if (!main) return;
  var reduce = !!(window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches);
  var sku = main.getAttribute("data-sku") || "";

  /* ---------- full-screen viewer ---------- */
  var figs = [].slice.call(main.querySelectorAll("[data-lb]"));
  var lb = figs.map(function (f) { var im = f.querySelector("img"); return { src: im.currentSrc || im.src, alt: im.alt }; });
  var box = d.querySelector("[data-lightbox]"), bimg = d.querySelector("[data-lb-img]"), bcount = d.querySelector("[data-lb-count]"), cur = 0, opener = null;
  function show(i) { if (!lb.length) return; bimg.classList.remove("is-zoomed"); cur = (i + lb.length) % lb.length; bimg.src = figs[cur].querySelector("img").currentSrc || lb[cur].src; bimg.alt = lb[cur].alt; bcount.textContent = (cur + 1) + " / " + lb.length; }
  function open(i, from) { opener = from; show(i); box.hidden = false; d.documentElement.classList.add("lx-lock"); d.querySelector(".lx-lightbox__close").focus(); }
  function close() { box.hidden = true; d.documentElement.classList.remove("lx-lock"); if (opener) opener.focus(); }
  if (box && lb.length) {
    main.addEventListener("click", function (e) { var b = e.target.closest("[data-lb]"); if (b) open(Number(b.getAttribute("data-lb")), b); });
    d.querySelector("[data-lb-close]").addEventListener("click", close);
    d.querySelector("[data-lb-prev]").addEventListener("click", function () { show(cur - 1); });
    d.querySelector("[data-lb-next]").addEventListener("click", function () { show(cur + 1); });
    box.addEventListener("click", function (e) { if (e.target === box) close(); });
    // click / tap the enlarged image to zoom to 2x around the pointer; only when the file has the pixels
    bimg.addEventListener("click", function (e) {
      if (bimg.classList.contains("is-zoomed")) { bimg.classList.remove("is-zoomed"); bimg.style.transformOrigin = ""; return; }
      if (bimg.naturalWidth && bimg.naturalWidth >= bimg.clientWidth * 1.8) {
        var r = bimg.getBoundingClientRect();
        bimg.style.transformOrigin = ((e.clientX - r.left) / r.width * 100) + "% " + ((e.clientY - r.top) / r.height * 100) + "%";
        bimg.classList.add("is-zoomed");
      }
    });
    var tx = null;
    box.addEventListener("touchstart", function (e) { tx = e.changedTouches[0].clientX; }, { passive: true });
    box.addEventListener("touchend", function (e) { if (tx == null) return; var dx = e.changedTouches[0].clientX - tx; if (Math.abs(dx) > 45) show(cur + (dx < 0 ? 1 : -1)); tx = null; }, { passive: true });
    d.addEventListener("keydown", function (e) {
      if (box.hidden) return;
      if (e.key === "Escape") close(); else if (e.key === "ArrowLeft") show(cur - 1); else if (e.key === "ArrowRight") show(cur + 1);
      else if (e.key === "Tab") { var f = [].slice.call(box.querySelectorAll("button")); var i = f.indexOf(d.activeElement); e.preventDefault(); f[(i + (e.shiftKey ? -1 : 1) + f.length) % f.length].focus(); }
    });
  }

  /* ---------- add to cart ---------- */
  [].forEach.call(d.querySelectorAll("[data-add]"), function (b) {
    b.addEventListener("click", function () {
      if (typeof SnsCart === "undefined") { location.href = "/cart.html"; return; }
      SnsCart.add(b.getAttribute("data-sku") || sku, 1);
      [].forEach.call(d.querySelectorAll("[data-add]"), function (x) { x.textContent = "Added"; setTimeout(function () { x.textContent = "Add to cart"; }, 1600); });
      var a = main.querySelector("[data-added]"); if (a) a.hidden = false;
    });
  });

  /* ---------- mobile buy bar: appears once the main actions scroll away ---------- */
  var bar = d.querySelector("[data-buybar]"), acts = main.querySelector("[data-actions]");
  if (bar && acts && "IntersectionObserver" in window) new IntersectionObserver(function (es) { bar.classList.toggle("is-visible", !es[0].isIntersecting && es[0].boundingClientRect.top < 0); }).observe(acts);

  /* ---------- thumbnails ---------- */
  var thumbs = main.querySelector("[data-thumbs]");
  if (thumbs) {
    thumbs.addEventListener("click", function (e) {
      var more = e.target.closest("[data-lb-open]"); if (more) { open(8, more); return; }
      var b = e.target.closest("[data-goto]"); if (!b) return;
      var fig = main.querySelector('[data-lb="' + b.getAttribute("data-goto") + '"]'); if (!fig) return;
      if (matchMedia("(min-width: 901px)").matches) window.scrollTo({ top: fig.getBoundingClientRect().top + scrollY - 150, behavior: reduce ? "auto" : "smooth" });
      else fig.scrollIntoView({ behavior: reduce ? "auto" : "smooth", inline: "start", block: "nearest" });
    });
    if ("IntersectionObserver" in window) {
      var seen = new IntersectionObserver(function (es) {
        es.forEach(function (en) {
          if (!en.isIntersecting) return;
          var n = en.target.getAttribute("data-lb");
          [].forEach.call(thumbs.querySelectorAll("[data-goto]"), function (t) { if (t.getAttribute("data-goto") === n) t.setAttribute("aria-current", "true"); else t.removeAttribute("aria-current"); });
        });
      }, { rootMargin: "-35% 0px -55% 0px", threshold: 0 });
      figs.forEach(function (f) { seen.observe(f); });
    }
  }

  /* ---------- swipe counter (phones) ---------- */
  var track = main.querySelector("[data-track]"), counter = main.querySelector("[data-counter]"), n = figs.length;
  function tick() { var w = track.clientWidth || 1; counter.textContent = (Math.min(n, Math.round(track.scrollLeft / w) + 1)) + " / " + n; }
  if (track && counter && n > 1) { tick(); track.addEventListener("scroll", function () { requestAnimationFrame(tick); }, { passive: true }); }
})();
