// Static server for visual review of the PROPOSED dataset.
// Serves public/, but any path that also exists under image-pipeline/proposed/
// is served from there instead — image-pipeline/proposed/data/* overlays
// public/data/*, and e.g. image-pipeline/proposed/product-page.js (a staged
// code fix, not just data) overlays public/product-page.js the same way.
// public/ itself is never read-write here — read-only passthrough for
// anything not overridden.
//   node serve-proposed.mjs   → http://127.0.0.1:8799/
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, extname, normalize } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(HERE, "..", "public");
const PROPOSED = join(HERE, "proposed");
const PORT = Number(process.env.PORT) || 8799;

const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml", ".jpg": "image/jpeg", ".png": "image/png", ".webmanifest": "application/manifest+json",
  ".xml": "application/xml", ".txt": "text/plain; charset=utf-8",
};

createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (p === "/") p = "/index.html";
    const rel = normalize(p).replace(/^([/\\])+/, "");
    let file = join(PROPOSED, rel);
    try {
      await stat(file); // exists under proposed/ — serve the staged override
    } catch {
      file = join(PUBLIC, rel); // fall back to the unmodified live file
    }
    try {
      if ((await stat(file)).isDirectory()) file = join(file, "index.html");
    } catch {}
    const body = await readFile(file);
    res.writeHead(200, { "content-type": TYPES[extname(file).toLowerCase()] || "application/octet-stream", "cache-control": "no-store" });
    res.end(body);
  } catch {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found");
  }
}).listen(PORT, "127.0.0.1", () => console.log(`proposed site → http://127.0.0.1:${PORT}/`));
