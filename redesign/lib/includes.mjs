// Page assembly for the luxury redesign overlay.
//
// Pages in redesign/pages/ are plain HTML with a few build-time markers:
//   <!--@include name-->      -> redesign/partials/name.html
//   <!--@hero-->              -> hero media markup rendered from luxe/hero-media.json
//   <!--@jsonld file.html-->  -> the application/ld+json blocks from public/file.html,
//                                so structured data stays single-sourced
//   <!--@product SKU-->       -> a product tile rendered from the catalog data
//   <!--@seo file.html-->     -> <title>, description, robots, canonical (+ JSON-LD) passed
//                                through from public/file.html, brand-normalized
//   <!--@wrap file.html-->    -> the <main> content of an existing public page (cart, checkout,
//                                policies...) re-skinned by .lx-legacy; scripts/ids/forms untouched
//   <!--@count brand NAME-->  <!--@count room NAME-->  -> visible product counts
// Used by serve.mjs (on request) and build.mjs (flattened output). Nothing here
// writes to public/ or touches catalog data.
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { ROOMS, ROOM_SLUGS } from "./rooms.mjs";
import { productPath, collectionPath } from "./slug.mjs";
import { fileURLToPath } from "node:url";

export const REDESIGN_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const PUBLIC_ROOT = join(REDESIGN_ROOT, "..", "public");

const read = (p) => readFileSync(p, "utf8");
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

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
let _media = null;
export function luxeMedia() {
  if (!_media) {
    const p = join(REDESIGN_ROOT, "data", "luxe-media.json");
    _media = existsSync(p) ? JSON.parse(read(p)) : {};
  }
  return _media;
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

/* ───────────── cinematic opening ─────────────
   <!--@opening home-->       home page: the Sigma 1006/1007 room photograph
   <!--@opening custom-->     Custom Furniture hub: the Sigma 1006/1007 studio photograph
   openingMarkup(variant, copy) is also called by the custom room pages with their own copy.
   The photographs are shown exactly as supplied (no crop beyond the frame's own
   5:4 aspect, no filter, no flip, no recolor). The "lights turning on" reveal is
   a dark overlay that fades to fully transparent and warm light layers placed
   BEHIND the photograph, so the final frame is the original image. All motion is
   CSS-only, so it runs without JavaScript, and is switched off for
   reduced-motion and data-saver visitors (who get the final frame at once).
   Owned images are served as <picture> (AVIF / WebP derivatives, original as fallback)
   with explicit width and height.

   VIDEO SLOT: set "video" in luxe/hero-media.json (see its _readme) and a genuine
   high-resolution video will play inside the same frame, above the still image,
   which then acts as the poster. Nothing is generated or synthesized here. */
const OPEN_COPY = {
  room: { eyebrow: "SNS Furniture", h1: "Custom furniture, designed around you", lede: "Interior design and consultation, delivered throughout California.", primary: ["Explore Custom Furniture", "custom-furniture.html"], secondary: ["Shop Stock Furniture", "stock-furniture.html"] },
  studio: { eyebrow: "SNS Furniture", h1: "Custom Furniture", lede: "Designed around you, and around your space.", primary: ["Request a Design Consultation", "#consultation"], secondary: ["How it works", "#process"] },
};
// Responsive derivatives of the two owned photographs (see luxe/media/hero/*-<w>.avif|webp).
const pictureFor = (still, alt) => {
  const stem = String(still.src).replace(/\.webp$/, "");
  const widths = still.widths || [];
  const set = (ext) => widths.map((w) => `${stem}-${w}.${ext} ${w}w`).concat(`${stem}.${ext === "avif" ? "avif" : "webp"} ${still.width || 1000}w`).join(", ");
  const sizes = "(max-width: 900px) 100vw, 64vw";
  const img = `<img class="lx-open__img" src="${esc(still.src)}" width="${still.width || 1000}" height="${still.height || 800}" alt="${esc(alt)}" fetchpriority="high" decoding="async">`;
  if (!widths.length) return img;
  return `<picture><source type="image/avif" srcset="${esc(set("avif"))}" sizes="${sizes}"><source type="image/webp" srcset="${esc(set("webp"))}" sizes="${sizes}">${img}</picture>`;
};
export function openingMarkup(variant = "room", copyOverride) {
  const cfg = JSON.parse(read(join(REDESIGN_ROOT, "luxe", "hero-media.json")));
  const studio = variant === "studio";
  const still = studio ? cfg.studio : cfg.poster;
  const video = studio ? null : cfg.video;
  const hasVideo = !!(video && ((video.desktop && video.desktop.length) || (video.mobile && video.mobile.length)));
  const img = still && still.src ? pictureFor(still, still.alt || "") : "";
  const videoTag = hasVideo
    ? `<!-- VIDEO SLOT: genuine supplied footage plays here, above the still image -->
      <video class="lx-hero__video" muted loop playsinline preload="none" aria-hidden="true" tabindex="-1" data-desktop='${esc(JSON.stringify(video.desktop || []))}' data-mobile='${esc(JSON.stringify(video.mobile || []))}'></video>`
    : "";
  const pause = hasVideo
    ? `<button class="lx-hero__toggle" type="button" data-hero-toggle aria-label="Pause background video" hidden><span aria-hidden="true"></span></button>`
    : "";
  const c = { ...OPEN_COPY[studio ? "studio" : "room"], ...(copyOverride || {}) };
  const copy = `<p class="lx-open__eyebrow">${esc(c.eyebrow)}</p>
      <h1 class="lx-open__title" id="open-h1">${esc(c.h1)}</h1>
      <p class="lx-open__lede">${esc(c.lede)}</p>
      <div class="lx-open__cta">
        <a class="lx-btn lx-btn--light" href="${esc(c.primary[1])}">${esc(c.primary[0])}</a>
        <a class="lx-textlink lx-open__second" href="${esc(c.secondary[1])}">${esc(c.secondary[0])}</a>
      </div>`;
  return `<section class="lx-open lx-open--${variant}" data-hero data-open data-has-video="${hasVideo ? "1" : "0"}" aria-labelledby="open-h1">
    <div class="lx-open__room" aria-hidden="true"><span class="lx-open__wall"></span><span class="lx-open__floor"></span></div>
    <div class="lx-open__lights" aria-hidden="true"><i></i><i></i><i></i></div>
    <figure class="lx-open__stage" data-open-stage>
      <div class="lx-open__frame">
        ${img}${videoTag}
        <span class="lx-open__dim" aria-hidden="true"></span>
      </div>
    </figure>
    <div class="lx-open__copy">
      ${copy}
    </div>
    ${pause}
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
  return `<a class="lx-tile${opts.cls ? " " + opts.cls : ""}" href="${productPath(sku)}">
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
    `<li><a href="${collectionPath(name)}" data-preview="${i}"><span class="lx-clist__name">${esc(name)}</span><span class="lx-clist__meta">${esc(room)}</span></a></li>`).join("\n      ");
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
const OLD_BRAND = /Sash and Shade/g;
export const brand = (t) => String(t).replace(OLD_BRAND, "SNS Furniture");
function jsonLd(file) {
  const p = join(PUBLIC_ROOT, file);
  if (!existsSync(p)) return `<!-- ${esc(file)} not found -->`;
  const blocks = read(p).match(/<script type="application\/ld\+json">[\s\S]*?<\/script>/g) || [];
  // SNS Furniture is the public brand. Structured data must match the visible text,
  // so names/FAQ strings are normalized; the old trading name is kept as alternateName.
  return blocks.map((b) => {
    const inner = b.replace(/^<script[^>]*>/, "").replace(/<\/script>$/, "");
    let data;
    try { data = JSON.parse(inner); } catch { return b; }
    const walk = (v) => Array.isArray(v) ? v.map(walk) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)])) : typeof v === "string" ? brand(v) : v;
    const out = walk(data);
    const types = [].concat(out["@type"] || []);
    if (types.includes("FAQPage")) return ""; // generated from the visible FAQ by <!--@faq--> instead
    if (types.includes("LocalBusiness")) return ""; // the business entity is emitted once, site-wide, by <!--@org-->
    return `<script type="application/ld+json">${JSON.stringify(out)}</script>`;
  }).join("\n");
}

/* ───────────── SEO passthrough + legacy page wrapping ───────────── */
export const ogImage = (alt) => `<meta property="og:image" content="${OG_IMAGE}"><meta property="og:image:width" content="1000"><meta property="og:image:height" content="800"><meta property="og:image:alt" content="${esc(alt)}"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:image" content="${OG_IMAGE}">`;
function seoFrom(file) {
  const p = join(PUBLIC_ROOT, file);
  if (!existsSync(p)) return `<!-- ${esc(file)} not found -->`;
  const html = read(p);
  const title = (html.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || "SNS Furniture";
  const attr = (re) => (html.match(re) || [])[1];
  const desc = attr(/<meta name="description" content="([^"]*)"/);
  const robots = attr(/<meta name="robots" content="([^"]*)"/);
  // Canonical = this page's own URL. (The inherited returns.html declared /refund.html, which does not exist.)
  const declared = attr(/<link rel="canonical" href="([^"]*)"/);
  const canon = declared ? (file === "index.html" ? SITE + "/" : SITE + "/" + file) : declared;
  const t = brand(title);
  return [
    `<title>${t}</title>`,
    desc ? `<meta name="description" content="${brand(desc)}">` : "",
    robots ? `<meta name="robots" content="${robots}">` : "",
    canon ? `<link rel="canonical" href="${canon}">` : "",
    `<meta property="og:type" content="website"><meta property="og:site_name" content="SNS Furniture"><meta property="og:title" content="${t}">`,
    desc ? `<meta property="og:description" content="${brand(desc)}">` : "",
    canon ? `<meta property="og:url" content="${canon}">` : "",
    ogImage(t),
    jsonLd(file),
  ].filter(Boolean).join("\n");
}
function wrapLegacy(file) {
  const p = join(PUBLIC_ROOT, file);
  if (!existsSync(p)) return `<!-- ${esc(file)} not found -->`;
  const m = read(p).match(/<main[^>]*>([\s\S]*?)<\/main>/);
  if (!m) return `<!-- no <main> in ${esc(file)} -->`;
  // About is brand copy, so it follows the SNS Furniture public brand; the legal/policy pages are
  // deliberately left word-for-word (their entity name is a legal matter, not a styling one).
  // Legal / policy pages stay word-for-word. The only additions are the fictitious-business-name
  // disclosure under the title and, for the contact form, an internal e-mail subject line.
  const NOTE = '<p class="lx-legal-note">SNS Furniture is a fictitious business name operated by Sash &amp; Shade.</p>';
  const withNote = ["terms.html", "privacy.html", "returns.html", "delivery.html", "contact.html"].includes(file);
  let body = m[1];
  if (file === "contact.html") body = body.replace('value="Sash and Shade Inquiry"', 'value="SNS Furniture inquiry"');
  if (withNote) body = body.replace("</h1>", "</h1>" + NOTE);
  return body
    .replace(/\sstyle="[^"]*"/g, "")                       // presentation only; wording/ids/forms untouched
    .replace(/<div class="wrap[^"]*"[^>]*>/g, '<div class="lx-legacy__inner">')
    .replace(/<section class="(?:shop|section|policy)">/g, '<section class="lx-legacy__section">')
    .replace(/<div class="eyebrow">/g, '<p class="lx-eyebrow">').replace(/(<p class="lx-eyebrow">[^<]*)<\/div>/g, "$1</p>");
}
/* ───────────── structured data helpers ───────────── */
export const SITE = "https://snsfurniture.com";
export const OG_IMAGE = `${SITE}/luxe/media/hero/sigma-1006-1007-room.webp`;
const ld = (o) => `<script type="application/ld+json">${JSON.stringify(o)}</script>`;
function breadcrumbs(spec) {
  const items = spec.split(",").map((s) => s.trim()).filter(Boolean).map((p) => {
    const i = p.lastIndexOf("|");
    return { name: p.slice(0, i), url: p.slice(i + 1) };
  });
  return ld({
    "@context": "https://schema.org", "@type": "BreadcrumbList",
    itemListElement: items.map((it, n) => ({ "@type": "ListItem", position: n + 1, name: it.name, item: it.url ? `${SITE}/${it.url}` : `${SITE}/` })),
  });
}
function collectionPage(spec) {
  const [name, url, description] = spec.split("|").map((s) => s.trim());
  return ld({
    "@context": "https://schema.org", "@type": "CollectionPage", name, url: `${SITE}/${url}`, description,
    isPartOf: { "@id": `${SITE}/#website` }, publisher: { "@id": `${SITE}/#business` },
  });
}
const FAQ_DESIGN = [
  ["What happens in a design consultation?", "You share your space, how you use it and what you have in mind, and we talk through direction and next steps. Final specifications and pricing are confirmed during the consultation."],
  ["Is the in-home design service free?", "Yes. SNS Furniture offers free in-home design service. Text or call (424) 310-6199."],
  ["Can a custom design be shown to me before I commit?", "Final specifications and pricing are confirmed during your consultation, before any order is placed."],
  ["Where does SNS Furniture deliver?", "Delivery options depend on the product and destination. California is the primary service area, and qualifying nationwide delivery may be available."],
];
const FAQ = [
  ["What does SNS Furniture offer?", "SNS Furniture offers custom furniture and interior design, along with stock furniture for the living room, dining room, bedroom, mattresses and accent spaces."],
  ["How do I start a custom design?", "Request a design consultation from the Custom Furniture or Design Services page, or text or call (424) 310-6199."],
  ["Does SNS Furniture offer design help?", "Yes. SNS Furniture offers free in-home design service. Text or call (424) 310-6199."],
  ["Does SNS Furniture deliver?", "Delivery options depend on the product and destination. California is the primary service area, and qualifying nationwide delivery may be available."],
];
// One source for the visible FAQ and its FAQPage markup, so they can never disagree.
function faqMarkup(kind) {
  const FAQ_LIST = kind === "design" ? FAQ_DESIGN : FAQ;
  const details = FAQ_LIST.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join("\n      ");
  const data = ld({ "@context": "https://schema.org", "@type": "FAQPage", mainEntity: FAQ_LIST.map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })) });
  return `${details}\n      ${data}`;
}
function orgMarkup() {
  return ld({
    // The single business entity for the whole site (products reference it as "seller"). SNS Furniture
    // sells online with delivery only, so it is an Organization / OnlineStore, not a walk-in shop.
    "@context": "https://schema.org", "@type": ["Organization", "OnlineStore"], "@id": `${SITE}/#business`, name: "SNS Furniture", alternateName: "Sash and Shade", url: `${SITE}/`,
    description: "SNS Furniture is a California custom and curated furniture brand with in-home design service and delivery throughout California.",
    telephone: "+1-424-310-6199", email: "info@snsfurniture.com",
    address: { "@type": "PostalAddress", streetAddress: "1575 Westwood Blvd.", addressLocality: "Los Angeles", addressRegion: "CA", postalCode: "90024", addressCountry: "US" },
    areaServed: [{ "@type": "State", name: "California" }],
    contactPoint: { "@type": "ContactPoint", contactType: "customer service", telephone: "+1-424-310-6199", email: "info@snsfurniture.com", areaServed: "US-CA", availableLanguage: "English" },
  });
}

function countMarkup(kind, name) {
  const idx = catalogIndex();
  const n = idx.filter((r) => (kind === "brand" ? r.brand === name : r.category === name)).length;
  return n.toLocaleString("en-US");
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
    .replace(/<!--@hero-->/g, () => openingMarkup("room"))
    .replace(/<!--@opening (home|custom)-->/g, (_, v) => openingMarkup(v === "home" ? "room" : "studio"))
    .replace(/<!--@seo ([\w.-]+)-->/g, (_, f) => seoFrom(f))
    .replace(/<!--@wrap ([\w.-]+)-->/g, (_, f) => wrapLegacy(f))
    .replace(/<!--@count (brand|room) ([^>]+?)-->/g, (_, k, n) => countMarkup(k, n))
    .replace(/<!--@ogimage ([^>]*?)-->/g, (_, alt) => ogImage(alt))
    .replace(/<!--@faq(?: (\w+))?-->/g, (_, k) => faqMarkup(k))
    .replace(/<!--@org-->/g, () => orgMarkup())
    .replace(/<!--@breadcrumbs ([^>]*?)-->/g, (_, spec) => breadcrumbs(spec))
    .replace(/<!--@collectionpage ([^>]*?)-->/g, (_, spec) => collectionPage(spec))
    .replace(/<!--@jsonld ([\w.-]+)-->/g, (_, f) => jsonLd(f))
    .replace(/<!--@product ([\w-]+)(?: ([\w-]+))?-->/g, (_, sku, cls) => productTile(sku, { cls }))
    .replace(/<!--@collections ([^>]*?)-->/g, (_, spec) => collectionsMarkup(spec));
  let out2 = out;
  for (const [name, fn] of MARKERS) out2 = out2.replace(new RegExp("<!--@" + name + "(?: ([^>]*?))?-->", "g"), (_, a) => fn(a, commerce));
  return depth < 3 && /<!--@/.test(out2) ? renderPage(out2, depth + 1, commerce) : out2;
}

/* ───────────── extension markers (registered by lib/markers.mjs) ───────────── */
const MARKERS = new Map();
export function registerMarker(name, fn) { MARKERS.set(name, fn); }

/* Root-relative URLs everywhere, so a page at /product/x/ resolves assets and links
   exactly like a page at /. In-page anchors, absolute URLs, mailto/tel are untouched. */
const KEEP = new RegExp("^(https?:|/|#|mailto:|tel:|data:|javascript:)");
export function finalize(html) {
  return html
    .replace(/(href|src|action)="([^"]*)"/g, (m, attr, v) => (!v || KEEP.test(v) ? m : `${attr}="/${v}"`))
    // srcset / imagesrcset: a comma-separated list of "url width" candidates
    .replace(/(srcset|imagesrcset)="([^"]*)"/g, (m, attr, v) => `${attr}="${v.split(",").map((c) => { const t = c.trim(); return t && !KEEP.test(t) ? "/" + t : t; }).join(", ")}"`);
}

export function listPages() {
  const own = readdirSync(join(REDESIGN_ROOT, "pages")).filter((f) => f.endsWith(".html"));
  return [...new Set([...own, ...ROOM_SLUGS.map((s) => s + ".html")])].sort();
}
function roomPage(slug) {
  const r = ROOMS[slug];
  const il = r.interlude;
  const vars = {
    slug, category: r.category, h1: r.h1, vh: r.vh, nav: r.nav, intro: r.intro,
    ilsrc: il ? il.src : "", ilalt: il ? il.alt : "", iltext: il ? il.text : "", ilhref: il ? "custom-furniture.html" : "", ilcta: il ? "Explore Custom Furniture" : "",
  };
  return read(join(REDESIGN_ROOT, "templates", "room.html")).replace(/\{\{(\w+)\}\}/g, (_, k) => esc(vars[k] ?? ""));
}
export function readPage(name) {
  const slug = name.replace(/\.html$/, "");
  const p = join(REDESIGN_ROOT, "pages", name);
  if (existsSync(p)) return finalize(renderPage(read(p)));
  if (ROOMS[slug]) return finalize(renderPage(roomPage(slug)));
  return null;
}
