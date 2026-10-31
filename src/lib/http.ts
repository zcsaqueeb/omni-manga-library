/**
 * Hardened upstream fetch helper: timeout, retries with exponential backoff
 * and jitter, polite User-Agent, and JSON parsing with graceful failure.
 */

// Sites behind Cloudflare reject obvious bot/server UAs — present a normal
// browser identity so upstream HTML sites keep answering (JSON APIs ignore it).
const DEFAULT_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

/**
 * Lazily load spawn WITHOUT a static import — http.ts is part of the client
 * bundle graph (the UI imports shared types through the source registry) and
 * a static node:child_process import breaks the browser build. The variable
 * specifier keeps every bundler from resolving it; on the client the guard
 * returns null and the curl fallback is simply unavailable (never executed —
 * it only runs inside Node API routes).
 */
interface CurlProcess {
  stdout: { on: (e: "data", cb: (c: Buffer) => void) => void };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on: (e: string, cb: (arg?: any) => void) => void;
  kill: (sig: string) => void;
}
type SpawnFn = (cmd: string, args: string[], opts: unknown) => CurlProcess;

let _spawn: SpawnFn | null | undefined;
function loadSpawn(): SpawnFn | null {
  if (_spawn !== undefined) return _spawn;
  return null; // async init runs on first call via initSpawn()
}
async function initSpawn(): Promise<SpawnFn | null> {
  if (_spawn !== undefined) return _spawn;
  try {
    if (typeof window !== "undefined" || typeof process === "undefined") {
      _spawn = null;
      return null;
    }
    const spec = "node:child_process";
    const mod = (await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ spec)) as {
      spawn: SpawnFn;
    };
    _spawn = mod.spawn;
  } catch {
    _spawn = null;
  }
  return _spawn;
}

export interface FetchOptions extends RequestInit {
  timeoutMs?: number;
  retries?: number;
  retryOnStatus?: number[];
  /** Treat an OK response as a failure (Cloudflare interstitials return 200/403 bodies). */
  validateBody?: (body: string) => boolean;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Cloudflare/anti-bot interstitials answer with these markers — retrying or
 * failing fast beats handing the scraper a challenge page to "parse". */
const CHALLENGE_MARKERS = [
  "just a moment",
  "challenge-platform",
  "cf-browser-verification",
  "attention required! | cloudflare",
  "cf-error-details",
  "checking your browser",
  "enable javascript and cookies to continue",
  "verify you are a human",
];

export function looksLikeChallenge(html: string): boolean {
  if (html.length > 60_000) return false; // real pages are rarely this small AND marked
  const needle = html.slice(0, 4_000).toLowerCase();
  return CHALLENGE_MARKERS.some((m) => needle.includes(m));
}

/* ─────────────── curl transport fallback (Cloudflare defeats undici) ─────────────── */

/**
 * Some Cloudflare configs challenge Node's fetch (undici TLS/HTTP2 fingerprint)
 * while waving the system curl binary through. When the primary transport hits
 * a challenge/403 we retry the exact request through curl — a different TLS
 * stack, same headers. This revived WeebCentral + ManhuaTop (2026-10 audit).
 */
async function curlText(url: string, timeoutMs: number, headers?: Record<string, string>): Promise<string> {
  const spawn = (await initSpawn()) ?? loadSpawn();
  if (!spawn) throw new Error("curl transport unavailable");
  const args = [
    "-sS",
    "-L", // follow redirects like fetch does
    "--compressed",
    "--max-time", String(Math.max(2, Math.ceil(timeoutMs / 1000))),
    "-A", DEFAULT_UA,
    "-H", "Accept-Language: en-US,en;q=0.9",
  ];
  for (const [k, v] of Object.entries(headers ?? {})) {
    if (k.toLowerCase() === "user-agent" || k.toLowerCase() === "accept-language") continue;
    args.push("-H", `${k}: ${v}`);
  }
  args.push(url);

  return new Promise<string>((resolve, reject) => {
    const p = spawn("curl", args, { stdio: ["ignore", "pipe", "ignore"] });
    const chunks: Buffer[] = [];
    p.stdout.on("data", (c: Buffer) => chunks.push(c));
    const timer = setTimeout(() => p.kill("SIGKILL"), timeoutMs + 2_000);
    p.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    p.on("close", (code) => {
      clearTimeout(timer);
      const body = Buffer.concat(chunks).toString("utf8");
      const ok = Number(code) === 0;
      if (!ok || !body) {
        reject(new Error(`curl transport failed (${code}) for ${url}`));
        return;
      }
      if (looksLikeChallenge(body)) {
        reject(new Error(`Bot challenge for ${url}`));
        return;
      }
      resolve(body);
    });
  });
}

export async function upstreamFetch(
  url: string,
  opts: FetchOptions = {},
): Promise<Response> {
  const {
    timeoutMs = 12_000,
    retries = 2,
    // 403/418 included: sites like AO3 answer bot hits with 418 and
    // Cloudflare-fronted sites answer without clearance with 403 — a quick
    // second attempt often clears a transient hiccup.
    retryOnStatus = [403, 418, 429, 500, 502, 503, 504],
    validateBody,
    ...init
  } = opts;

  let lastError: unknown = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        ...init,
        signal: init.signal ?? controller.signal,
        headers: {
          "User-Agent": DEFAULT_UA,
          Accept: "application/json,text/html;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
          "Sec-Fetch-Dest": "document",
          "Sec-Fetch-Mode": "navigate",
          "Sec-Fetch-Site": "none",
          "Upgrade-Insecure-Requests": "1",
          ...(init.headers ?? {}),
        },
        cache: "no-store",
      });

      if (retryOnStatus.includes(res.status) && attempt < retries) {
        await sleep(300 * 2 ** attempt + Math.random() * 200);
        continue;
      }

      // Body validation (challenge detection) — burn one retry, then fail.
      if (validateBody) {
        const body = await res.text();
        if (!validateBody(body) && attempt < retries) {
          await sleep(300 * 2 ** attempt + Math.random() * 200);
          continue;
        }
        return new Response(body, {
          status: res.status,
          statusText: res.statusText,
          headers: res.headers,
        });
      }

      return res;
    } catch (err) {
      lastError = err;
      if (attempt < retries) {
        await sleep(300 * 2 ** attempt + Math.random() * 200);
        continue;
      }
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`Upstream failed: ${url}`);
}

export async function fetchJson<T>(url: string, opts: FetchOptions = {}): Promise<T> {
  try {
    const res = await upstreamFetch(url, opts);
    if (!res.ok) throw new Error(`Upstream ${res.status} for ${url}`);
    return (await res.json()) as T;
  } catch (err) {
    // API challenged? try the curl transport once before giving up.
    const body = await curlText(url, opts.timeoutMs ?? 12_000, opts.headers as Record<string, string>).catch(() => null);
    if (body) {
      try {
        return JSON.parse(body) as T;
      } catch {
        /* fall through */
      }
    }
    throw err;
  }
}

/** Fetch a page as decoded text (HTML scraping). Anti-bot interstitials are
 * detected and retried — and when Node's fetch keeps getting challenged, the
 * request falls back to the curl transport. If that also fails the caller sees
 * a normal failure (the shared cache's 10s negative TTL keeps it from
 * sticking). */
export async function fetchHtml(url: string, opts: FetchOptions = {}): Promise<string> {
  const headers = {
    Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    ...(opts.headers ?? {}),
  };
  try {
    const res = await upstreamFetch(url, {
      ...opts,
      headers,
      validateBody: (body) => !looksLikeChallenge(body),
    });
    if (!res.ok) throw new Error(`Upstream ${res.status} for ${url}`);
    const text = await res.text();
    // some sites serve the challenge page with HTTP 200 — that is still a block
    if (looksLikeChallenge(text)) throw new Error(`Bot challenge for ${url}`);
    return text;
  } catch (err) {
    // Last-resort transport: same request through curl (different TLS stack).
    return curlText(url, opts.timeoutMs ?? 12_000, headers as Record<string, string>);
  }
}

/** First URL that answers OK (domain-rotation helper for mirror lists). */
export async function fetchFirstOk(urls: string[], opts: FetchOptions = {}): Promise<Response> {
  let last: unknown = null;
  for (const url of urls) {
    try {
      const res = await upstreamFetch(url, { ...opts, retries: 0 });
      if (res.ok) return res;
      last = new Error(`Upstream ${res.status} for ${url}`);
    } catch (err) {
      last = err;
    }
  }
  throw last instanceof Error ? last : new Error("All mirrors failed");
}

/** Regex-free HTML tag stripper + entity decoder for descriptions. */
export function stripHtml(s: string | undefined | null, max = 400): string | undefined {
  if (!s) return undefined;
  const out = s
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;|&#8217;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#8230;/g, "…")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/\s+/g, " ")
    .trim();
  return out ? out.slice(0, max) : undefined;
}

/** Simple HTML document mini-helper: cheap regex-based extraction without a DOM dependency. */
export function html(doc?: string): HtmlDoc {
  return new HtmlDoc(doc ?? "");
}
export class HtmlDoc {
  constructor(private readonly doc: string) {}

  /** All anchor hrefs whose URL path contains `needle`. */
  links(needle: string, limit = 40): { href: string; text: string }[] {
    const out: { href: string; text: string }[] = [];
    const re = /<a\s[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(this.doc)) && out.length < limit * 3) {
      const href = m[1];
      if (!href.includes(needle)) continue;
      out.push({ href, text: stripHtml(m[2], 160) ?? "" });
      if (out.length >= limit) break;
    }
    return out;
  }

  /** First capture of a regex. */
  match(re: RegExp): string | undefined {
    const m = this.doc.match(re);
    return m?.[1];
  }

  img(selectorHint: string): string | undefined {
    // find first <img> inside a chunk of HTML that mentions selectorHint
    const idx = this.doc.indexOf(selectorHint);
    if (idx === -1) return undefined;
    const chunk = this.doc.slice(Math.max(0, idx - 200), idx + 1200);
    const m =
      chunk.match(/data-src="([^"]+)"/) ??
      chunk.match(/data-lazy-src="([^"]+)"/) ??
      chunk.match(/src="([^"]+\.(?:jpe?g|png|webp|avif)[^"]*)"/i);
    return m?.[1];
  }

  /** All image URLs in the document (reader pages). */
  images(minLen = 30): string[] {
    const out: string[] = [];
    const re = /(?:data-src|data-lazy-src|src)="([^"]+)"/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(this.doc))) {
      const u = m[1];
      if (u.startsWith("data:") || u.length < minLen) continue;
      if (/\.(jpe?g|png|webp|avif)(\?|$)/i.test(u) || u.includes("uploads")) out.push(u);
    }
    return out;
  }

  text(sel: string, max = 300): string | undefined {
    // extract inner text of the first tag pair following sel
    const idx = this.doc.indexOf(sel);
    if (idx === -1) return undefined;
    const chunk = this.doc.slice(idx, idx + 2500);
    const m = chunk.match(/>([^<>]{2,}?)</);
    return m ? stripHtml(m[1], max) : undefined;
  }
}

/** Run async tasks with bounded concurrency, preserving input order in results. */
export async function pooled<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const lanes = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const idx = cursor++;
      results[idx] = await worker(items[idx], idx);
    }
  });
  await Promise.all(lanes);
  return results;
}
