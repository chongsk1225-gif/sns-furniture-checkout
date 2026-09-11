/**
 * Tax calculation + delivery-address validation. NO rate is hard-coded.
 *
 * getTaxProvider(env) → null | { name, async quote(input) }
 * computeTax(env, input) → { ok:true, taxCents, taxRate, source, jurisdiction }
 *                        | { ok:false, code }   code ∈ tax_unavailable | ca_delivery_only | address_unverifiable
 *
 * Providers:
 *   taxjar  — THE authority for launch. Validates the delivery address and
 *             calculates destination-based California tax via TaxJar /v2/taxes.
 *             Rejects any address TaxJar cannot resolve, or that resolves
 *             outside California, before a payment token is ever created.
 *   manual  — LOCAL AUTOMATED-TEST FIXTURE ONLY. Requires ALLOW_MANUAL_TAX="true"
 *             AND a non-production Authorize.Net environment. Its source is
 *             labelled "manual-test-fixture" so it can never be mistaken for real
 *             tax. Never enabled in staging or production config.
 *   avalara — not implemented; deliberately unavailable.
 *
 * quote(input): { subtotalCents, taxableCents, address:{line1,city,state,zip,country} }
 */

export class TaxError extends Error {
  constructor(code, reason) {
    super(reason || code);
    this.code = code; // 'ca_delivery_only' | 'address_unverifiable' | 'tax_unavailable'
  }
}

export function getTaxProvider(env) {
  const name = String(env.TAX_PROVIDER || "").trim().toLowerCase();
  if (!name) return null;

  if (name === "manual") {
    if (String(env.ALLOW_MANUAL_TAX || "").toLowerCase() !== "true") {
      throw new Error(
        "manual tax provider is a local automated-test fixture and is disabled (ALLOW_MANUAL_TAX != true)",
      );
    }
    if (String(env.AUTHORIZE_NET_ENVIRONMENT || "").toLowerCase() === "production") {
      throw new Error("manual tax provider must never run against production");
    }
    const rate = Number(env.TAX_MANUAL_RATE);
    if (!Number.isFinite(rate) || rate < 0 || rate > 0.2) {
      throw new Error("TAX_MANUAL_RATE must be a decimal between 0 and 0.2");
    }
    return {
      name: "manual-test-fixture",
      async quote({ taxableCents }) {
        return {
          taxCents: Math.round(taxableCents * rate),
          taxRate: rate,
          source: "manual-test-fixture",
          jurisdiction: "TEST FIXTURE — NOT REAL TAX",
        };
      },
    };
  }

  if (name === "taxjar") return makeTaxJarProvider(env);

  if (name === "avalara") {
    return {
      name: "avalara",
      async quote() {
        throw new TaxError("tax_unavailable", 'tax provider "avalara" is not implemented');
      },
    };
  }

  throw new Error(`unknown TAX_PROVIDER "${name}"`);
}

function makeTaxJarProvider(env) {
  const token = env.TAXJAR_API_KEY;
  const base = String(env.TAXJAR_API_BASE || "https://api.taxjar.com").replace(/\/+$/, "");

  return {
    name: "taxjar",
    async quote({ subtotalCents, address }) {
      if (!token) {
        throw new TaxError("tax_unavailable", "TAXJAR_API_KEY is not configured");
      }
      const payload = {
        to_country: "US",
        to_zip: address.zip,
        to_state: address.state,
        to_city: address.city,
        to_street: address.line1,
        amount: Number((subtotalCents / 100).toFixed(2)),
        shipping: 0,
      };

      let res;
      let data;
      try {
        res = await fetch(`${base}/v2/taxes`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
          },
          body: JSON.stringify(payload),
        });
        data = await res.json().catch(() => null);
      } catch (e) {
        throw new TaxError("address_unverifiable", "TaxJar request failed");
      }

      // 4xx from /v2/taxes means the destination address could not be resolved.
      if (res.status >= 400 || !data || !data.tax) {
        throw new TaxError(
          "address_unverifiable",
          `TaxJar could not validate the delivery address (HTTP ${res.status})`,
        );
      }

      const t = data.tax;
      if (t.has_nexus === false) {
        throw new TaxError(
          "tax_unavailable",
          "TaxJar reports no nexus for this address — configure California nexus in the TaxJar account",
        );
      }
      const j = t.jurisdictions || {};
      if (String(j.country || "").toUpperCase() !== "US") {
        throw new TaxError("ca_delivery_only", `resolved country ${j.country || "?"}`);
      }
      if (String(j.state || "").toUpperCase() !== "CA") {
        throw new TaxError("ca_delivery_only", `resolved state ${j.state || "?"}`);
      }

      const taxCents = Math.round(Number(t.amount_to_collect) * 100);
      if (!Number.isFinite(taxCents) || taxCents < 0) {
        throw new TaxError("address_unverifiable", "TaxJar returned an invalid tax amount");
      }
      const rate = Number(t.rate);
      return {
        taxCents,
        taxRate: Number.isFinite(rate) ? rate : null,
        source: "taxjar",
        jurisdiction: [j.city, j.county, j.state].filter(Boolean).join(" / "),
      };
    },
  };
}

/**
 * @returns {Promise<
 *   { ok:true, taxCents:number, taxRate:number|null, source:string, jurisdiction?:string }
 * | { ok:false, code:'tax_unavailable'|'ca_delivery_only'|'address_unverifiable', reason:string }>}
 */
export async function computeTax(env, input) {
  let provider;
  try {
    provider = getTaxProvider(env);
  } catch (err) {
    return { ok: false, code: "tax_unavailable", reason: err.message };
  }
  if (!provider) return { ok: false, code: "tax_unavailable", reason: "no tax provider configured" };

  try {
    const q = await provider.quote(input);
    if (!Number.isInteger(q.taxCents) || q.taxCents < 0) {
      return { ok: false, code: "tax_unavailable", reason: "provider returned an invalid amount" };
    }
    return {
      ok: true,
      taxCents: q.taxCents,
      taxRate: q.taxRate ?? null,
      source: q.source || provider.name,
      jurisdiction: q.jurisdiction,
    };
  } catch (err) {
    const code =
      err instanceof TaxError ? err.code : "tax_unavailable";
    return { ok: false, code, reason: err.message };
  }
}
