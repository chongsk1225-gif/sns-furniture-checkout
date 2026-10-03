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
  var heroEl = d.querySelector(".lx-hero, .lx-chero");
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

  /* ---------- scroll reveal ---------- */
  var io = null;
  function observe(el) {
    if (!el) return;
    if (reduce || !("IntersectionObserver" in window)) { el.classList.add("is-in"); return; }
    if (!io) {
      io = new IntersectionObserver(function (es) {
        es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add("is-in"); io.unobserve(e.target); } });
      }, { rootMargin: "0px 0px -6% 0px", threshold: 0.06 });
    }
    io.observe(el);
  }
  all(".lx-reveal, .lx-panel").forEach(observe);
  window.LX = { observe: observe, reduce: reduce };

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
