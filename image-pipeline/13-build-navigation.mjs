// Site-wide navigation rebuild — stages EVERY public/*.html file into
// image-pipeline/proposed/ with:
//   1. Office + Youth & Kids added to header nav, mobile nav, and footer SHOP
//      (identical markup was verified byte-for-byte identical across all 22
//      pages before this script assumes it — see 22/22 check below).
//   2. A #subsectionBar placeholder injected into the 5 room pages
//      (living-room/dining-room/bedroom + new office/youth), right above the
//      product grid, for site.js's renderSubsectionBar() to populate.
//   3. Two new pages, office.html and youth.html, built from the
//      living-room.html template with room-specific copy/schema/hero text.
// Writes ONLY to image-pipeline/proposed/ — public/ is read-only input here.
//   node 13-build-navigation.mjs
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(HERE, "..", "public");
const PROPOSED = join(HERE, "proposed");
mkdirSync(PROPOSED, { recursive: true });

const OLD_NAV = `<nav class="nav"><a href="living-room.html">LIVING ROOM</a><a href="dining-room.html">DINING ROOM</a><a href="bedroom.html">BEDROOM</a><a href="mattresses.html">MATTRESSES</a><a href="accent.html">ACCENT</a><a href="catalog.html">ALL FURNITURE</a></nav>`;
const NEW_NAV = `<nav class="nav"><a href="living-room.html">LIVING ROOM</a><a href="dining-room.html">DINING ROOM</a><a href="bedroom.html">BEDROOM</a><a href="mattresses.html">MATTRESSES</a><a href="accent.html">ACCENT</a><a href="office.html">OFFICE</a><a href="youth.html">YOUTH &amp; KIDS</a><a href="catalog.html">ALL FURNITURE</a></nav>`;

const OLD_MNAV = `<div class="mobile-nav wrap"><a href="living-room.html">Living Room</a><a href="dining-room.html">Dining Room</a><a href="bedroom.html">Bedroom</a><a href="mattresses.html">Mattresses</a><a href="accent.html">Accent Furniture</a><a href="catalog.html">All Furniture</a></div>`;
const NEW_MNAV = `<div class="mobile-nav wrap"><a href="living-room.html">Living Room</a><a href="dining-room.html">Dining Room</a><a href="bedroom.html">Bedroom</a><a href="mattresses.html">Mattresses</a><a href="accent.html">Accent Furniture</a><a href="office.html">Office</a><a href="youth.html">Youth &amp; Kids</a><a href="catalog.html">All Furniture</a></div>`;

const OLD_FOOTER = `<h4>SHOP</h4><a href="living-room.html">Living Room</a><br><a href="dining-room.html">Dining Room</a><br><a href="bedroom.html">Bedroom</a><br><a href="mattresses.html">Mattresses</a><br><a href="accent.html">Accent Furniture</a>`;
const NEW_FOOTER = `<h4>SHOP</h4><a href="living-room.html">Living Room</a><br><a href="dining-room.html">Dining Room</a><br><a href="bedroom.html">Bedroom</a><br><a href="mattresses.html">Mattresses</a><br><a href="accent.html">Accent Furniture</a><br><a href="office.html">Office</a><br><a href="youth.html">Youth &amp; Kids</a>`;

const SUBSECTION_BAR = `<div class="subsection-bar" id="subsectionBar"></div>`;

const htmlFiles = readdirSync(PUBLIC).filter((f) => f.endsWith(".html"));
let navCount = 0, mnavCount = 0, footerCount = 0;
const missing = [];

for (const f of htmlFiles) {
  let html = readFileSync(join(PUBLIC, f), "utf8");
  if (html.includes(OLD_NAV)) { html = html.replace(OLD_NAV, NEW_NAV); navCount++; } else missing.push(`${f}: header nav`);
  if (html.includes(OLD_MNAV)) { html = html.replace(OLD_MNAV, NEW_MNAV); mnavCount++; } else missing.push(`${f}: mobile nav`);
  if (html.includes(OLD_FOOTER)) { html = html.replace(OLD_FOOTER, NEW_FOOTER); footerCount++; } else missing.push(`${f}: footer SHOP`);
  writeFileSync(join(PROPOSED, f), html);
}

console.log(`Processed ${htmlFiles.length} public/*.html files -> image-pipeline/proposed/`);
console.log(`  header nav updated: ${navCount}/${htmlFiles.length}`);
console.log(`  mobile nav updated: ${mnavCount}/${htmlFiles.length}`);
console.log(`  footer SHOP updated: ${footerCount}/${htmlFiles.length}`);
if (missing.length) console.log("  MISMATCHES (markup wasn't byte-identical, needs manual review):\n    " + missing.join("\n    "));

// ---- inject #subsectionBar into the 3 existing room pages ------------------
const ROOM_PAGES = ["living-room.html", "dining-room.html", "bedroom.html"];
let barInjected = 0;
for (const f of ROOM_PAGES) {
  const path = join(PROPOSED, f);
  let html = readFileSync(path, "utf8");
  const marker = '<div class="product-grid" id="grid"></div>';
  if (html.includes(marker) && !html.includes('id="subsectionBar"')) {
    html = html.replace(marker, `${SUBSECTION_BAR}${marker}`);
    writeFileSync(path, html);
    barInjected++;
  }
}
console.log(`#subsectionBar injected into ${barInjected}/${ROOM_PAGES.length} existing room pages`);

// ---- build office.html and youth.html from the living-room.html template --
const template = readFileSync(join(PROPOSED, "living-room.html"), "utf8");

function buildRoomPage({ slug, category, title, metaDesc, heroH1, heroP }) {
  let html = template;
  html = html.replaceAll("Living Room Furniture | Sofas &amp; Sectionals | Sash and Shade", title);
  html = html.replaceAll(
    "Browse living room furniture at Sash and Shade, including sofas and sectionals. Ask about availability, delivery and free in-home design service.",
    metaDesc,
  );
  html = html.replaceAll("https://snsfurniture.com/living-room.html", `https://snsfurniture.com/${slug}`);
  html = html.replace("<h1>Living Room Furniture</h1>", `<h1>${heroH1}</h1>`);
  html = html.replace(
    "<p>Sofas and sectionals with individually matched product photography.</p>",
    `<p>${heroP}</p>`,
  );
  html = html.replace('renderCategory("Living Room");', `renderCategory("${category}");`);
  return html;
}

writeFileSync(
  join(PROPOSED, "office.html"),
  buildRoomPage({
    slug: "office.html",
    category: "Office",
    title: "Office Furniture | Desks &amp; Desk Chairs | Sash and Shade",
    metaDesc: "Browse office furniture at Sash and Shade, including desks, desk chairs, bookshelves and file cabinets. Ask about availability, delivery and free in-home design service.",
    heroH1: "Office Furniture",
    heroP: "Desks, desk chairs, bookshelves, file cabinets, music studio and gaming furniture with individually matched product photography.",
  }),
);
writeFileSync(
  join(PROPOSED, "youth.html"),
  buildRoomPage({
    slug: "youth.html",
    category: "Youth",
    title: "Youth &amp; Kids Furniture | Bunk Beds &amp; Bedroom Sets | Sash and Shade",
    metaDesc: "Browse youth and kids furniture at Sash and Shade, including bunk beds, daybeds and kids bedroom sets. Ask about availability, delivery and free in-home design service.",
    heroH1: "Youth &amp; Kids Furniture",
    heroP: "Bunk beds, daybeds, trundles and kids bedroom sets with individually matched product photography.",
  }),
);
console.log("Built proposed/office.html and proposed/youth.html from the living-room.html template");

// inject #subsectionBar into the 2 new pages too
for (const f of ["office.html", "youth.html"]) {
  const path = join(PROPOSED, f);
  let html = readFileSync(path, "utf8");
  const marker = '<div class="product-grid" id="grid"></div>';
  html = html.replace(marker, `${SUBSECTION_BAR}${marker}`);
  writeFileSync(path, html);
}
console.log("#subsectionBar injected into office.html and youth.html");
