// Extension markers that need catalog data. Import this once at startup (serve.mjs / build.mjs)
// after includes.mjs; it registers them with the page assembler.
//   <!--@tiles living-room-->   the first rows of a room page as real, crawlable HTML
//                               (the browser script continues from there: filters, "view more")
import { registerMarker, esc } from "./includes.mjs";
import { collectionData, collectionsIndexData } from "./collections.mjs";
import { collectionPath } from "./slug.mjs";
import { tileHtml } from "./cards.mjs";
import { ROOMS } from "./rooms.mjs";
import { inspirationGrid, inspirationStories } from "./inspiration.mjs";
import { processHtml } from "./custom.mjs";

export const SSR_TILES = 24;
const INTERLUDE_AFTER = 12;
const cache = new Map();

function roomTiles(slug) {
  if (cache.has(slug)) return cache.get(slug);
  const room = ROOMS[slug];
  const data = collectionData(slug);
  if (!room || !data) return "";
  const il = room.interlude;
  let html = "";
  data.items.slice(0, SSR_TILES).forEach((i, n) => {
    html += tileHtml({ sku: i[0], name: i[1], type: i[2], sub: i[3] ? `${i[3]} collection` : i[2], price: i[4], image: i[5] }, n);
    if (il && n === INTERLUDE_AFTER - 1 && data.items.length > INTERLUDE_AFTER + 3) {
      html += `<figure class="lx-interlude"><img src="${esc(il.src)}" width="1600" height="686" alt="${esc(il.alt)}" loading="lazy" decoding="async"><span class="lx-interlude__scrim"></span><figcaption class="lx-interlude__copy"><p>${esc(il.text)}</p><a class="lx-btn lx-btn--light" href="/custom-furniture.html">Explore Custom Furniture</a></figcaption></figure>`;
    }
  });
  cache.set(slug, html);
  return html;
}

registerMarker("tiles", (slug) => roomTiles(String(slug || "").trim()));
// The piece count in a room header, rendered on the server so the first paint already has its final text.
registerMarker("roomcount", (slug) => {
  const data = collectionData(String(slug || "").trim());
  const n = data ? data.items.length : 0;
  return n ? `${n.toLocaleString("en-US")} ${n === 1 ? "piece" : "pieces"}` : "&nbsp;";
});

//   <!--@consult Living room-->   the design-consultation section (form + intro). The argument
//                                 pre-selects the room. Posts through formsubmit.co exactly like
//                                 the existing contact form (no new server, no stored data).
const ROOM_OPTIONS = ["Living room", "Dining room", "Bedroom", "Another space"];
registerMarker("consult", (room) => {
  const sel = String(room || "").trim();
  const opts = ROOM_OPTIONS.map((r) => `<option${r === sel ? " selected" : ""}>${esc(r)}</option>`).join("");
  return `<section class="lx-consult" id="consultation" aria-labelledby="consult-h">
    <div class="lx-consult__grid">
      <div class="lx-consult__intro">
        <p class="lx-eyebrow lx-reveal">Begin</p>
        <h2 class="lx-h2 lx-reveal" id="consult-h">Request a Design Consultation</h2>
        <p class="lx-reveal">Tell us a little about your project. We will reply by email or phone. Final specifications and pricing are confirmed during the consultation.</p>
        <p class="lx-reveal">Prefer to talk? Text or call <a class="lx-textlink" style="padding:0" href="tel:+14243106199">(424) 310-6199</a>.</p>
      </div>
      <form class="lx-form lx-reveal" action="https://formsubmit.co/info@snsfurniture.com" method="POST" aria-label="Design consultation request">
        <input type="hidden" name="_subject" value="Design consultation request">
        <input type="hidden" name="_template" value="table">
        <div class="lx-hp" aria-hidden="true"><label for="cf-company">Company</label><input id="cf-company" name="_honey" type="text" tabindex="-1" autocomplete="off"></div>
        <div class="lx-form__row">
          <div><label for="cf-name">Full name</label><input id="cf-name" name="name" autocomplete="name" required></div>
          <div><label for="cf-email">Email</label><input id="cf-email" name="email" type="email" autocomplete="email" required></div>
        </div>
        <div class="lx-form__row">
          <div><label for="cf-phone">Phone</label><input id="cf-phone" name="phone" type="tel" autocomplete="tel"></div>
          <div><label for="cf-zip">Delivery ZIP code</label><input id="cf-zip" name="zip" inputmode="numeric" autocomplete="postal-code"></div>
        </div>
        <div class="lx-form__row">
          <div><label for="cf-room">Room</label><select id="cf-room" name="room"><option value="">Select a room</option>${opts}</select></div>
          <div><label for="cf-contact">Preferred contact</label><select id="cf-contact" name="preferred_contact"><option>Email</option><option>Phone call</option><option>Text message</option></select></div>
        </div>
        <div><label for="cf-ref">Piece or reference (optional)</label><input id="cf-ref" name="reference" placeholder="For example, Sigma 1006 / 1007"></div>
        <div><label for="cf-msg">Tell us about your space</label><textarea id="cf-msg" name="message" required></textarea></div>
        <p class="lx-form__note">By sending this request you agree to be contacted about your project. See our <a href="privacy.html">Privacy Policy</a>.</p>
        <button class="lx-btn lx-btn--light" type="submit">Request a Design Consultation</button>
      </form>
    </div>
  </section>`;
});

//   <!--@process-->            the four-step custom process
//   <!--@inspiration 3-->      N room-inspiration scenes (collection photographs)
//   <!--@stories-->            the long-form scenes for the Room Inspiration page
registerMarker("process", () => processHtml(esc));
registerMarker("inspiration", (n) => inspirationGrid(Number(n) || 3, false));
registerMarker("stories", () => inspirationStories());

//   <!--@paths-->   the four custom pathways (Living, Sectionals, Dining, Bedroom) as image panels
const owned = (stem, alt) => `<picture><source type="image/avif" srcset="/luxe/media/hero/${stem}-480.avif 480w, /luxe/media/hero/${stem}-800.avif 800w, /luxe/media/hero/${stem}.avif 1000w" sizes="(max-width: 760px) 100vw, 50vw"><source type="image/webp" srcset="/luxe/media/hero/${stem}-480.webp 480w, /luxe/media/hero/${stem}-800.webp 800w, /luxe/media/hero/${stem}.webp 1000w" sizes="(max-width: 760px) 100vw, 50vw"><img src="/luxe/media/hero/${stem}.webp" width="1000" height="800" alt="${esc(alt)}" loading="lazy" decoding="async"></picture>`;
const PATHS = [
  ["custom-living.html", "Custom Living", owned("sigma-1006-1007-room", "A low, pale sectional with a wood-toned inset table in a bright corner room with floor-to-ceiling windows, in front of a white marble coffee table.")],
  ["custom-sectionals.html", "Custom Sectionals", owned("sigma-1006-1007-studio", "A low sectional in pale stone upholstery with a wood-toned inset table between a chaise and a sofa, photographed against a white studio backdrop.")],
  ["custom-dining.html", "Custom Dining", `<img src="https://www.acmecorp.com/media/catalog/product/d/n/dn04775_life.jpg" width="1000" height="800" alt="A marble-topped dining table on a sculptural dark base before backlit shelving" loading="lazy" decoding="async">`],
  ["custom-bedroom.html", "Custom Bedroom", `<img src="https://www.acmecorp.com/media/catalog/product/b/d/bd07271ek_life.jpg" width="1000" height="800" alt="A low platform bed with an upholstered headboard beside tall windows" loading="lazy" decoding="async">`],
];
registerMarker("paths", () => `<div class="lx-paths__grid">${PATHS.map(([href, name, media], i) => `<a class="lx-path lx-reveal" style="--d:${(i % 2) * 100}ms" href="${href}">${media}<span class="lx-path__cap"><span class="lx-path__name">${name}</span><span class="lx-path__cta">Explore</span></span></a>`).join("")}</div><p class="lx-paths__note lx-reveal">Dining and bedroom imagery is room inspiration from our stock collections.</p>`);

// First rows of the Collections index as real, crawlable HTML (the client script adopts them).
const ROOM_ORDER = ["Living", "Dining", "Bedroom", "Mattresses", "Accent", "Youth", "Office"];
registerMarker("collectiontiles", () => {
  const rows = collectionsIndexData().items.slice(0, 24);
  return rows.map((r, n) => {
    const rooms = [...r[2]].sort((x, y) => ROOM_ORDER.indexOf(x) - ROOM_ORDER.indexOf(y)).join(" · ");
    const img = n < 2 ? "" : ' loading="lazy" fetchpriority="low"';
    const pri = n < 2 ? ' fetchpriority="high"' : "";
    return '<a class="lx-tile" href="' + collectionPath(r[0]) + '"><span class="lx-tile__media"><img src="' + esc(r[3]) + '" width="1000" height="1000" alt="' + esc(r[0] + " collection") + '"' + img + pri + ' decoding="async"></span><span class="lx-tile__meta"><span class="lx-tile__eyebrow">' + esc(rooms) + '</span><span class="lx-tile__name">' + esc(r[0]) + '</span><span class="lx-tile__price">' + r[1].toLocaleString("en-US") + ' pieces</span></span></a>';
  }).join("");
});
registerMarker("collectionscount", () => { const n = collectionsIndexData().items.length; return n.toLocaleString("en-US") + (n === 1 ? " collection" : " collections"); });
