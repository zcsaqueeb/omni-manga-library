import { fetchHtml, stripHtml } from "@/lib/http";
import type {
  ChapterEntry,
  Details,
  MediaItem,
  SearchResult,
  SourceAdapter,
} from "./types";
import { htmlToText, textOrThrow } from "./novels";

/**
 * Webnovel (Qidian International) — readable in-app.
 *
 * www.webnovel.com itself sits behind a hard Cloudflare JS challenge, so
 * server-side scraping of the official site is impossible. Instead this
 * adapter serves Webnovel's catalogue (originals + licensed C-novel
 * translations) through the ReadNovelFull mirror, which hosts the same
 * titles with their full free chapter lists:
 *
 *   search      /novel-list/search?keyword=<q>&page=<n>     (server-rendered, 20/page)
 *   popular     /ajax/hot-novels                            (fragment of cards)
 *   book page   /<slug>.html                                (meta + data-novel-id)
 *   chapter list /ajax/chapter-archive?novelId=<id>         (full archive, HTML fragment)
 *   chapter text /<slug>/chapter-….html → <div id="chr-content">
 *
 * Chapter bodies land in the built-in text reader ({ text } payload) — no
 * external redirects — and the generic download route turns the same
 * payload into a .txt file, so every row gets working Read + Download.
 */

const ROOT = "https://readnovelfull.com";
const UA_NOTE = { timeoutMs: 14_000 } as const;

/** Book path from any RNF url — "/shadow-slave.html" */
function bookPath(href: string): string | null {
  if (!href || !href.endsWith(".html")) return null;
  if (!href.startsWith("/")) return null;
  if (/^\/(genres|novel-list|authors|user|login|register|forum)/.test(href)) return null;
  // book pages live at "/<slug>.html"; chapters at "/<slug>/chapter-….html"
  if (href.slice(1, -5).includes("/")) return null;
  return href;
}

/* ─────────────────────────── search ─────────────────────────── */

/** Parse the server-rendered search grid into MediaItems. */
function parseSearchGrid(docHtml: string, limit: number): MediaItem[] {
  const items: MediaItem[] = [];
  const seen = new Set<string>();
  // each result row: cover img → novel-title link → author span (all adjacent)
  const re =
    /<img[^>]*class="cover"[^>]*>[\s\S]{0,900}?<h3 class="novel-title"><a href="([^"]+\.html)"[^>]*>([\s\S]*?)<\/a><\/h3>[\s\S]{0,600}?<span class="author">([\s\S]*?)<\/div>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(docHtml)) && items.length < limit) {
    const path = bookPath(m[1]);
    if (!path || seen.has(path)) continue;
    const title = stripHtml(m[2], 140);
    if (!title || title.length < 2) continue;
    seen.add(path);
    const img = m[0].match(/<img[^>]*class="cover"[^>]*>/)?.[0];
    const cover = img?.match(/src="([^"]+)"/)?.[1];
    const author = stripHtml(m[3], 80);
    items.push({
      id: `webnovel:${path}`,
      type: "novel",
      source: "webnovel",
      sourceLabel: "Webnovel (Qidian)",
      title,
      authors: author ? [author] : undefined,
      cover,
      externalUrl: `https://www.webnovel.com/search?keywords=${encodeURIComponent(title)}`,
    });
  }
  return items;
}

export const webnovel: SourceAdapter = {
  id: "webnovel",
  label: "Webnovel (Qidian)",
  type: "novel",
  siteUrl: "https://www.webnovel.com",
  note: "Qidian's catalogue via mirror — chapters read in-app, free",
  mirrors: [ROOT],
  imgHosts: ["img.readnovelfull.com"],

  async search(q, page, limit): Promise<SearchResult> {
    const docHtml = await fetchHtml(
      `${ROOT}/novel-list/search?keyword=${encodeURIComponent(q.slice(0, 80))}&page=${page}`,
      UA_NOTE,
    );
    const items = parseSearchGrid(docHtml, limit);
    return { items, total: items.length, page, hasMore: items.length >= 20 };
  },

  async popular(page, limit) {
    if (page > 1) return { items: [], total: 0, page, hasMore: false };
    const frag = await fetchHtml(`${ROOT}/ajax/hot-novels`, { timeoutMs: 12_000 }).catch(() => "");
    if (!frag) return { items: [], total: 0, page, hasMore: false };
    const items: MediaItem[] = [];
    const seen = new Set<string>();
    const re = /<a href="(\/[a-z0-9-]+\.html)"\s+title="([^"]+)">[\s\S]{0,160}?<img src="([^"]+)"/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(frag)) && items.length < limit) {
      if (seen.has(m[1])) continue;
      seen.add(m[1]);
      const title = stripHtml(m[2], 140);
      if (!title || title.length < 2) continue;
      items.push({
        id: `webnovel:${m[1]}`,
        type: "novel",
        source: "webnovel",
        sourceLabel: "Webnovel (Qidian)",
        title,
        cover: m[3],
        externalUrl: `https://www.webnovel.com/search?keywords=${encodeURIComponent(title)}`,
      });
    }
    return { items, total: items.length, page, hasMore: false };
  },

  /* ─────────────────────────── details ─────────────────────────── */

  async details(realId): Promise<Details> {
    const path = realId.startsWith("/") ? realId : `/${realId}`;
    const docHtml = await fetchHtml(`${ROOT}${path}`, UA_NOTE);

    const title =
      stripHtml(docHtml.match(/<h3 class="title"[^>]*>([\s\S]*?)<\/h3>/)?.[1], 140) ?? "Untitled";
    const author = stripHtml(docHtml.match(/Author:<\/h3><a[^>]*>([^<]+)<\/a>/)?.[1], 80);
    const status = stripHtml(docHtml.match(/Status:<\/h3><a[^>]*>([^<]+)<\/a>/)?.[1], 30);
    const genres = stripHtml(docHtml.match(/Genre:<\/h3>([\s\S]*?)<\/li>/)?.[1], 160);
    const description = stripHtml(
      docHtml.match(/<div class="desc-text"[^>]*>([\s\S]*?)<\/div>/)?.[1],
      1400,
    );
    const cover =
      docHtml.match(/<div class="book"><img src="([^"]+)"/)?.[1] ??
      docHtml.match(/<img[^>]*class="cover"[^>]*src="([^"]+)"/)?.[1];
    const novelId = docHtml.match(/data-novel-id="(\d+)"/)?.[1];

    const chapters: ChapterEntry[] = [];

    // full archive via AJAX fragment; fall back to the inline list on the page
    let archiveHtml = "";
    if (novelId) {
      archiveHtml = await fetchHtml(`${ROOT}/ajax/chapter-archive?novelId=${novelId}`, {
        timeoutMs: 18_000,
      }).catch(() => "");
    }
    const sourceHtml = archiveHtml || docHtml;

    const chRe = /<a\s[^>]*href="(\/[^"]+\/chapter-[^"]+\.html)"\s+title="([^"]*)"/gi;
    const seen = new Set<string>();
    let m: RegExpExecArray | null;
    while ((m = chRe.exec(sourceHtml)) && chapters.length < 8000) {
      if (seen.has(m[1])) continue;
      seen.add(m[1]);
      chapters.push({
        id: `webnovel-ch:${m[1]}`,
        label: stripHtml(m[2], 130) ?? "Chapter",
      });
    }
    // archive fragments come oldest → newest; inline lists too. The details
    // normalizer re-sorts by chapter number anyway.
    chapters.reverse();

    return {
      id: `webnovel:${path}`,
      type: "novel",
      source: "webnovel",
      sourceLabel: "Webnovel (Qidian)",
      title,
      authors: author ? [author] : [],
      status: status || undefined,
      tags: genres
        ? genres.split(",").map((g) => g.trim()).filter(Boolean).slice(0, 6)
        : undefined,
      description,
      cover,
      externalUrl: `https://www.webnovel.com/search?keywords=${encodeURIComponent(title)}`,
      chapters,
      readable: chapters.length > 0,
    };
  },

  /* ─────────────────────────── chapter text ─────────────────────────── */

  async chapterPages(realId) {
    const path = realId.startsWith("/") ? realId : `/${realId}`;
    const docHtml = await fetchHtml(`${ROOT}${path}`, { timeoutMs: 20_000 });

    const raw = extractChrContent(docHtml);
    return textOrThrow(raw);
  },
};

/**
 * Extract the reader body: the balanced <div id="chr-content"> … </div> span.
 * String-marker guesses (chr-foot / comments) break across RNF layouts — some
 * chapter pages have no footer marker and the naive slice then leaks the site
 * footer ("Contact - ToS - Sitemap") into the chapter text. Tracking div depth
 * captures exactly the reader block on every layout.
 */
function extractChrContent(docHtml: string): string {
  const marker = docHtml.indexOf('id="chr-content"');
  if (marker === -1) return "";
  const open = docHtml.indexOf(">", marker) + 1;
  let depth = 1; // the chr-content div itself is already open
  const re = /<div\b|<\/div>/g;
  re.lastIndex = open;
  let m: RegExpExecArray | null;
  while ((m = re.exec(docHtml))) {
    depth += m[0] === "</div>" ? -1 : 1;
    if (depth === 0) return docHtml.slice(open, m.index);
  }
  return docHtml.slice(open, open + 200_000);
}

/** Exported for tests/scripts: shared HTML→text pipeline check. */
export { htmlToText };
