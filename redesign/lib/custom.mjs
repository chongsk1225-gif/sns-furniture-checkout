// Custom Furniture room pages (living, dining, bedroom, sectionals). Content is deliberately
// consultation-led: it describes what a conversation covers, never what SNS Furniture can
// build, how long it takes or what it guarantees. Final specifications and pricing are
// stated as confirmed during consultation. Add confirmed options later in data/luxe-custom.json.
export const CUSTOM_ROOMS = {
  "custom-living": {
    h1: "Custom Living", opening: "room", form: "Living room",
    title: "Custom Living Room Furniture | SNS Furniture",
    description: "Custom living room furniture from SNS Furniture, designed around your space. Request a design consultation. Delivery throughout California.",
    lede: "Rooms for gathering, designed around you.",
    statement: "A living room is where a home is lived in. Custom begins with how you use yours.",
    topics: [["The room", "Scale, light and the way the space is used shape every decision."], ["The seating", "How many people gather, and how you like to sit."], ["The details", "Materials, finishes and dimensions are discussed and confirmed during your consultation."]],
    figures: [{ src: "/luxe/media/hero/sigma-1006-1007-studio.webp", w: 1000, h: 800, alt: "A low sectional in pale stone upholstery with a wood-toned inset table between a chaise and a sofa, photographed against a white studio backdrop.", cap: "Sigma 1006 / 1007", owned: true }],
    related: [["custom-sectionals", "Custom Sectionals"], ["living-room", "Shop Living, stock furniture"]],
  },
  "custom-dining": {
    h1: "Custom Dining", opening: null, form: "Dining room",
    title: "Custom Dining Room Furniture | SNS Furniture",
    description: "Custom dining room furniture from SNS Furniture, designed around the way you host. Request a design consultation. Delivery throughout California.",
    lede: "Tables and rooms for the way you host.",
    statement: "The dining room is built around people. Custom begins with who sits at your table.",
    topics: [["The table", "How many you host, and how the room is used day to day."], ["The room", "Proportion, light and the space to move around the table."], ["The details", "Materials, finishes and dimensions are discussed and confirmed during your consultation."]],
    figures: [{ src: "https://www.acmecorp.com/media/catalog/product/d/n/dn04775_life.jpg", w: 1000, h: 1000, alt: "A marble-topped dining table on a sculptural dark base before backlit shelving", cap: "Room inspiration", sku: "DN04775" }],
    related: [["custom-living", "Custom Living"], ["dining-room", "Shop Dining, stock furniture"]],
  },
  "custom-bedroom": {
    h1: "Custom Bedroom", opening: null, form: "Bedroom",
    title: "Custom Bedroom Furniture | SNS Furniture",
    description: "Custom bedroom furniture from SNS Furniture, designed for a calmer room. Request a design consultation. Delivery throughout California.",
    lede: "A quieter room, designed for you.",
    statement: "A bedroom should feel calm. Custom begins with how you want to wake up in it.",
    topics: [["The bed", "Scale and presence within the room."], ["The room", "Light, storage and the feel of the space."], ["The details", "Materials, finishes and dimensions are discussed and confirmed during your consultation."]],
    figures: [{ src: "https://www.acmecorp.com/media/catalog/product/b/d/bd07271ek_life.jpg", w: 1200, h: 1200, alt: "A low platform bed with an upholstered headboard beside tall windows", cap: "Room inspiration", sku: "BD07271EK" }],
    related: [["custom-living", "Custom Living"], ["bedroom", "Shop Bedroom, stock furniture"]],
  },
  "custom-sectionals": {
    h1: "Custom Sectionals", opening: "studio", form: "Living room",
    title: "Custom Sectionals | SNS Furniture",
    description: "Custom sectional seating from SNS Furniture, planned around your room. Request a design consultation. Delivery throughout California.",
    lede: "Seating planned around your room.",
    statement: "A sectional succeeds or fails on proportion. Custom begins with the room and the way you sit.",
    topics: [["The layout", "How the seating sits within the room and how you move around it."], ["The comfort", "How you sit, lounge and gather."], ["The details", "Materials, finishes and dimensions are discussed and confirmed during your consultation."]],
    figures: [{ src: "/luxe/media/hero/sigma-1006-1007-room.webp", w: 1000, h: 800, alt: "A low, pale sectional with a wood-toned inset table in a bright corner room with floor-to-ceiling windows, in front of a white marble coffee table.", cap: "Sigma 1006 / 1007", owned: true }],
    related: [["custom-living", "Custom Living"], ["living-room", "Shop Living, stock furniture"]],
  },
};
export const CUSTOM_SLUGS = Object.keys(CUSTOM_ROOMS);
export const PROCESS = [
  ["Share your vision", "Tell us about your space and how you live in it."],
  ["Develop the concept", "We shape a direction for the room together."],
  ["Refine dimensions, materials and finishes", "Specifics are discussed and confirmed with you."],
  ["Review and confirm the design", "Final specifications and pricing are confirmed before anything moves forward."],
];
export const processHtml = (esc) => `<ol class="lx-steps">${PROCESS.map(([t, p], i) => `<li class="lx-step lx-reveal" style="--d:${i * 80}ms"><span class="lx-step__n" aria-hidden="true">0${i + 1}</span><span class="lx-step__t">${esc(t)}</span><p>${esc(p)}</p></li>`).join("")}</ol>`;
