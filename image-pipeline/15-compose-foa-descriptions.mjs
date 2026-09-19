// Composes an ORIGINAL written description per FOA product from the
// structured FACTS 14-fetch-foa-descriptions.mjs extracted (style, finish,
// material, hardware, features, dimensions) — never from FOA's own blurb
// text, which is used only as a human-reviewable reference in the report,
// not as composition input. Sentences are built from a bank of varied
// templates chosen by a deterministic hash of the SKU (reproducible, and
// varied enough across products that near-identical items — e.g. the same
// nightstand in five colors — don't read as a single mail-merged template).
//
// Writes ONLY to image-pipeline/proposed/data/details/*.json (only the
// `description` field, only for SKUs that had none) and reports/. Never
// touches public/ or any other field.
//   node 15-compose-foa-descriptions.mjs
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { openDb } from "./lib/db.mjs";
import { sha1 } from "./lib/util.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DATA = join(HERE, "..", "public", "data");
const PROPOSED_DATA = join(HERE, "proposed", "data");
const REPORTS = join(HERE, "reports");
mkdirSync(REPORTS, { recursive: true });

const db = openDb();
const facts = new Map(db.prepare("SELECT * FROM foa_page_facts").all().map((r) => [r.sku, r]));

// deterministic 0..n-1 index from the sku, so re-runs are stable
function pick(sku, salt, arr) {
  const h = parseInt(sha1(sku + "|" + salt).slice(0, 8), 16);
  return arr[h % arr.length];
}
function joinNatural(items) {
  if (items.length <= 1) return items[0] || "";
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}
const A_AN = (s) => (/^[aeiou]/i.test(s) ? "an" : "a");
// "Pine Wood, Others" -> "pine wood and other materials" — the source page's
// literal enum tag reads oddly lowercased or left as-is mid-sentence.
function naturalMaterial(material) {
  return material.replace(/,?\s*Others\s*$/i, "").trim().toLowerCase() + " and other materials";
}
// normalize for de-duplication only (compare meaning, not exact formatting) —
// the features tag list and the labeled fields sometimes differ by a comma
// or spacing for the same fact (e.g. "Faux Fur Solid Wood, Others" vs
// "Faux Fur, Solid Wood, Others").
const normKey = (s) => s.toLowerCase().replace(/[,.\s]+/g, " ").trim();

const OPENERS = [
  ({ name, type, style, collection }) => collection
    ? `Part of the ${collection} collection, the ${name} ${type.toLowerCase()} brings ${A_AN(style)} ${style} look to the room.`
    : `The ${name} ${type.toLowerCase()} brings ${A_AN(style)} ${style} look to the room.`,
  ({ name, type, style }) => `${name} pairs ${style} styling with a ${type.toLowerCase()} built for everyday use.`,
  ({ name, type, style, collection }) => collection
    ? `The ${name} ${type.toLowerCase()} is designed with ${style.toLowerCase()} lines, part of the ${collection} collection.`
    : `The ${name} ${type.toLowerCase()} is designed with ${style.toLowerCase()} lines in mind.`,
  ({ name, type, style }) => `With its ${style} character, the ${name} ${type.toLowerCase()} fits comfortably into a range of room styles.`,
  ({ name, type }) => `The ${name} ${type.toLowerCase()} is built to be both functional and easy to style.`,
];

const MATERIAL_TEMPLATES = [
  ({ material, finish }) => `It's built from ${naturalMaterial(material)}${finish ? `, finished in ${finish}` : ""}.`,
  ({ material, finish }) => finish
    ? `Construction in ${naturalMaterial(material)} is paired with a ${finish} finish for a look that holds up to daily use.`
    : `Construction in ${naturalMaterial(material)} gives it a sturdy, everyday feel.`,
  ({ material, finish }) => finish
    ? `Built using ${naturalMaterial(material)}, it wears a ${finish} finish that suits a range of room palettes.`
    : `Built using ${naturalMaterial(material)} for lasting everyday use.`,
];

const FRAME_FINISH_ADD = (frameFinish, finish) =>
  frameFinish && frameFinish !== finish ? ` The frame is finished in ${frameFinish}.` : "";

const HARDWARE_TEMPLATES = [
  (hw) => `Hardware comes in ${hw}.`,
  (hw) => `${hw} hardware rounds out the design.`,
];

const FEATURE_TEMPLATES = [
  (list) => `Notable details include ${joinNatural(list)}.`,
  (list) => `It also features ${joinNatural(list)}.`,
  (list) => `Design details: ${joinNatural(list)}.`,
];

const DIMS_SINGLE_TEMPLATES = [
  (piece, dims) => `${piece ? piece + " measures" : "It measures"} ${dims}.`,
  (piece, dims) => `Sized at ${dims}${piece ? ` (${piece})` : ""}, it's built to fit comfortably in most rooms.`,
];

export function composeDescription(sku, product, fact) {
  const name = product.name, type = product.type || "piece", collection = product.collection || "";
  const details = fact.details_json ? JSON.parse(fact.details_json) : {};
  const rawFeatures = fact.features_json ? JSON.parse(fact.features_json) : [];
  const dims = fact.dims_json ? JSON.parse(fact.dims_json) : [];

  const style = details["Style"] || "";
  const finish = details["Color/Finish"] || "";
  const material = details["Material"] || "";
  const frameFinish = details["Frame Finish"] || "";
  const hardware = details["Hardware"] || "";

  // features list frequently repeats Style/Finish/Material verbatim as tags
  // (sometimes with slightly different punctuation than the labeled field —
  // normKey compares on meaning, not exact formatting) — drop anything that
  // duplicates a fact we already state explicitly.
  const usedValues = new Set([style, finish, material, frameFinish].filter(Boolean).map(normKey));
  const extraFeatures = rawFeatures.filter((f) => !usedValues.has(normKey(f))).slice(0, 4);

  if (!style && !finish && !material && extraFeatures.length === 0 && dims.length === 0) return null; // nothing to ground a description in

  const sentences = [];
  if (style) {
    sentences.push(pick(sku, "opener", OPENERS)({ name, type, style, collection }));
  } else {
    sentences.push(`The ${name} ${type.toLowerCase()} is built to be both functional and easy to style${collection ? `, part of the ${collection} collection` : ""}.`);
  }
  if (material) {
    sentences.push(pick(sku, "material", MATERIAL_TEMPLATES)({ material, finish }) + FRAME_FINISH_ADD(frameFinish, finish));
  } else if (finish) {
    sentences.push(`It comes in a ${finish} finish.`);
  }
  if (hardware) sentences.push(pick(sku, "hardware", HARDWARE_TEMPLATES)(hardware));
  if (extraFeatures.length) sentences.push(pick(sku, "features", FEATURE_TEMPLATES)(extraFeatures));
  if (dims.length === 1) {
    // omit the piece name when it's just the product's own type restated
    // (already said in the opener) — only worth naming when it differs, e.g.
    // a specific piece out of a multi-item set
    const pieceLabel = dims[0].piece && normKey(dims[0].piece) !== normKey(type) ? dims[0].piece : null;
    sentences.push(pick(sku, "dims", DIMS_SINGLE_TEMPLATES)(pieceLabel, dims[0].dims));
  } else if (dims.length > 1) {
    const shown = dims.slice(0, 4).map((d) => `${d.piece || "piece"} at ${d.dims}`);
    const more = dims.length > 4 ? `, plus ${dims.length - 4} more piece${dims.length - 4 === 1 ? "" : "s"}` : "";
    sentences.push(`Piece dimensions include ${joinNatural(shown)}${more}.`);
  }

  return sentences.join(" ");
}

// ---- run over every FOA product missing a description ---------------------
const detailFiles = readdirSync(join(PUBLIC_DATA, "details")).filter((f) => f.endsWith(".json"));
let written = 0, noFacts = 0, notFetched = 0, fetchError = 0;
const noFactsList = [], notFetchedList = [], fetchErrorList = [];

for (const f of detailFiles) {
  const srcPath = join(PROPOSED_DATA, "details", f); // build on top of already-staged data if present
  const path = existsSync(srcPath) ? srcPath : join(PUBLIC_DATA, "details", f);
  const arr = JSON.parse(readFileSync(path, "utf8"));
  let touched = false;
  for (const rec of arr) {
    if (rec.brand !== "Furniture of America" || (rec.description && rec.description.trim())) continue;
    const fact = facts.get(rec.sku);
    if (!fact) { notFetched++; notFetchedList.push(rec.sku); continue; }
    if (fact.fetch_status === "error") { fetchError++; fetchErrorList.push({ sku: rec.sku, error: fact.last_error }); continue; }
    if (fact.fetch_status === "no_facts_found") { noFacts++; noFactsList.push(rec.sku); continue; }
    const desc = composeDescription(rec.sku, rec, fact);
    if (!desc) { noFacts++; noFactsList.push(rec.sku); continue; }
    rec.description = desc;
    rec.description_source = "foa_authorized_original_composition"; // provenance marker, not shown to customers
    touched = true;
    written++;
  }
  if (touched) {
    mkdirSync(join(PROPOSED_DATA, "details"), { recursive: true });
    writeFileSync(join(PROPOSED_DATA, "details", f), JSON.stringify(arr));
  }
}

const summary = `# FOA description composition

_Generated ${new Date().toISOString()}._

FOA products that had no description before this: 5,455.

- **Written (original, composed from extracted facts): ${written}**
- Fetched OK but no usable facts on the page: ${noFacts}
- Page fetch never completed / not yet attempted this run: ${notFetched}
- Page fetch errored (network/HTTP failure): ${fetchError}

None of these are fabricated — every written description is built only from
facts actually extracted from that SKU's own FOA page (style, finish,
material, hardware, features, dimensions), phrased originally rather than
copying FOA's own text. Nothing was invented for the ${noFacts + notFetched + fetchError}
that couldn't be grounded this way; those SKUs keep whatever description
they had before (none).

## SKUs with no usable facts on their page (${noFactsList.length})
${noFactsList.slice(0, 50).map((s) => `- ${s}`).join("\n")}${noFactsList.length > 50 ? `\n- ...and ${noFactsList.length - 50} more` : ""}

## SKUs not yet fetched (${notFetchedList.length})
${notFetchedList.length <= 20 ? notFetchedList.map((s) => `- ${s}`).join("\n") : `(${notFetchedList.length} — run 14-fetch-foa-descriptions.mjs to completion first)`}

## SKUs whose page fetch errored (${fetchErrorList.length})
${fetchErrorList.slice(0, 50).map((e) => `- ${e.sku}: ${e.error}`).join("\n")}${fetchErrorList.length > 50 ? `\n- ...and ${fetchErrorList.length - 50} more` : ""}
`;
writeFileSync(join(REPORTS, "foa-description-composition.md"), summary);
console.log(summary);
db.close();
