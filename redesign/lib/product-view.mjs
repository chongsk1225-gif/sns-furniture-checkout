// Server-side product page. Every visible stock product gets a complete, crawlable HTML
// page at /product/<sku-slug>/ (name, price, specifications, gallery, structured data,
// related products) so nothing core depends on JavaScript. luxe/luxe-product.js only
// hydrates it (lightbox, add to cart, thumbnails). Hidden products have no page.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { REDESIGN_ROOT, SITE, catalogIndex, catalogDetails, luxeMedia, esc, fmtPrice, renderPage, finalize } from "./includes.mjs";
import { cardImage, tileFromIndex } from "./cards.mjs";
import { productPath, collectionPath, skuSlug } from "./slug.mjs";
import { ROOMS } from "./rooms.mjs";

const DIAGRAM = /_(dim|feat|draw|spec|cc)(_\d+)?\.(jpe?g|png)$/i;
const LIFE = /_life\.(jpe?g|png)$/i;
const base = (u) => String(u).split("/").pop();
const ROOM_BY_CATEGORY = Object.fromEntries(Object.entries(ROOMS).map(([slug, r]) => [r.category, { slug, label: r.h1 }]));
export const DELIVERY_COPY = "Ask about delivery options for this item. California is our primary service area; qualifying nationwide delivery may be available depending on the product and destination.";
const CHECKOUT_NOTE = "Online payment covers merchandise, applicable sales tax, and a flat $150 delivery fee. Online checkout is available for California delivery addresses only.";
const RETURNS_COPY = "Eligible non-defective furniture may be returned within 14 days after delivery, subject to the conditions and fees in our Refund & Return Policy. Mattresses, special orders and custom orders are final sale.";

// Structured-data blocks that mirror the published policies (policy text is the source of truth).
const SHIPPING = { "@type": "OfferShippingDetails", shippingRate: { "@type": "MonetaryAmount", value: 150, currency: "USD" }, shippingDestination: { "@type": "DefinedRegion", addressCountry: "US", addressRegion: ["CA"] } };
const returnPolicy = (category) => category === "Mattresses"
  ? { "@type": "MerchantReturnPolicy", applicableCountry: "US", returnPolicyCategory: "https://schema.org/MerchantReturnNotPermitted", merchantReturnLink: `${SITE}/returns.html` }
  : { "@type": "MerchantReturnPolicy", applicableCountry: "US", returnPolicyCategory: "https://schema.org/MerchantReturnFiniteReturnWindow", merchantReturnDays: 14, returnFees: "https://schema.org/RestockingFees", restockingFee: 0.2, merchantReturnLink: `${SITE}/returns.html` };
export { SHIPPING, returnPolicy };

// "</" is escaped so structured data can never close its own <script> element.
const ld = (o) => `<script type="application/ld+json">${JSON.stringify(o).split("</").join("<" + String.fromCharCode(92) + "/")}</script>`;
const weight = (v) => { const n = Number(v); return isFinite(n) && n > 0 ? `${Math.round(n * 100) / 100} lbs` : ""; };

function tidyFeatures(arr) {
  const out = [];
  for (const f of (arr || []).filter(Boolean)) {
    const t = String(f).trim();
    if (t.length > 70 && !/[,;\n•]/.test(t)) t.replace(/([a-z)])([A-Z])/g, "$1\n$2").split("\n").forEach((x) => { x = x.trim(); if (x) out.push(x); });
    else out.push(t);
  }
  return out;
}

function metaDescription(p) {
  let d = String(p.description || "").replace(/\s+/g, " ").trim();
  if (!d) d = `${p.name}${p.type ? `, ${String(p.type).toLowerCase()}` : ""}${p.collection ? `, from the ${p.collection} collection` : ""}. Delivery throughout California.`;
  if (d.length > 155) d = d.slice(0, 155).replace(/\s+\S*$/, "") + "…";
  return d;
}

/** Order the gallery into a calm sequence: scene, product views, details, then diagrams. */
function buildMedia(p, m) {
  const gallery = (p.gallery && p.gallery.length ? p.gallery : [p.image]).filter(Boolean);
  const roles = m.roles || {}, used = new Set();
  const resolve = (ref) => { if (!ref) return null; if (typeof ref === "object") ref = ref.src; if (/^(https?:)?\/\//.test(ref) || ref.startsWith("/")) return ref; return gallery.find((u) => base(u) === ref) || null; };
  const take = (list) => { const o = []; for (const r of list || []) { const u = resolve(r); if (u && !used.has(u)) { used.add(u); o.push(u); } } return o; };
  let life, prod = [], detail = [], diagram;
  if (m.roles) { life = take(roles.lifestyle); prod = take(roles.product); detail = take(roles.detail); diagram = take(roles.diagram); }
  else { life = gallery.filter((u) => LIFE.test(u)); life.forEach((u) => used.add(u)); diagram = gallery.filter((u) => !used.has(u) && DIAGRAM.test(u)); diagram.forEach((u) => used.add(u)); }
  const rest = gallery.filter((u) => !used.has(u));
  const items = [];
  life.forEach((u) => items.push({ src: u, role: "scene", wide: true, alt: `${p.name}, in a room setting` }));
  prod.forEach((u, i) => items.push({ src: u, role: "cutout", alt: `${p.name}, view ${i + 1}` }));
  detail.forEach((u) => items.push({ src: u, role: "cutout", alt: `${p.name}, material and construction detail` }));
  rest.forEach((u, i) => items.push({ src: u, role: "cutout", alt: i === 0 && !life.length && !prod.length ? `${p.name}${p.type ? `, ${p.type}` : ""}` : `${p.name}, photograph ${i + 1 + prod.length}` }));
  diagram.forEach((u) => items.push({ src: u, role: "diagram", wide: true, alt: `${p.name}, dimensions diagram`, cap: "Dimensions" }));
  if (items.length) items[0].wide = true;
  let pending = null;
  for (const it of items) { if (it.wide) { if (pending) { pending.wide = true; pending = null; } } else if (pending) pending = null; else pending = it; }
  if (pending) pending.wide = true;
  return items;
}

function related(p) {
  if (!p.collection) return [];
  const same = catalogIndex().filter((r) => r.collection === p.collection && r.sku !== p.sku);
  const seen = new Set([p.type]), diverse = [], rest = [];
  for (const r of same) { if (!seen.has(r.type)) { seen.add(r.type); diverse.push(r); } else rest.push(r); }
  return [...diverse, ...rest].slice(0, 4);
}

let _collectionsWithPages = null;
export function collectionsWithPages() {
  if (!_collectionsWithPages) {
    const c = new Map();
    for (const r of catalogIndex()) if (r.collection) c.set(r.collection, (c.get(r.collection) || 0) + 1);
    _collectionsWithPages = new Set([...c].filter(([, n]) => n >= 2).map(([k]) => k));
  }
  return _collectionsWithPages;
}

let _skuSet = null;
export const isVisible = (sku) => (_skuSet || (_skuSet = new Set(catalogIndex().map((r) => r.sku)))).has(sku);
export const visibleSkus = () => catalogIndex().map((r) => r.sku);

export function productInfo(sku) {
  const idx = catalogIndex().find((r) => r.sku === sku);
  return idx;
}

let _byRow = null;
const row = (sku) => (_byRow || (_byRow = new Map(catalogIndex().map((r) => [r.sku, r])))).get(sku);

/** Full HTML page for a visible product, or null (hidden / unknown SKUs have no page). */
export function renderProductPage(sku, commerce) {
  const idx = row(sku);
  if (!idx) return null;
  const d = catalogDetails().get(sku);
  if (!d || d.hidden === true) return null;
  const p = { ...d, collection: d.collection || idx.collection || "", sale: idx.sale };
  const m = luxeMedia()[sku] || {};
  const items = buildMedia(p, m);
  const canonical = `${SITE}${productPath(sku)}`;
  const room = ROOM_BY_CATEGORY[p.category];
  const hasCollPage = p.collection && collectionsWithPages().has(p.collection);
  const hide = m.hideSpecs || [];

  const figs = items.map((it, i) => {
    const cls = `lx-media${it.wide ? " lx-media--wide" : ""} lx-media--${it.role}`;
    return `<button type="button" class="${cls}" data-lb="${i}" aria-label="Enlarge: ${esc(it.alt)}"><img src="${esc(it.src)}" width="1000" height="1000" alt="${esc(it.alt)}"${i === 0 ? ' fetchpriority="high"' : ' loading="lazy"'} decoding="async">${it.cap ? `<span class="lx-media__cap">${esc(it.cap)}</span>` : ""}</button>`;
  }).join("");
  const MAXT = 8;
  const thumbs = items.length > 1 ? `<div class="lx-thumbs" data-thumbs role="group" aria-label="Product images">${items.slice(0, MAXT).map((it, i) => `<button type="button" class="lx-thumb" data-goto="${i}" aria-label="Show image ${i + 1} of ${items.length}"${i === 0 ? ' aria-current="true"' : ""}><img src="${esc(it.src)}" alt="" width="64" height="64" loading="lazy" decoding="async" fetchpriority="low"></button>`).join("")}${items.length > MAXT ? `<button type="button" class="lx-thumb lx-thumb--more" data-lb-open aria-label="View all ${items.length} images">+${items.length - MAXT}</button>` : ""}</div>` : "";

  const spec = (l, v) => (v ? `<dt>${esc(l)}</dt><dd>${esc(v)}</dd>` : "");
  const specs = spec("SKU", p.sku) + spec("Style", p.style) + spec("Finish", p.finish) + spec("Material", p.material) + (hide.includes("dimensions") ? "" : spec("Dimensions", p.dimensions)) + spec("Weight", weight(p.netWeight)) + spec("Pack", p.pack);
  const feats = tidyFeatures(p.features);
  const unverified = !(p.image_verification && /official_multi|verified_single_image/.test(p.image_verification.status || ""));
  const price = p.sale == null ? null : p.sale;
  const inquire = `/contact.html?product=${encodeURIComponent(p.sku)}`;
  const buy = price != null ? `<!--@if commerce--><button class="lx-btn lx-btn--solid" type="button" data-add data-sku="${esc(p.sku)}">Add to cart</button><!--@endif-->` : "";

  const crumbs = [["Home", "/"], ["Stock Furniture", "/stock-furniture.html"]];
  crumbs.push(room ? [room.label, `/${room.slug}.html`] : [p.category || "Catalog", `/catalog.html?room=${encodeURIComponent(p.category || "")}`]);
  if (hasCollPage) crumbs.push([`${p.collection} collection`, collectionPath(p.collection)]);
  crumbs.push([p.name, productPath(sku)]);
  const crumbHtml = `<nav class="lx-crumbs" aria-label="Breadcrumb"><ol>${crumbs.map(([n, u], i) => (i === crumbs.length - 1 ? `<li aria-current="page">${esc(n)}</li>` : `<li><a href="${esc(u)}">${esc(n)}</a></li>`)).join("")}</ol></nav>`;

  const info = `<p class="lx-eyebrow">${esc(p.collection ? `${p.collection} collection` : p.category || "")}</p>
      <h1 class="lx-pdp__title">${esc(p.name)}</h1>
      <p class="lx-pdp__type">${esc(p.type || "")}</p>
      <p class="lx-pdp__price">${esc(price == null ? "Price on request" : fmtPrice(price))}</p>
      <div class="lx-pdp__actions" data-actions>${buy}<a class="lx-btn" href="${inquire}">Inquire</a><a class="lx-textlink" style="justify-self:center" href="tel:+14243106199">Call (424) 310-6199</a></div>
      <p class="lx-pdp__note lx-pdp__consult">Planning a room around this piece? <a class="lx-textlink" href="/design-services.html?reference=${encodeURIComponent(p.sku)}#consultation">Request a Design Consultation</a></p>
      <p class="lx-pdp__note" data-added hidden><a class="lx-textlink" href="/cart.html">View cart</a></p>
      <p class="lx-pdp__note">${esc(price != null ? CHECKOUT_NOTE : "Delivery options depend on the item and destination. California is our primary service area.")}</p>
      <p class="lx-pdp__note">Current availability is confirmed with your order.</p>
      ${unverified ? '<p class="lx-pdp__note">A larger verified photograph of this item is not yet available.</p>' : ""}
      ${p.description ? `<p class="lx-pdp__desc">${esc(p.description)}</p>` : ""}
      <div class="lx-acc">
        ${specs ? `<details open><summary>Details</summary><div class="lx-acc__body"><dl class="lx-spec">${specs}</dl></div></details>` : ""}
        ${feats.length ? `<details><summary>Features</summary><div class="lx-acc__body"><ul class="lx-feat">${feats.map((f) => `<li>${esc(f)}</li>`).join("")}</ul></div></details>` : ""}
        <details><summary>Delivery</summary><div class="lx-acc__body">${esc(DELIVERY_COPY)}</div></details>
        <details><summary>Returns</summary><div class="lx-acc__body">${esc(RETURNS_COPY)} <a class="lx-textlink" href="/returns.html">Refund &amp; Return Policy</a></div></details>
      </div>
      ${hasCollPage ? `<p style="margin-top:28px"><a class="lx-textlink" href="${collectionPath(p.collection)}">View the ${esc(p.collection)} collection</a></p>` : ""}`;

  const rel = related(p);
  const relHtml = rel.length ? `<section class="lx-pdp__related" aria-labelledby="lx-rel-h"><p class="lx-eyebrow" id="lx-rel-h">More from the ${esc(p.collection)} collection</p><div class="lx-related-grid">${rel.map((r, i) => tileFromIndex(r, i + 4)).join("")}</div></section>` : "";

  const offer = price != null ? { "@type": "Offer", url: canonical, priceCurrency: "USD", price: Number(price).toFixed(2), itemCondition: "https://schema.org/NewCondition", availability: "https://schema.org/LimitedAvailability", seller: { "@id": `${SITE}/#business` }, shippingDetails: SHIPPING, hasMerchantReturnPolicy: returnPolicy(p.category) } : undefined;
  const product = { "@context": "https://schema.org", "@type": "Product", "@id": `${canonical}#product`, name: p.name, sku: p.sku, mpn: p.sku, category: p.category, description: String(p.description || metaDescription(p)).slice(0, 4900), image: items.map((i) => i.src).slice(0, 10), brand: { "@type": "Brand", name: p.brand || "Furniture of America" }, url: canonical, offers: offer };
  const bc = { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: crumbs.map(([n, u], i) => ({ "@type": "ListItem", position: i + 1, name: n, item: `${SITE}${u}` })) };

  const title = `${p.name} (${p.sku}) | SNS Furniture`;
  const desc = metaDescription(p);
  const ogImg = items[0] ? items[0].src : "";
  const html = readFileSync(join(REDESIGN_ROOT, "templates", "product.html"), "utf8");
  const fill = { title: esc(title), description: esc(desc), canonical, ogimg: esc(ogImg), ogalt: esc(items[0] ? items[0].alt : p.name), preload: ogImg ? `<link rel="preload" as="image" href="${esc(ogImg)}" fetchpriority="high">` : "",
    jsonld: ld(product) + "\n" + ld(bc), crumbs: crumbHtml, thumbs, figs, info, related: relHtml, sku: esc(sku), price: esc(price == null ? "" : fmtPrice(price)), nav: room ? room.slug.replace("-room", "") : "stock",
    pricetag: price != null ? `<meta property="product:price:amount" content="${Number(price).toFixed(2)}"><meta property="product:price:currency" content="USD">` : "",
    bar: price != null ? `<!--@if commerce--><button class="lx-btn lx-btn--solid" type="button" data-add data-sku="${esc(p.sku)}">Add to cart</button><!--@endif-->` : `<a class="lx-btn lx-btn--solid" href="${inquire}">Inquire</a>` };
  const out = html.replace(/\{\{\{(\w+)\}\}\}/g, (_, k) => fill[k] ?? "").replace(/\{\{(\w+)\}\}/g, (_, k) => fill[k] ?? "");
  return finalize(renderPage(out, 0, commerce));
}

export { skuSlug };
