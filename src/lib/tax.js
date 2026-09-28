/**
 * Tax calculation + delivery-address validation. NO rate is hard-coded in
 * JavaScript — every combined rate comes from `ca-district-tax-rates.json`,
 * a machine-parsed copy of CDTFA-95 ("California Sales and Use Tax Rates by
 * County and City"), CDTFA's own official quarterly rate publication.
 *
 * getTaxProvider(env) → null | { name, async quote(input) }
 * computeTax(env, input) → { ok:true, taxCents, taxRate, source, jurisdiction }
 *                        | { ok:false, code }   code ∈ tax_unavailable | ca_delivery_only | address_unverifiable
 *
 * Provider:
 *   ca-district-table — THE authority for launch. No external API, no account,
 *     no secret, no network call. Looks the delivery city up directly in the
 *     CDTFA table (483 incorporated CA cities, each with its own combined
 *     state+county+city+district rate) and falls back to nothing — an
 *     unmatched city is rejected rather than guessed, exactly as CDTFA's own
 *     "some communities may not be listed, please call" guidance says to.
 *
 * quote(input): { subtotalCents, taxableCents, address:{line1,city,state,zip,country} }
 */
import RATES from "./ca-district-tax-rates.json";

export class TaxError extends Error {
  constructor(code, reason) {
    super(reason || code);
    this.code = code; // 'ca_delivery_only' | 'address_unverifiable' | 'tax_unavailable'
  }
}

const CA_ZIP_MIN = 90001;
const CA_ZIP_MAX = 96162;

function normalizeCity(city) {
  return String(city || "")
    .trim()
    .toUpperCase()
    .replace(/^(CITY|TOWN)\s+OF\s+/, "")
    .replace(/\s+/g, " ");
}

/**
 * @returns {null | { rate:number, jurisdiction:string }}
 */
export function lookupDistrictRate(city) {
  const key = normalizeCity(city);
  const hit = RATES.cities[key];
  if (!hit) return null;
  return { rate: hit.rate, jurisdiction: `${hit.raw}, ${hit.county} County, CA` };
}

function makeDistrictTableProvider() {
  return {
    name: "ca-district-table",
    async quote({ taxableCents, address }) {
      const state = String(address.state || "").toUpperCase();
      if (state !== "CA") {
        throw new TaxError("ca_delivery_only", `resolved state "${address.state || "?"}"`);
      }
      const zip = parseInt(String(address.zip || "").slice(0, 5), 10);
      if (!Number.isInteger(zip) || zip < CA_ZIP_MIN || zip > CA_ZIP_MAX) {
        throw new TaxError("ca_delivery_only", `zip "${address.zip || "?"}" is outside the California ZIP range`);
      }
      const hit = lookupDistrictRate(address.city);
      if (!hit) {
        throw new TaxError(
          "address_unverifiable",
          `no CDTFA district tax rate on file for city "${address.city || "?"}" — please double-check the city, or call to complete this order`,
        );
      }
      const taxCents = Math.round(taxableCents * hit.rate);
      return { taxCents, taxRate: hit.rate, source: "ca-district-table", jurisdiction: hit.jurisdiction };
    },
  };
}

export function getTaxProvider(env) {
  const name = String(env.TAX_PROVIDER || "").trim().toLowerCase();
  if (!name) return null;
  if (name === "ca-district-table") return makeDistrictTableProvider();
  throw new Error(`unknown TAX_PROVIDER "${name}"`);
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
    const code = err instanceof TaxError ? err.code : "tax_unavailable";
    return { ok: false, code, reason: err.message };
  }
}
