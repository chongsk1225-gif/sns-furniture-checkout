// Shared product-card helpers: which image a grid tile shows, the tile markup used by
// every server-rendered grid, and the slim search dataset. Read-only over public/data.
import { catalogIndex, catalogDetails, luxeMedia, resolveRef, esc, fmtPrice } from "./includes.mjs";
import { productPath } from "./slug.mjs";

// Dimension/feature diagrams and room-scene photographs are not what a grid tile should lead
// with. When a product's primary image is one of those AND its own gallery has a clean
// alternative, the clean one is used. Display-layer only: catalog data is never edited, and
// a product with no alternative keeps its primary image.
export const DIAGRAM = /_(dim|feat|draw|spec|cc)(_\d+)?\.(jpe?g|png)$/i;
export const SCENE = /(_life|_lifestyle|_ls|_room|_scene)(_\d+)?\.(jpe?g|png)$/i;

// How likely an image file is a clean, front-facing product shot, judged from the file name only
// (no image is downloaded or analysed): 2 = primary-style name, 1 = unknown, 0 = looks like a room
// scene, swatch or late-gallery detail. Used only to order grids, never to hide anything.
export function cleanScore(url) {
  const f = String(url).split("/").pop().toLowerCase();
  if (SCENE.test(f) || /-ot-/.test(f) || DIAGRAM.test(f)) return 0;
  const m = f.match(/[-_](\d+)(?:_\d+)*\.(?:jpe?g|png)$/);
  if (!m) return 2;
  const n = Number(m[1]);
  return n <= 2 ? 2 : n >= 8 ? 0 : 1;
}

export function cardImage(p) {
  const m = luxeMedia()[p.sku];
  if (m && m.cardImage) return resolveRef(p.sku, m.cardImage);
  const d = catalogDetails().get(p.sku);
  const gal = (d && d.gallery) || [];
  let img = p.image;
  if ((DIAGRAM.test(img) || SCENE.test(img)) && gal.length) {
    const alt = gal.find((u) => !DIAGRAM.test(u) && !SCENE.test(u));
    if (alt) img = alt;
  }
  return img;
}

/** One grid tile. n is the tile's position, so only the first row loads eagerly. */
export function tileHtml({ sku, name, type, sub, price, image }, n = 99, opts = {}) {
  const eager = opts.eager ?? n < 2;
  const prio = opts.prio ?? n < 2;
  const alt = type ? `${name}, ${type}` : name;
  return `<a class="lx-tile" href="${productPath(sku)}"><span class="lx-tile__media"><img src="${esc(image)}" width="1000" height="1000" alt="${esc(alt)}"${eager ? "" : ' loading="lazy" fetchpriority="low"'}${prio ? ' fetchpriority="high"' : ""} decoding="async"></span><span class="lx-tile__meta"><span class="lx-tile__eyebrow">${esc(sub)}</span><span class="lx-tile__name">${esc(name)}</span><span class="lx-tile__price">${esc(price == null ? "Price on request" : fmtPrice(price))}</span></span></a>`;
}

export const tileFromIndex = (p, n) => tileHtml({ sku: p.sku, name: p.name, type: p.type, sub: p.collection ? `${p.collection} collection` : p.type || "", price: p.sale, image: cardImage(p) }, n);

/** Compact, derived search dataset (replaces loading the full 2.3 MB index in the browser). */
export function catalogCardsData() {
  const brands = [];
  const withImg = catalogIndex().map((p) => ({ p, img: cardImage(p) }));
  withImg.sort((a, b) => cleanScore(b.img) - cleanScore(a.img));
  const rows = withImg.map(({ p, img }) => {
    let b = brands.indexOf(p.brand); if (b < 0) { b = brands.length; brands.push(p.brand); }
    return [p.sku, p.name, p.type || "", p.category || "", b, p.collection || "", p.sale, img, p.finish || ""];
  });
  return { fields: ["sku", "name", "type", "category", "brand", "collection", "sale", "image", "finish"], brands, items: rows };
}
