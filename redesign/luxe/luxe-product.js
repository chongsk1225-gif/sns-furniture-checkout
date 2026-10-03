/* Luxury product page. Reads the SAME product data the existing page uses
   (data/details/<first-char>.json) plus the optional per-SKU luxury media
   manifest (data/luxe-media.json). Nothing here modifies product data. */
(function () {
  "use strict";
  var d = document, main = d.querySelector("[data-pdp]");
  if (!main) return;
  var sku = window.__lxSku || (new URLSearchParams(location.search).get("sku") || "LV02404").trim();
  var reduce = !!(window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches);
  var DIAGRAM = /_(dim|feat|draw|spec|cc)(_\d+)?\.(jpe?g|png)$/i, LIFE = /_life\.(jpe?g|png)$/i;
  var DELIVERY = "Ask about delivery options for this item. California is our primary service area; qualifying nationwide delivery may be available depending on the product and destination.";
  var CHECKOUT_NOTE = "Online payment covers merchandise, applicable sales tax, and a flat $150 delivery fee. Online checkout is available for California delivery addresses only.";

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function price(n) { if (n == null) return "Price on request"; var v = Number(n); return "$" + v.toLocaleString("en-US", { minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2 }); }
  function base(u) { return String(u).split("/").pop(); }
  function weight(v) { var n = Number(v); return isFinite(n) && n > 0 ? (Math.round(n * 100) / 100) + " lbs" : ""; }
  function tidy(arr) {
    var out = [];
    (arr || []).filter(Boolean).forEach(function (f) {
      f = String(f).trim();
      if (f.length > 70 && !/[,;\n•]/.test(f)) f.replace(/([a-z)])([A-Z])/g, "$1\n$2").split("\n").forEach(function (x) { x = x.trim(); if (x) out.push(x); });
      else out.push(f);
    });
    return out;
  }

  Promise.all([
    window.__lxShard || fetch("data/details/" + encodeURIComponent(sku.charAt(0).toLowerCase()) + ".json").then(function (r) { return r.ok ? r.json() : []; }).catch(function () { return []; }),
    fetch("data/luxe-media.json").then(function (r) { return r.ok ? r.json() : {}; }).catch(function () { return {}; })
  ]).then(function (res) {
    var rec = (res[0] || []).filter(function (x) { return x.sku === sku; })[0];
    if (!rec) return missing();
    render(rec, (res[1] || {})[sku] || {});
  });

  function missing() {
    d.title = "Product not found | SNS Furniture";
    main.innerHTML = '<div class="lx-pdp__missing"><h1 class="lx-h2">Product not found</h1><p>This item may no longer be available.</p><a class="lx-btn" href="catalog.html">Return to the collection</a></div>';
  }

  /* ---------- media assembly ---------- */
  function buildMedia(p, m) {
    var gallery = (p.gallery && p.gallery.length ? p.gallery : [p.image]).filter(Boolean);
    var roles = m.roles || {}, used = Object.create(null);
    function resolve(ref) {
      if (!ref) return null;
      if (typeof ref === "object") ref = ref.src;
      if (/^(https?:)?\/\//.test(ref) || ref.charAt(0) === "/" || ref.indexOf("luxe/") === 0) return ref;
      return gallery.filter(function (u) { return base(u) === ref; })[0] || null;
    }
    function take(list) { var out = []; (list || []).forEach(function (r) { var u = resolve(r); if (u && !used[u]) { used[u] = 1; out.push(u); } }); return out; }
    var life, prod = [], detail = [], diagram;
    if (m.roles) { life = take(roles.lifestyle); prod = take(roles.product); detail = take(roles.detail); diagram = take(roles.diagram); }
    else {
      life = gallery.filter(function (u) { return LIFE.test(u); }); life.forEach(function (u) { used[u] = 1; });
      diagram = gallery.filter(function (u) { return !used[u] && DIAGRAM.test(u); }); diagram.forEach(function (u) { used[u] = 1; });
    }
    var rest = gallery.filter(function (u) { return !used[u]; });
    var name = p.name, items = [];
    (m.video || []).forEach(function (v) { items.push({ kind: "video", src: v.src, poster: v.poster, vtype: v.type, role: "scene", wide: true }); });
    life.forEach(function (u) { items.push({ kind: "img", src: u, role: "scene", wide: true, alt: name + ", in a room setting" }); });
    prod.forEach(function (u, i) { items.push({ kind: "img", src: u, role: "cutout", alt: name + ", view " + (i + 1) }); });
    detail.forEach(function (u) { items.push({ kind: "img", src: u, role: "cutout", alt: name + ", material and construction detail" }); });
    rest.forEach(function (u, i) { items.push({ kind: "img", src: u, role: "cutout", alt: name + ", photograph " + (i + 1) }); });
    ((roles.finish) || []).forEach(function (f) { var u = resolve(f); if (u) items.push({ kind: "img", src: u, role: "cutout", alt: name + " finish" + (f.label ? ": " + f.label : ""), cap: f.label }); });
    diagram.forEach(function (u) { items.push({ kind: "img", src: u, role: "diagram", wide: true, alt: name + " dimensions diagram", cap: "Dimensions" }); });
    if (items.length) items[0].wide = true;
    // pairing: any non-wide item left alone in a row becomes wide
    var pending = null;
    items.forEach(function (it) {
      if (it.wide) { if (pending) { pending.wide = true; pending = null; } }
      else if (pending) pending = null; else pending = it;
    });
    if (pending) pending.wide = true;
    return { items: items, hasLife: life.length > 0, hasDetail: detail.length > 0, hasVideo: (m.video || []).length > 0, hasFinish: (roles.finish || []).length > 0 };
  }

  /* ---------- render ---------- */
  function render(p, m) {
    var media = buildMedia(p, m), items = media.items, lb = [];
    var hide = m.hideSpecs || [];
    var cart = typeof SnsCart !== "undefined", canBuy = cart && p.sale != null && !p.hidden;
    var unverified = p.hidden || p.needs_review || !(p.image_verification && /official_multi|verified_single_image/.test(p.image_verification.status || ""));

    d.title = p.name + " | SNS Furniture";
    var mt = d.querySelector('meta[name="description"]');
    if (mt) mt.setAttribute("content", (p.description || (p.name + " from SNS Furniture.")).slice(0, 155));
    var cn = d.querySelector('link[rel="canonical"]');
    if (cn) cn.setAttribute("href", "https://snsfurniture.com/product.html?sku=" + encodeURIComponent(p.sku));
    var ld = { "@context": "https://schema.org", "@type": "Product", "name": p.name, "sku": p.sku, "category": p.category, "description": p.description, "image": p.gallery || [p.image], "brand": { "@type": "Brand", "name": p.brand || "Furniture of America" }, "seller": { "@id": "https://snsfurniture.com/#business" } };
    if (p.sale != null) ld.offers = { "@type": "Offer", "url": "https://snsfurniture.com/product.html?sku=" + encodeURIComponent(p.sku), "priceCurrency": "USD", "price": p.sale, "availability": "https://schema.org/LimitedAvailability", "seller": { "@id": "https://snsfurniture.com/#business" } };
    var s = d.createElement("script"); s.type = "application/ld+json"; s.textContent = JSON.stringify(ld); d.head.appendChild(s);

    var figs = items.map(function (it, i) {
      var cls = "lx-media" + (it.wide ? " lx-media--wide" : "") + " lx-media--" + it.role;
      if (it.kind === "video") {
        return '<figure class="' + cls + '" style="cursor:default"><video muted loop playsinline preload="none"' + (it.poster ? ' poster="' + esc(it.poster) + '"' : "") + ' data-src="' + esc(it.src) + '"' + (it.vtype ? ' data-type="' + esc(it.vtype) + '"' : "") + (reduce ? " controls" : "") + ' aria-label="' + esc(p.name) + ' film"></video></figure>';
      }
      lb.push({ src: it.src, alt: it.alt });
      var n = lb.length - 1, first = i === 0;
      return '<button type="button" class="' + cls + '" data-lb="' + n + '" aria-label="Enlarge: ' + esc(it.alt) + '"><img src="' + esc(it.src) + '" alt="' + esc(it.alt) + '"' + (first ? ' fetchpriority="high"' : ' loading="lazy"') + ' decoding="async">' + (it.cap ? '<span class="lx-media__cap">' + esc(it.cap) + "</span>" : "") + "</button>";
    }).join("");

    var slots = [];
    if (!media.hasVideo) slots.push("Cinematic furniture video");
    if (!media.hasLife) slots.push("Lifestyle / room scene");
    if (!media.hasDetail) slots.push("Material &amp; detail close-ups");
    if (!media.hasFinish) slots.push("Finish &amp; material imagery");
    slots.push("Custom options (when confirmed)");
    var slotRow = '<div class="lx-slots-row" data-review-only>' + slots.map(function (t) { return '<div class="lx-slot">Media slot<br>' + t + "<br>(pending asset)</div>"; }).join("") + "</div>";

    function spec(l, v) { return v ? "<dt>" + esc(l) + "</dt><dd>" + esc(v) + "</dd>" : ""; }
    var specs = spec("SKU", p.sku) + spec("Style", p.style) + spec("Finish", p.finish) + spec("Material", p.material) +
      (hide.indexOf("dimensions") < 0 ? spec("Dimensions", p.dimensions) : "") + spec("Weight", weight(p.netWeight)) + spec("Pack", p.pack);
    var feats = tidy(p.features);

    var inquire = "contact.html?product=" + encodeURIComponent(p.sku);
    var actions =
      (canBuy ? '<button class="lx-btn lx-btn--solid" type="button" data-add>Add to cart</button>' : "") +
      '<a class="lx-btn" href="' + inquire + '">Inquire</a>' +
      '<a class="lx-textlink" style="justify-self:center" href="tel:+14243106199">Call (424) 310-6199</a>';

    var info =
      '<p class="lx-eyebrow">' + esc(p.collection ? p.collection + " collection" : p.category) + "</p>" +
      '<h1 class="lx-pdp__title">' + esc(p.name) + "</h1>" +
      '<p class="lx-pdp__type">' + esc(p.type || "") + "</p>" +
      '<p class="lx-pdp__price">' + esc(price(p.sale)) + "</p>" +
      '<div class="lx-pdp__actions" data-actions>' + actions + "</div>" +
      '<p class="lx-pdp__note" data-added hidden><a class="lx-textlink" href="cart.html">View cart</a></p>' +
      '<p class="lx-pdp__note">' + esc(canBuy ? CHECKOUT_NOTE : "Delivery options depend on the item and destination. California is our primary service area.") + "</p>" +
      (unverified ? '<p class="lx-pdp__note">Photography for this item is pending verification.</p>' : "") +
      (p.description ? '<p class="lx-pdp__desc">' + esc(p.description) + "</p>" : "") +
      '<div class="lx-acc">' +
      (specs ? '<details open><summary>Details</summary><div class="lx-acc__body"><dl class="lx-spec">' + specs + "</dl></div></details>" : "") +
      (feats.length ? '<details><summary>Features</summary><div class="lx-acc__body"><ul class="lx-feat">' + feats.map(function (f) { return "<li>" + esc(f) + "</li>"; }).join("") + "</ul></div></details>" : "") +
      "<details><summary>Delivery</summary><div class=\"lx-acc__body\">" + esc(DELIVERY) + "</div></details></div>" +
      (p.collection ? '<p style="margin-top:28px"><a class="lx-textlink" href="catalog.html?q=' + encodeURIComponent(p.collection) + '">View the ' + esc(p.collection) + " collection</a></p>" : "");

    var roomLink = { "Living Room": ["living-room.html", "Living"], "Dining Room": ["dining-room.html", "Dining"], "Bedroom": ["bedroom.html", "Bedroom"] }[p.category];
    main.innerHTML =
      '<p class="lx-pdp__crumb"><a href="' + (roomLink ? roomLink[0] : "catalog.html") + '">&larr; ' + esc(roomLink ? roomLink[1] : "Collections") + "</a></p>" +
      '<div class="lx-pdp__layout"><div class="lx-pdp__mediawrap"><div class="lx-pdp__media" data-track>' + figs + slotRow + '</div><span class="lx-pdp__counter" data-counter aria-hidden="true"></span></div>' +
      '<div class="lx-pdp__info">' + info + "</div></div>";

    /* buy bar (mobile): price + primary action once the main actions scroll away */
    var bar = d.querySelector("[data-buybar]");
    if (bar) {
      bar.innerHTML = '<span class="lx-buybar__price">' + esc(price(p.sale)) + "</span>" +
        (canBuy ? '<button class="lx-btn lx-btn--solid" type="button" data-add>Add to cart</button>' : '<a class="lx-btn lx-btn--solid" href="' + inquire + '">Inquire</a>');
      var acts = main.querySelector("[data-actions]");
      if ("IntersectionObserver" in window && acts) new IntersectionObserver(function (es) { bar.classList.toggle("is-visible", !es[0].isIntersecting && es[0].boundingClientRect.top < 0); }).observe(acts);
    }

    /* add to cart */
    [].forEach.call(d.querySelectorAll("[data-add]"), function (b) {
      b.addEventListener("click", function () {
        SnsCart.add(p.sku, 1);
        [].forEach.call(d.querySelectorAll("[data-add]"), function (x) { x.textContent = "Added"; setTimeout(function () { x.textContent = "Add to cart"; }, 1600); });
        var a = main.querySelector("[data-added]"); if (a) a.hidden = false;
      });
    });

    /* lightbox */
    var box = d.querySelector("[data-lightbox]"), bimg = d.querySelector("[data-lb-img]"), bcount = d.querySelector("[data-lb-count]"), cur = 0, opener = null;
    function show(i) { cur = (i + lb.length) % lb.length; bimg.src = lb[cur].src; bimg.alt = lb[cur].alt; bcount.textContent = (cur + 1) + " / " + lb.length; }
    function open(i, from) { opener = from; show(i); box.hidden = false; d.documentElement.classList.add("lx-lock"); d.querySelector(".lx-lightbox__close").focus(); }
    function close() { box.hidden = true; d.documentElement.classList.remove("lx-lock"); if (opener) opener.focus(); }
    main.addEventListener("click", function (e) { var b = e.target.closest("[data-lb]"); if (b) open(Number(b.getAttribute("data-lb")), b); });
    d.querySelector("[data-lb-close]").addEventListener("click", close);
    d.querySelector("[data-lb-prev]").addEventListener("click", function () { show(cur - 1); });
    d.querySelector("[data-lb-next]").addEventListener("click", function () { show(cur + 1); });
    box.addEventListener("click", function (e) { if (e.target === box) close(); });
    d.addEventListener("keydown", function (e) {
      if (box.hidden) return;
      if (e.key === "Escape") close(); else if (e.key === "ArrowLeft") show(cur - 1); else if (e.key === "ArrowRight") show(cur + 1);
      else if (e.key === "Tab") { var f = [].slice.call(box.querySelectorAll("button")); var i = f.indexOf(d.activeElement); e.preventDefault(); f[(i + (e.shiftKey ? -1 : 1) + f.length) % f.length].focus(); }
    });

    /* mobile gallery counter */
    var track = main.querySelector("[data-track]"), counter = main.querySelector("[data-counter]");
    var nImgs = items.length;
    function tick() { var w = track.clientWidth || 1; counter.textContent = (Math.min(nImgs, Math.round(track.scrollLeft / w) + 1)) + " / " + nImgs; }
    if (track && counter) { tick(); track.addEventListener("scroll", function () { requestAnimationFrame(tick); }, { passive: true }); }

    /* cinematic video: play only while visible, never for reduced-motion */
    [].forEach.call(main.querySelectorAll("video[data-src]"), function (v) {
      if (reduce) { v.src = v.getAttribute("data-src"); return; }
      new IntersectionObserver(function (es) {
        es.forEach(function (e) {
          if (e.isIntersecting) { if (!v.src) v.src = v.getAttribute("data-src"); var pr = v.play(); if (pr && pr.catch) pr.catch(function () {}); } else v.pause();
        });
      }, { threshold: 0.25 }).observe(v);
    });
  }
})();
