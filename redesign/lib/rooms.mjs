// Stock-furniture room pages share one template (templates/room.html); this is
// their per-room configuration. Titles, descriptions, canonical URLs and JSON-LD
// are NOT defined here: they are passed through from the existing public/<slug>.html
// (via <!--@seo-->) so SEO-critical text and structured data stay single-sourced.
export const ROOMS = {
  "living-room": {
    category: "Living Room", h1: "Living", vh: " room furniture", nav: "stock",
    interlude: { src: "https://www.acmecorp.com/media/catalog/product/5/4/54955_life.jpg", alt: "A tan leather sofa and two armchairs before a walnut-paneled wall", text: "Designed around your space." },
  },
  "dining-room": {
    category: "Dining Room", h1: "Dining", vh: " room furniture", nav: "stock",
    interlude: { src: "https://www.acmecorp.com/media/catalog/product/d/n/dn04775_life.jpg", alt: "A marble-topped dining table on a sculptural dark base before backlit shelving", text: "Designed around your space." },
  },
  "bedroom": {
    category: "Bedroom", h1: "Bedroom", vh: " furniture", nav: "stock",
    interlude: { src: "https://www.acmecorp.com/media/catalog/product/b/d/bd07271ek_life.jpg", alt: "A low platform bed with an upholstered headboard beside tall windows", text: "Designed around your space." },
  },
  "mattresses": { category: "Mattresses", h1: "Mattresses", vh: "", nav: "stock", interlude: null },
  "accent": { category: "Accent Furniture", h1: "Accent", vh: " furniture", nav: "stock", interlude: null },
};
export const ROOM_SLUGS = Object.keys(ROOMS);
