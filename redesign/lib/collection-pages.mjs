// One crawlable page per named collection (two or more visible pieces): editorial header,
// factual introduction, every piece as a real link with name and price, structured data.
// Hidden products are never listed (catalogIndex() only contains visible products).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { REDESIGN_ROOT, SITE, catalogIndex, esc, renderPage, finalize } from "./includes.mjs";
import { collectionsIndexData } from "./collections.mjs";
import { tileHtml, cardImage } from "./cards.mjs";
import { productPath, collectionPath, nameSlug, assertUnique } from "./slug.mjs";
import { ROOMS } from "./rooms.mjs";

const SHORT = { "Living Room": "living room", "Dining Room": "dining room", "Bedroom": "bedroom", "Mattresses": "mattresses", "Accent Furniture": "accent furniture", "Youth": "youth bedroom", "Office": "home office", "Outdoor": "outdoor", "Other": "other spaces" };
const ld = (o) => `<script type="application/ld+json">${JSON.stringify(o).split("</").join("<" + String.fromCharCode(92) + "/")}</script>`;

let _model = null;
function model() {
  if (_model) return _model;
  const by = new Map();
  for (const p of catalogIndex()) if (p.collection) (by.get(p.collection) || by.set(p.collection, []).get(p.collection)).push(p);
  const cover = new Map(collectionsIndexData().items.map((r) => [r[0], { image: r[3], sku: r[4] }]));
  const list = [...by].filter(([, items]) => items.length >= 2).map(([name, items]) => ({ name, items, slug: nameSlug(name), cover: cover.get(name) }));
  assertUnique(list, (c) => c.slug, "collection");
  _model = { list, bySlug: new Map(list.map((c) => [c.slug, c])) };
  return _model;
}
export const collectionSlugs = () => model().list.map((c) => c.slug);
export const collectionList = () => model().list;

function introFor(c) {
  const rooms = [...new Set(c.items.map((p) => SHORT[p.category] || p.category))];
  const where = rooms.length === 1 ? `the ${rooms[0]}` : rooms.length === 2 ? `the ${rooms[0]} and ${rooms[1]}` : `the ${rooms.slice(0, -1).join(", ")} and ${rooms[rooms.length - 1]}`;
  return `The ${c.name} collection brings together ${c.items.length} pieces for ${where}. Browse every piece below, or ask about delivery and our in-home design service.`;
}

export function renderCollectionPage(slug, commerce) {
  const c = model().bySlug.get(slug);
  if (!c) return null;
  const canonical = `${SITE}${collectionPath(c.name)}`;
  const intro = introFor(c);
  const items = [...c.items].sort((a, b) => (a.type || "").localeCompare(b.type || "") || a.name.localeCompare(b.name));
  const tiles = items.map((p, i) => tileHtml({ sku: p.sku, name: p.name, type: p.type, sub: p.type || "", price: p.sale, image: cardImage(p) }, i, { eager: false, prio: false })).join("");
  const rooms = [...new Set(c.items.map((p) => p.category))];
  const roomLinks = rooms.map((r) => { const e = Object.entries(ROOMS).find(([, v]) => v.category === r); return e ? `<a class="lx-textlink" href="/${e[0]}.html">${esc(e[1].h1)}</a>` : ""; }).filter(Boolean).join("");
  const crumbs = [["Home", "/"], ["Stock Furniture", "/stock-furniture.html"], ["Collections", "/collections.html"], [`${c.name} collection`, collectionPath(c.name)]];
  const bc = { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: crumbs.map(([n, u], i) => ({ "@type": "ListItem", position: i + 1, name: n, item: `${SITE}${u}` })) };
  const page = { "@context": "https://schema.org", "@type": "CollectionPage", "@id": `${canonical}#collection`, name: `${c.name} collection`, url: canonical, description: intro, isPartOf: { "@id": `${SITE}/#website` }, publisher: { "@id": `${SITE}/#business` }, primaryImageOfPage: c.cover ? { "@type": "ImageObject", url: c.cover.image } : undefined, mainEntity: { "@type": "ItemList", numberOfItems: items.length, itemListElement: items.slice(0, 24).map((p, i) => ({ "@type": "ListItem", position: i + 1, url: `${SITE}${productPath(p.sku)}`, name: p.name })) } };
  const crumbHtml = `<nav class="lx-crumbs" aria-label="Breadcrumb"><ol>${crumbs.map(([n, u], i) => (i === crumbs.length - 1 ? `<li aria-current="page">${esc(n)}</li>` : `<li><a href="${esc(u)}">${esc(n)}</a></li>`)).join("")}</ol></nav>`;
  const hero = c.cover ? `<figure class="lx-chead__img"><img src="${esc(c.cover.image)}" width="1000" height="800" alt="${esc(`${c.name} collection, room scene`)}" fetchpriority="high" decoding="async"></figure>` : "";
  const fill = {
    title: esc(`${c.name} Collection | Stock Furniture | SNS Furniture`), description: esc(intro), canonical,
    ogimg: esc(c.cover ? c.cover.image : ""), ogalt: esc(`${c.name} collection`), preload: c.cover ? `<link rel="preload" as="image" href="${esc(c.cover.image)}" fetchpriority="high">` : "",
    jsonld: ld(page) + "\n" + ld(bc), crumbs: crumbHtml, name: esc(c.name), intro: esc(intro), count: String(items.length), hero, tiles, rooms: roomLinks,
  };
  const html = readFileSync(join(REDESIGN_ROOT, "templates", "collection.html"), "utf8");
  const out = html.replace(/\{\{\{(\w+)\}\}\}/g, (_, k) => fill[k] ?? "").replace(/\{\{(\w+)\}\}/g, (_, k) => fill[k] ?? "");
  return finalize(renderPage(out, 0, commerce));
}
