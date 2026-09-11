import crypto from "node:crypto";

export const sha1 = (s) => crypto.createHash("sha1").update(s).digest("hex");
export const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");

export const nowIso = () => new Date().toISOString();
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function brandKey(brand) {
  const b = String(brand || "").toLowerCase();
  if (b.includes("acme")) return "acme";
  if (b.includes("america") || b === "foa") return "foa";
  return "other";
}

/** Hamming distance between two equal-length binary strings. */
export function hamming(a, b) {
  if (!a || !b || a.length !== b.length) return 999;
  let d = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++;
  return d;
}

/** Normalise a SKU for comparison: upper, strip spaces and separators. */
export function normSku(s) {
  return String(s || "").toUpperCase().replace(/[\s._/-]+/g, "");
}

/**
 * Tokens that could stand in for a SKU inside an image filename.
 * ACME/FOA both file a lettered "kit/variant" SKU (e.g. `04084A`, `12248KIT`,
 * `91110_KIT`) under the manufacturer's BASE item number (`04084`, `12248`,
 * `91110`) — a documented, harmless suffix, not a different product. We accept
 * the base-number match but this is logged in match_json for review.
 */
export function skuVariants(sku) {
  const raw = String(sku || "").trim();
  const up = raw.toUpperCase();
  const set = new Set([up, normSku(up), up.replace(/-/g, "_"), up.replace(/-/g, "")]);
  // drop a trailing size/config suffix like -CK / -EK / -Q / -F / -T / -2PC
  const noSizeSuffix = up.replace(/-(CK|EK|Q|QN|F|FL|T|TW|TXL|K|KN|2PC|3PC|SET|PK|PC)$/i, "");
  if (noSizeSuffix !== up) set.add(normSku(noSizeSuffix));
  // drop a trailing bare kit/variant letter or "KIT"/"_KIT"
  const noKit = up.replace(/_?KIT$/i, "").replace(/([0-9])[A-Z]$/i, "$1");
  if (noKit !== up && noKit.length >= 4) set.add(normSku(noKit));
  // Iteratively strip a CHAIN of trailing dash-segments that each look like a
  // quantity/pack/config qualifier rather than a color/model token — e.g.
  // `CM-BR6252BG-24-2PK` -> base `CM-BR6252BG` (the "-24-2PK" is a pack-count/
  // set-size suffix; the color code BG is already inside the base). Only pure
  // numbers or a short known qualifier shape count as strippable — a real
  // color/finish/model segment (letters mixed with digits beyond a small
  // known list) stops the strip, so this never eats into the actual SKU body.
  const QUALIFIER = /^(\d{1,4}|[0-9]*PC|[0-9]*PK|CK|EK|QN?|F|FL|T|TW|TXL|KN?|SET|CT|EA|KIT)$/i;
  const parts = up.split("-");
  let cut = parts.length;
  while (cut > 1 && QUALIFIER.test(parts[cut - 1])) cut--;
  if (cut < parts.length) {
    const base = parts.slice(0, cut).join("-");
    if (base.length >= 4) set.add(normSku(base));
  }
  return [...set].filter(Boolean);
}

/** Manufacturer cross-reference the record's own name asserts, e.g. "(Same AC00899)". */
export function nameAliasTokens(name) {
  const m = String(name || "").match(/\bsame\s*[:#]?\s*([a-z0-9][a-z0-9-]{2,})\b/i);
  return m ? [normSku(m[1])] : [];
}

export function hostOf(url) {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return "";
  }
}

export function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) out[key] = true;
      else {
        out[key] = next;
        i++;
      }
    } else out._.push(a);
  }
  return out;
}
