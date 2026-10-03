// Local preview server for the luxury redesign prototype.
//   node redesign/serve.mjs            -> http://127.0.0.1:8810/
//
// Overlay model: anything the redesign provides wins; everything else falls
// through to public/ untouched, so the existing catalog, cart and checkout
// pages keep working exactly as they do today. /api/* is proxied to the local
// wrangler dev Worker (default 127.0.0.1:8787) so cart -> checkout can be
// exercised from the redesigned pages. Never deploys, never writes.
import http from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, extname, normalize, sep } from "node:path";
import { REDESIGN_ROOT, PUBLIC_ROOT, readPage } from "./lib/includes.mjs";
import { collectionData, ROOM_BY_SLUG } from "./lib/collections.mjs";

const PORT = Number(process.env.PORT) || 8810;
const API_TARGET = process.env.API_TARGET || "http://127.0.0.1:8787";
const MIME = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".avif": "image/avif",
  ".woff2": "font/woff2", ".woff": "font/woff", ".mp4": "video/mp4", ".webm": "video/webm",
  ".txt": "text/plain; charset=utf-8", ".xml": "application/xml", ".webmanifest": "application/manifest+json",
};

function safeJoin(root, urlPath) {
  const p = normalize(decodeURIComponent(urlPath)).replace(/^([/\\])+/, "");
  const full = join(root, p);
  return full.startsWith(root + sep) || full === root ? full : null;
}
function sendFile(res, file) {
  const type = MIME[extname(file).toLowerCase()] || "application/octet-stream";
  res.writeHead(200, { "content-type": type, "cache-control": "no-store" });
  res.end(readFileSync(file));
}
function isFile(p) {
  try { return statSync(p).isFile(); } catch { return false; }
}

async function proxy(req, res) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = chunks.length ? Buffer.concat(chunks) : undefined;
  const headers = { ...req.headers, host: new URL(API_TARGET).host };
  // The Worker allow-lists a single Origin; present the one it was configured for.
  if (headers.origin) headers.origin = API_TARGET;
  if (headers.referer) headers.referer = API_TARGET + "/";
  const r = await fetch(API_TARGET + req.url, { method: req.method, headers, body, redirect: "manual" });
  const out = {};
  r.headers.forEach((v, k) => { if (!["content-encoding", "transfer-encoding", "content-length"].includes(k)) out[k] = v; });
  const setCookie = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
  if (setCookie.length) out["set-cookie"] = setCookie.map((c) => c.replace(/;\s*Secure/i, ""));
  res.writeHead(r.status, out);
  res.end(Buffer.from(await r.arrayBuffer()));
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    const path = url.pathname;

    if (path.startsWith("/api/")) return await proxy(req, res);

    // virtual per-room data
    const m = path.match(/^\/data\/collection-([\w-]+)\.json$/);
    if (m && ROOM_BY_SLUG[m[1]]) {
      res.writeHead(200, { "content-type": MIME[".json"], "cache-control": "no-store" });
      return res.end(JSON.stringify(collectionData(m[1])));
    }

    // redesigned pages
    const pageName = path === "/" ? "index.html" : path.slice(1);
    if (/^[\w-]+\.html$/.test(pageName) && existsSync(join(REDESIGN_ROOT, "pages", pageName))) {
      res.writeHead(200, { "content-type": MIME[".html"], "cache-control": "no-store" });
      return res.end(readPage(pageName));
    }

    // redesign assets (luxe/*) and overlay data (data/luxe-*)
    if (path.startsWith("/luxe/") || /^\/data\/luxe-[\w-]+\.json$/.test(path)) {
      const f = safeJoin(REDESIGN_ROOT, path);
      if (f && isFile(f)) return sendFile(res, f);
    }

    // everything else: the existing site, untouched
    const f = safeJoin(PUBLIC_ROOT, path === "/" ? "/index.html" : path);
    if (f && isFile(f)) return sendFile(res, f);
    res.writeHead(404, { "content-type": MIME[".txt"] });
    res.end("Not found");
  } catch (e) {
    res.writeHead(500, { "content-type": MIME[".txt"] });
    res.end("Server error: " + (e && e.message));
  }
});
server.listen(PORT, "127.0.0.1", () => console.log(`luxury redesign preview -> http://127.0.0.1:${PORT}/  (public/ underneath, /api -> ${API_TARGET})`));
