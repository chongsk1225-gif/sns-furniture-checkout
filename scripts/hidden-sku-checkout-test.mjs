/**
 * Hidden-SKU checkout security test.
 *   node scripts/hidden-sku-checkout-test.mjs
 *
 * Bundles the real Worker (src/worker.js) with esbuild (a wrangler dependency,
 * present after `npm install`; override with ESBUILD_PATH) and drives it through
 * its real HTTP entry point with:
 *   - an ASSETS binding that serves the real public/ files,
 *   - a recording fake D1 (every statement is logged; orders are counted),
 *   - a fetch spy that records every outbound request (Authorize.Net included).
 * No network, no real database, no real credentials: the secrets below are
 * dummy test constants that exist only inside this process.
 *
 * Proves, for several of the 188 hidden SKUs and for request manipulation:
 *   - they cannot be added to a payable order (422, nothing priced),
 *   - no Authorize.Net request is ever made,
 *   - no order / order-item row is written,
 * and that a normal visible SKU still works (positive control), so the harness
 * is not simply rejecting everything.
 */
import { readFileSync, readdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC = join(ROOT, "public");

async function loadEsbuild() {
  const candidates = [process.env.ESBUILD_PATH, "esbuild"].filter(Boolean);
  for (const c of candidates) {
    try {
      return await import(c.includes("/") || c.includes("\\") ? pathToFileURL(join(c, "lib", "main.js")).href : c);
    } catch {}
  }
  throw new Error("esbuild not found: run `npm install` (wrangler depends on it) or set ESBUILD_PATH");
}

const esbuild = await loadEsbuild();
const out = join(mkdtempSync(join(tmpdir(), "sns-worker-")), "worker.mjs");
await (esbuild.build || esbuild.default.build)({
  entryPoints: [join(ROOT, "src", "worker.js")],
  bundle: true,
  format: "esm",
  platform: "neutral",
  outfile: out,
  loader: { ".json": "json" },
  logLevel: "error",
});
// Each case gets a fresh Worker instance: the Worker caches the pricing and
// blocked lists per isolate, and overrides must actually be read.
let instance = 0;
const freshWorker = async () => (await import(pathToFileURL(out).href + "?i=" + ++instance)).default;

/* ── fakes ─────────────────────────────────────────────────────────────────── */
const ORIGIN = "https://staging.test";
const statements = []; // every SQL statement prepared/run
const outbound = []; // every fetch() the Worker makes
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  outbound.push(String(url));
  if (/authorize\.net/i.test(String(url))) {
    return new Response(JSON.stringify({ token: "TEST-TOKEN", messages: { resultCode: "Ok" } }), { status: 200 });
  }
  throw new Error("unexpected outbound fetch " + url);
};

async function makeEnv(assetOverride = {}) {
  const worker = await freshWorker();
  const orders = [];
  const items = [];
  const DB = {
    prepare(sql) {
      statements.push(sql);
      const stmt = {
        _sql: sql,
        _args: [],
        bind(...a) { stmt._args = a; return stmt; },
        async first() { return null; },
        async run() { return { meta: { changes: 1 } }; },
        async all() { return { results: [] }; },
      };
      return stmt;
    },
    async batch(list) {
      for (const s of list) {
        if (/INSERT INTO orders/i.test(s._sql)) orders.push(s._args);
        if (/INSERT INTO order_items/i.test(s._sql)) items.push(s._args);
      }
      return [];
    },
  };
  const ASSETS = {
    async fetch(req) {
      const path = new URL(typeof req === "string" ? req : req.url).pathname;
      if (assetOverride[path] === "404") return new Response("nf", { status: 404 });
      const file = assetOverride[path] || join(PUBLIC, path);
      try {
        return new Response(readFileSync(file), { status: 200 });
      } catch {
        return new Response("nf", { status: 404 });
      }
    },
  };
  return {
    worker,
    env: {
      ASSETS,
      DB,
      ALLOWED_ORIGINS: ORIGIN,
      TAX_PROVIDER: "ca-district-table",
      CSRF_SIGNING_SECRET: "dummy-test-csrf-secret-not-real",
      AUTHORIZE_NET_API_LOGIN_ID: "dummy-test-login",
      AUTHORIZE_NET_TRANSACTION_KEY: "dummy-test-key",
      AUTHORIZE_NET_SIGNATURE_KEY: "abcd",
      AUTHORIZE_NET_ENVIRONMENT: "sandbox",
    },
    orders,
    items,
  };
}

async function session(worker, env) {
  const r = await worker.fetch(new Request(ORIGIN + "/api/checkout/session"), env);
  const { csrfToken } = await r.json();
  const cookie = r.headers.get("set-cookie").split(";")[0];
  return { csrfToken, cookie };
}

const DELIVERY = { line1: "100 Test St", city: "Los Angeles", state: "CA", zip: "90012", country: "United States" };
const CUSTOMER = { name: "Test Buyer", email: "test@example.com", phone: "3105550100" };

async function post({ worker, env }, path, body, extra = {}) {
  const { csrfToken, cookie } = await session(worker, env);
  const res = await worker.fetch(
    new Request(ORIGIN + path, {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN, "x-csrf-token": csrfToken, cookie },
      body: JSON.stringify({ customer: CUSTOMER, delivery: DELIVERY, acceptTerms: true, acceptRefundPolicy: true, ...body, ...extra }),
    }),
    env,
  );
  let data = null;
  try { data = await res.json(); } catch {}
  return { status: res.status, data };
}

/* ── data ──────────────────────────────────────────────────────────────────── */
const details = [];
for (const f of readdirSync(join(PUBLIC, "data", "details"))) details.push(...JSON.parse(readFileSync(join(PUBLIC, "data", "details", f), "utf8")));
const hidden = details.filter((d) => d.hidden === true).map((d) => d.sku);
const visibleSku = JSON.parse(readFileSync(join(PUBLIC, "data", "catalog-index.json"), "utf8"))[0].sku;
const pick = [hidden[0], hidden[Math.floor(hidden.length / 2)], hidden[hidden.length - 1], "AM-SL110-F", "CM4915-3PK"].filter((s, i, a) => hidden.includes(s) && a.indexOf(s) === i);

/* ── harness ───────────────────────────────────────────────────────────────── */
let failures = 0;
const results = [];
function check(name, cond, detail = "") {
  results.push({ name, ok: !!cond });
  console.log(`${cond ? "  ok  " : "FAIL  "}${name}${detail ? "  — " + detail : ""}`);
  if (!cond) failures++;
}
function snapshot(e) { return { orders: e.orders.length, items: e.items.length, outbound: outbound.length }; }

async function expectRejected(label, path, lines, extra, assetOverride) {
  const e = await makeEnv(assetOverride);
  const stmtStart = statements.length;
  const before = snapshot(e);
  const r = await post(e, path, { lines }, extra);
  const after = snapshot(e);
  const wrote = statements.slice(stmtStart).filter((s) => /INSERT INTO (orders|order_items)|UPDATE orders/i.test(s));
  check(
    `${label}`,
    r.status >= 400 &&
      after.orders === before.orders && after.items === before.items &&
      after.outbound === before.outbound && wrote.length === 0 &&
      !(r.data && (r.data.token || r.data.orderNumber)),
    `HTTP ${r.status} ${r.data && r.data.error ? r.data.error : ""} · orders ${after.orders} · order_items ${after.items} · outbound calls ${after.outbound - before.outbound} · order SQL ${wrote.length}`,
  );
  return r;
}

console.log(`\nHidden SKUs under test: ${pick.join(", ")}  (of ${hidden.length} hidden) — visible control: ${visibleSku}\n`);

// 0. positive control: a visible SKU still reaches an order + exactly one Authorize.Net token request
{
  const e = await makeEnv();
  const o0 = outbound.length;
  const r = await post(e, "/api/checkout/create-token", { lines: [{ sku: visibleSku, qty: 1 }] });
  const calls = outbound.slice(o0).filter((u) => /authorize\.net/i.test(u)).length;
  check("control: visible SKU creates 1 order and requests 1 Authorize.Net token", r.status === 200 && r.data && r.data.token === "TEST-TOKEN" && e.orders.length === 1 && calls === 1, `HTTP ${r.status} · orders ${e.orders.length} · token calls ${calls}`);
  const q = await post(e, "/api/checkout/tax-quote", { lines: [{ sku: visibleSku, qty: 1 }] });
  check("control: visible SKU gets a tax quote", q.status === 200 && q.data.totalCents > 0, `HTTP ${q.status}`);
}

for (const sku of pick) {
  await expectRejected(`create-token rejects hidden ${sku}`, "/api/checkout/create-token", [{ sku, qty: 1 }]);
  await expectRejected(`tax-quote rejects hidden ${sku}`, "/api/checkout/tax-quote", [{ sku, qty: 1 }]);
}

const h = pick[0];
// 1. request manipulation
await expectRejected("mixed cart (visible + hidden) is rejected as a whole", "/api/checkout/create-token", [{ sku: visibleSku, qty: 1 }, { sku: h, qty: 1 }]);
await expectRejected("client-supplied price/name/total fields are ignored (still rejected)", "/api/checkout/create-token",
  [{ sku: h, qty: 1, price: 1, sale: 1, unitPriceCents: 100, name: "Free", hidden: false }], { total: 1, totalCents: 100, subtotalCents: 100, items: [{ sku: visibleSku }] });
await expectRejected("quantity split across duplicate lines is rejected", "/api/checkout/create-token", [{ sku: h, qty: 1 }, { sku: h, qty: 2 }]);
await expectRejected("whitespace-padded hidden SKU is rejected", "/api/checkout/create-token", [{ sku: `  ${h}  `, qty: 1 }]);
await expectRejected("case-changed hidden SKU is rejected", "/api/checkout/create-token", [{ sku: h.toLowerCase(), qty: 1 }]);
await expectRejected("prototype-pollution SKU (__proto__) is rejected", "/api/checkout/create-token", [{ sku: "__proto__", qty: 1 }]);
await expectRejected("prototype-pollution SKU (constructor) is rejected", "/api/checkout/create-token", [{ sku: "constructor", qty: 1 }]);
await expectRejected("SKU sent as non-string is rejected", "/api/checkout/create-token", [{ sku: { toString: () => h }, qty: 1 }]);
await expectRejected("unknown SKU is rejected", "/api/checkout/create-token", [{ sku: "NOT-A-REAL-SKU", qty: 1 }]);
// 2. defense in depth: even a stale pricing file that still prices the hidden SKUs cannot sell them
{
  const staleFile = process.env.STALE_PRICING;
  if (staleFile) {
    await expectRejected("STALE pricing file that prices hidden SKUs still cannot sell them", "/api/checkout/create-token", [{ sku: h, qty: 1 }], {}, { "/data/catalog-pricing.json": staleFile });
    const stalePriced = !!JSON.parse(readFileSync(staleFile, "utf8"))[h];
    check("(precondition) stale pricing file really prices the hidden SKU", stalePriced);
  } else {
    console.log("  skip  stale-pricing test (set STALE_PRICING=<old catalog-pricing.json> to run)");
  }
}
// 3. fail closed
await expectRejected("blocked-list unavailable -> fails closed (no order, no token)", "/api/checkout/create-token", [{ sku: visibleSku, qty: 1 }], {}, { "/data/catalog-blocked.json": "404" });
// 4. data invariants the Worker relies on
{
  const pricing = JSON.parse(readFileSync(join(PUBLIC, "data", "catalog-pricing.json"), "utf8"));
  const blocked = JSON.parse(readFileSync(join(PUBLIC, "data", "catalog-blocked.json"), "utf8"));
  check("all 188 hidden SKUs are absent from catalog-pricing.json", hidden.every((s) => !(s in pricing)), `${hidden.filter((s) => s in pricing).length} present`);
  check("all 188 hidden SKUs are listed in catalog-blocked.json", hidden.every((s) => blocked.includes(s)) && blocked.length === 188, `${blocked.length} listed`);
  check("hidden detail records are retained (not deleted)", hidden.length === 188);
}

globalThis.fetch = realFetch;
console.log(`\n${results.length - failures}/${results.length} checks passed`);
process.exit(failures ? 1 : 0);
