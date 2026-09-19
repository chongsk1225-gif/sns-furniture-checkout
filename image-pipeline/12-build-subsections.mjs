// Builds the room-subsection lookup the site ships (SKU -> bucket, for the 5
// nav rooms only), plus a full audit report. Reads public/data/catalog-index.json
// (falling back to proposed/data if it's been overlaid), writes ONLY to
// image-pipeline/proposed/data/subsections.json and reports/. No network,
// no writes to public/ or pipeline.db.
//   node 12-build-subsections.mjs
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { classify, ROOMS, ROOM_LABELS, SUBSECTIONS_BY_ROOM } from "./lib/subsections.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DATA = join(HERE, "..", "public", "data");
const PROPOSED_DATA = join(HERE, "proposed", "data");
const REPORTS = join(HERE, "reports");
mkdirSync(PROPOSED_DATA, { recursive: true });
mkdirSync(REPORTS, { recursive: true });

// Prefer the already-staged proposed catalog-index (has the image fixes) so
// the subsection data is built from the same rows the preview actually shows.
const srcPath = existsSync(join(PROPOSED_DATA, "catalog-index.json"))
  ? join(PROPOSED_DATA, "catalog-index.json")
  : join(PUBLIC_DATA, "catalog-index.json");
const idx = JSON.parse(readFileSync(srcPath, "utf8"));

const skuToBucket = {};
const bucketCounts = {}; // room -> bucket -> n
const flagged = [];
let classified = 0;

for (const p of idx) {
  const cls = classify(p);
  if (!cls) continue;
  classified++;
  skuToBucket[p.sku] = cls.bucket;
  bucketCounts[cls.room] = bucketCounts[cls.room] || {};
  bucketCounts[cls.room][cls.bucket] = (bucketCounts[cls.room][cls.bucket] || 0) + 1;
  if (cls.flagged) flagged.push({ room: cls.room, sku: p.sku, name: p.name, type: p.type });
}

writeFileSync(join(PROPOSED_DATA, "subsections.json"), JSON.stringify(skuToBucket));

let report = `# Room subsection classification\n\n_Generated ${new Date().toISOString()} from \`${srcPath.includes("proposed") ? "proposed" : "public"}/data/catalog-index.json\`._\n\n`;
report += `Products classified into a room subsection: ${classified}\n\n`;
for (const room of Object.keys(ROOMS)) {
  const total = Object.values(bucketCounts[room] || {}).reduce((a, b) => a + b, 0);
  report += `## ${ROOM_LABELS[room]} — ${total} products\n`;
  for (const bucket of SUBSECTIONS_BY_ROOM[room]) {
    const n = (bucketCounts[room] || {})[bucket] || 0;
    if (n > 0 || !ROOMS[room].other || bucket !== ROOMS[room].other) report += `- **${bucket}**: ${n}\n`;
  }
  report += "\n";
}
report += `## Flagged (uncertain — landed in an implicit Other for a room with none defined): ${flagged.length}\n`;
for (const f of flagged) report += `- ${ROOM_LABELS[f.room]} / "${f.type}" — ${f.sku} "${f.name}"\n`;

writeFileSync(join(REPORTS, "subsection-classification.md"), report);
console.log(report);
console.log(`\nsubsections.json: ${Object.keys(skuToBucket).length} SKUs mapped -> image-pipeline/proposed/data/subsections.json`);
