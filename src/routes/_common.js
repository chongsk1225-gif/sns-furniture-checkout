/** Shared request parsing for the checkout endpoints. Delivery only.
 *
 * NOTE: this does only structural validation of the delivery address (required
 * fields, US country, 5-digit ZIP). Whether the address is real and actually in
 * California is decided authoritatively by TaxJar in src/lib/tax.js — NOT by a
 * ZIP-prefix guess here. create-token calls the tax/address check BEFORE it
 * creates any Authorize.Net payment token.
 */
import { HttpError, str, optionalStr, email, phone } from "../lib/security.js";

/** The only fulfillment method. Stored on every order record. */
export const FULFILLMENT = "delivery";

export function parseLines(body) {
  const lines = body.lines;
  if (!Array.isArray(lines) || lines.length === 0) {
    throw new HttpError("cart_empty", 422);
  }
  return lines.map((l) => ({
    sku: typeof l?.sku === "string" ? l.sku : "",
    qty: Number(l?.qty),
  }));
}

export function parseCustomer(body) {
  const c = body.customer || {};
  return {
    name: str(c.name, { min: 2, max: 120, label: "name" }),
    email: email(c.email),
    phone: phone(c.phone),
  };
}

const US_COUNTRY = /^(us|usa|u\.s\.|u\.s\.a\.|united states|united states of america)$/i;

/**
 * Structural parse of the customer's delivery address. This is NOT the
 * California authority — TaxJar validates and confirms the jurisdiction.
 */
export function parseDeliveryAddress(body) {
  const d = body.delivery || {};
  const country = str(d.country || "United States", { min: 2, max: 60, label: "country" });
  if (!US_COUNTRY.test(country.trim())) {
    throw new HttpError("ca_delivery_only", 422);
  }
  const zip = str(d.zip, { min: 5, max: 10, label: "zip" });
  if (!/^\d{5}(-\d{4})?$/.test(zip.trim())) {
    throw new HttpError("invalid_field", 422, { field: "zip" });
  }
  let state = str(d.state, { min: 2, max: 40, label: "state" }).trim();
  state = /^california$/i.test(state) ? "CA" : state.toUpperCase();
  return {
    line1: str(d.line1, { min: 3, max: 60, label: "line1" }),
    line2: optionalStr(d.line2, 60),
    city: str(d.city, { min: 2, max: 40, label: "city" }),
    state,
    zip: zip.trim(),
    country: "US",
  };
}
