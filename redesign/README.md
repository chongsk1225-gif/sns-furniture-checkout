# SNS Furniture: redesign

The complete customer-facing site (every page a visitor can reach) lives here. It is rendered from
templates and the existing catalog data; **nothing under `public/data` is edited** by it.

```bash
node redesign/serve.mjs        # preview at http://127.0.0.1:8810/ (renders every page on demand)
npx wrangler dev --port 8787   # local checkout API, proxied by the preview at /api
node redesign/build.mjs [dir]  # write the whole site to a static folder (default redesign/dist)
```

## Where things are

| Folder | What it holds |
|---|---|
| `pages/` | One file per fixed page (home, custom hub, design services, rooms, cart, checkout, policies, 404). |
| `templates/` | Shared templates: product, collection, room (living, dining, bedroom, mattresses, accent), custom room. |
| `partials/` | Header, footer, sub-navigation, head, logo. |
| `lib/` | The assembler (`includes.mjs`), URL routes (`routes.mjs`), product and collection pages, sitemap, merchant feed. |
| `luxe/` | The design system: `luxe.css`, scripts, fonts, owned images in `media/`, brand SVGs. |
| `data/` | `luxe-media.json` (per-product media roles) and `luxe-custom.json` (confirmed custom options). |
| `seo/` | `robots.txt`, `llms.txt`, `ai.txt`. |

## Generated URLs

- `/product/<sku-slug>/` is a complete HTML page for every visible product (name, price, specifications, gallery,
  Product / Offer / BreadcrumbList data, related products from the same collection). `/product.html?sku=` still
  works and forwards to it. Hidden products have no page.
- `/collection/<name>/` is a complete HTML page for every collection with two or more pieces.
- Room pages ship their first 24 products as real HTML, then continue in the browser.
- `sitemap.xml` lists pages, collections and visible products only.

## Rules that must stay true

1. The 188 hidden products stay hidden: no page, no sitemap entry, no feed row, and the checkout Worker rejects them
   (`public/data/catalog-blocked.json`, `src/lib/catalog.js`). Run `npm run validate:catalog` and `npm run test:checkout-security`.
2. Prices and product records are never changed here. Grids only choose which of a product's own images to show.
3. Photography is never up-scaled: images 320 px or smaller render at native size, centred.
4. Custom Furniture copy is consultation-led. Do not add capabilities, materials, lead times or warranties until the
   owner confirms them; confirmed options go in `data/luxe-custom.json` and appear automatically.
5. ACME and Furniture of America are named only under Stock Furniture (hub, catalog filters, product data).
6. Public brand is SNS Furniture; the legal disclosure ("a fictitious business name operated by Sash & Shade") is in
   the footer and on About and the policy pages. Policy text is otherwise word-for-word.

## Hero media

`luxe/hero-media.json` documents the Sigma 1006/1007 photographs and where genuine video goes. The opening is a
CSS-only reveal with reduced-motion, data-saver and no-JavaScript fallbacks; the final frame is the unaltered photograph.

## Merchant feed

`build.mjs` writes `_feeds/google-merchant.tsv` (visible, priced products) and lists it in `.assetsignore` so it is
not deployed. Nothing is submitted. Review `FEED_AVAILABILITY` in `lib/feed.mjs` before using it.

## Before promoting to production

Production is not touched by this folder. Promotion is a deliberate step: build with `node redesign/build.mjs`, copy
the output over a copy of `public/`, regenerate the pricing index (`npm run build`), review, and deploy only with the
owner's explicit approval. Note the Cloudflare file limit (about 10,000 files in the build).

## QA record (final review candidate)

Run against the preview on 2026-10-05. Scripts are not committed; each check is described so it can be repeated.

| Check | Result |
| --- | --- |
| Full build (`npm run build:redesign`) | 9,851 generated pages and data files (9,181 product pages, 633 collection pages, the rest site pages and derived data); sitemap 9,836 URLs; merchant feed 9,181 rows (not deployable until the owner decides availability) |
| Static verification of every generated page | 717,932 internal links, 0 unresolved; 29,502 JSON-LD blocks, 0 invalid; 0 wrong canonicals; 0 missing descriptions or og:image; 0 duplicate titles; exactly one h1 per page; 85,194 images, 0 without alt |
| Hidden products | 188 hidden SKUs: 0 pages generated, 0 links, 0 in sitemap, 0 in feed. Their URLs return a real 404 with noindex, no Add to Cart and no product data. A cart holding all 188 shows "no longer available online" on every row and offers no checkout. The checkout page disables payment. |
| Checkout security (`npm run test:checkout-security`) | 23/23 |
| Catalog validation (`npm run validate:catalog`) | OK: 9,181 visible, 188 hidden, 0 duplicate SKUs |
| Existing regression suite (`npm run regression`) | all checks passed |
| axe-core (WCAG 2 A/AA, 2.1 A/AA, best practice) | 0 violations on 48 page views (24 routes x desktop and mobile) |
| Keyboard-only | menu and search dialogs trap focus, close on Esc, return focus to their button |
| Hero modes | reduced motion, data saver, JavaScript disabled and blocked image all pass; normal motion starts dark and reveals |
| Responsive sweep | 105 page views (35 routes x 1440 desktop, 820 tablet, 390 mobile): no horizontal scroll, no console errors, no failed owned assets, CLS under 0.1. The only flags are on About, which carries the required legal line "SNS Furniture is a fictitious business name operated by Sash & Shade." |
| Order states | pending, paid, declined, canceled and not-found render in the new design on desktop and mobile (mocked API); cancel calls the cancel endpoint once |
| Image audit | 318 images on 13 pages x 2 viewports: 0 upscaled, 0 missing width/height; below-the-fold images lazy |

### Lighthouse (local preview, Lighthouse 12 defaults)

Accessibility, Best Practices and SEO are 100 on every page except Cart, whose SEO score is 66 because the cart is deliberately `noindex`. 

Mobile performance: Home 99, Custom Furniture 92, Custom Living 91, Design Services 96, Room Inspiration 99, Contact 97, Stock hub 97, Cart 98, Product 87, Living 77, Collection 75, Collections 68. Desktop performance is 94-100 on every page. CLS is 0.043 or lower on every run.

Known limitation, accepted: Product, Living, Collection and Collections score lower on mobile because their lead image is a 0.4-1 MB manufacturer photograph served from the manufacturer's host. Those images are not resized by this overlay; consistent studio photography in `ASSET_REQUEST.md` is the real fix. Scores on these pages vary run to run with the manufacturer's network.
