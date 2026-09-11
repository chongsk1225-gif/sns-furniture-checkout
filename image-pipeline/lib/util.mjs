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

/** Tokens that could stand in for a SKU inside an image filename. */
export function skuVariants(sku) {
  const raw = String(sku || "").trim();
  const up = raw.toUpperCase();
  const set = new Set([up, normSku(up), up.replace(/-/g, "_"), up.replace(/-/g, "")]);
  // drop a trailing size/config suffix like -CK / -EK / -Q / -F / -T / -2PC for a looser (still logged) check
  const noSuffix = up.replace(/-(CK|EK|Q|QN|F|FL|T|TW|TXL|K|KN|2PC|3PC|SET|PK|PC)$/i, "");
  if (noSuffix !== up) set.add(normSku(noSuffix));
  return [...set].filter(Boolean);
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
