// sitemap.xml for the redesigned site: every indexable page, every collection page and every
// visible product page. Hidden products are not in the catalog index, so they can never appear.
// Cart, checkout and order-status pages are noindex and are left out.
import { SITE } from "./includes.mjs";
import { visibleSkus } from "./product-view.mjs";
import { collectionSlugs } from "./collection-pages.mjs";
import { skuSlug } from "./slug.mjs";

export const INDEXABLE_PAGES = ["", "custom-furniture.html", "custom-living.html", "custom-dining.html", "custom-bedroom.html", "custom-sectionals.html", "collections.html", "living-room.html", "dining-room.html", "bedroom.html", "mattresses.html", "accent.html", "stock-furniture.html", "design-services.html", "room-inspiration.html", "catalog.html", "about.html", "contact.html", "delivery.html", "returns.html", "privacy.html", "terms.html"];

export function buildSitemap() {
  const urls = [
    ...INDEXABLE_PAGES.map((p) => `${SITE}/${p}`),
    ...collectionSlugs().map((s) => `${SITE}/collection/${s}/`),
    ...visibleSkus().map((s) => `${SITE}/product/${skuSlug(s)}/`),
  ];
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${u}</loc></url>`).join("\n")}\n</urlset>\n`;
  return { xml, count: urls.length, products: visibleSkus().length, collections: collectionSlugs().length, pages: INDEXABLE_PAGES.length };
}
