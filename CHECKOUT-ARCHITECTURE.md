# SNS Furniture — Authorize.Net Accept Hosted Checkout

**Status:** the **`sns-furniture-staging` Worker is deployed** and passing every automated check
against its live URL. It is Authorize.Net **sandbox** only, **delivery only**, **California
delivery addresses only**, with a **real CDTFA city/county district rate table** (no third-party
tax API, no account, no secret) as the tax authority, and a **flat $150.00 delivery fee** on
every order. The one remaining step is you privately setting the Authorize.Net sandbox secrets
(§5).

- Staging URL: `https://sns-furniture-staging.chongsk1225.workers.dev` (workers.dev only — **no
  custom domain, no route, not connected to snsfurniture.com**).
- Staging D1: `sns-furniture-orders-staging` (`a918004f-b3b0-49e2-94f3-67349986bb6d`), migrated.
- Already set on staging: `CSRF_SIGNING_SECRET` (app-internal random HMAC key, generated and set
  via stdin — not a third-party credential, rotatable).
- **Pending (you):** `AUTHORIZE_NET_API_LOGIN_ID`, `AUTHORIZE_NET_TRANSACTION_KEY`,
  `AUTHORIZE_NET_SIGNATURE_KEY`, `AUTHORIZE_NET_ENVIRONMENT=sandbox`. Until these are set,
  `create-token` correctly returns `502 payment_init_failed` and no payment token is created
  (tax-quote already works with zero secrets — see §4).

Repo: `C:\Users\chong\Downloads\SNS-FURNITURE-CHECKOUT\`
Production Worker `sns-furniture` / `snsfurniture.com`: **untouched** — still assets-only version,
zero secrets, `/api/*` → 404 (verified). `sashandshade` / its Cloudflare project,
DNS, email, `benjihub.com`, `bold-frog-90b7`: not touched.

---

## 1. Architecture

### Shape
The site stays a Cloudflare **Workers Static Assets** project; a Worker script is added
alongside the assets. Static files are served first; the script only ever runs for
`/api/checkout/*`. No `routes`/`route` in the config, so the custom domain is not involved.

```
Browser (cart in localStorage: only [{sku,qty}])
   │  GET  /api/checkout/session      → signed double-submit CSRF token (HttpOnly cookie)
   │  POST /api/checkout/tax-quote    → looks the delivery city up in the CDTFA district rate
   │       (delivery only)              table and returns subtotal + tax + $150 flat shipping;
   │                                    else 409 tax_unavailable / 422 ca_delivery_only /
   │                                    422 address_unverifiable
   │  POST /api/checkout/create-token → re-runs the same rate-table lookup FIRST, then
   │                                    validates/prices, writes pending order (D1, incl.
   │                                    shipping_cents), and only then requests a one-time
   │                                    Accept Hosted token for subtotal + tax + shipping
   ▼
Authorize.Net hosted payment page   ← card data AND the cardholder billing address (incl.
   │  (customer pays)                   billing ZIP, for AVS) are entered here, never on our
   │                                    origin. Billing address is NOT taken from the delivery
   │                                    address and may differ.
   ├─ browser redirected to /checkout-approved.html?ref=…  (return URL — informational only)
   └─ Authorize.Net → POST /api/checkout/webhook
          verify X-ANET-Signature (HMAC-SHA512, Signature Key)
          → getTransactionDetailsRequest (re-fetch, authoritative)
          → amount must equal the server-computed order total (subtotal + tax + shipping)
          → order pending → paid  (stores transId, authCode, card brand + last4 only)
   ▼
/order-confirmation.html?ref=…  polls /api/checkout/confirm → shows paid status,
                                order number + Authorize.Net transaction reference
```

An order is **never** marked paid from the customer return URL. Only the signature-verified
webhook + server-side `getTransactionDetailsRequest` can do that.

### Payment model (as approved)
- **Delivery only.** There is no pickup option anywhere in the flow. The customer's complete
  **California delivery address** is collected before payment and is the destination used for
  sales-tax calculation.
- Customer pays **merchandise + applicable sales tax + a flat $150.00 delivery fee**. The fee is
  the same on every order regardless of size, weight, or distance — no tiers, no calculation.
  It is not itself taxed (separately stated line item).
- **California delivery addresses only for launch.** The Worker rejects any non-CA state, a
  non-California ZIP (outside 90001–96162), or a non-US country with `422 ca_delivery_only`; the
  checkout form offers California as the only state and locks the country to the US.
- Disclosed before payment, verbatim:
  > "Your payment covers merchandise, applicable sales tax, and a flat $150.00 delivery fee. We
  > will contact you to confirm availability and schedule delivery after your order is placed."
- "Orders remain subject to inventory and availability confirmation" shown at checkout and on the receipt.
- Unavailable-after-paid: receipt links the published cancellation/refund path; order status
  supports `refund_requested` / `refunded` for you to action via Authorize.Net.

### Server-side price authority
`scripts/build-pricing-index.mjs` derives `public/data/catalog-pricing.json`
(`{SKU: {p: unitPriceCents, n, b}}`, 9,369 entries) from the same `catalog-index.json` the
storefront renders. Build **fails** unless it emits exactly 9,369 priced SKUs. The Worker loads
this map and, per request, reads **only `{sku, qty}`** from the browser — every price, line
total, subtotal, tax, shipping and grand total is recomputed server-side. Catalog prices, SKUs,
images and specs were not modified.

### Data (Cloudflare D1 — `sns-furniture-orders`, staging `sns-furniture-orders-staging`)
`migrations/0001_init.sql` + `migrations/0002_add_shipping.sql`: `orders` (with
`delivery_address`, `shipping_cents` — flat $150.00, `DEFAULT 15000` so it backfills safely),
`order_items`, `rate_limit`, `webhook_events`. Money stored as integer cents. Card data stored:
**brand + last4 only**. No PAN, no CVV, ever.

---

## 2. Files

### New — Worker
| File | Purpose |
|---|---|
| `wrangler.jsonc` | adds `main`, `assets.binding`, `d1_databases`, `[env.staging]`; keeps `preview_urls:false`, no routes |
| `src/worker.js` | router; assets fall through; generic 500, never leaks internals |
| `src/lib/security.js` | JSON I/O, origin allow-list, signed double-submit CSRF, D1 rate limiter, HMAC, constant-time compare, field validators |
| `src/lib/catalog.js` | loads pricing map; `validateCart` (unknown SKU / bad qty → 422; qty 1–25; caps) |
| `src/lib/tax.js` | `getTaxProvider` / `computeTax` — looks the delivery city up in `ca-district-tax-rates.json` (CDTFA-95, no external call, no secret); unmatched city → `422 address_unverifiable`, never guessed |
| `src/lib/ca-district-tax-rates.json` | machine-parsed copy of CDTFA-95 ("California Sales and Use Tax Rates by County and City"), effective 2026-07-01: 483 incorporated-city combined rates + 58 county default rates |
| `src/lib/authorizenet.js` | Accept Hosted token request (merchandise + delivery line items), `getTransactionDetails`, webhook HMAC-SHA512 verify |
| `src/lib/orders.js` | D1 CRUD, order-number generator (`SNS-YYYYMMDD-XXXXXX`), idempotent `markPaid`, webhook ledger |
| `src/routes/*.js` | `session`, `taxQuote`, `createToken`, `confirm`, `cancel`, `webhook`; `_common.js` also defines `SHIPPING_CENTS = 15000` |
| `migrations/0001_init.sql`, `migrations/0002_add_shipping.sql` | D1 schema |
| `scripts/build-pricing-index.mjs` | pricing index build + 9,369 assertion |
| `scripts/regression-check.mjs` | storefront + checkout smoke test |
| `package.json`, `.gitignore`, `.dev.vars.example` | tooling; `.dev.vars` is git-ignored |

### New — storefront pages (`public/`)
`cart.html` + `cart.js`, `checkout.html` + `checkout.js`,
`checkout-approved.html`, `order-confirmation.html`, `checkout-declined.html`,
`checkout-cancel.html` + shared `checkout-status.js`,
generated `data/catalog-pricing.json`.
All reuse the existing header/footer/promo markup and the "Sash and Shade" branding. Every page
that shows an order total now has a "Delivery (flat fee)" row alongside subtotal and tax.

### Edited — storefront
| File | Change |
|---|---|
| `public/site.js` | `SnsCart` module (localStorage `[{sku,qty}]` only); persistent "CART n" header indicator; delegated `.add-cart` handler; `card()` gains an ADD TO CART button |
| `public/product-page.js` | ADD TO CART + VIEW CART in `.actions`; "merchandise + tax + flat $150 delivery fee / California only" note |
| `public/styles.css` | appended one `/* Cart & checkout */` block + mobile rules; no existing rule changed |
| **all 21 `public/*.html`** | top strip "VISIT OUR SHOWROOM AT 1575 WESTWOOD BLVD" → "CALIFORNIA DELIVERY STATEWIDE" (30 occurrences) |
| `public/returns.html` | removed "our showroom" as a sales channel; removed two "pickup" words from the return-transport / non-refundable-charge clauses |
| `public/checkout.html` | removed the pickup vs. delivery-quote fulfillment radios; "Billing address" panel → **"Delivery address"** (California-only, state fixed to CA, country locked to US); order summary shows a live "Delivery (flat fee)" line; new disclosure text |
| `public/checkout.js` | fulfillment hard-set to `delivery`; tax gated on a valid delivery ZIP; California client guard; sends `delivery` (not `billing`); renders `shippingCents` from the tax-quote/create-token response |
| `public/checkout-status.js` | removed the pickup branch; receipt shows the paid delivery fee |
| `public/cart.js` | summary shows the $150 flat delivery line and includes it in the estimated total |

### Edited — Worker
| File | Change |
|---|---|
| `src/routes/_common.js` | `parseDeliveryAddress` (enforces CA state + CA ZIP + US country → `ca_delivery_only`); `FULFILLMENT = "delivery"` and `SHIPPING_CENTS = 15000` constants; dropped `parseFulfillment`/`parseBilling` |
| `src/routes/taxQuote.js`, `src/routes/createToken.js` | require a California `delivery` address; fulfillment always `delivery`; response/total includes `shippingCents`; delivery address is the tax destination + Authorize.Net `billTo` prefill |
| `src/lib/orders.js`, `migrations/0001_init.sql`, `migrations/0002_add_shipping.sql` | `orders.billing_address` column → `delivery_address`; added `shipping_cents` |
| `src/lib/tax.js` | TaxJar removed entirely; replaced with the CDTFA district-rate-table lookup (`src/lib/ca-district-tax-rates.json`) — no external API, no account, no secret |

`catalog-index.json`, `data/details/*`, and the catalog/marketing HTML **content** are unchanged
(only the shared top-strip span differs). `terms.html` / `privacy.html` legal body text is unchanged;
`returns.html` changed only as noted above.

---

## 3. Security review

| Control | Implementation | Verified |
|---|---|---|
| HTTPS only | Cloudflare edge; `Secure` cookies | — |
| Origin / CSRF | `Origin`/`Referer` allow-list + `X-CSRF-Token` header matched to an **HMAC-signed HttpOnly cookie** on every state-changing call | 403 on missing/foreign origin; 403 on missing/blank CSRF |
| JSON only | non-`application/json` → 415; body cap 16 KB | ✓ |
| Price/total tamper | server ignores client `price`/`unitPriceCents`/`name`/`subtotalCents`/`totalCents`; recomputes from SKU map, tax table, and the fixed `SHIPPING_CENTS` constant | client sent `price:1,total:1` → server returned true totals |
| Quantity abuse | integer 1–25/line, ≤100 total, subtotal ≤ $100k | qty 0 / 999 → 422 |
| Invalid SKU | unknown SKU → 422 `invalid_sku` | ✓ |
| Rate limiting | D1 fixed window per IP: `create-token` 8/min, `tax-quote` 20/min, `cancel` 20/min → 429 + `retry_after` | 429 after the limit; bucket persisted |
| Webhook authenticity | HMAC-SHA512 of raw body with Signature Key, constant-time compare | valid sig → processed; tampered body / bad sig → 401 |
| Webhook idempotency | `webhook_events` ledger keyed by `notificationId`; `markPaid` only advances `pending`; replay is a no-op | replay → `{duplicate:true}` |
| Return-URL trust | return page only *polls* status; paid set solely by webhook + `getTransactionDetails`; amount must equal order total (subtotal + tax + shipping) | webhook with unresolvable txn → `unverified`, order stays `pending` |
| No card storage | schema has only `card_brand`, `card_last4`; no PAN/CVV path exists | confirm payload exposes `{brand:"Visa",last4:"1111"}` only |
| Billing / AVS | cardholder billing address + billing ZIP entered on the Authorize.Net hosted page (`hostedPaymentBillingAddressOptions {show,required}`); the Worker sends **no `billTo`** — billing is never derived from the delivery address and may differ | code review + `billTo` removed from the request |
| Address authority | `src/lib/tax.js` looks the delivery city up directly in the CDTFA rate table; an address whose city isn't in the table (or whose state/ZIP isn't California) is rejected with `422` **before** an order row or payment token is created — never guessed at a nearby rate | live lookup with an out-of-table city → `422 address_unverifiable`, 0 orders created |
| No external tax dependency | tax computation is a static, offline lookup — no network call, no account, no API key, nothing that can be down or rate-limited | code review |
| PII exposure | `/confirm` returns items + amounts + status + txn ref only — **no name/email/phone/address** | ✓ |
| Secrets | only `wrangler secret put` (encrypted) or local git-ignored `.dev.vars`; never logged/returned; error bodies are generic codes | ✓ |
| Order-state machine | `cancel` moves only `pending`→`canceled`; never touches `paid`/`failed` | paid order cancel → stays `paid` |
| localStorage / URLs | cart = `[{sku,qty}]` only; no customer or payment data in storage or query strings | ✓ |

**Residual items (not blockers, disclosed):**
- `/api/checkout/confirm?ref=` is unauthenticated. It returns no PII and no card data, but a
  guessed order number would reveal line items + amount + status. Order numbers are
  `SNS-<date>-<6 Crockford-base32>` (~1e9 space). Acceptable for launch; can be tightened to
  require the session cookie post-launch if desired.
- Emails (customer receipt, merchant notification) are handled by Authorize.Net's own receipt
  settings in this build — no custom mail path was added.
- The CDTFA rate table is a point-in-time snapshot (effective 2026-07-01, sourced from
  `SalesTaxRates07-01-26.xlsx`, CDTFA's official publication). CDTFA updates rates up to four
  times a year (Jan 1 / Apr 1 / Jul 1 / Oct 1). **This needs to be refreshed each quarter** — see
  §4.

---

## 4. Tax + delivery fee

**No rate is hard-coded in JavaScript.** `src/lib/ca-district-tax-rates.json` is a direct,
machine-parsed copy of **CDTFA-95** ("California Sales and Use Tax Rates by County and City"),
the California Department of Tax and Fee Administration's own official rate publication — 483
incorporated cities, each with its own combined state + county + city + district rate, plus all
58 counties' default rate for addresses not in an incorporated city. Verified cross-referenced
against two independent CDTFA downloads (the PDF form and the Excel table) before use.

At checkout:
- delivery state must be `CA` and the ZIP must fall in the California range (90001–96162), else `422 ca_delivery_only`
- the delivery **city** (normalized: trimmed, case-folded, "City of"/"Town of" stripped) is looked up directly in the table
- found → that city's exact combined rate is applied to the merchandise subtotal (not the delivery fee)
- **not found → `422 address_unverifiable`, no rate is guessed.** This mirrors CDTFA's own
  published guidance ("some communities may not be listed... please call our toll-free number").
  In practice this only affects unincorporated place names that aren't one of the 483 listed
  cities; the checkout UI shows the same "please call" message already built for this case.
- no provider configured (misconfiguration) → `409 tax_unavailable`

All of this runs **before** any order row or Authorize.Net token is created. The checkout UI
disables the pay button and shows the matching message.

| Case | Handling |
|---|---|
| **California delivery address, matched city** (the common case) | exact CDTFA combined rate for that city, e.g. Burbank 10.50%, Culver City 10.75%, Beverly Hills 9.75%, Santa Monica 10.75%, Long Beach 10.50%, Torrance 10.25%, Lancaster/Palmdale 11.25% |
| **California delivery address, unincorporated area not in the table** | Rejected at checkout (`422 address_unverifiable`). No order, no token. |
| **Out-of-state / non-CA ZIP** | Rejected at checkout (`422 ca_delivery_only`). No order, no token. |

**Delivery fee:** flat **$150.00** (`SHIPPING_CENTS = 15000` in `src/routes/_common.js`), added
to every order after tax, on top of the taxable merchandise subtotal — no tiers, no per-item or
per-mile calculation. It is treated as a separately stated delivery charge and is **not** itself
subject to sales tax (California generally does not tax a delivery charge that is separately
stated on the invoice — CDTFA Publication 100). If you'd rather it be taxed, or priced
differently by order size, say so and it's a small change in `createToken.js`/`taxQuote.js`.

**Keeping the rate table current:** CDTFA republishes this table up to 4×/year. To refresh it:
1. Download the current "Tax Rates Effective <date>" Excel file from
   `https://www.cdtfa.ca.gov/taxes-and-fees/sales-use-tax-rates.htm`.
2. Re-run the extraction (unzip the `.xlsx`, parse `xl/sharedStrings.xml` + `xl/worksheets/sheet1.xml`
   for the `Location / Rate / County / Type` columns — the same approach used to build the
   current file) to regenerate `src/lib/ca-district-tax-rates.json`.
3. Update `effectiveDate` in that file and redeploy. No code changes needed elsewhere.
The next scheduled CDTFA update after this one is **October 1, 2026**.

**Before production:** create a production D1, set the **production** Authorize.Net keys +
`AUTHORIZE_NET_ENVIRONMENT=production`, confirm `TAX_PROVIDER="ca-district-table"` (already the
top-level default in `wrangler.jsonc`), and confirm the rate table is still current for the
production launch date. Then `wrangler deploy` (no routes change).

There is **no pickup / point-of-sale scenario** — pickup was removed from the checkout entirely.

---

## 5. Exact secure credential-entry procedure

Credentials are entered **only** through `wrangler secret put`, which reads the value from a
hidden stdin prompt (or piped stdin), encrypts it at Cloudflare, and never writes it to disk,
Git, logs, or any response. Do **not** paste credentials into chat.

### What to get before you start
Sign up (if you haven't) at **https://developer.authorize.net/hello_world.html** — this creates a
**free Authorize.Net sandbox account**, separate from your live merchant account. From the
sandbox merchant portal (`https://sandbox.authorize.net/`), under **Account → Settings → Security
Settings → API Credentials & Keys**, get:
- **API Login ID**
- **Transaction Key** (generate one if you don't have one)
- **Signature Key** (a separate value, same page — used to verify webhook authenticity)

These are **test-mode-only** values tied to the sandbox account; they cannot move real money.
Your **live/production** API Login ID + Transaction Key (which you said you already have) come
from your real Authorize.Net merchant account instead — keep them separate, never in the same
`.dev.vars` or staging secret set as the sandbox values.

### Already done for staging (no action needed)
- `sns-furniture-staging` Worker deployed (workers.dev only, no custom domain).
- `sns-furniture-orders-staging` D1 created + migrated.
- `CSRF_SIGNING_SECRET` set (random app-internal HMAC key — not a third-party credential).
- `wrangler.jsonc` `[env.staging]` sets `TAX_PROVIDER="ca-district-table"` — no tax secret needed.

### You do this now — in an interactive terminal in `C:\Users\chong\Downloads\SNS-FURNITURE-CHECKOUT`
```bash
npx wrangler secret put AUTHORIZE_NET_API_LOGIN_ID    --env staging   # paste your SANDBOX API Login ID
npx wrangler secret put AUTHORIZE_NET_TRANSACTION_KEY --env staging   # paste your SANDBOX Transaction Key
npx wrangler secret put AUTHORIZE_NET_SIGNATURE_KEY   --env staging   # paste your SANDBOX Signature Key
npx wrangler secret put AUTHORIZE_NET_ENVIRONMENT     --env staging   # type:  sandbox
```
Each command pauses for hidden stdin input — type/paste the value and press Enter. Nothing you
type is echoed or sent to me.

Then, in the **Authorize.Net sandbox** merchant portal → Account → Webhooks, add an endpoint for
event `net.authorize.payment.authcapture.created` (and `...refund.created` if you want refund
sync) pointing at:
`https://sns-furniture-staging.chongsk1225.workers.dev/api/checkout/webhook`

`npx wrangler secret list --env staging` shows only names, never values. No redeploy is needed
after adding secrets — they take effect on the next request.

### Production (`sns-furniture`) — ONLY after staging passes and you explicitly approve
```bash
npx wrangler d1 create sns-furniture-orders
# paste database_id into wrangler.jsonc → top-level d1_databases[0].database_id
npx wrangler d1 migrations apply sns-furniture-orders --remote

npx wrangler secret put CSRF_SIGNING_SECRET              # a fresh random string
npx wrangler secret put AUTHORIZE_NET_API_LOGIN_ID       # your LIVE/production API Login ID
npx wrangler secret put AUTHORIZE_NET_TRANSACTION_KEY    # your LIVE/production Transaction Key
npx wrangler secret put AUTHORIZE_NET_SIGNATURE_KEY      # your LIVE Signature Key (production portal)
npx wrangler secret put AUTHORIZE_NET_ENVIRONMENT        # enter:  production

npx wrangler deploy            # no routes change → snsfurniture.com custom domain untouched
# add the production Authorize.Net webhook → https://snsfurniture.com/api/checkout/webhook
```
`TAX_PROVIDER="ca-district-table"` is already the top-level default in `wrangler.jsonc` — no tax
secret to set for production either.

`wrangler secret list --env <env>` shows only names, never values.

---

## 6. Test results

Run locally (`wrangler dev`) **and** against the live `sns-furniture-staging` URL.

| Scenario | Result |
|---|---|
| Regression suite green **against the deployed staging URL** (9,369 products, all pages, CSRF cookie, no pickup/showroom on 16 pages) | ✓ |
| Staging `tax-quote` works with **zero secrets** (no external tax account needed) | ✓ live |
| Staging `create-token` before Authorize.Net secrets → `502 payment_init_failed`, order marked `failed`, no token | ✓ live |
| Staging served on `sns-furniture-staging.chongsk1225.workers.dev` only — **no route, no custom domain** | ✓ |
| Production `sns-furniture` unchanged — `[]` secrets, `snsfurniture.com/api/*` → 404 | ✓ |
| **AVS billing** — Worker sends no `billTo`; billing address + billing ZIP collected on the Authorize.Net hosted page and may differ from delivery | ✓ (code) |
| **CDTFA table is the address authority** — a delivery city not in the table → `422 address_unverifiable` on tax-quote **and** create-token; 0 orders created | ✓ |
| **CA-only enforcement** — non-CA state / non-CA ZIP / non-US country → `422 ca_delivery_only` on tax-quote **and** create-token; no order row created | ✓ |
| **Rate accuracy** — spot-checked Burbank 10.50%, Culver City 10.75%, Beverly Hills 9.75%, Long Beach 10.50%, Torrance 10.25% against the live CDTFA-95 publication | ✓ |
| **Flat delivery fee** — every quote/order includes exactly `shippingCents:15000`; not affected by cart size or address | ✓ |
| 9,369 products still load; pricing index = 9,369 | ✓ |
| Storefront pages, search/filter, product gallery + lightbox, policies, mobile nav | ✓ unchanged |
| Add to cart — product page **and** catalog card | ✓ |
| Cart quantity change, line removal, persistent indicator | ✓ |
| Checkout: order summary (subtotal, tax, $150 delivery, total), exact disclosure text, no pickup option, delivery-address panel, 2 required policy checkboxes | ✓ |
| **Delivery only** — no `fulfillment` radio in the DOM; a request body sending `fulfillment:"pickup"` is ignored and the order is stored as `delivery` | ✓ |
| **Pickup/showroom scrub** — no "pickup", "showroom", or "VISIT OUR SHOWROOM" wording on any storefront, checkout, or policy page (regression `scrubPages` over 16 pages) | ✓ |
| Tax + shipping + total only shown once the CA address resolves | ✓ |
| Required-field + policy-acceptance guards | ✓ |
| **Altered price / qty / name / totals in request body** | ✓ ignored — server recomputes |
| **Invalid SKU** | ✓ 422 |
| **Tax unavailable** (misconfigured `TAX_PROVIDER`) | ✓ `tax-quote` 409, `create-token` refuses token, UI blocks payment |
| **Duplicate submission** | ✓ webhook replay is a no-op (`duplicate`); `markPaid` only advances `pending` |
| **Declined / not-approved** webhook | ✓ order → `failed`, `/checkout-declined.html` shown, cart kept |
| **Canceled** | ✓ `pending`→`canceled`; paid order refuses cancel |
| Webhook signature: valid / tampered / missing | ✓ 200 / 401 / 401 |
| Amount-mismatch webhook (subtotal + tax + shipping must match settled amount) | ✓ order → `failed` (not paid) |
| Rate limiting on token + tax endpoints | ✓ 429 after limit |
| Order confirmation shows order # + Authorize.Net transaction ref + card brand/last4 + delivery fee | ✓ |
| **Mobile checkout** (375 px) — no horizontal scroll on cart / checkout / catalog / product | ✓ |
| CSRF / Origin enforcement | ✓ 403 |

**Not yet done (needs your sandbox Authorize.Net secrets on staging):** a real approved/declined
transaction on the Authorize.Net hosted page, a live webhook round-trip, and real-device mobile.

---

## 7. Where this stops — your move

Staging is deployed and every automated check passes, including live tax-quote calculations
(the tax path needs no secrets at all now). The next step is yours:

1. Get your Authorize.Net **sandbox** credentials (§5) and set the 4 secrets on staging with
   `wrangler secret put --env staging`.
2. Add the Authorize.Net **sandbox** webhook → the staging `/api/checkout/webhook` URL.

Then tell me and I'll walk you through a real sandbox test transaction using Authorize.Net's
published test card numbers (approved / declined / etc.), confirm the live webhook round-trip,
verify a real order lands correctly in D1 with the right subtotal/tax/$150-shipping/total split,
and re-run the full regression + rejection-case suite against the live staging URL.

**Production** (`sns-furniture` / `snsfurniture.com`) and any live charge happen only after that
passes and you explicitly approve. Nothing about production, DNS, email, `sashandshade.com`, or
the Sash & Shade Cloudflare project is touched by any of this.

---

**Storefront redesign.** The luxury storefront (every customer-facing page) lives in `redesign/` as an overlay that renders over `public/` without editing it; see `redesign/README.md` for routes, build and preview commands, and the rules it enforces (hidden products have no page, no feed row and no checkout path; prices come only from the server-side pricing index).
