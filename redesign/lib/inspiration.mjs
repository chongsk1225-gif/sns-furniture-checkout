// Room inspiration: editorial scenes built only from relationships the catalog supports.
// A scene is the lifestyle photograph of a product (the file is named after that SKU), shown
// with the collection that product belongs to. We never claim that other pieces appear in the
// photograph; the "Shown" line names only the product the photograph was made for.
import { catalogIndex, esc, fmtPrice } from "./includes.mjs";
import { collectionsIndexData } from "./collections.mjs";
import { collectionPath } from "./slug.mjs";
import { ROOMS } from "./rooms.mjs";

const LABEL = Object.fromEntries(Object.entries(ROOMS).map(([, r]) => [r.category, r.h1]));
// Curated order (room variety first); any name missing from the catalog is skipped.
const PREFERRED = ["Leonia", "Clayten", "Metis", "Helena", "Malika", "Zoey", "Versailles", "Dresden", "Vendome", "Noralie", "Picardy"];

let _scenes = null;
export function scenes() {
  if (_scenes) return _scenes;
  const idx = new Map(catalogIndex().map((p) => [p.sku, p]));
  const rows = new Map(collectionsIndexData().items.map((r) => [r[0], r]));
  const out = [];
  for (const name of PREFERRED) {
    const r = rows.get(name);
    if (!r || !/_life\./i.test(r[3] || "")) continue;
    const shown = idx.get(r[4]);
    if (!shown) continue;
    out.push({ collection: name, count: r[1], image: r[3], sku: r[4], shown, room: LABEL[shown.category] || shown.category, href: collectionPath(name) });
  }
  _scenes = out;
  return out;
}

export function inspirationGrid(n, big) {
  return `<div class="lx-scenes${big ? " lx-scenes--big" : ""}">${scenes().slice(0, n).map((s, i) => `<a class="lx-scene lx-reveal" style="--d:${(i % 3) * 90}ms" href="${s.href}"><span class="lx-scene__media"><img src="${esc(s.image)}" width="1000" height="800" alt="${esc(`${s.collection} collection, ${s.room.toLowerCase()} room scene`)}" loading="lazy" decoding="async"></span><span class="lx-scene__cap"><span class="lx-scene__eyebrow">${esc(s.room)}</span><span class="lx-scene__name">${esc(s.collection)}</span><span class="lx-scene__cta">View the collection</span></span></a>`).join("")}</div>`;
}

/** Long-form scenes for the Room Inspiration page. */
export function inspirationStories() {
  return scenes().map((s, i) => `<article class="lx-story${i % 2 ? " lx-story--flip" : ""}"><a class="lx-story__media lx-reveal" href="${s.href}"><img src="${esc(s.image)}" width="1000" height="800" alt="${esc(`${s.collection} collection, ${s.room.toLowerCase()} room scene`)}" loading="${i < 2 ? "eager" : "lazy"}" decoding="async"></a><div class="lx-story__copy"><p class="lx-eyebrow lx-reveal">${esc(s.room)}</p><h2 class="lx-story__h lx-reveal">${esc(s.collection)}</h2><p class="lx-story__p lx-reveal">The ${esc(s.collection)} collection brings together ${s.count} pieces. In this room: ${esc(s.shown.name)}${s.shown.sale != null ? `, ${esc(fmtPrice(s.shown.sale))}` : ""}.</p><p class="lx-story__links lx-reveal"><a class="lx-btn" href="${s.href}">View the Collection</a><a class="lx-textlink" href="design-services.html#consultation">Request a consultation</a></p></div></article>`).join("");
}
