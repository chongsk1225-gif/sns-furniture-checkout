// Slim, derived per-room dataset for the redesigned collection pages.
// Read-only over public/data — generated in memory (serve.mjs) or written to
// dist/ (build.mjs); never written back into public/data.
//
// Why: shipping the full 2.3 MB catalog-index to a room page is wasteful; a
// room needs ~8 short fields. Subsection buckets reuse the project's existing
// classifier (image-pipeline/lib/subsections.mjs) rather than duplicating it.
import { classify, SUBSECTIONS_BY_ROOM } from "../../image-pipeline/lib/subsections.mjs";
import { catalogIndex, catalogDetails, luxeMedia, resolveRef } from "./includes.mjs";

import { ROOMS } from "./rooms.mjs";

export const ROOM_BY_SLUG = Object.fromEntries(Object.entries(ROOMS).map(([slug, r]) => [slug, r.category]));
const SHORT_ROOM = { "Living Room": "Living", "Dining Room": "Dining", "Bedroom": "Bedroom", "Mattresses": "Mattresses", "Accent Furniture": "Accent", "Youth": "Youth", "Office": "Office", "Outdoor": "Outdoor", "Other": "Other" };

// A handful of catalog cards use a dimension/feature diagram as their image.
// Display-layer fix only: swap in the first real photo from that product's own
// gallery. The catalog data itself is not modified.
const DIAGRAM = /_(dim|feat|draw|spec|cc)(_\d+)?\.(jpe?g|png)$/i;

export function collectionData(slug) {
  const room = ROOM_BY_SLUG[slug];
  if (!room) return null;
  const media = luxeMedia();
  const details = catalogDetails();
  const buckets = SUBSECTIONS_BY_ROOM[room] || [];
  const items = [];
  for (const p of catalogIndex()) {
    if (p.category !== room) continue;
    const cls = classify(p);
    const bucket = cls ? buckets.indexOf(cls.bucket) : -1;
    const d = details.get(p.sku);
    let image = media[p.sku] && media[p.sku].cardImage ? resolveRef(p.sku, media[p.sku].cardImage) : p.image;
    if (DIAGRAM.test(image) && d) {
      const alt = (d.gallery || []).find((u) => !DIAGRAM.test(u));
      if (alt) image = alt;
    }
    // [sku, name, type, collection, price, image, bucketIdx, galleryCount]
    items.push([p.sku, p.name, p.type || "", p.collection || "", p.sale, image, bucket, (d && d.gallery ? d.gallery.length : 0)]);
  }
  // "Featured" order: best-documented listings first (most photos), then price.
  items.sort((a, b) => b[7] - a[7] || (b[4] || 0) - (a[4] || 0));
  return { room, buckets, fields: ["sku", "name", "type", "collection", "price", "image", "bucket", "photos"], items };
}

// ---- Collections index (collections.html) --------------------------------------
// One row per named collection with at least 2 visible pieces. Cover image: a real
// lifestyle photograph from the collection's own gallery when one exists
// (filename ..._life), otherwise its best non-diagram product image. Read-only
// over the catalog; names are never edited.
const LIFE = /_life.(jpe?g|png)$/i;
export function collectionsIndexData() {
  const details = catalogDetails();
  const by = new Map();
  for (const p of catalogIndex()) {
    if (!p.collection) continue;
    const o = by.get(p.collection) || { name: p.collection, items: [], rooms: new Set() };
    o.items.push(p); o.rooms.add(SHORT_ROOM[p.category] || p.category); by.set(p.collection, o);
  }
  const rows = [];
  for (const o of by.values()) {
    if (o.items.length < 2) continue;
    let cover = null, sku = null, best = -1;
    for (const p of o.items) {
      const d = details.get(p.sku);
      const gal = (d && d.gallery) || [];
      const life = gal.find((u) => LIFE.test(u));
      const score = (life ? 1000 : 0) + gal.length;
      if (score > best) { best = score; sku = p.sku; cover = life || gal.find((u) => !DIAGRAM.test(u)) || p.image; }
    }
    rows.push([o.name, o.items.length, [...o.rooms].sort(), cover, sku]);
  }
  rows.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const rooms = [...new Set(rows.flatMap((r) => r[2]))];
  return { fields: ["name", "count", "rooms", "image", "sku"], rooms, items: rows };
}
