# SNS Furniture — product image pipeline

Resumable, rate-limited collection + verification of **exact-SKU** product images for the
9,369-product ACME + Furniture of America catalog. Fixes 223×223 thumbnails and builds genuine
multi-image galleries.

**This tool never touches** checkout code, Authorize.Net, D1, TaxJar, prices, SKUs, policies,
DNS, or `public/` — it writes only to `image-pipeline/pipeline.db`, `reports/`, and `proposed/`.
`public/data/` is changed only after the account owner reviews and approves.

## Sources (allowed)

- Official ACME site + CDN (`www.acmecorp.com`), official FOA CDN (`cdn.foagroup.com`) and
  product pages (`www.foagroup.com`).
- Supplied: `C:\Users\chong\Downloads\acme_product_image_links_2026_09_08.csv` — the official
  ACME image feed (100% SKU coverage, ~6 images/SKU).
- Retailer pages may be read to *discover* a manufacturer CDN URL; retailer-hosted images are
  classified `retailer_owned_permission_required` and go to a report, never the auto gallery.
- Never: marketplaces, AI images, upscaled thumbnails, neighbouring-SKU / other-colour /
  other-size / other-config / other-orientation images, duplicates-as-multiples.

## Run (Node 24+, `node:sqlite`)

```
cd image-pipeline
npm install

# Milestone 1 — ACME
node 01-seed.mjs
ACME_RPS=8 node 02-fetch.mjs --brand acme --concurrency 12   # resumable — re-run to continue
node 03-verify.mjs --brand acme
node 04-report.mjs --brand acme        # -> reports/ACME-before-after.md + exception CSVs
node 05-build-dataset.mjs --brand acme # -> proposed/data/ (NOT public/)
node serve-proposed.mjs                # review at http://127.0.0.1:8799/

# Milestone 2 — FOA (adds a page-scrape step; multi-session)
node 02-fetch.mjs --brand foa ...
```

`02-fetch.mjs` writes every row as it goes; kill it any time and re-run — it skips rows already
`fetched`/`verified`/`rejected`. `--sku <SKU>` / `--origin <o>` / `--limit N` scope a run.
`--retry-errors` re-attempts transient failures.

## Data model (`pipeline.db`)

- `products` — one per catalog SKU: current (before) image/gallery, and the computed
  `resolution` (`official_multi` | `verified_single_image` | `unresolved`) + `final_*`.
- `candidate_images` — one per (SKU, source URL): origin, resolved URL, HTTP status, bytes,
  pixel `width`/`height`, `sha256`, `phash` (64-bit dHash), `sku_token_in_url`, the 10-point
  `match_json` evidence, `dup_of`, `rights_class`, `reject_reason`, `status`, `gallery_rank`.
- `runs` — phase audit trail with counts.
