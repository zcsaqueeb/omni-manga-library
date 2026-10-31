import { fetchHtml, stripHtml } from "@/lib/http";
import type {
  ChapterEntry,
  Details,
  MediaItem,
  SearchResult,
  SourceAdapter,
} from "./types";

/* ────────────────────────────────── Standard Ebooks (verified live) ────────────────────────────────── */

export const standardebooks: SourceAdapter = {
  id: "standardebooks",
  label: "Standard Ebooks",
  type: "book",
  siteUrl: "https://standardebooks.org",
  note: "Free, liberated public-domain ebooks, professionally formatted",
  imgHosts: ["standardebooks.org"],

  async search(q, page, limit) {
    if (page > 1) return { items: [], total: 0, page, hasMore: false };
    const docHtml = await fetchHtml(`https://standardebooks.org/ebooks?query=${encodeURIComponent(q.slice(0, 80))}`, { timeoutMs: 14_000 });
    const items: MediaItem[] = [];
    const re = /<a\s[^>]*href="(\/ebooks\/[^"]+)"[^>]*>([\s\S]{0,500}?)<\/a>/gi;
    const seen = new Set<string>();
    let m: RegExpExecArray | null;
    while ((m = re.exec(docHtml)) && items.length < limit) {
      const path = m[1];
      if (path.split("/").length < 4 || seen.has(path)) continue; // skip index pages (/ebooks/author-name/title)
      seen.add(path);
      const title = stripHtml(m[2], 140);
      if (!title || title.length < 2) continue;
      const img = m[0].match(/(?:data-src|src)="([^"]+\.(?:jpe?g|png|webp)[^"]*)"/i)?.[1];
      const author = path.split("/")[2]?.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
      items.push({
        id: `standardebooks:${path}`,
        type: "book",
        source: "standardebooks",
        sourceLabel: "Standard Ebooks",
        title,
        authors: author ? [author] : undefined,
        cover: img ? `https://standardebooks.org${img}` : undefined,
        externalUrl: `https://standardebooks.org${path}`,
      });
    }
    return { items, total: items.length, page, hasMore: false };
  },

  async popular(page, limit) {
    if (page > 1) return { items: [], total: 0, page, hasMore: false };
    const docHtml = await fetchHtml("https://standardebooks.org/ebooks", { timeoutMs: 14_000 }).catch(() => "");
    if (!docHtml) return { items: [], total: 0, page, hasMore: false };
    const items: MediaItem[] = [];
    const re = /<a\s[^>]*href="(\/ebooks\/[^"]+)"[^>]*>([\s\S]{0,500}?)<\/a>/gi;
    const seen = new Set<string>();
    let m: RegExpExecArray | null;
    while ((m = re.exec(docHtml)) && items.length < limit) {
      const path = m[1];
      if (path.split("/").length < 4 || seen.has(path)) continue;
      seen.add(path);
      const title = stripHtml(m[2], 140);
      if (!title || title.length < 2) continue;
      const img = m[0].match(/(?:data-src|src)="([^"]+\.(?:jpe?g|png|webp)[^"]*)"/i)?.[1];
      const author = path.split("/")[2]?.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
      items.push({ id: `standardebooks:${path}`, type: "book", source: "standardebooks", sourceLabel: "Standard Ebooks", title, authors: author ? [author] : undefined, cover: img ? `https://standardebooks.org${img}` : undefined, externalUrl: `https://standardebooks.org${path}` });
    }
    return { items, total: items.length, page, hasMore: false };
  },

  async details(realId) {
    const url = `https://standardebooks.org${realId.startsWith("/") ? realId : `/${realId}`}`;
    const docHtml = await fetchHtml(url, { timeoutMs: 14_000 });

    const title = stripHtml(docHtml.match(/property=["']og:title["'][^>]+content=["']([^"']+)["']/)?.[1]) ?? "Untitled";
    const author = stripHtml(docHtml.match(/property=["']og:book:author["'][^>]+content=["']([^"']+)["']/)?.[1]);
    const description = stripHtml(docHtml.match(/property=["']og:description["'][^>]+content=["']([^"']+)["']/)?.[1], 1400);
    const publishedAt = stripHtml(docHtml.match(/property=["']og:book:publication_date["'][^>]+content=["']([^"']+)["']/)?.[1]);

    const chapters: ChapterEntry[] = [];
    const re = /<a\s[^>]*href="(\/ebooks\/[^"]+\/downloads\/[^"]+)"[^>]*>([\s\S]{0,120}?)<\/a>/gi;
    const seen = new Set<string>();
    let m: RegExpExecArray | null;
    while ((m = re.exec(docHtml))) {
      const href = m[1];
      const ext = href.match(/\.(epub|azw3|kepub\.epub)(\?|$)/i)?.[1]?.toLowerCase() ?? "";
      const key = ext || href;
      if (seen.has(key)) continue;
      seen.add(key);
      chapters.push({
        id: `standardebooks-file:${Buffer.from(href).toString("base64url")}`,
        label: ext === "azw3" ? "Kindle (.azw3) download" : ext === "kepub.epub" ? "Kobo (.kepub) download" : "EPUB download",
        file: { ext: ext === "azw3" ? "azw3" : "epub" },
      });
    }

    return {
      id: `standardebooks:${realId}`,
      type: "book",
      source: "standardebooks",
      sourceLabel: "Standard Ebooks",
      title,
      authors: author ? [author] : [],
      description,
      publishedAt,
      externalUrl: url,
      chapters,
      readable: false,
    };
  },
};
