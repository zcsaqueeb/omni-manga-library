import { NextRequest, NextResponse } from "next/server";
import { upstreamFetch } from "@/lib/http";
import { cachedImage } from "@/lib/img-cache";
import { SOURCES } from "@/lib/sources";

export const runtime = "nodejs";

/** Static hosts we are always willing to proxy images from. */
const ALLOWED_HOSTS = new Set([
  "uploads.mangadex.org",
  "mangadex.org",
  "covers.openlibrary.org",
  "archive.org",
  "www.archive.org",
  "www.gutenberg.org",
  "gutendex.com",
  "standardebooks.org",
]);

const STATIC_SUFFIXES = [
  ".archive.org",
  ".mangadex.org",
  ".mangadex.network",
  ".gutenberg.org",
  ".getcomics.info",
  ".scansmangasee123.com",
  ".fanfox.net",
  ".mangahere.cc",
  ".fmximg.com",
  ".weserv.nl",
  // shared CDNs used by WordPress-theme manhwa sites for covers
  ".wp.com",
  ".mangaread.org",
  ".mgicdn.com",
  ".noirserv.net",
];

/** Per-source hosts contributed by the adapter registry (covers + reader pages). */
function buildAllowlists() {
  const hosts = new Set(ALLOWED_HOSTS);
  const suffixes = new Set(STATIC_SUFFIXES);
  for (const s of SOURCES) {
    try {
      const host = new URL(s.siteUrl).hostname.replace(/^www\./, "");
      suffixes.add(`.${host}`);
      hosts.add(host);
    } catch {
      /* skip malformed */
    }
    for (const h of s.imgHosts ?? []) {
      if (h.startsWith("*.")) suffixes.add(h.slice(1));
      else if (h.includes("-,") && h.includes(".,")) suffixes.add(`.${h.split(",")[0]}`); // wildcard pattern like "sf1-,sf2-…"
      else if (h.includes(".")) {
        if (h.startsWith(".")) suffixes.add(h);
        else hosts.add(h.replace(/^www\./, ""));
      }
    }
  }
  return { hosts, suffixes: [...suffixes] };
}

const { hosts: ALLOWED_DYNAMIC, suffixes: ALLOWED_SUFFIXES } = buildAllowlists();

function isAllowed(raw: string): boolean {
  try {
    // protocol-relative URLs ("//cdn.example/x.jpg") are common in reader payloads
    const u = new URL(/^\/\//.test(raw) ? `https:${raw}` : raw);
    if (u.protocol !== "https:" && u.protocol !== "http:") return false;
    const host = u.hostname.toLowerCase();
    // SSRF guard — never proxy requests at internal/private targets
    if (
      host === "localhost" ||
      host.endsWith(".localhost") ||
      host.endsWith(".internal") ||
      host.endsWith(".local") ||
      /^127\.|^10\.|^192\.168\.|^169\.254\.|^0\./.test(host) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
      host === "[::1]" || host === "::1"
    ) {
      return false;
    }
    if (ALLOWED_DYNAMIC.has(host)) return true;
    return ALLOWED_SUFFIXES.some((s) => host.endsWith(s));
  } catch {
    return false;
  }
}

/** Some CDNs reject requests whose Referer is the CDN's own host (or missing)
 * — map known page-image CDNs to the site that actually serves them. */
const CDN_REFERER_MAP: [RegExp, string][] = [
  [/(?:^|\.)mangafox\.me$|(?:^|\.)mfcdn\.net$|(?:^|\.)fanfox\.net$|(?:^|\.)fmximg\.com$/, "https://fanfox.net/"],
  [/(?:^|\.)mangahere\.cc$|(?:^|\.)mangahere\.org$/, "https://mangahere.cc/"],
];

/** Some CDNs check the Referer header — send the origin site's own URL. */
function refererFor(raw: string): string | undefined {
  try {
    const u = new URL(/^\/\//.test(raw) ? `https:${raw}` : raw);
    const host = u.hostname.toLowerCase();
    for (const [re, ref] of CDN_REFERER_MAP) if (re.test(host)) return ref;
    return `${u.protocol}//${u.hostname}/`;
  } catch {
    return undefined;
  }
}

export async function GET(req: NextRequest) {
  const rawParam = req.nextUrl.searchParams.get("url") ?? "";
  // protocol-relative reader URLs ("//cdn.example/x.jpg") → https
  const raw = /^\/\//.test(rawParam) ? `https:${rawParam}` : rawParam;
  if (!raw || !isAllowed(raw)) {
    return NextResponse.json({ error: "Blocked URL" }, { status: 403 });
  }

  try {
    // Central shared cache: the first request stores the bytes on disk and
    // every later user (on any device) is served from the local cache.
    const { buf, ctype, cache } = await cachedImage(raw, async () => {
      const res = await upstreamFetch(raw, {
        timeoutMs: 15_000,
        retries: 1,
        headers: {
          Accept: "image/avif,image/webp,image/*,*/*;q=0.8",
          Referer: refererFor(raw) ?? undefined,
        } as Record<string, string>,
      });
      if (!res.ok) throw new Error(`upstream ${res.status}`);
      const upstreamCt = (res.headers.get("content-type") ?? "image/jpeg").split(";")[0].trim();
      const buf = Buffer.from(await res.arrayBuffer());
      return { ok: true, ctype: upstreamCt, buf };
    });

    const headers = new Headers();
    headers.set("Content-Type", ctype);
    headers.set("Cache-Control", "public, max-age=604800, stale-while-revalidate=2592000, immutable");
    headers.set("Content-Length", String(buf.byteLength));
    headers.set("X-Cache", cache);
    return new Response(new Uint8Array(buf), { headers });
  } catch (err) {
    console.error("[api/img]", raw.slice(0, 120), err);
    return NextResponse.json({ error: "Image fetch failed" }, { status: 502 });
  }
}
