// Stock-furniture room pages share one template (templates/room.html); this is
// their per-room configuration. Titles, descriptions, canonical URLs and JSON-LD
// are NOT defined here: they are passed through from the existing public/<slug>.html
// (via <!--@seo-->) so SEO-critical text and structured data stay single-sourced.
// `intro` is the short visible category introduction (written from the catalog's own
// product groups; no claims beyond what the catalog and published policies support).
export const ROOMS = {
  "living-room": {
    category: "Living Room", h1: "Living", vh: " room furniture", nav: "living",
    intro: "Sectionals, sofas and loveseats, recliners and chairs, tables, ottomans and benches for the living room. Delivery throughout California; in-home design service available.",
    interlude: { src: "https://www.acmecorp.com/media/catalog/product/5/4/54955_life.jpg", alt: "A tan leather sofa and two armchairs before a walnut-paneled wall", text: "Designed around your space." },
  },
  "dining-room": {
    category: "Dining Room", h1: "Dining", vh: " room furniture", nav: "dining",
    intro: "Dining table sets, dining tables and chairs, counter-height and bar seating, and servers, curios and buffets. Delivery throughout California; in-home design service available.",
    interlude: { src: "https://www.acmecorp.com/media/catalog/product/d/n/dn04775_life.jpg", alt: "A marble-topped dining table on a sculptural dark base before backlit shelving", text: "Designed around your space." },
  },
  "bedroom": {
    category: "Bedroom", h1: "Bedroom", vh: " furniture", nav: "bedroom",
    intro: "Beds, bedroom sets, nightstands, dressers and mirrors, and chests for the bedroom. Delivery throughout California; in-home design service available.",
    interlude: { src: "https://www.acmecorp.com/media/catalog/product/b/d/bd07271ek_life.jpg", alt: "A low platform bed with an upholstered headboard beside tall windows", text: "Designed around your space." },
  },
  "mattresses": {
    category: "Mattresses", h1: "Mattresses", vh: "", nav: "stock",
    intro: "Mattresses and foundations, including memory foam and pillow-top styles. Delivery throughout California.",
    interlude: null,
  },
  "accent": {
    category: "Accent Furniture", h1: "Accent", vh: " furniture", nav: "stock",
    intro: "Accent chairs and tables, end tables, console units, area rugs and lamps to finish a room. Delivery throughout California.",
    interlude: null,
  },
};
export const ROOM_SLUGS = Object.keys(ROOMS);
