// Slim, derived per-room dataset for the redesigned collection pages.
// Read-only over public/data — generated in memory (serve.mjs) or written to
// dist/ (build.mjs); never written back into public/data.
//
// Why: shipping the full 2.3 MB catalog-index to a room page is wasteful; a
// room needs ~8 short fields. Subsection buckets reuse the project's existing
// classifier (image-pipeline/lib/subsections.mjs) rather than duplicating it.
import { classify, SUBSECTIONS_BY_ROOM } from "../../image-pipeline/lib/subsections.mjs";
import { catalogIndex, catalogDetails, luxeMedia, resolveRef } from "./includes.mjs";

export const ROOM_BY_SLUG = {
  "living-room": "Living Room",
  "dining-room": "Dining Room",
  "bedroom": "Bedroom",
};

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
