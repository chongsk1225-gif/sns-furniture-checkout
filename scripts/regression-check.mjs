/**
 * Storefront + checkout regression check against a running server.
 *   node scripts/regression-check.mjs [baseUrl]
 * default baseUrl: http://127.0.0.1:8787
 *
 * Confirms the catalog is intact (9,369 total SKUs, 9,181 browsable — 188 are
 * intentionally hidden for having no verifiable manufacturer photo) and every
 * storefront page plus the checkout pages/endpoints respond as expected.
 */
const BASE = (process.argv[2] || process.env.BASE || "http://127.0.0.1:8787").replace(/\/$/, "");
const EXPECTED_PRODUCTS = 9369;
const EXPECTED_BROWSABLE = 9181; // catalog-index.json excludes hidden (unverifiable-photo) products

let failures = 0;
function ok(name) {
  console.log(`  ok  ${name}`);
}
function bad(name, detail) {
  failures++;
  console.error(`FAIL  ${name}${detail ? " — " + detail : ""}`);
}

async function get(path, init) {
  const res = await fetch(BASE + path, init);
  const text = await res.text();
  return { res, text };
}

async function checkPage(path, ...needles) {
  try {
    const { res, text } = await get(path);
    if (res.status !== 200) return bad(`GET ${path}`, `status ${res.status}`);
    for (const n of needles) {
      if (!text.includes(n)) return bad(`GET ${path}`, `missing "${n}"`);
    }
    ok(`GET ${path}`);
  } catch (e) {
    bad(`GET ${path}`, String(e));
  }
}

async function scrubPages(paths, forbidden) {
  let clean = true;
  for (const path of paths) {
    try {
      const { res, text } = await get(path);
      if (res.status !== 200) {
        bad(`scrub ${path}`, `status ${res.status}`);
        clean = false;
        continue;
      }
      for (const re of forbidden) {
        const m = text.match(re);
        if (m) {
          bad(`scrub ${path}`, `contains forbidden ${re} → "${m[0]}"`);
          clean = false;
        }
      }
    } catch (e) {
      bad(`scrub ${path}`, String(e));
      clean = false;
    }
  }
  if (clean) ok(`no pickup/showroom wording on ${paths.length} pages`);
}

const run = async () => {
  console.log(`regression-check → ${BASE}`);

  // Catalog integrity
  try {
    const { res, text } = await get("/data/catalog-index.json");
    const arr = JSON.parse(text);
    if (res.status === 200 && Array.isArray(arr) && arr.length === EXPECTED_BROWSABLE) {
      ok(`catalog-index.json has ${EXPECTED_BROWSABLE} browsable products`);
    } else {
      bad("catalog-index.json", `status ${res.status}, length ${Array.isArray(arr) ? arr.length : "n/a"}`);
    }
  } catch (e) {
    bad("catalog-index.json", String(e));
  }

  try {
    const { res, text } = await get("/data/catalog-pricing.json");
    const map = JSON.parse(text);
    const n = Object.keys(map).length;
    if (res.status === 200 && n === EXPECTED_PRODUCTS) ok(`catalog-pricing.json has ${n} SKUs`);
    else bad("catalog-pricing.json", `status ${res.status}, keys ${n}`);
  } catch (e) {
    bad("catalog-pricing.json", String(e));
  }

  // Storefront pages unchanged and serving
  await checkPage("/", "Sash and Shade", "loadCatalog");
  await checkPage("/catalog.html", "Furniture Catalog", "renderAll");
  await checkPage("/product.html", "Loading product details", "product-page.js");
  await checkPage("/living-room.html", 'renderCategory("Living Room")');
  await checkPage("/mattresses.html", 'renderCategory("Mattresses")');
  await checkPage("/terms.html", "Terms &amp; Conditions", "Authorize.net");
  await checkPage("/returns.html", "Refund &amp; Return Policy", "restocking fee");
  await checkPage("/delivery.html", "delivery options");
  await checkPage("/privacy.html", "Privacy");
  await checkPage("/sitemap.xml", "<urlset");
  await checkPage("/site.js", "SnsCart", "add-cart");
  await checkPage("/styles.css", "Cart & checkout");

  // New checkout pages
  await checkPage("/cart.html", "Your Cart", "cart.js");
  await checkPage("/cart.js", "California delivery addresses only", "SnsCart");
  await checkPage("/checkout.js", 'FULFILLMENT = "delivery"', "ca_delivery_only", "address_unverifiable");
  await checkPage(
    "/checkout.html",
    "DELIVERY ADDRESS",
    "Your payment covers merchandise, applicable sales tax, and a flat $150.00 delivery fee",
    "California delivery addresses only",
    "terms.html",
    "returns.html",
  );
  await checkPage("/checkout-approved.html", 'data-mode="approved"');
  await checkPage("/order-confirmation.html", 'data-mode="confirmation"');
  await checkPage("/checkout-declined.html", 'data-mode="declined"');
  await checkPage("/checkout-cancel.html", 'data-mode="cancel"');

  // Delivery-only scrub: no pickup / showroom wording anywhere it was removed
  await scrubPages(
    ["/", "/catalog.html", "/product.html", "/cart.html", "/checkout.html",
     "/checkout-approved.html", "/order-confirmation.html", "/checkout-declined.html",
     "/checkout-cancel.html", "/terms.html", "/returns.html", "/privacy.html",
     "/delivery.html", "/site.js", "/checkout.js", "/checkout-status.js"],
    [/showroom/i, /pick[\s-]?up/i, /VISIT OUR SHOWROOM/i, /value="pickup"/i],
  );

  // API surface
  try {
    const { res, text } = await get("/api/checkout/session");
    const body = JSON.parse(text);
    const setCookie = res.headers.get("set-cookie") || "";
    if (res.status === 200 && body.csrfToken && /sns_csrf=/.test(setCookie) && /HttpOnly/i.test(setCookie)) {
      ok("GET /api/checkout/session issues an HttpOnly CSRF cookie");
    } else {
      bad("/api/checkout/session", `status ${res.status}, cookie "${setCookie.slice(0, 40)}"`);
    }
  } catch (e) {
    bad("/api/checkout/session", String(e));
  }

  try {
    const { res } = await get("/api/checkout/confirm?ref=SNS-20260101-ZZZZZZ");
    if (res.status === 404) ok("GET /api/checkout/confirm unknown ref → 404");
    else bad("/api/checkout/confirm unknown ref", `status ${res.status}`);
  } catch (e) {
    bad("/api/checkout/confirm", String(e));
  }

  try {
    const { res } = await get("/api/checkout/create-token", { method: "GET" });
    if (res.status === 405) ok("GET /api/checkout/create-token → 405");
    else bad("/api/checkout/create-token method guard", `status ${res.status}`);
  } catch (e) {
    bad("/api/checkout/create-token method guard", String(e));
  }

  console.log(failures ? `\n${failures} failure(s)` : "\nall checks passed");
  process.exit(failures ? 1 : 0);
};

run();
