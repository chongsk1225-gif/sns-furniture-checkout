// sitemap.xml for the redesigned site: every URL in the existing public sitemap is
// kept, except the intentionally hidden products (they must not be advertised to
// crawlers), plus the new indexable pages. Read-only over public/.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PUBLIC_ROOT } from "./includes.mjs";

const NEW_PAGES = ["custom-design.html", "stock-furniture.html", "collections.html"];

export function buildSitemap() {
  const blocked = new Set(JSON.parse(readFileSync(join(PUBLIC_ROOT, "data", "catalog-blocked.json"), "utf8")));
  let dropped = 0;
  const old = readFileSync(join(PUBLIC_ROOT, "sitemap.xml"), "utf8").replace(/ *<url><loc>[^<]*product\.html\?sku=([^<]+)<\/loc><\/url>\r?\n?/g, (m, sku) => {
    if (blocked.has(decodeURIComponent(sku))) { dropped++; return ""; }
    return m;
  });
  const have = new Set([...old.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]));
  const add = NEW_PAGES.map((p) => `https://snsfurniture.com/${p}`).filter((u) => !have.has(u));
  const xml = old.replace("</urlset>", add.map((u) => `  <url><loc>${u}</loc></url>\n`).join("") + "</urlset>");
  return { xml, added: add.length, dropped };
}
