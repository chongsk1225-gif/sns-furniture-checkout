// Merges ONLY the description (+ description_source) field from
// proposed/data/details/*.json into public/data/details/*.json, matched by
// SKU. Deliberately narrow — does not touch galleries, pricing, hidden
// status, or anything else already correct in public/, avoiding the
// wholesale-copy mistakes made earlier in this project.
//   node 17-merge-descriptions-to-public.mjs
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const PROPOSED = "./proposed/data/details";
const PUBLIC = "../public/data/details";

const descBySku = new Map();
for (const f of readdirSync(PROPOSED)) {
  if (!f.endsWith(".json")) continue;
  for (const rec of JSON.parse(readFileSync(join(PROPOSED, f), "utf8"))) {
    if (rec.description && rec.description.trim()) {
      descBySku.set(rec.sku, { description: rec.description, description_source: rec.description_source });
    }
  }
}
console.log(`descriptions available to merge: ${descBySku.size}`);

let filled = 0, alreadyHad = 0, files = 0;
for (const f of readdirSync(PUBLIC)) {
  if (!f.endsWith(".json")) continue;
  const path = join(PUBLIC, f);
  const arr = JSON.parse(readFileSync(path, "utf8"));
  let touched = false;
  for (const rec of arr) {
    if (rec.description && rec.description.trim()) { alreadyHad++; continue; }
    const hit = descBySku.get(rec.sku);
    if (!hit) continue;
    rec.description = hit.description;
    if (hit.description_source) rec.description_source = hit.description_source;
    filled++;
    touched = true;
  }
  if (touched) { writeFileSync(path, JSON.stringify(arr)); files++; }
}
console.log(JSON.stringify({ filled, alreadyHad, filesChanged: files }, null, 2));
