import { fetchHtml, html, stripHtml, upstreamFetch } from "@/lib/http";
import vm from "node:vm";
import type {
  ChapterEntry,
  Details,
  MediaItem,
  SearchResult,
  SourceAdapter,
} from "./types";

function abs(base: string, u: string): string {
  try {
    return new URL(u, base).toString();
  } catch {
    return u;
  }
}

/* ────────────────────────────────── WeebCentral (HTMX endpoints, SSR) ────────────────────────────────── */

/**
 * WeebCentral server-renders everything through HTMX fragments:
 *   search   GET /search/data?text=…&display_mode=Full Display&…  → <article> cards
 *   series   /series/{id}/{slug}                                     → og: meta
 *   chapters /series/{id}/full-chapter-list                          → <a href="/chapters/{hid}">
 *   pages    /chapters/{hid}/images?is_prev=False                    → <img src> per page
 * The chapter-list fragment ships EVERY chapter (newest first), so no paging.
 */
function parseWcCards(data: string, limit: number): MediaItem[] {
  // Each result is one top-level <article class="bg-base-300 …"> card holding
  // a cover link (with the alt="{Title} cover" img) and a title link. Parsing
  // per card keeps titles paired with the right series.
  const items: MediaItem[] = [];
  const seen = new Set<string>();
  for (const blk of data.split(/<article class="bg-base-300/).slice(1)) {
    if (items.length >= limit) break;
    const href = blk.match(/href="https:\/\/weebcentral\.com(\/series\/[0-9A-Za-z]+\/[^"#?]+)/)?.[1];
    if (!href || seen.has(href)) continue;
    const title =
      stripHtml(blk.match(/alt="([^"]{2,140}?)\s*(?:cover)?"/i)?.[1], 140) ??
      stripHtml(blk.match(/<a[^>]+href="https:\/\/weebcentral\.com\/series\/[^"#?]+"[^>]*>([^<]{2,140})</)?.[1], 140);
    if (!title || title.length < 2) continue;
    seen.add(href);
    items.push({
      id: `weebcentral:${href}`,
      type: "manga",
      source: "weebcentral",
      sourceLabel: "WeebCentral",
      title,
      externalUrl: `https://weebcentral.com${href}`,
    });
  }
  return items;
}

export const weebcentral: SourceAdapter = {
  id: "weebcentral",
  label: "WeebCentral",
  type: "manga",
  siteUrl: "https://weebcentral.com",
  imgHosts: ["weebcentral.com", "temp.compsci88.com", "official.lowee.us", "scans.lowee.us", "hot.plane.us"],

  async search(q, page, limit) {
    const data = await fetchHtml(
      `https://weebcentral.com/search/data?text=${encodeURIComponent(q.slice(0, 80))}` +
        `&display_mode=Full%20Display&sort=Best%20Match&official=Any&anime=Any&adult=Any&status=Any` +
        `&minimum_comment=0&chapter_range=0-&limit=${Math.min(limit, 24)}&offset=${(page - 1) * limit}`,
      { timeoutMs: 14_000 },
    ).catch(() => "");
    if (!data) return { items: [], total: 0, page, hasMore: false };
    const items = parseWcCards(data, limit);
    return { items, total: items.length, page, hasMore: items.length >= limit };
  },

  async popular(page, limit) {
    const data = await fetchHtml(
      `https://weebcentral.com/search/data?text=&display_mode=Full%20Display&sort=Popularity&official=Any&anime=Any&adult=Any&status=Any` +
        `&minimum_comment=0&chapter_range=0-&limit=${Math.min(limit, 24)}&offset=${(page - 1) * limit}`,
      { timeoutMs: 14_000 },
    ).catch(() => "");
    if (!data) return { items: [], total: 0, page, hasMore: false };
    const items = parseWcCards(data, limit);
    return { items, total: items.length, page, hasMore: items.length >= limit };
  },

  async details(realId) {
    const path = realId.startsWith("/") ? realId : `/${realId}`;
    // the series id is the second segment — /series/{id}/{slug}
    const seg = path.match(/^\/series\/([0-9A-Za-z]+)/)?.[1];
    if (!seg) throw new Error("Bad WeebCentral series id");

    const docHtml = await fetchHtml(`https://weebcentral.com${path}`, { timeoutMs: 14_000 });
    const title =
      stripHtml(docHtml.match(/property=["']og:title["'][^>]+content=["']([^"']+)/i)?.[1]?.replace(/\s*\|\s*Weeb Central\s*$/i, ""), 140) ??
      "Untitled";
    const cover = docHtml.match(/property=["']og:image["'][^>]+content=["']([^"']+)/i)?.[1];
    const description = stripHtml(docHtml.match(/property=["']og:description["'][^>]+content=["']([^"']+)/i)?.[1], 1200);
    const author = stripHtml(docHtml.match(/Author[s]?:\s*<\/span>\s*<span[^>]*>([^<]+)/)?.[1] ?? docHtml.match(/(?:Author|Authors)[\s\S]{0,200}?<span[^>]*>([^<]{2,80})<\/span>/)?.[1] ?? "");

    const listHtml = await fetchHtml(`https://weebcentral.com/series/${seg}/full-chapter-list`, {
      timeoutMs: 14_000,
    }).catch(() => "");

    const chapters: ChapterEntry[] = [];
    const seen = new Set<string>();
    const blocks = listHtml.split('<a href="/chapters/').slice(1);
    for (const blk of blocks) {
      const hid = blk.match(/^([0-9A-Za-z]+)"?/)?.[1];
      if (!hid || seen.has(hid)) continue;
      seen.add(hid);
      // label: first meaningful <span> inside the grow span; date from <time datetime>
      const label =
        stripHtml(blk.match(/<span class="grow[\s\S]{0,220}?<span[^>]*>([^<]+)<\/span>/)?.[1], 100) ??
        stripHtml(blk.match(/<span[^>]*>([^<]{2,80})<\/span>/)?.[1], 100) ??
        "Chapter";
      const date = blk.match(/datetime="([0-9-]{10})/)?.[1];
      chapters.push({
        id: `weebcentral-ch:/chapters/${hid}`,
        label,
        date,
      });
    }

    return {
      id: `weebcentral:${path}`,
      type: "manga",
      source: "weebcentral",
      sourceLabel: "WeebCentral",
      title,
      cover,
      description,
      authors: author ? [author] : [],
      externalUrl: `https://weebcentral.com${path}`,
      chapters: chapters.reverse(), // fragment is newest-first → ascending
      readable: chapters.length > 0,
    };
  },

  async chapterPages(realId) {
    const chPath = realId.startsWith("/") ? realId : `/${realId}`;
    const docHtml = await fetchHtml(
      `https://weebcentral.com${chPath}/images?is_prev=False`,
      { timeoutMs: 20_000 },
    );
    return [...docHtml.matchAll(/src="(https?:\/\/[^"]+\.(?:webp|jpe?g|png|avif)[^"]*)"/gi)]
      .map((m) => m[1])
      .filter((u) => !/logo|badge|icon|brand/i.test(u));
  },
};

/* ────────────────────────────────── MangaHere / MangaFox (fanfox.net) ────────────────────────────────── */

export const mangahere: SourceAdapter = {
  id: "mangahere",
  label: "MangaHere",
  type: "manga",
  siteUrl: "https://fanfox.net",
  beta: true,
  imgHosts: ["fanfox.net", "fmximg.com", "zjcdn.mangahere.org", "zjcdn.mangahere.cc", "zjcdn.mangafox.me", "static.mangahere.cc", "static.fanfox.net", "fmcdn.mfcdn.net"],

  async search(q, page, limit) {
    const docHtml = await fetchHtml(`https://fanfox.net/search?title=${encodeURIComponent(q.slice(0, 60))}&page=${page}`, { timeoutMs: 12_000 });
    const items: MediaItem[] = [];
    const seen = new Set<string>();
    // Result cards carry the title in the anchor's title="…" attribute (and the
    // cover img alt) — anchor inner text is unreliable across page variants.
    const re = /<a\s[^>]*href="(\/manga\/[^/]+\/)"[^>]*title="([^"]{2,120})"[^>]*>/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(docHtml)) && items.length < limit) {
      const path = m[1];
      if (seen.has(path)) continue;
      seen.add(path);
      const title = stripHtml(m[2], 120);
      if (!title || title.length < 2) continue;
      items.push({ id: `mangahere:${path}`, type: "manga", source: "mangahere", sourceLabel: "MangaHere", title, externalUrl: `https://fanfox.net${path}` });
    }
    // covers
    const cardRe = /<a[^>]+href="(\/manga\/[^"]+\/)"[\s\S]{0,800}?<img[^>]+(?:data-src|src)="([^"]+)"/gi;
    const coverMap = new Map<string, string>();
    let cm: RegExpExecArray | null;
    while ((cm = cardRe.exec(docHtml))) coverMap.set(cm[1], abs("https://fanfox.net", cm[2]));
    for (const item of items) if (coverMap.has(item.id.replace("mangahere:", ""))) item.cover = coverMap.get(item.id.replace("mangahere:", ""));
    return { items: items.slice(0, limit), total: items.length, page, hasMore: items.length >= limit };
  },

  async popular(page, limit) {
    const docHtml = await fetchHtml(`https://fanfox.net/directory/${page}.html`, { timeoutMs: 12_000 }).catch(() => "");
    if (!docHtml) return { items: [], total: 0, page, hasMore: false };
    const doc = html(docHtml);
    const items: MediaItem[] = [];
    const seen = new Set<string>();
    for (const a of doc.links("/manga/", limit * 2)) {
      const path = a.href.replace(/^https?:\/\/fanfox\.net/, "");
      if (!/^\/manga\/[^/]+\/$/.test(path) || seen.has(path)) continue;
      seen.add(path);
      const title = stripHtml(a.text, 120);
      if (!title || title.length < 2) continue;
      items.push({ id: `mangahere:${path}`, type: "manga", source: "mangahere", sourceLabel: "MangaHere", title, externalUrl: `https://fanfox.net${path}` });
    }
    return { items: items.slice(0, limit), total: items.length, page, hasMore: items.length >= limit };
  },

  async details(realId) {
    const url = `https://fanfox.net${realId.startsWith("/") ? realId : `/${realId}`}`;
    const docHtml = await fetchHtml(url, { timeoutMs: 12_000 });
    // Title sources, most specific first: the legacy og:novel:series meta is
    // gone from the current page — fall back through og:title / <title>.
    const ogSeries = docHtml.match(/property=["']og:novel:series["'][^>]+content=["']([^"']+)/)?.[1];
    const ogTitle = docHtml.match(/property=["']og:title["'][^>]+content=["']([^"']+)/)?.[1]?.replace(/\s+Manga\s*$/i, "");
    const titleTag = docHtml.match(/<title>([^<]*)<\/title>/)?.[1]?.replace(/\s*Manga\s*[-–]\s*Read.*$/i, "");
    const title = stripHtml(ogSeries ?? ogTitle ?? titleTag) ?? "Untitled";
    const cover = docHtml.match(/property=["']og:image["'][^>]+content=["']([^"']+)/i)?.[1];

    const chapters: ChapterEntry[] = [];
    // Chapter links come with or without a volume segment and may carry
    // decimal numbers ("/manga/x/v01/c001/1.html", "/manga/x/c1046.5/1.html").
    // Labels live in the anchor title="…" attribute. The scan is scoped to the
    // "#chapterlist" block and to THIS manga's path so sidebar links from
    // other series can never leak into the chapter list.
    const slug = realId.replace(/^\/?manga\//, "").replace(/\/$/, "");
    const listStart = docHtml.indexOf('id="chapterlist"');
    const listHtml = listStart >= 0 ? docHtml.slice(listStart, listStart + 500_000) : docHtml;
    const chRe = new RegExp(
      `<a\\s[^>]*href="(/manga/${slug}/(?:v(?:TT|TBE|\\d+)/)?c\\d+(?:\\.\\d+)?/1\\.html)"[^>]*title="([^"]{2,120})"`,
      "gi",
    );
    const seen = new Set<string>();
    let m: RegExpExecArray | null;
    while ((m = chRe.exec(listHtml)) && chapters.length < 400) {
      if (seen.has(m[1])) continue;
      seen.add(m[1]);
      chapters.push({ id: `mangahere-ch:${m[1]}`, label: stripHtml(m[2], 100) ?? m[1], lang: "EN" });
    }

    return {
      id: `mangahere:${realId}`,
      type: "manga",
      source: "mangahere",
      sourceLabel: "MangaHere",
      title,
      cover,
      authors: [],
      externalUrl: url,
      chapters: chapters.reverse(),
      readable: chapters.length > 0,
    };
  },

  async chapterPages(realId) {
    const path = realId.startsWith("http") ? realId.replace(/^https?:\/\/[^/]+/, "") : realId;
    const docHtml = await fetchHtml(`https://fanfox.net${path}`, { timeoutMs: 15_000 }).catch(() => "");
    if (!docHtml) return [];

    // Legacy static markup — page <img> tags straight in the HTML.
    const legacy = [...docHtml.matchAll(/<img[^>]+src="([^"]*\/store\/[^"]+\.(?:jpe?g|png|webp)[^"]*)"/gi)].map((m) => m[1]);
    if (legacy.length) return legacy;

    // Modern reader: images load via JS from chapterfun.ashx with a packed
    // response (Dean Edwards packer). Resolve chapter id from the page, then
    // walk the endpoint page-by-page, unpacking each payload.
    const chapterId = docHtml.match(/chapterid\s*=\s*(\d+)/)?.[1];
    if (!chapterId) return [];
    const slug = path.match(/^\/?manga\/([^/]+)/)?.[1];
    if (!slug) return [];
    const declared = Number(docHtml.match(/imagecount\s*=\s*(\d+)/)?.[1] ?? 0);

    const unpack = (packed: string): string => {
      try {
        return String(vm.runInContext(packed.replace(/^eval/, "(function(v){ return v; })"), vm.createContext({})));
      } catch {
        return "";
      }
    };

    const pages: string[] = [];
    const seen = new Set<string>();
    const cap = Math.min(declared > 0 ? declared : 60, 80);
    for (let p = 1; p <= cap && pages.length < cap; p++) {
      let body = "";
      try {
        const res = await upstreamFetch(
          `https://fanfox.net/manga/${slug}/chapterfun.ashx?cid=${chapterId}&page=${p}&key=`,
          { timeoutMs: 12_000, retries: 1, headers: { Referer: `https://fanfox.net${path}` } },
        );
        if (!res.ok) break;
        body = await res.text();
      } catch {
        break;
      }
      const js = unpack(body);
      const pix = js.match(/var pix="([^"]+)"/)?.[1] ?? "";
      const arrRaw = js.match(/var pvalue=\[([\s\S]*?)\]/)?.[1];
      if (!arrRaw) break;
      let urls: string[];
      try {
        urls = JSON.parse(`[${arrRaw}]`) as string[];
      } catch {
        break;
      }
      let added = 0;
      for (const rel of urls) {
        const abs = rel.startsWith("//") || rel.startsWith("http") ? rel : `${pix}${rel}`;
        if (!seen.has(abs)) {
          seen.add(abs);
          pages.push(abs);
          added++;
        }
      }
      if (!added) break; // no new pages → chapter finished
    }
    return pages;
  },
};
