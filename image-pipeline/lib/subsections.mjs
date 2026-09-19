// Room -> subsection bucket classifier, built from real /data/catalog-index.json
// "type" values. Used by 12-build-subsections.mjs to generate the static
// lookup table the site ships, and to print a full audit (every type value +
// its bucket + count) for review.
//
// Design: ordered rule lists per room, first match wins, checked against the
// product's `type` field. A handful of ACME "type" values are collection-
// style labels, not a physical piece at all (e.g. "Casual Dining"/
// "Formal Dining" — 537 rows, 100% ACME, describing casual-vs-formal STYLE
// while the real piece — table/chair/bench/server — only appears in the
// product `name`). So: try `type` first; if nothing matches, retry the same
// rules against `name` before giving up. Only if BOTH fail does a product
// land in the room's Other bucket (flagged, for a room with no Other of its
// own) — this generalizes past just the two known collection-style labels
// without having to special-case every future one by name.

// Each rule: [bucketLabel, RegExp]. Checked in order; first match wins.
// `other` names the catch-all bucket for unmatched values (rooms without one
// still get an implicit "Other" so nothing becomes unfilterable — any value
// landing there for a room that didn't ask for one is flagged, not hidden).
export const ROOMS = {
  "Living Room": {
    other: null, // no Other bucket requested — anything landing here is flagged
    rules: [
      ["Sectionals", /sectional|\bu-sectional|\bl-sectional|\bj-shaped|left chaise|right chaise|\bchaise\b(?!.*lounge)/i],
      ["Tables", /\btable|\bconsole\b/i],
      ["Sofas & Loveseats", /\bsofa|\bloveseat|\bfuton/i],
      ["Recliners & Chairs", /\brecliner|\bchair\b|\bglider|chaise lounge/i],
      ["Ottomans & Benches", /\bottoman|\bbench\b/i],
    ],
  },
  "Dining Room": {
    other: null,
    rules: [
      ["Counter Height & Bar", /counter\s*h[t.]|counter\s*height|\bbar\b|\bstool/i],
      ["Dining Table Sets", /\bpc\.?\s|\bpack\b.*set|\bset\b.*\bpc\b|dining set/i],
      ["Servers/Curios/Buffets", /\bserver|\bcurio|\bbuffet|\bhutch/i],
      ["Dining Chairs", /\bchair|\bbench\b/i],
      ["Dining Tables", /\btable/i],
    ],
  },
  "Bedroom": {
    other: "Other",
    rules: [
      ["Bedroom Sets", /bedroom set/i],
      ["Mattresses", /\bmattress/i],
      ["Nightstands", /\bnightstand/i],
      ["Chests", /\bchest/i],
      ["Dressers & Mirrors", /\bdresser|\bmirror/i],
      ["Beds", /\bbed\b|\bdaybed/i],
    ],
  },
  "Office": {
    other: null,
    rules: [
      ["Bookshelves & File Cabinets", /\bbookshelf|\bbookcase|file cabinet/i],
      ["Desk Chairs", /desk chair|office chair/i],
      ["Music Studio", /music studio/i],
      ["Gaming Tables", /gaming table/i],
      ["Desks", /\bdesk\b/i],
    ],
  },
  "Youth": {
    other: "Other",
    rules: [
      ["Bunk Beds", /\bbunk|loft bed|triple twin/i],
      ["Kids Bedroom Sets", /bedroom set/i],
      ["Daybeds & Trundles", /\bdaybed|\btrundle/i],
      ["Beds", /\bbed\b/i],
    ],
  },
};

// Some subsections pull in a whole SEPARATE top-level catalog category
// rather than filtering within the room's own `type` field — Bedroom's
// "Mattresses" tab means the 71 products actually filed under the
// top-level "Mattresses" category (a sibling category, not a Bedroom type
// value; no Bedroom-category product has ever had "mattress" in its type).
// { room: [{ bucket, fromCategory }] } — every product in `fromCategory`
// is placed straight into `bucket` under `room`, no regex matching at all.
export const CROSS_CATEGORY = {
  "Bedroom": [{ bucket: "Mattresses", fromCategory: "Mattresses" }],
};

function firstMatch(rules, s) {
  for (const [bucket, re] of rules) if (re.test(s)) return bucket;
  return null;
}

/**
 * Classify one product for room-subsection purposes. Returns null if it
 * belongs to no nav room and isn't cross-category-pulled into one either.
 * A product can match here via its OWN category (normal case) or via a
 * CROSS_CATEGORY rule that pulls a different category's products into a
 * bucket under a different room (the Mattresses case) — `crossPulled` marks
 * the latter so callers can tell the two apart if needed.
 */
export function classify(product) {
  const ownRoom = product.category;
  const def = ROOMS[ownRoom];
  if (def) {
    let bucket = firstMatch(def.rules, product.type || "");
    let via = "type";
    if (!bucket && product.name) {
      bucket = firstMatch(def.rules, product.name);
      via = "name";
    }
    if (!bucket) { bucket = def.other || "Other"; via = "none"; }
    return { room: ownRoom, bucket, flagged: via === "none" && !def.other, via, crossPulled: false };
  }
  for (const [room, pulls] of Object.entries(CROSS_CATEGORY)) {
    const pull = pulls.find((p) => p.fromCategory === ownRoom);
    if (pull) return { room, bucket: pull.bucket, flagged: false, via: "cross-category", crossPulled: true };
  }
  return null;
}

export const ROOM_LABELS = {
  "Living Room": "Living Room", "Dining Room": "Dining Room", "Bedroom": "Bedroom",
  "Office": "Office", "Youth": "Youth & Kids",
};
export const SUBSECTIONS_BY_ROOM = Object.fromEntries(
  Object.entries(ROOMS).map(([room, def]) => [room, [...new Set(def.rules.map((r) => r[0]))].concat(def.other ? [def.other] : [])]),
);
