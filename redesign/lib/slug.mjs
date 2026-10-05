// Deterministic, collision-checked URL slugs for the static product and collection pages.
// The same rules are mirrored in luxe/luxe.js (LX.productUrl) so client-rendered links match.
export const skuSlug = (sku) =>
  String(sku).toLowerCase().replace(/\+/g, "-plus-").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
export const nameSlug = (name) =>
  String(name).toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
export const productPath = (sku) => `/product/${skuSlug(sku)}/`;
export const collectionPath = (name) => `/collection/${nameSlug(name)}/`;
/** Throws if two inputs map to one slug (would silently overwrite a page). */
export function assertUnique(list, fn, label) {
  const seen = new Map();
  for (const x of list) {
    const s = fn(x);
    if (!s) throw new Error(`${label}: empty slug for ${JSON.stringify(x)}`);
    if (seen.has(s) && seen.get(s) !== x) throw new Error(`${label}: slug collision "${s}" for ${JSON.stringify(seen.get(s))} and ${JSON.stringify(x)}`);
    seen.set(s, x);
  }
  return seen.size;
}
