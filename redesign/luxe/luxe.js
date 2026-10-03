/* SNS Furniture luxury redesign - shared behavior. No dependencies.
   Header state, menu + search overlays (focus-trapped), scroll reveal,
   collections hover preview, and the hero media controller. */
(function () {
  "use strict";
  var d = document, root = d.documentElement, body = d.body;
  var reduce = !!(window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches);

  /* ---------- header: transparent over the hero, solid after it ---------- */
  var header = d.querySelector("[data-lx-header]");
  function setSolid(on) { if (header) header.classList.toggle("is-solid", on); }
  var heroEl = d.querySelector(".lx-hero, .lx-chero, .lx-open");
  if (!body.classList.contains("lx-overlay-header") || !heroEl) {
    setSolid(true);
  } else if ("IntersectionObserver" in window) {
    var hh = (header && header.offsetHeight) || 76;
    new IntersectionObserver(function (es) { setSolid(!es[0].isIntersecting); },
      { rootMargin: "-" + hh + "px 0px 0px 0px", threshold: 0 }).observe(heroEl);
  } else {
    addEventListener("scroll", function () { setSolid(scrollY > heroEl.offsetHeight - 80); }, { passive: true });
  }

  /* ---------- active nav ---------- */
  var navKey = body.getAttribute("data-nav");
  if (navKey) [].forEach.call(d.querySelectorAll('.lx-nav a[data-nav="' + navKey + '"]'), function (a) { a.setAttribute("aria-current", "page"); });

  /* ---------- cart link: only where the cart module exists ---------- */
  var cartLink = d.querySelector("[data-lx-cart]");
  if (cartLink) {
    if (typeof SnsCart === "undefined") cartLink.hidden = true;
    else if (typeof window.updateCartIndicator === "function") window.updateCartIndicator();
  }

  /* ---------- overlays (menu, search) with focus trap ---------- */
  var FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select,textarea,[tabindex]:not([tabindex="-1"])';
  function overlay(el, openers, closers, focusSel) {
    if (!el) return;
    var isOpen = false, lastFocus = null, timer = null;
    function show() {
      lastFocus = d.activeElement;
      clearTimeout(timer);
      el.hidden = false;
      root.classList.add("lx-lock");
      requestAnimationFrame(function () { el.classList.add("is-open"); });
      openers.forEach(function (b) { b.setAttribute("aria-expanded", "true"); });
      isOpen = true;
      setTimeout(function () { var f = el.querySelector(focusSel); if (f) f.focus(); }, 80);
    }
    function hide() {
      if (!isOpen) return;
      isOpen = false;
      el.classList.remove("is-open");
      root.classList.remove("lx-lock");
      openers.forEach(function (b) { b.setAttribute("aria-expanded", "false"); });
      timer = setTimeout(function () { if (!isOpen) el.hidden = true; }, reduce ? 0 : 520);
      if (lastFocus && lastFocus.focus) lastFocus.focus();
    }
    openers.forEach(function (b) { b.addEventListener("click", show); });
    closers.forEach(function (b) { b.addEventListener("click", hide); });
    el.addEventListener("keydown", function (e) {
      if (e.key === "Escape") { e.preventDefault(); hide(); return; }
      if (e.key !== "Tab") return;
      var f = [].filter.call(el.querySelectorAll(FOCUSABLE), function (n) { return n.offsetParent !== null; });
      if (!f.length) return;
      var first = f[0], last = f[f.length - 1];
      if (e.shiftKey && d.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && d.activeElement === last) { e.preventDefault(); first.focus(); }
    });
    el.addEventListener("click", function (e) { if (e.target.closest("a[href]")) { isOpen = false; root.classList.remove("lx-lock"); } });
  }
  function all(sel) { return [].slice.call(d.querySelectorAll(sel)); }
  overlay(d.getElementById("lx-menu"), all("[data-lx-menu-open]"), all("[data-lx-menu-close]"), ".lx-menu__close");
  overlay(d.getElementById("lx-search"), all("[data-lx-search-open]"), all("[data-lx-search-close]"), "#lx-search-input");

  /* ---------- sub-navigation + menu: mark the current page ---------- */
  var here = (location.pathname.split("/").pop() || "index.html");
  [].forEach.call(d.querySelectorAll("[data-lx-subnav] a, .lx-menu a"), function (a) {
    var href = (a.getAttribute("href") || "").split("?")[0];
    if (href === here) a.setAttribute("aria-current", "page");
  });

  /* ---------- search suggestions (catalog index is fetched only when typing starts) ---------- */
  var sInput = d.getElementById("lx-search-input"), sList = d.querySelector("[data-lx-suggest]");
  if (sInput && sList) {
    var index = null, loading = null, timer = null;
    var escH = function (s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
    var money = function (n) { if (n == null) return ""; var v = Number(n); return "$" + v.toLocaleString("en-US", { minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2 }); };
    var load = function () {
      if (index) return Promise.resolve(index);
      return loading || (loading = fetch("data/catalog-index.json").then(function (r) { return r.json(); }).then(function (rows) {
        index = rows.map(function (p) { return { p: p, h: (p.name + " " + p.type + " " + p.sku + " " + (p.collection || "") + " " + (p.finish || "")).toLowerCase() }; });
        return index;
      }).catch(function () { loading = null; return []; }));
    };
    var render = function () {
      var toks = sInput.value.toLowerCase().split(/\s+/).filter(Boolean);
      if (!toks.length || sInput.value.trim().length < 2) { sList.hidden = true; sList.innerHTML = ""; return; }
      load().then(function (rows) {
        var hits = [], total = 0;
        for (var i = 0; i < rows.length; i++) {
          var ok = true;
          for (var t = 0; t < toks.length; t++) if (rows[i].h.indexOf(toks[t]) < 0) { ok = false; break; }
          if (ok) { total++; if (hits.length < 6) hits.push(rows[i].p); }
        }
        if (sInput.value.toLowerCase().split(/\s+/).filter(Boolean).join(" ") !== toks.join(" ")) return;
        sList.innerHTML = hits.map(function (p) {
          return '<li><a href="product.html?sku=' + encodeURIComponent(p.sku) + '"><img src="' + escH(p.image) + '" alt="" width="56" height="56" loading="lazy" decoding="async"><span><span class="lx-suggest__name">' + escH(p.name) + '</span><span class="lx-suggest__meta">' + escH(p.collection ? p.collection + " collection" : p.type) + '</span></span><span class="lx-suggest__price">' + money(p.sale) + '</span></a></li>';
        }).join("") + (total ? '<li><a class="lx-suggest__all" href="catalog.html?q=' + encodeURIComponent(sInput.value.trim()) + '">See all ' + total.toLocaleString("en-US") + ' results</a></li>' : '<li><a class="lx-suggest__all" href="catalog.html">No matches — browse all stock furniture</a></li>');
        sList.hidden = false;
      });
    };
    sInput.addEventListener("input", function () { clearTimeout(timer); timer = setTimeout(render, 120); });
    sInput.addEventListener("focus", load);
    sInput.addEventListener("keydown", function (e) { if (e.key === "ArrowDown") { var a = sList.querySelector("a"); if (a) { e.preventDefault(); a.focus(); } } });
    sList.addEventListener("keydown", function (e) {
      var links = [].slice.call(sList.querySelectorAll("a")), i = links.indexOf(d.activeElement);
      if (e.key === "ArrowDown" && i < links.length - 1) { e.preventDefault(); links[i + 1].focus(); }
      else if (e.key === "ArrowUp") { e.preventDefault(); (i > 0 ? links[i - 1] : sInput).focus(); }
    });
  }

  /* ---------- scroll reveal ---------- */
  var io = null;
  function observe(el) {
    if (!el) return;
    if (el.querySelectorAll) [].forEach.call(el.querySelectorAll("img[data-src]"), lazyImg);
    if (reduce || !("IntersectionObserver" in window)) { el.classList.add("is-in"); return; }
    if (!io) {
      io = new IntersectionObserver(function (es) {
        es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add("is-in"); io.unobserve(e.target); } });
      }, { rootMargin: "0px 0px -6% 0px", threshold: 0.06 });
    }
    io.observe(el);
  }
  all(".lx-reveal, .lx-panel").forEach(observe);
  /* ---------- tile images: only the first row loads up front; the rest load as they approach the viewport ---------- */
  var GIF = "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==";
  var lazyIO = null;
  function lazyImg(img) {
    if (!img || !img.getAttribute("data-src")) return;
    if (!("IntersectionObserver" in window)) { img.src = img.getAttribute("data-src"); img.removeAttribute("data-src"); return; }
    if (!lazyIO) lazyIO = new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        if (!e.isIntersecting) return;
        var im = e.target; im.src = im.getAttribute("data-src"); im.removeAttribute("data-src"); lazyIO.unobserve(im);
      });
    }, { rootMargin: "320px 0px", threshold: 0 });
    lazyIO.observe(img);
  }
  function tileImg(n, src, alt) {
    var e = function (s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
    if (n < 4) return '<img src="' + e(src) + '" width="1000" height="1000" alt="' + e(alt) + '"' + (n < 2 ? ' fetchpriority="high"' : "") + ' decoding="async">';
    return '<img src="' + GIF + '" data-src="' + e(src) + '" width="1000" height="1000" alt="' + e(alt) + '" decoding="async">';
  }
  window.LX = { observe: observe, reduce: reduce, tileImg: tileImg };

  /* ---------- small verified images are shown at native size, never stretched ---------- */
  function markNative(img) {
    var box = img.closest && img.closest(".lx-tile, .lx-media");
    if (box && img.naturalWidth && img.naturalWidth <= 320) box.classList.add("is-native");
  }
  d.addEventListener("load", function (e) { if (e.target && e.target.tagName === "IMG") markNative(e.target); }, true);
  [].forEach.call(d.images, function (i) { if (i.complete) markNative(i); });

  /* ---------- opening: restrained parallax (off for reduced-motion and data saver) ---------- */
  var openEl = d.querySelector("[data-open]");
  if (openEl && !reduce && !root.classList.contains("lx-save")) {
    var stage = openEl.querySelector("[data-open-stage]"), lamps = openEl.querySelector(".lx-open__lights"), pending = false;
    var tick = function () {
      pending = false;
      var y = Math.min(window.scrollY || 0, window.innerHeight * 1.2);
      if (stage) stage.style.setProperty("--py", (y * 0.09).toFixed(1) + "px");
      if (lamps) lamps.style.setProperty("--ly", (y * 0.2).toFixed(1) + "px");
    };
    addEventListener("scroll", function () { if (!pending) { pending = true; requestAnimationFrame(tick); } }, { passive: true });
    if (lamps && window.matchMedia && matchMedia("(pointer: fine)").matches) {
      openEl.addEventListener("pointermove", function (e) {
        var r = openEl.getBoundingClientRect();
        lamps.style.setProperty("--lx-lx", (((e.clientX - r.left) / r.width - 0.5) * -26).toFixed(1) + "px");
      });
    }
  }

  /* ---------- collections: hover/focus preview ---------- */
  var clist = d.querySelector("[data-clist]"), prev = d.querySelector("[data-cpreview]");
  if (clist && prev) {
    var imgs = [].slice.call(prev.querySelectorAll("img"));
    function pick(i) { imgs.forEach(function (im, n) { im.classList.toggle("is-active", n === i); }); }
    [].forEach.call(clist.querySelectorAll("a[data-preview]"), function (a) {
      var i = Number(a.getAttribute("data-preview"));
      a.addEventListener("mouseenter", function () { pick(i); });
      a.addEventListener("focus", function () { pick(i); });
    });
  }

  /* ---------- hero media controller ----------
     Poster is server-rendered (see lib/includes.mjs). The video loads only
     after the page is interactive, never for reduced-motion or data-saver
     users, pauses off-screen / in background tabs, and fades in only once it
     is actually playing - any failure leaves the poster in place. */
  var hero = d.querySelector("[data-hero]");
  if (hero && hero.getAttribute("data-has-video") === "1") {
    var video = hero.querySelector("video"), toggle = hero.querySelector("[data-hero-toggle]");
    var conn = navigator.connection || {};
    var slow = conn.saveData || /(^|-)2g$/.test(conn.effectiveType || "");
    if (video && !reduce && !slow) {
      var mobile = matchMedia("(max-width: 768px)").matches;
      var parse = function (k) { try { return JSON.parse(video.getAttribute("data-" + k) || "[]"); } catch (e) { return []; } };
      var list = parse(mobile ? "mobile" : "desktop");
      if (!list.length) list = parse(mobile ? "desktop" : "mobile");
      var userPaused = false, failed = false;
      var play = function () { if (!failed && !userPaused) { var p = video.play(); if (p && p.catch) p.catch(function () {}); } };
      var fail = function () { failed = true; video.classList.remove("is-playing"); if (toggle) toggle.hidden = true; };
      var start = function () {
        list.forEach(function (s) { var el = d.createElement("source"); el.src = s.src; if (s.type) el.type = s.type; video.appendChild(el); });
        video.muted = true; video.loop = true; video.playsInline = true;
        video.addEventListener("playing", function () { video.classList.add("is-playing"); if (toggle) toggle.hidden = false; });
        video.addEventListener("error", fail, true);
        video.load(); play();
      };
      if (list.length) {
        var kick = function () { ("requestIdleCallback" in window) ? requestIdleCallback(start, { timeout: 2500 }) : setTimeout(start, 800); };
        d.readyState === "complete" ? kick() : addEventListener("load", kick, { once: true });
        if ("IntersectionObserver" in window) new IntersectionObserver(function (es) {
          es.forEach(function (e) { if (e.isIntersecting) play(); else video.pause(); });
        }, { threshold: 0.1 }).observe(hero);
        d.addEventListener("visibilitychange", function () { if (d.hidden) video.pause(); else play(); });
        if (toggle) toggle.addEventListener("click", function () {
          userPaused = !userPaused;
          toggle.classList.toggle("is-paused", userPaused);
          toggle.setAttribute("aria-label", userPaused ? "Play background video" : "Pause background video");
          userPaused ? video.pause() : play();
        });
      }
    }
  }
})();
