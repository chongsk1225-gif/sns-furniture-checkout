// Per-host token-bucket rate limiter + bounded concurrency + retry/backoff.
import { hostOf, sleep } from "./util.mjs";

const DEFAULT_RPS = 2;
const HOST_RPS = {
  // static-CDN image hosts on large commercial sites — courteous but not glacial
  "www.acmecorp.com": Number(process.env.ACME_RPS) || 6,
  "cdn.foagroup.com": Number(process.env.FOA_CDN_RPS) || 6,
  // FOA product-page HTML — gentle
  "www.foagroup.com": Number(process.env.FOA_PAGE_RPS) || 1,
};

class Bucket {
  constructor(rps) {
    this.interval = 1000 / rps;
    this.next = 0;
  }
  async take() {
    const now = Date.now();
    const at = Math.max(now, this.next);
    this.next = at + this.interval;
    if (at > now) await sleep(at - now);
  }
}

const buckets = new Map();
function bucketFor(host) {
  if (!buckets.has(host)) buckets.set(host, new Bucket(HOST_RPS[host] || DEFAULT_RPS));
  return buckets.get(host);
}

/**
 * Rate-limited fetch with retry. Returns { ok, status, contentType, buffer, finalUrl, error }.
 * Retries 429/5xx/network up to `retries` with exponential backoff. 404/410 fail fast.
 */
export async function politeFetch(url, { retries = 4, timeoutMs = 30000, headers = {} } = {}) {
  const host = hostOf(url);
  for (let attempt = 0; attempt <= retries; attempt++) {
    await bucketFor(host).take();
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        redirect: "follow",
        signal: ac.signal,
        headers: {
          "user-agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36",
          accept: "image/avif,image/webp,image/jpeg,image/png,*/*;q=0.8,text/html;q=0.5",
          ...headers,
        },
      });
      clearTimeout(timer);
      if (res.status === 404 || res.status === 410) {
        return { ok: false, status: res.status, finalUrl: res.url, error: "not_found" };
      }
      if ((res.status === 429 || res.status >= 500) && attempt < retries) {
        const wait = Math.min(30000, 800 * 2 ** attempt) + Math.random() * 400;
        await sleep(wait);
        continue;
      }
      const contentType = res.headers.get("content-type") || "";
      const buffer = Buffer.from(await res.arrayBuffer());
      return { ok: res.ok, status: res.status, contentType, buffer, finalUrl: res.url };
    } catch (err) {
      clearTimeout(timer);
      if (attempt < retries) {
        await sleep(Math.min(30000, 800 * 2 ** attempt) + Math.random() * 400);
        continue;
      }
      return { ok: false, status: 0, error: String(err && err.message ? err.message : err) };
    }
  }
  return { ok: false, status: 0, error: "exhausted" };
}

/** Run async `worker(item)` over `items` with at most `concurrency` in flight. */
export async function pool(items, concurrency, worker) {
  let i = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      await worker(items[idx], idx);
    }
  });
  await Promise.all(runners);
}
