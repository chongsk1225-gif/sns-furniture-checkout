// Shared wrong-photo-risk classifier for unresolved FOA products. Used by
// 09-foa-unresolved-diagnosis.mjs (reporting) and 11-foa-hide-high-risk.mjs
// (acting on it) — kept in one place so the two never drift apart.
import { normSku } from "./util.mjs";

export function baseName(url) {
  return (String(url).split("/").pop() || "").toLowerCase().replace(/\.(jpe?g|png)$/i, "");
}

/**
 * Find the longest leading run of the SKU's own dash-separated segments that
 * appears (normalized, no separators) as a substring of the image filename.
 * unmatched is the trailing part of the SKU the filename does NOT account
 * for (e.g. the "-TABLE" / "-SECT" piece-type, or an unrecognized pack code).
 */
export function diagnoseMismatch(sku, file) {
  const segs = String(sku).toUpperCase().split("-").filter(Boolean);
  const nf = normSku(file);
  let bestK = 0;
  for (let k = segs.length; k >= 1; k--) {
    const prefix = normSku(segs.slice(0, k).join("-"));
    if (prefix.length >= 4 && nf.includes(prefix)) { bestK = k; break; }
  }
  if (bestK === 0) return { matched: null, unmatched: segs, kind: "no_relation" };
  if (bestK === segs.length) return { matched: segs, unmatched: [], kind: "full_match" };
  return { matched: segs.slice(0, bestK), unmatched: segs.slice(bestK), kind: "partial_match" };
}

const PIECE_TYPE_HINTS = /^(TABLE|CHAIR|BED|SECT|BENCH|STOOL|MIRROR|NIGHTSTAND|DRESSER|HEADBOARD|DESK|HUTCH|LOVESEAT|SOFA|OTTOMAN|CONSOLE|SERVER|BUFFET|CHEST|VN|VANITY|RUG|LAMP|WEDGE|ARMLESS|CT|RT|BT|PT|F|Q|EK|CK|TF)$/i;

/**
 * Classify ONE candidate for an unresolved product. Returns the same row
 * shape 09's CSV uses: { failure_kind, matched_sku_portion, unmatched_sku_suffix,
 * likely_piece_type_or_config_suffix, wrong_photo_risk, reason, image_filename }.
 */
export function classifyCandidate(sku, cand) {
  const url = cand ? (cand.resolved_url || cand.original_url) : "";
  const file = cand ? baseName(url) : "";

  if (!cand) {
    return { image_filename: "", current_image_url: "", failure_kind: "no_candidate_image",
      matched_sku_portion: "", unmatched_sku_suffix: "", likely_piece_type_or_config_suffix: "",
      wrong_photo_risk: "high", reason: "No source image URL was found at all for this SKU (no ACME-style feed entry, no CDN candidate)." };
  }
  if (cand.reject_reason === "too_small") {
    return { image_filename: file, current_image_url: url, failure_kind: "too_small",
      matched_sku_portion: "", unmatched_sku_suffix: "", likely_piece_type_or_config_suffix: "",
      wrong_photo_risk: "low", reason: `Image is real but under the 400px floor (${cand.width || "?"}x${cand.height || "?"}) — same photo, just too small to verify.` };
  }
  if (cand.reject_reason !== "sku_mismatch") {
    return { image_filename: file, current_image_url: url, failure_kind: cand.reject_reason || "unknown",
      matched_sku_portion: "", unmatched_sku_suffix: "", likely_piece_type_or_config_suffix: "",
      wrong_photo_risk: "medium", reason: `Rejected for "${cand.reject_reason}" — not a SKU-text mismatch.` };
  }

  const diag = diagnoseMismatch(sku, file);
  if (diag.kind === "no_relation") {
    const isGeneric = /^image_\d+$/i.test(file) || /^\d+$/.test(file);
    return { image_filename: file, current_image_url: url, failure_kind: "no_relation",
      matched_sku_portion: "", unmatched_sku_suffix: diag.unmatched.join("-"),
      likely_piece_type_or_config_suffix: "", wrong_photo_risk: "high",
      reason: isGeneric
        ? "Filename is a generic catalog placeholder (no SKU/model token at all) — likely a wrong or missing photo, not just a naming mismatch."
        : "No part of this SKU appears in the image filename at all — this looks like a different model's photo, not a suffix/piece-type issue." };
  }
  const unmatchedStr = diag.unmatched.join("-");
  const looksLikePieceType = diag.unmatched.some((seg) => PIECE_TYPE_HINTS.test(seg));
  return { image_filename: file, current_image_url: url, failure_kind: "partial_match",
    matched_sku_portion: diag.matched.join("-"), unmatched_sku_suffix: unmatchedStr,
    likely_piece_type_or_config_suffix: looksLikePieceType ? "yes" : "unclear",
    wrong_photo_risk: looksLikePieceType ? "low" : "medium",
    reason: looksLikePieceType
      ? `Image matches this product's base model ("${diag.matched.join("-")}") but not its "-${unmatchedStr}" piece-type/configuration suffix — most likely the correct family/set photo, just not verifiable as this exact piece.`
      : `Image matches this product's base model ("${diag.matched.join("-")}") but not its "-${unmatchedStr}" suffix, and that suffix isn't a recognized piece-type word — could be a set/pack code our matcher doesn't recognize, or a genuinely different variant. Worth a manual look.` };
}

/**
 * Classify a full unresolved product (may have >1 rejected candidate) — takes
 * the HIGHEST-risk candidate's classification as the product's own risk
 * (high > medium > low), since one bad candidate is enough to make the
 * currently-shown image suspect.
 */
const RISK_RANK = { high: 3, medium: 2, low: 1 };
export function classifyProduct(sku, candidates) {
  if (!candidates || candidates.length === 0) return classifyCandidate(sku, null);
  let best = null;
  for (const c of candidates) {
    const row = classifyCandidate(sku, c);
    if (!best || RISK_RANK[row.wrong_photo_risk] > RISK_RANK[best.wrong_photo_risk]) best = row;
  }
  return best;
}
