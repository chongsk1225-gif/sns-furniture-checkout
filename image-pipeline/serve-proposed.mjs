// Static server for visual review of the PROPOSED dataset.
// Serves public/ but overlays image-pipeline/proposed/data/* for /data/* requests.
//   node serve-proposed.mjs   → http://127.0.0.1:8799/
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, extname, normalize } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(HERE, "..", "public");
const PROPOSED_DATA = join(HERE, "proposed", "data");
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
    const base = rel.startsWith("data/") || rel.startsWith("data\\") ? PROPOSED_DATA.replace(/data$/, "") : PUBLIC;
    let file = join(base, rel);
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
