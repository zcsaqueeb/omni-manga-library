import { fetchHtml, stripHtml } from "@/lib/http";
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

/* ────────────────────────────────── GetComics (verified live) ────────────────────────────────── */

export const getcomics: SourceAdapter = {
  id: "getcomics",
  label: "GetComics",
  type: "comic",
  siteUrl: "https://getcomics.info",
  imgHosts: ["getcomics.info"],

  async search(q, page, limit) {
    const docHtml = await fetchHtml(`https://getcomics.info/page/${page}/?s=${encodeURIComponent(q.slice(0, 80))}`, { timeoutMs: 14_000 });
    const items: MediaItem[] = [];
    const re = /<article[^>]*>([\s\S]*?)<\/article>/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(docHtml)) && items.length < limit) {
      const chunk = m[1];
      const link = chunk.match(/<h2[^>]+class="post-title"[^>]*>\s*<a\s[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
      if (!link) continue;
      const title = stripHtml(link[2], 140);
      if (!title) continue;
      const img = chunk.match(/<img[^>]+(?:data-src|src)="([^"]+\.(?:jpe?g|png|webp)[^"]*)"/i)?.[1];
      const excerpt = stripHtml(chunk.match(/<p[^>]*class="post-excerpt"[^>]*>([\s\S]*?)<\/p>/)?.[1], 160);
      items.push({
        id: `getcomics:${link[1].replace("https://getcomics.info", "")}`,
        type: "comic",
        source: "getcomics",
        sourceLabel: "GetComics",
        title,
        cover: img ? abs("https://getcomics.info", img) : undefined,
        description: excerpt,
        externalUrl: link[1],
      });
    }
    return { items, total: items.length, page, hasMore: items.length >= limit };
  },

  async popular(page, limit) {
    const docHtml = await fetchHtml(`https://getcomics.info/page/${page}/`, { timeoutMs: 14_000 }).catch(() => "");
    if (!docHtml) return { items: [], total: 0, page, hasMore: false };
    const items: MediaItem[] = [];
    const re = /<article[^>]*>([\s\S]*?)<\/article>/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(docHtml)) && items.length < limit) {
      const chunk = m[1];
      const link = chunk.match(/<h2[^>]+class="post-title"[^>]*>\s*<a\s[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
      if (!link) continue;
      const title = stripHtml(link[2], 140);
      if (!title) continue;
      const img = chunk.match(/<img[^>]+(?:data-src|src)="([^"]+\.(?:jpe?g|png|webp)[^"]*)"/i)?.[1];
      items.push({ id: `getcomics:${link[1].replace("https://getcomics.info", "")}`, type: "comic", source: "getcomics", sourceLabel: "GetComics", title, cover: img ? abs("https://getcomics.info", img) : undefined, externalUrl: link[1] });
    }
    return { items, total: items.length, page, hasMore: items.length >= limit };
  },

  async details(realId) {
    const url = realId.startsWith("http") ? realId : `https://getcomics.info${realId.startsWith("/") ? realId : `/${realId}`}`;
    const docHtml = await fetchHtml(url, { timeoutMs: 14_000 });

    const title = stripHtml(docHtml.match(/<h1[^>]+class="post-title[^"]*"[^>]*>([\s\S]*?)<\/h1>/)?.[1] ?? docHtml.match(/property=["']og:title["'][^>]+content=["']([^"']+)["']/)?.[1]) ?? "Untitled";
    const cover = docHtml.match(/property=["']og:image["'][^>]+content=["']([^"']+)["']/)?.[1];
    const description = stripHtml(docHtml.match(/<h3[^>]*>\s*(?:ABOUT|Synopsis|Description)[\s\S]{0,100}?<\/h3>\s*<p>([\s\S]*?)<\/p>/i)?.[1] ?? docHtml.match(/<div[^>]+class="[^"]*entry-content[^"]*"[^>]*>\s*<p>([\s\S]*?)<\/p>/)?.[1], 1200);

    // Post pages expose one or more "download now" buttons / file links.
    const chapters: ChapterEntry[] = [];
    const seen = new Set<string>();
    const re = /<a\s[^>]*href="([^"]+)"[^>]*>([\s\S]{0,120}?)<\/a>/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(docHtml)) && chapters.length < 8) {
      const href = m[1];
      const label = stripHtml(m[2], 80) ?? "";
      const isDownload =
        /download/i.test(href) ||
        /download/i.test(label) ||
        /\.(cbz|cbr|pdf|epub|zip|rar)(\?|$)/i.test(href) ||
        /mega\.nz|drive\.google|1fichier|mediafire|pixeldrain|usersdrive|send\.cm/i.test(href);
      if (!isDownload || seen.has(href)) continue;
      seen.add(href);
      chapters.push({
        id: `getcomics-link:${Buffer.from(href).toString("base64url")}`,
        label: (label || "Download").slice(0, 80),
        href,
      });
    }

    return {
      id: `getcomics:${realId}`,
      type: "comic",
      source: "getcomics",
      sourceLabel: "GetComics",
      title,
      cover,
      description,
      authors: [],
      externalUrl: url,
      chapters,
      readable: false,
    };
  },
};
