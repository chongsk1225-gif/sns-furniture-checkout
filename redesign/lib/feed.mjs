// Merchant-feed readiness: a Google Merchant Center product data file (tab-separated) built from
// the visible, priced catalog. It is GENERATED ONLY. Nothing is submitted, no account is created,
// and the build keeps it out of the deployable site (_feeds/ is listed in .assetsignore).
//
// Review before ever submitting (owner decisions):
//   - AVAILABILITY: the site says "current availability is confirmed with your order". The feed
//     uses the value below for every product; change it if that is not accurate.
//   - Shipping (flat $150, California delivery only) and returns are declared here and/or in the
//     Merchant Center account settings; they mirror the published policies.
import { catalogIndex, catalogDetails, SITE } from "./includes.mjs";
import { cardImage, DIAGRAM } from "./cards.mjs";
import { productPath } from "./slug.mjs";

export const FEED_AVAILABILITY = "in_stock";
const clean = (s, n) => String(s ?? "").replace(/<[^>]+>/g, " ").replace(/[\t\r\n]+/g, " ").replace(/\s+/g, " ").trim().slice(0, n);

export function buildFeed() {
  const cols = ["id", "title", "description", "link", "image_link", "additional_image_link", "availability", "price", "condition", "brand", "mpn", "product_type", "shipping"];
  const rows = [cols.join("\t")];
  let n = 0;
  for (const p of catalogIndex()) {
    if (p.sale == null) continue;
    const d = catalogDetails().get(p.sku);
    if (!d || d.hidden === true) continue;
    const gal = (d.gallery || []).filter((u) => !DIAGRAM.test(u));
    const main = cardImage(p) || gal[0];
    if (!main) continue;
    const extra = gal.filter((u) => u !== main).slice(0, 10).join(",");
    const type = [p.category, p.type].filter(Boolean).join(" > ");
    const title = clean(`${p.name}${p.type ? ` ${p.type}` : ""}`, 150);
    const desc = clean(d.description || `${p.name} ${p.type || ""} from the ${p.collection || p.category} collection.`, 5000);
    rows.push([p.sku, title, desc, `${SITE}${productPath(p.sku)}`, main, extra, FEED_AVAILABILITY, `${Number(p.sale).toFixed(2)} USD`, "new", p.brand || "", p.sku, type, "US:CA:Delivery:150.00 USD"].join("\t"));
    n++;
  }
  return { tsv: rows.join("\n") + "\n", count: n };
}
