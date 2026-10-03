// Page assembly for the luxury redesign overlay.
//
// Pages in redesign/pages/ are plain HTML with a few build-time markers:
//   <!--@include name-->      -> redesign/partials/name.html
//   <!--@hero-->              -> hero media markup rendered from luxe/hero-media.json
//   <!--@jsonld file.html-->  -> the application/ld+json blocks from public/file.html,
//                                so structured data stays single-sourced
//   <!--@product SKU-->       -> a product tile rendered from the catalog data
// Used by serve.mjs (on request) and build.mjs (flattened output). Nothing here
// writes to public/ or touches catalog data.
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const REDESIGN_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const PUBLIC_ROOT = join(REDESIGN_ROOT, "..", "public");

const read = (p) => readFileSync(p, "utf8");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/* ───────────── catalog access (read-only, cached) ───────────── */
let _index = null;
let _details = null;
export function catalogIndex() {
  if (!_index) _index = JSON.parse(read(join(PUBLIC_ROOT, "data", "catalog-index.json")));
  return _index;
}
export function catalogDetails() {
  if (!_details) {
    _details = new Map();
    const dir = join(PUBLIC_ROOT, "data", "details");
    for (const f of readdirSync(dir)) {
      if (!f.endsWith(".json")) continue;
      for (const rec of JSON.parse(read(join(dir, f)))) _details.set(rec.sku, rec);
    }
  }
  return _details;
}
export function luxeMedia() {
  const p = join(REDESIGN_ROOT, "data", "luxe-media.json");
  return existsSync(p) ? JSON.parse(read(p)) : {};
}

/** Resolve a manifest image reference: absolute URL as-is, otherwise a file name matched against the product's own gallery. */
export function resolveRef(sku, ref) {
  if (!ref) return ref;
  if (/^(https?:)?\/\//.test(ref) || ref.startsWith("/")) return ref;
  const d = catalogDetails().get(sku);
  const hit = d && (d.gallery || []).find((u) => u.split("/").pop() === ref);
  return hit || ref;
}

export function fmtPrice(n) {
  if (n == null || !isFinite(Number(n))) return "";
  const v = Number(n);
  return "$" + v.toLocaleString("en-US", { minimumFractionDigits: Number.isInteger(v) ? 0 : 2, maximumFractionDigits: 2 });
}

/* ───────────── hero media ───────────── */
function heroMarkup() {
  const cfg = JSON.parse(read(join(REDESIGN_ROOT, "luxe", "hero-media.json")));
  const poster = cfg.poster;
  const video = cfg.video;
  let media;
  if (poster && poster.src) {
    const m = poster.mobile;
    const srcsets = (list) =>
      (list || []).map((s) => `<source${s.media ? ` media="${esc(s.media)}"` : ""} srcset="${esc(s.srcset)}" type="${esc(s.type)}">`).join("");
    media = `<picture class="lx-hero__poster">
        ${m ? `<source media="(max-width: 768px)" srcset="${esc(m.src)}">` : ""}
        ${srcsets(poster.sources)}
        <img src="${esc(poster.src)}" width="${poster.width || 1920}" height="${poster.height || 1080}" alt="${esc(cfg.alt || "")}" fetchpriority="high" decoding="async">
      </picture>`;
  } else {
    media = `<div class="lx-hero__placeholder" role="img" aria-label="Hero media placeholder"><span class="lx-hero__grain"></span><span class="lx-hero__slats"></span><span class="lx-hero__light"></span></div>`;
  }
  const hasVideo = video && ((video.desktop && video.desktop.length) || (video.mobile && video.mobile.length));
  const videoTag = hasVideo
    ? `<video class="lx-hero__video" muted loop playsinline preload="none" aria-hidden="true" tabindex="-1" data-desktop='${esc(JSON.stringify(video.desktop || []))}' data-mobile='${esc(JSON.stringify(video.mobile || []))}'></video>`
    : "";
  const note = !(poster && poster.src) && !hasVideo
    ? `<p class="lx-slot-note" data-review-only>Hero media slot &middot; ${esc(cfg.label || "cinematic asset")} pending &middot; 16:9 loop + poster &middot; 9:16 mobile cut</p>`
    : "";
  const pause = hasVideo
    ? `<button class="lx-hero__toggle" type="button" data-hero-toggle aria-label="Pause background video" hidden><span aria-hidden="true"></span></button>`
    : "";
  return `<section class="lx-hero" data-hero data-has-video="${hasVideo ? "1" : "0"}" aria-label="SNS Furniture">
    <div class="lx-hero__media" data-hero-media>${media}${videoTag}</div>
    <div class="lx-hero__scrim"></div>
    <div class="lx-hero__copy">
      <p class="lx-hero__brand">SNS Furniture</p>
      <h1 class="lx-hero__title">Custom, without compromise.</h1>
      <a class="lx-btn lx-btn--light" href="custom-furniture.html">Discover custom</a>
    </div>
    ${note}${pause}
    <span class="lx-hero__cue" aria-hidden="true"></span>
  </section>`;
}

/* ───────────── product tile ───────────── */
function productTile(sku, opts = {}) {
  const idx = catalogIndex().find((r) => r.sku === sku);
  if (!idx) return `<!-- product ${esc(sku)} not found -->`;
  const media = luxeMedia()[sku] || {};
  const img = media.cardImage ? resolveRef(sku, media.cardImage) : idx.image;
  const coll = idx.collection ? `${esc(idx.collection)} collection` : esc(idx.type || "");
  return `<a class="lx-tile${opts.cls ? " " + opts.cls : ""}" href="product-luxe.html?sku=${encodeURIComponent(sku)}">
      <span class="lx-tile__media"><img src="${esc(img)}" width="1000" height="1000" alt="${esc(idx.name)}" loading="lazy" decoding="async"></span>
      <span class="lx-tile__meta"><span class="lx-tile__eyebrow">${coll}</span><span class="lx-tile__name">${esc(idx.name)}</span><span class="lx-tile__price">${esc(fmtPrice(idx.sale))}</span></span>
    </a>`;
}

/* ───────────── collections index (list + hover preview) ───────────── */
// <!--@collections Name:SKU:Room, Name:SKU:Room-->  Each entry links to the
// existing catalog search for that collection name; the preview image is the
// representative SKU's catalog image.
function collectionsMarkup(spec) {
  const rows = spec.split(",").map((s) => s.trim().split(":")).filter((a) => a.length >= 3);
  const idx = catalogIndex();
  const lis = rows.map(([name, , room], i) =>
    `<li><a href="catalog.html?q=${encodeURIComponent(name)}" data-preview="${i}"><span class="lx-clist__name">${esc(name)}</span><span class="lx-clist__meta">${esc(room)}</span></a></li>`).join("\n      ");
  const imgs = rows.map(([name, sku], i) => {
    const r = idx.find((x) => x.sku === sku);
    const media = luxeMedia()[sku] || {};
    const src = media.cardImage ? resolveRef(sku, media.cardImage) : r && r.image;
    return src ? `<img${i === 0 ? ' class="is-active"' : ""} src="${esc(src)}" alt="" width="1000" height="1000" loading="lazy" decoding="async">` : "";
  }).join("\n      ");
  return `<div class="lx-collections__layout">
    <ul class="lx-clist lx-reveal" data-clist>
      ${lis}
    </ul>
    <div class="lx-collections__preview" aria-hidden="true" data-cpreview>
      ${imgs}
    </div>
  </div>`;
}

/* ───────────── JSON-LD passthrough ───────────── */
function jsonLd(file) {
  const p = join(PUBLIC_ROOT, file);
  if (!existsSync(p)) return `<!-- ${esc(file)} not found -->`;
  return (read(p).match(/<script type="application\/ld\+json">[\s\S]*?<\/script>/g) || []).join("\n");
}

/* ───────────── page rendering ───────────── */
// commerce=false renders the catalog-only variant (no cart link). Default: on, override with LUXE_COMMERCE=0.
export const COMMERCE = process.env.LUXE_COMMERCE !== "0";
export function renderPage(html, depth = 0, commerce = COMMERCE) {
  const out = html
    .replace(/<!--@if commerce-->([\s\S]*?)<!--@endif-->/g, (_, inner) => (commerce ? inner : ""))
    .replace(/<!--@include ([\w-]+)-->/g, (_, name) => {
      const p = join(REDESIGN_ROOT, "partials", name + ".html");
      return existsSync(p) ? read(p) : `<!-- missing partial ${name} -->`;
    })
    .replace(/<!--@hero-->/g, () => heroMarkup())
    .replace(/<!--@jsonld ([\w.-]+)-->/g, (_, f) => jsonLd(f))
    .replace(/<!--@product ([\w-]+)(?: ([\w-]+))?-->/g, (_, sku, cls) => productTile(sku, { cls }))
    .replace(/<!--@collections ([^>]*?)-->/g, (_, spec) => collectionsMarkup(spec));
  return depth < 2 && /<!--@/.test(out) ? renderPage(out, depth + 1, commerce) : out;
}

export function listPages() {
  return readdirSync(join(REDESIGN_ROOT, "pages")).filter((f) => f.endsWith(".html"));
}
export function readPage(name) {
  const p = join(REDESIGN_ROOT, "pages", name);
  return existsSync(p) ? renderPage(read(p)) : null;
}
