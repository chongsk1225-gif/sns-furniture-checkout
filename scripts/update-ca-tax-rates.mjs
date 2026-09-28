/**
 * Refresh src/lib/ca-district-tax-rates.json from CDTFA's official published
 * rate table. CDTFA updates rates up to 4×/year (Jan 1 / Apr 1 / Jul 1 / Oct 1).
 *
 *   node scripts/update-ca-tax-rates.mjs <xlsxUrl> <effectiveDateISO>
 *
 * Get <xlsxUrl> from https://www.cdtfa.ca.gov/taxes-and-fees/sales-use-tax-rates.htm
 * — the "Excel Version 2012 (xlsx)" link under the current "Tax Rates Effective …"
 * heading (e.g. https://www.cdtfa.ca.gov/taxes-and-fees/SalesTaxRates10-1-26.xlsx).
 *
 * The file is CDTFA's own "Location / Rate / County / Type / Notes" table —
 * this script only reformats it, it never invents or adjusts a rate.
 */
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = join(HERE, "..", "src", "lib", "ca-district-tax-rates.json");

const [, , xlsxUrl, effectiveDate] = process.argv;
if (!xlsxUrl || !/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate || "")) {
  console.error("usage: node scripts/update-ca-tax-rates.mjs <xlsxUrl> <YYYY-MM-DD>");
  process.exit(1);
}

const tmp = mkdtempSync(join(tmpdir(), "ca-tax-"));
try {
  const xlsxPath = join(tmp, "rates.xlsx");
  execFileSync("curl", ["-sL", "-A", "Mozilla/5.0", xlsxUrl, "-o", xlsxPath], { stdio: "inherit" });
  execFileSync("unzip", ["-o", "-q", xlsxPath, "-d", tmp]);

  const sharedXml = require_text(join(tmp, "xl", "sharedStrings.xml"));
  const sheetXml = require_text(join(tmp, "xl", "worksheets", "sheet1.xml"));

  function decodeXml(s) {
    return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
  }

  const shared = [];
  for (const m of sharedXml.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
    const texts = [...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((x) => x[1]);
    shared.push(decodeXml(texts.join("")));
  }

  function colIdx(col) {
    let n = 0;
    for (const ch of col) n = n * 26 + (ch.charCodeAt(0) - 64);
    return n - 1;
  }

  const rows = [];
  for (const rowM of sheetXml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const byIdx = {};
    const cellRe = /<c([^>]*)>(?:([\s\S]*?))?<\/c>|<c([^>]*)\/>/g;
    let cm;
    while ((cm = cellRe.exec(rowM[1]))) {
      const attrs = cm[1] || cm[3] || "";
      const body = cm[2] || "";
      const refMatch = /r="([A-Z]+)\d+"/.exec(attrs);
      if (!refMatch) continue;
      const type = (/t="([^"]+)"/.exec(attrs) || [])[1];
      const vMatch = /<v>([\s\S]*?)<\/v>/.exec(body);
      let value = vMatch ? vMatch[1] : "";
      if (type === "s") value = shared[Number(value)] ?? "";
      byIdx[colIdx(refMatch[1])] = value;
    }
    rows.push([byIdx[0] ?? "", byIdx[1] ?? "", byIdx[2] ?? "", byIdx[3] ?? ""]);
  }

  const cities = {};
  const counties = {};
  let skipped = 0;
  for (const [location, rateRaw, county, type] of rows.slice(2)) {
    if (!location) continue;
    const rate = Number(rateRaw);
    if (!Number.isFinite(rate) || rate <= 0 || rate > 0.2) {
      skipped++;
      continue;
    }
    if (type === "City") {
      cities[String(location).trim().toUpperCase()] = { rate: Number(rate.toFixed(5)), county, raw: location };
    } else if (type === "County") {
      counties[String(county).trim().toUpperCase()] = { rate: Number(rate.toFixed(5)), raw: location };
    }
  }

  const cityCount = Object.keys(cities).length;
  const countyCount = Object.keys(counties).length;
  if (cityCount < 400 || countyCount < 50) {
    console.error(`FATAL: parsed only ${cityCount} cities / ${countyCount} counties — expected ~483/58. Refusing to overwrite ${OUT_PATH}. The source file's layout may have changed; inspect it manually.`);
    process.exit(2);
  }

  writeFileSync(
    OUT_PATH,
    JSON.stringify({ effectiveDate, source: xlsxUrl, cities, counties }, null, 1),
  );
  console.log(`wrote ${OUT_PATH}: ${cityCount} cities, ${countyCount} counties, effective ${effectiveDate} (${skipped} non-rate rows skipped)`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

function require_text(path) {
  return execFileSync("cat", [path]).toString("utf8");
}
