// Parser for the supplied official ACME image feed:
//   acme_product_image_links_2026_09_08.csv
//   header:  sku,catalog_product_entity_media_gallery.images
//   row:     <SKU>,"<url>,<url>,..."     (quoted when multiple; bare when single)
import { readFileSync } from "node:fs";

export function parseAcmeFeed(path) {
  const text = readFileSync(path, "utf8");
  const lines = text.split(/\r?\n/);
  const out = new Map(); // SKU(upper) -> [urls]
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const comma = line.indexOf(",");
    if (comma < 0) continue;
    const sku = line.slice(0, comma).trim().toUpperCase();
    let cell = line.slice(comma + 1).trim();
    if (cell.startsWith('"') && cell.endsWith('"')) cell = cell.slice(1, -1);
    const urls = cell
      .split(",")
      .map((u) => u.trim())
      .filter((u) => /^https?:\/\//i.test(u));
    if (!sku || urls.length === 0) continue;
    const prev = out.get(sku) || [];
    for (const u of urls) if (!prev.includes(u)) prev.push(u);
    out.set(sku, prev);
  }
  return out;
}
