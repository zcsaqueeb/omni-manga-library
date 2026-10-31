import { fetchFirstOk, html, stripHtml } from "@/lib/http";
import type {
  ChapterEntry,
  Details,
  MediaItem,
  SearchResult,
  SourceAdapter,
} from "./types";

/**
 * Generic engine for the WordPress "Madara" theme — used by a very large share
 * of manhwa/manhua scanlation sites (Toonily, ZinManga, MangaSusu, KunManga…).
 * Selectors are tolerant: every instance gets the same fallback chain, and
 * failures surface per-source as "offline" instead of breaking the page.
 */

interface MadaraSpec {
  id: string;
  label: string;
  base: string;
  /** Post-type path, e.g. "/manga/", "/serie/", "/series/", "/comic/". */
  path: string;
  nsfw?: boolean;
  mirrors?: string[];
  imgHosts?: string[];
  note?: string;
}

function abs(base: string, u: string): string {
  try {
    return new URL(u, base).toString();
  } catch {
    return u;
  }
}

function cardsFrom(docHtml: string, base: string, sourceId: string, label: string, type: "manga" | "novel", nsfw?: boolean): MediaItem[] {
  const seen = new Set<string>();
  const items: MediaItem[] = [];

  const re = /<div[^>]+class="[^"]*(?:page-item-detail|page-item|c-tabs-item|col-6)[^"]*"[^>]*>([\s\S]{0,4000}?)(?=<div[^>]+class="[^"]*(?:page-item-detail|page-item|c-tabs-item|col-6)|<\/section>|<\/ul>|$)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(docHtml)) && items.length < 60) {
    const chunk = m[1];
    const link =
      chunk.match(/<h[35][^>]*>\s*<a\s[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/) ??
      chunk.match(/<a\s[^>]*href="([^"]+)"[^>]*>\s*(?:<h[35][^>]*>)?([^<]{2,150}?)(?:<\/h[35]>)?\s*<\/a>/);
    if (!link) continue;
    const href = link[1].trim();
    if (!href || href === "#") continue;
    const title = stripHtml(link[2], 150) ?? link[2].replace(/\s+/g, " ").trim();
    if (!title || title.length < 2) continue;
    const realId = href.startsWith("http") ? href : abs(base, href);
    if (seen.has(realId)) continue;
    seen.add(realId);

    const img =
      chunk.match(/data-src="([^"]+\.(?:jpe?g|png|webp|avif)[^"]*)"/i)?.[1] ??
      chunk.match(/data-lazy-src="([^"]+\.(?:jpe?g|png|webp|avif)[^"]*)"/i)?.[1] ??
      chunk.match(/src="([^"]+\.(?:jpe?g|png|webp|avif)[^"]*)"/i)?.[1];

    const latest =
      chunk.match(/class="[^"]*chapter-item[^"]*[\s\S]{0,400}?<a[^>]*>([\s\S]*?)<\/a>/)?.[1] ??
      undefined;

    items.push({
      id: `${sourceId}:${realId.replace(base, "")}`,
      type,
      source: sourceId,
      sourceLabel: label,
      title,
      cover: img ? abs(base, img.trim()) : undefined,
      latest: latest ? stripHtml(latest, 60) : undefined,
      nsfw,
    });
  }
  return items;
}

/**
 * Fallback card parse for Madara sites whose search results skip the classic
 * `page-item` containers (Toonily's new theme, ManhuaTop's /search/{q}/ page).
 * Titles come from the anchor's text, or its title="…"/img-alt attributes when
 * the anchor renders only a cover.
 */
function cardsFromAnchors(docHtml: string, base: string, sourceId: string, label: string, type: "manga" | "novel", nsfw?: boolean): MediaItem[] {
  const seen = new Set<string>();
  const items: MediaItem[] = [];
  const re = /<a\s[^>]*href="([^"]+)"[^>]*>([\s\S]{0,800}?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(docHtml)) && items.length < 60) {
    const href = m[1].trim();
    if (!href || href === "#" || /#respond|\/genre|\/author|privacy|terms|dmca/i.test(href)) continue;
    const realId = href.startsWith("http") ? href : abs(base, href);
    const path = new URL(realId, base).pathname;
    // must look like a series page, never a chapter
    if (!/(?:manga|manhua|manhwa|serie|series|comic|webtoon|novel)\//i.test(path)) continue;
    if (/chapter[-_]\d|\/chapter/i.test(path)) continue;
    // sort-menu links keep the type path but add ?m_orderby=… — never series
    if (/[?&](m_orderby|orderby|mask)=/i.test(realId)) continue;
    if (seen.has(realId)) continue;
    const title =
      stripHtml(m[2], 150) ??
      stripHtml(m[0].match(/\stitle="([^"]{2,150})"/)?.[1], 150) ??
      stripHtml(m[0].match(/alt="([^"]{2,150}?)\s*(?:cover)?"/i)?.[1], 150);
    if (!title || title.length < 2) continue;
    // skip site-menu listing links ("All Mangas", "Manga List", genre pages…)
    if (/^(?:all|latest|new|hot|popular|top|completed|ongoing)?\s*(?:mangas?|manhwas?|manhuas?|novels?|comics?|series|list)\b/i.test(title)) continue;
    seen.add(realId);
    const img =
      m[0].match(/data-src="([^"]+\.(?:jpe?g|png|webp|avif)[^"]*)"/i)?.[1] ??
      m[0].match(/src="([^"]+\.(?:jpe?g|png|webp|avif)[^"]*)"/i)?.[1];
    items.push({
      id: `${sourceId}:${realId.replace(base, "")}`,
      type,
      source: sourceId,
      sourceLabel: label,
      title,
      cover: img ? abs(base, img.trim()) : undefined,
      nsfw,
    });
  }
  return items;
}

function extractAuthors(docHtml: string): string[] {
  const out: string[] = [];
  const chunks = [
    ...docHtml.matchAll(/<div[^>]+class="[^"]*(?:authors-content|author-content)[^"]*"[^>]*>([\s\S]{0,800}?)<\/div>/g),
  ];
  for (const c of chunks) {
    const re = /<a[^>]*>([^<]{2,60})<\/a>/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(c[1])) && out.length < 6) out.push(m[1].trim());
  }
  if (!out.length) {
    const single = docHtml.match(/class="[^"]*author-content[^"]*"[^>]*>\s*<a[^>]*>([^<]+)</);
    if (single) out.push(single[1].trim());
  }
  return out;
}

function extractGenres(docHtml: string): string[] {
  const genres: string[] = [];
  const chunk = docHtml.match(/class="[^"]*genres-content[^"]*"[^>]*>([\s\S]{0,1500}?)<\/div>/)?.[1] ?? "";
  const re = /<a[^>]*>([^<]{2,40})<\/a>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(chunk)) && genres.length < 8) genres.push(m[1].trim());
  return genres;
}

function extractStatus(docHtml: string): string | undefined {
  return (
    docHtml.match(/<h5[^>]*>\s*Status\s*<\/h5>\s*<div[^>]*>\s*([^<]+?)\s*<\/div>/)?.[1] ??
    docHtml.match(/post-status_item[\s\S]{0,300}?>([^<]+)</)?.[1]
  )?.trim() || undefined;
}

function extractDescription(docHtml: string): string | undefined {
  return (
    docHtml.match(/<div[^>]+class="[^"]*description-text[^"]*"[^>]*>([\s\S]{0,4000}?)<\/div>/)?.[1] ??
    docHtml.match(/<div[^>]+class="[^"]*summary__content[^"]*"[^>]*>([\s\S]{0,4000}?)<\/div>/)?.[1] ??
    docHtml.match(/<div[^>]+class="[^"]*manga-excerpt[^"]*"[^>]*>([\s\S]{0,4000}?)<\/div>/)?.[1]
  );
}

function extractCover(docHtml: string, base: string): string | undefined {
  const idx = docHtml.indexOf("summary_image");
  if (idx === -1) return undefined;
  const chunk = docHtml.slice(idx, idx + 1500);
  const m =
    chunk.match(/data-src="([^"]+)"/) ??
    chunk.match(/data-lazy-src="([^"]+)"/) ??
    chunk.match(/src="([^"]+\.(?:jpe?g|png|webp|avif)[^"]*)"/i);
  return m ? abs(base, m[1].trim()) : undefined;
}

function extractChapters(docHtml: string, sourceId: string, base: string): ChapterEntry[] {
  const chapters: ChapterEntry[] = [];
  const seen = new Set<string>();
  const chRe = /<li[^>]+class="[^"]*wp-manga-chapter[^"]*"[^>]*>([\s\S]*?)<\/li>/g;
  let cm: RegExpExecArray | null;
  while ((cm = chRe.exec(docHtml)) && chapters.length < 400) {
    const li = cm[1];
    const a = li.match(/<a\s[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    if (!a) continue;
    const href = a[1].trim();
    if (seen.has(href)) continue;
    seen.add(href);
    const date = li.match(/<i[^>]*>([^<]+)<\/i>/)?.[1]?.trim() ?? li.match(/title="([^"]+)"/)?.[1];
    chapters.push({
      id: `${sourceId}-ch:${href.startsWith("http") ? href.replace(base, "") : href}`,
      label: stripHtml(a[2], 120) ?? "Chapter",
      date: date || undefined,
    });
  }
  return chapters; // newest-first as listed
}

function makeMadara(spec: MadaraSpec): SourceAdapter {
  const bases = [spec.base, ...(spec.mirrors ?? [])];
  const root = (b: string) => b.replace(/\/$/, "");
  const type = spec.id === "boxnovel" ? ("novel" as const) : ("manga" as const);

  async function getPage(path: string): Promise<{ text: string; base: string }> {
    const res = await fetchFirstOk(bases.map((b) => `${root(b)}${path}`), {
      timeoutMs: 12_000,
      retries: 1,
    });
    const text = await res.text();
    return { text, base: root(bases[0]) };
  }

  return {
    id: spec.id,
    label: spec.label,
    type,
    siteUrl: spec.base,
    nsfw: spec.nsfw,
    beta: true,
    note: spec.note,
    mirrors: spec.mirrors,
    imgHosts: spec.imgHosts ?? [new URL(spec.base).hostname.replace(/^www\./, "")],

    async search(q, page, limit) {
      const { text, base } = await getPage(`/?s=${encodeURIComponent(q.slice(0, 80))}&post_type=wp-manga`);
      let items = cardsFrom(text, base, spec.id, spec.label, type, spec.nsfw);
      if (!items.length) items = cardsFromAnchors(text, base, spec.id, spec.label, type, spec.nsfw);
      return { items: items.slice(0, limit), total: items.length, page, hasMore: false };
    },

    async popular(page, limit) {
      const { text, base } = await getPage(`${spec.path}?m_orderby=popular&page=${page}`);
      let items = cardsFrom(text, base, spec.id, spec.label, type, spec.nsfw);
      if (!items.length) items = cardsFromAnchors(text, base, spec.id, spec.label, type, spec.nsfw);
      return { items: items.slice(0, limit), total: items.length, page, hasMore: items.length >= limit };
    },

    async details(realId) {
      const { text: docHtml, base } = await getPage(
        realId.startsWith("http") ? realId.replace(base0(bases), "") : `/${realId.replace(/^\//, "")}`,
      );
      const url = realId.startsWith("http") ? realId : `${base0(bases)}/${realId.replace(/^\//, "")}`;

      const title =
        docHtml.match(/<h1[^>]+class="[^"]*post-title[^"]*"[^>]*>\s*<a[^>]*>([\s\S]*?)<\/a>/)?.[1] ??
        docHtml.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)?.[1] ??
        "Untitled";

      const chapters = extractChapters(docHtml, spec.id, base);

      return {
        id: `${spec.id}:${realId}`,
        type,
        source: spec.id,
        sourceLabel: spec.label,
        title: stripHtml(title, 160) ?? "Untitled",
        cover: extractCover(docHtml, base),
        authors: [...new Set(extractAuthors(docHtml))].slice(0, 4),
        status: extractStatus(docHtml),
        tags: extractGenres(docHtml).length ? extractGenres(docHtml) : undefined,
        description: stripHtml(extractDescription(docHtml), 1200),
        externalUrl: url,
        nsfw: spec.nsfw,
        chapters: chapters.reverse(), // ascending for prev/next navigation
        readable: true,
      };
    },

    async chapterPages(chapterRealId) {
      const { text: docHtml, base } = await getPage(
        chapterRealId.startsWith("http")
          ? chapterRealId.replace(base0(bases), "")
          : `/${chapterRealId.replace(/^\//, "")}`,
      );
      const doc = html(docHtml);
      return doc
        .images()
        .map((u) => abs(base, u.trim()))
        .filter((u) => !/logo|banner|\/ads?\.|placeholder/i.test(u));
    },
  };
}

function base0(bases: string[]): string {
  return bases[0].replace(/\/$/, "");
}

export function madaraInstances(specs: MadaraSpec[]): SourceAdapter[] {
  return specs.map(makeMadara);
}

/**
 * Live Madara instances (2026-10 re-audit — every base probed and answering
 * with parseable wp-manga markup). Dead domains (ZinManga, MangaSusu, MangaTx,
 * KunManga, ManhwaClan, AquaManga, MangaGeko, ResetScans, TwilightScans,
 * XcalibrScans, LHTranslation, DisasterScans, ImperfectComic, RuyaManga,
 * HScans, RealmScans, BoxNovel — DNS gone or hard 403 bot-walls) were removed
 * so they no longer slow every search down.
 */
export const MADARA_INSTANCES: SourceAdapter[] = madaraInstances([
  { id: "toonily", label: "Toonily", base: "https://toonily.com", path: "/serie/", nsfw: true },
  { id: "manhuatop", label: "ManhuaTop", base: "https://manhuatop.org", path: "/manga/" },
  { id: "mangaeffect", label: "MangaRead", base: "https://www.mangaread.org", path: "/manga/", note: "Ex-MangaEffect — same catalogue" },
]);
