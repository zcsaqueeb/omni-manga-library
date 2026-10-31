import { fetchFirstOk, fetchHtml, stripHtml } from "@/lib/http";
import type {
  ChapterEntry,
  Details,
  MediaItem,
  SearchResult,
  SourceAdapter,
} from "./types";

/**
 * Universal fallback engine for scan-group / reader templates without a
 * dedicated adapter (Keyoapp clones, Flix-family sites, misc WordPress
 * themes). It leans on the bits every site ships:
 *   - series links: /series|/serie|/manga|/comic|/novel/<slug>
 *   - og:image / og:title / og:description meta on detail pages
 *   - chapter links matching /chapter|ch-/i
 *   - <img> lists on chapter pages
 * Every step is defensive: a template mismatch degrades to "no results",
 * never to a crashed page.
 */

export interface GenericSpec {
  id: string;
  label: string;
  base: string;
  nsfw?: boolean;
  mirrors?: string[];
  imgHosts?: string[];
  /** Extra query paths tried in order for search. */
  searchPaths?: string[];
  /** Extra query paths tried in order for browse/popular. */
  browsePaths?: string[];
  note?: string;
}

const SERIES_HINTS = ["/series/", "/serie/", "/manga/", "/comic/", "/comics/", "/novel/", "/book/"];
/** Series-like paths for the title-attribute fallback (no inner text). */
const SERIES_HINT_RE = /\/(?:series|serie|manga|manhua|comics?|novel|book)\//i;
const CHAPTER_RE = /(chapter[-_/]?\d|\/chapters?\/|ch-?\d+(?:[.\-]|$))/i;

function abs(base: string, u: string): string {
  try {
    return new URL(u, base).toString();
  } catch {
    return u;
  }
}

function cardFromAnchor(anchorHtml: string, href: string, inner: string, spec: GenericSpec, root: string): MediaItem | null {
  if (!href || href === "#") return null;
  const full = href.startsWith("http") ? href : abs(root, href);
  const path = new URL(full, root).pathname;
  if (!SERIES_HINTS.some((h) => path.includes(h)) && !SERIES_HINT_RE.test(path)) return null;
  if (/(chapter|chap-)/i.test(path)) return null;
  // Title priority: anchor text → title="…" attribute → cover img alt.
  // Modern card themes (Asura, HTMX grids) leave the anchor empty and carry
  // the title only in the image alt, so the fallbacks matter.
  const title =
    stripHtml(inner, 140) ??
    stripHtml(anchorHtml.match(/\stitle="([^"]{2,140})"/)?.[1], 140) ??
    stripHtml(anchorHtml.match(/alt="([^"]{2,140}?)\s*(?:cover)?"/i)?.[1], 140);
  if (!title || title.length < 2) return null;
  return {
    id: `${spec.id}:${full.replace(root, "") || path}`,
    type: "manga",
    source: spec.id,
    sourceLabel: spec.label,
    title,
    nsfw: spec.nsfw,
  };
}

function parseCards(docHtml: string, spec: GenericSpec, root: string, limit: number): MediaItem[] {
  const items: MediaItem[] = [];
  const seen = new Set<string>();
  const re = /<a\s[^>]*href="([^"]+)"[^>]*>([\s\S]{0,600}?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(docHtml)) && items.length < limit) {
    const anchor = m[0];
    const card = cardFromAnchor(anchor, m[1], m[2], spec, root);
    if (!card || seen.has(card.id)) continue;
    const img =
      anchor.match(/data-src="([^"]+\.(?:jpe?g|png|webp|avif)[^"]*)"/i)?.[1] ??
      anchor.match(/src="([^"]+\.(?:jpe?g|png|webp|avif)[^"]*)"/i)?.[1];
    if (img) card.cover = abs(root, img.trim());
    seen.add(card.id);
    items.push(card);
  }
  return items;
}

function meta(docHtml: string, prop: string): string | undefined {
  const m =
    docHtml.match(new RegExp(`<meta[^>]+property=["']og:${prop}["'][^>]+content=["']([^"']+)["']`, "i")) ??
    docHtml.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:${prop}["']`, "i")) ??
    docHtml.match(new RegExp(`<meta[^>]+name=["']${prop}["'][^>]+content=["']([^"']+)["']`, "i"));
  return m?.[1];
}

export function makeGeneric(spec: GenericSpec): SourceAdapter {
  const bases = [spec.base, ...(spec.mirrors ?? [])];
  const root = bases[0].replace(/\/$/, "");

  async function getAny(paths: string[], timeoutMs = 12_000): Promise<{ text: string; url: string } | null> {
    for (const p of paths) {
      try {
        const text = await fetchHtml(`${root}${p}`, { timeoutMs, retries: 0 });
        if (text && text.length > 500 && !/Just a moment|Attention Required/i.test(text.slice(0, 2000))) {
          return { text, url: `${root}${p}` };
        }
      } catch {
        /* try next path */
      }
    }
    return null;
  }

  return {
    id: spec.id,
    label: spec.label,
    type: "manga",
    siteUrl: spec.base,
    nsfw: spec.nsfw,
    beta: true,
    note: spec.note,
    mirrors: spec.mirrors,
    imgHosts: spec.imgHosts ?? [new URL(spec.base).hostname.replace(/^www\./, "")],

    async search(q, page, limit) {
      const enc = encodeURIComponent(q);
      const paths = (spec.searchPaths ?? [
        "/browse?query=%s",
        "/search?query=%s",
        "/search?data=%s",
        "/?s=%s&post_type=wp-manga",
        "/?name=%s",
      ]).map((p) => p.replace("%s", enc));
      const found = await getAny(paths);
      const items = found ? parseCards(found.text, spec, root, limit) : [];
      return { items, total: items.length, page, hasMore: false };
    },

    async popular(page, limit) {
      if (page > 1) return { items: [], total: 0, page, hasMore: false };
      const paths = spec.browsePaths ?? ["/browse", "/series", "/browse?page=1"];
      const found = await getAny(paths);
      const items = found ? parseCards(found.text, spec, root, limit) : [];
      return { items, total: items.length, page, hasMore: false };
    },

    async details(realId) {
      const url = realId.startsWith("http") ? realId : `${root}/${realId.replace(/^\//, "")}`;
      const docHtml = await fetchHtml(url, { timeoutMs: 12_000, retries: 1 });

      const title =
        stripHtml(meta(docHtml, "title") ?? docHtml.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)?.[1], 160) ?? "Untitled";
      const cover = meta(docHtml, "image");
      const description = stripHtml(meta(docHtml, "description"), 1200);

      const chapters: ChapterEntry[] = [];
      const seen = new Set<string>();
      // chapter anchors can embed sizeable SVG icons (Asura ~400 chars) before
      // the label text — give the inner window enough room to reach </a>
      const re = /<a\s[^>]*href="([^"]+)"[^>]*>([\s\S]{0,900}?)<\/a>/gi;
      let m: RegExpExecArray | null;
      while ((m = re.exec(docHtml)) && chapters.length < 400) {
        const href = m[1];
        if (!CHAPTER_RE.test(href) || seen.has(href)) continue;
        const tail = href.split("/").filter(Boolean).pop() ?? "";
        // "Chapter 2 Jul 31, 2024" → "Chapter 2" (card spans carry release dates)
        const label =
          (stripHtml(m[2], 120) ?? (tail ? `Chapter ${tail}` : "Chapter")).replace(
            /\s+(?:[A-Za-z]{3}\s+\d{1,2},\s*\d{4}|\d{4}-\d{2}-\d{2})\s*$/,
            "",
          ) || "Chapter";
        seen.add(href);
        const full = href.startsWith("http") ? href : abs(root, href);
        chapters.push({
          id: `${spec.id}-ch:${full.replace(root, "") || full}`,
          label,
        });
      }

      return {
        id: `${spec.id}:${realId}`,
        type: "manga",
        source: spec.id,
        sourceLabel: spec.label,
        title,
        cover: cover ? abs(root, cover) : undefined,
        authors: [],
        description,
        externalUrl: url,
        nsfw: spec.nsfw,
        chapters: chapters.reverse(),
        readable: chapters.length > 0,
      };
    },

    async chapterPages(chapterRealId) {
      const url = chapterRealId.startsWith("http")
        ? chapterRealId
        : `${root}/${chapterRealId.replace(/^\//, "")}`;
      const docHtml = await fetchHtml(url, { timeoutMs: 15_000, retries: 1 });
      const imgs = [...docHtml.matchAll(/(?:data-src|data-lazy-src|src)="([^"]+)"/gi)]
        .map((m) => m[1])
        .filter(
          (u) =>
            !u.startsWith("data:") &&
            u.length > 30 &&
            (/\.(jpe?g|png|webp|avif)(\?|$)/i.test(u) || /uploads|chapter|manga|comic|wp-content|images/i.test(u)) &&
            !/logo|icon|banner|avatar|\/ads?|favicon|covers?\//i.test(u),
        )
        .map((u) => abs(root, u.trim()));
      return imgs;
    },
  };
}

export function genericInstances(specs: GenericSpec[]): SourceAdapter[] {
  return specs.map(makeGeneric);
}

/**
 * Live generic-template instances (2026-10 re-audit). Every entry was probed:
 * search + series pages + chapter pages all answer with parseable HTML.
 * Instances whose domains died (Luminous, HiveToons, Vortex, Thunder,
 * MM-Scans, ReaperScans — DNS gone or hard bot-walls) were removed so they
 * no longer slow every search down.
 */
export const GENERIC_INSTANCES: SourceAdapter[] = genericInstances([
  {
    id: "asurascans",
    label: "AsuraScans",
    base: "https://asurascans.com",
    searchPaths: ["/browse?search=%s", "/comics?name=%s"], // site's SearchAction target
    browsePaths: ["/browse"],
    imgHosts: ["cdn.asurascans.com", "asurascans.com", "www.asurascans.com"],
    note: "Largest manhwa group — cards carry titles in img alt",
  },
  {
    id: "drakecomic",
    label: "DrakeComic",
    base: "https://drakecomic.net",
    searchPaths: [], // site search is client-side JS → browse-only source
    browsePaths: ["/"],
    note: "Drake Scans — browse the home grid",
  },
  {
    id: "manhuaplus",
    label: "ManhuaPlus",
    base: "https://manhuaplus.org",
    searchPaths: [], // site search is JS-only → browse-only source
    browsePaths: ["/home"],
    note: "Browse-only — use the home grid",
  },
]);
