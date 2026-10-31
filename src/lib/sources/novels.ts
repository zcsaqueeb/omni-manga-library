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

const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  mdash: "\u2014", ndash: "\u2013", hellip: "\u2026", rsquo: "\u2019",
  lsquo: "\u2018", ldquo: "\u201c", rdquo: "\u201d",
};

/**
 * Chapter HTML → clean reader text.
 * The in-app reader renders `text` as plain paragraphs, so every tag that
 * survives here would be shown LITERALLY (<p>…</p>). Convert block boundaries
 * to blank lines, strip the remaining markup and decode entities.
 */
export function htmlToText(raw: string): string {
  return raw
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<hr\s*\/?>/gi, "\n\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&#(\d+);/g, (_, d) => {
      const n = Number(d);
      return n > 0 && n < 0x10ffff ? String.fromCodePoint(n) : "";
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => {
      const n = parseInt(h, 16);
      return n > 0 && n < 0x10ffff ? String.fromCodePoint(n) : "";
    })
    .replace(/&([a-z]+);/gi, (m, name: string) => ENTITIES[name.toLowerCase()] ?? m)
    .replace(/[\u00a0\u200b]/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Missing content must THROW — an empty payload would otherwise be cached for
 * hours, while a throw only triggers the 10s negative cache. */
export function textOrThrow(content: string | undefined): { text: string } {
  const text = content ? htmlToText(content) : "";
  if (!text) throw new Error("Chapter text unavailable");
  return { text };
}

/* ────────────────────────────────── Royal Road (server-rendered) ────────────────────────────────── */

export const royalroad: SourceAdapter = {
  id: "royalroad",
  label: "Royal Road",
  type: "novel",
  siteUrl: "https://www.royalroad.com",
  beta: true,
  note: "Serialized web fiction — read free on site",

  async search(q, page, limit) {
    const docHtml = await fetchHtml(`https://www.royalroad.com/fictions/search?keyword=${encodeURIComponent(q.slice(0, 60))}&page=${page}`, { timeoutMs: 14_000 });
    const items: MediaItem[] = [];
    const re = /<a\s[^>]*href="(\/fiction\/\d+\/[^"]+)"[^>]*>([\s\S]{0,200}?)<\/a>/gi;
    const seen = new Set<string>();
    let m: RegExpExecArray | null;
    while ((m = re.exec(docHtml)) && items.length < limit) {
      if (seen.has(m[1])) continue;
      seen.add(m[1]);
      const title = stripHtml(m[2], 120);
      if (!title || title.length < 2) continue;
      items.push({
        id: `royalroad:${m[1]}`,
        type: "novel",
        source: "royalroad",
        sourceLabel: "Royal Road",
        title,
        externalUrl: `https://www.royalroad.com${m[1]}`,
      });
    }
    return { items, total: items.length, page, hasMore: items.length >= limit };
  },

  async popular(page, limit) {
    if (page > 1) return { items: [], total: 0, page, hasMore: false };
    const docHtml = await fetchHtml("https://www.royalroad.com/fictions/best-rated", { timeoutMs: 14_000 }).catch(() => "");
    if (!docHtml) return { items: [], total: 0, page, hasMore: false };
    const items: MediaItem[] = [];
    const re = /<a\s[^>]*href="(\/fiction\/\d+\/[^"]+)"[^>]*>([\s\S]{0,200}?)<\/a>/gi;
    const seen = new Set<string>();
    let m: RegExpExecArray | null;
    while ((m = re.exec(docHtml)) && items.length < limit) {
      if (seen.has(m[1])) continue;
      seen.add(m[1]);
      const title = stripHtml(m[2], 120);
      if (!title || title.length < 2) continue;
      items.push({ id: `royalroad:${m[1]}`, type: "novel", source: "royalroad", sourceLabel: "Royal Road", title, externalUrl: `https://www.royalroad.com${m[1]}` });
    }
    return { items, total: items.length, page, hasMore: false };
  },

  async details(realId) {
    const docHtml = await fetchHtml(`https://www.royalroad.com${realId.startsWith("/") ? realId : `/${realId}`}`, { timeoutMs: 14_000 });
    const title = stripHtml(docHtml.match(/<h1[^>]+class="[^"]*fiction-title[^"]*"[^>]*>([\s\S]*?)<\/h1>/)?.[1]) ?? "Untitled";
    const author = stripHtml(docHtml.match(/<span[^>]*>\s*by\s*<\/span>\s*<a[^>]*>([^<]+)<\/a>/)?.[1]);
    const description = stripHtml(docHtml.match(/<div[^>]+class="[^"]*description[\s\S]{0,200}?>([\s\S]*?)<\/div>/)?.[1], 1400);
    const cover = docHtml.match(/property=["']og:image["'][^>]+content=["']([^"']+)/)?.[1];
    const slugPath = realId.startsWith("/") ? realId : `/${realId}`;

    const chapters: ChapterEntry[] = [];
    const chRe = /<a\s[^>]*href="(\/fiction\/\d+\/[^"]+\/chapter\/\d+[^"]*)"[^>]*>([\s\S]{0,150}?)<\/a>/gi;
    const seen = new Set<string>();
    let m: RegExpExecArray | null;
    while ((m = chRe.exec(docHtml)) && chapters.length < 300) {
      if (seen.has(m[1])) continue;
      seen.add(m[1]);
      chapters.push({ id: `royalroad-ch:${m[1]}`, label: stripHtml(m[2], 110) ?? "Chapter", date: m[0].match(/title="([^"]+)"/)?.[1]?.slice(0, 10) });
    }

    return {
      id: `royalroad:${realId}`,
      type: "novel",
      source: "royalroad",
      sourceLabel: "Royal Road",
      title,
      authors: author ? [author] : [],
      description,
      cover,
      externalUrl: `https://www.royalroad.com${slugPath}`,
      chapters: chapters.reverse(),
      readable: chapters.length > 0,
    };
  },

  async chapterPages(realId) {
    const docHtml = await fetchHtml(`https://www.royalroad.com${realId.startsWith("/") ? realId : `/${realId}`}`, { timeoutMs: 15_000 });
    const content = docHtml.match(/<div[^>]+class="chapter-content[\s\S]*?>([\s\S]*?)<\/div>/)?.[1];
    return textOrThrow(content);
  },
};

/* ────────────────────────────────── LightNovelPub / NovelBin (shared template) ────────────────────────────────── */

interface LnpSpec {
  id: string;
  label: string;
  base: string;
}

function makeLnp(spec: LnpSpec): SourceAdapter {
  const root = spec.base.replace(/\/$/, "");
  return {
    id: spec.id,
    label: spec.label,
    type: "novel",
    siteUrl: root,
    beta: true,

    async search(q, page, limit) {
      const docHtml = await fetchHtml(`${root}/search?keyword=${encodeURIComponent(q.slice(0, 60))}&page=${page}`, { timeoutMs: 14_000 });
      const items: MediaItem[] = [];
      const re = /<a\s[^>]*href="(\/novel\/[^"]+)"[^>]*>([\s\S]{0,300}?)<\/a>/gi;
      const seen = new Set<string>();
      let m: RegExpExecArray | null;
      while ((m = re.exec(docHtml)) && items.length < limit) {
        if (seen.has(m[1])) continue;
        seen.add(m[1]);
        const title = stripHtml(m[2], 120);
        if (!title || title.length < 2) continue;
        const img = m[0].match(/(?:data-src|src)="([^"]+\.(?:jpe?g|png|webp)[^"]*)"/i)?.[1];
        items.push({ id: `${spec.id}:${m[1]}`, type: "novel", source: spec.id, sourceLabel: spec.label, title, cover: img ? abs(root, img) : undefined, externalUrl: `${root}${m[1]}` });
      }
      return { items, total: items.length, page, hasMore: items.length >= limit };
    },

    async popular(page, limit) {
      if (page > 1) return { items: [], total: 0, page, hasMore: false };
      const docHtml = await fetchHtml(`${root}/most-popular`, { timeoutMs: 14_000 }).catch(() => "");
      if (!docHtml) return { items: [], total: 0, page, hasMore: false };
      const items: MediaItem[] = [];
      const re = /<a\s[^>]*href="(\/novel\/[^"]+)"[^>]*>([\s\S]{0,300}?)<\/a>/gi;
      const seen = new Set<string>();
      let m: RegExpExecArray | null;
      while ((m = re.exec(docHtml)) && items.length < limit) {
        if (seen.has(m[1])) continue;
        seen.add(m[1]);
        const title = stripHtml(m[2], 120);
        if (!title || title.length < 2) continue;
        items.push({ id: `${spec.id}:${m[1]}`, type: "novel", source: spec.id, sourceLabel: spec.label, title, externalUrl: `${root}${m[1]}` });
      }
      return { items, total: items.length, page, hasMore: false };
    },

    async details(realId) {
      const docHtml = await fetchHtml(`${root}${realId.startsWith("/") ? realId : `/${realId}`}`, { timeoutMs: 14_000 });
      const title = stripHtml(docHtml.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)?.[1]) ?? "Untitled";
      const author = stripHtml(docHtml.match(/Author:\s*(?:<\/span>)?\s*<a[^>]*>([^<]+)/)?.[1]);
      const description = stripHtml(docHtml.match(/id="paragraph"[^>]*>([\s\S]*?)<\/div>/)?.[1] ?? docHtml.match(/itemprop="description"[^>]*>([\s\S]*?)<\/div>/)?.[1], 1400);
      const cover = docHtml.match(/property=["']og:image["'][^>]+content=["']([^"']+)/)?.[1];
      const status = stripHtml(docHtml.match(/Status:\s*(?:<\/span>)?\s*([^<]{2,20})/)?.[1]);

      const chapters: ChapterEntry[] = [];
      const chRe = /<a\s[^>]*href="(\/novel\/[^"]+\/chapter-[^"]+)"[^>]*>([\s\S]{0,150}?)<\/a>/gi;
      const seen = new Set<string>();
      let m: RegExpExecArray | null;
      while ((m = chRe.exec(docHtml)) && chapters.length < 400) {
        if (seen.has(m[1])) continue;
        seen.add(m[1]);
        chapters.push({ id: `${spec.id}-ch:${m[1]}`, label: stripHtml(m[2], 110) ?? m[1] });
      }

      return {
        id: `${spec.id}:${realId}`,
        type: "novel",
        source: spec.id,
        sourceLabel: spec.label,
        title,
        authors: author ? [author] : [],
        status: status || undefined,
        description,
        cover,
        externalUrl: `${root}${realId}`,
        chapters: chapters.reverse(),
        readable: chapters.length > 0,
      };
    },

    async chapterPages(realId) {
      const docHtml = await fetchHtml(`${root}${realId.startsWith("/") ? realId : `/${realId}`}`, { timeoutMs: 15_000 });
      const content = docHtml.match(/id="paragraph"[^>]*>([\s\S]*?)<\/div>/)?.[1] ?? docHtml.match(/id="chr-content"[^>]*>([\s\S]*?)<\/div>/)?.[1];
      return textOrThrow(content);
    },
  };
}

export const lightnovelpub = makeLnp({ id: "lightnovelpub", label: "LightNovelPub", base: "https://www.lightnovelpub.com" });
export const novelbin = makeLnp({ id: "novelbin", label: "NovelBin", base: "https://novelbin.com" });

/* ────────────────────────────────── NovelUpdates (catalogue index) ────────────────────────────────── */

export const novelupdates: SourceAdapter = {
  id: "novelupdates",
  label: "NovelUpdates",
  type: "novel",
  siteUrl: "https://www.novelupdates.com",
  beta: true,
  note: "Series index & tracking — chapters live on the linked translation sites",

  async search(q, page, limit) {
    if (page > 1) return { items: [], total: 0, page, hasMore: false };
    const docHtml = await fetchHtml(`https://www.novelupdates.com/?s=${encodeURIComponent(q.slice(0, 60))}`, { timeoutMs: 14_000 });
    const items: MediaItem[] = [];
    const re = /<a\s[^>]*href="(https:\/\/www\.novelupdates\.com\/series\/[^"]+)"[^>]*>([\s\S]{0,200}?)<\/a>/gi;
    const seen = new Set<string>();
    let m: RegExpExecArray | null;
    while ((m = re.exec(docHtml)) && items.length < limit) {
      if (seen.has(m[1])) continue;
      seen.add(m[1]);
      const title = stripHtml(m[2], 120);
      if (!title || title.length < 2) continue;
      items.push({ id: `novelupdates:${m[1].replace("https://www.novelupdates.com", "")}`, type: "novel", source: "novelupdates", sourceLabel: "NovelUpdates", title, externalUrl: m[1] });
    }
    return { items, total: items.length, page, hasMore: false };
  },

  async popular(page, limit) {
    if (page > 1) return { items: [], total: 0, page, hasMore: false };
    const docHtml = await fetchHtml("https://www.novelupdates.com/series-ranking/?rank=popweek", { timeoutMs: 14_000 }).catch(() => "");
    if (!docHtml) return { items: [], total: 0, page, hasMore: false };
    const items: MediaItem[] = [];
    const re = /<a\s[^>]*href="(https:\/\/www\.novelupdates\.com\/series\/[^"]+)"[^>]*>([\s\S]{0,200}?)<\/a>/gi;
    const seen = new Set<string>();
    let m: RegExpExecArray | null;
    while ((m = re.exec(docHtml)) && items.length < limit) {
      if (seen.has(m[1])) continue;
      seen.add(m[1]);
      const title = stripHtml(m[2], 120);
      if (!title || title.length < 2) continue;
      items.push({ id: `novelupdates:${m[1].replace("https://www.novelupdates.com", "")}`, type: "novel", source: "novelupdates", sourceLabel: "NovelUpdates", title, externalUrl: m[1] });
    }
    return { items, total: items.length, page, hasMore: false };
  },

  async details(realId) {
    const url = `https://www.novelupdates.com${realId.startsWith("/") ? realId : `/${realId}`}`;
    const docHtml = await fetchHtml(url, { timeoutMs: 14_000 });
    const title = stripHtml(docHtml.match(/class="seriestitle[^"]*"[^>]*>([\s\S]*?)</)?.[1]) ?? "Untitled";
    const cover = docHtml.match(/<img[^>]+class="wp-post-image[^"]*"[^>]+src="([^"]+)"/)?.[1];
    const description = stripHtml(docHtml.match(/id="editdescription"[^>]*>([\s\S]*?)<\/div>/)?.[1], 1400);
    const author = stripHtml(docHtml.match(/#showcreatore[\s\S]{0,300}?<a[^>]*>([^<]+)<\/a>/)?.[1] ?? docHtml.match(/<span[^>]*>Author\s*<\/span>[\s\S]{0,200}?<a[^>]*>([^<]+)<\/a>/)?.[1]);
    const publishedAt = stripHtml(docHtml.match(/Related Series[\s\S]{0,100}|Original Publication:\s*([\w ,]+)/)?.[1]);

    return {
      id: `novelupdates:${realId}`,
      type: "novel",
      source: "novelupdates",
      sourceLabel: "NovelUpdates",
      title,
      authors: author ? [author] : [],
      description,
      cover,
      publishedAt,
      externalUrl: url,
      chapters: [],
      readable: false,
    };
  },
};

/* ────────────────────────────────── ScribbleHub ────────────────────────────────── */

export const scribblehub: SourceAdapter = {
  id: "scribblehub",
  label: "Scribble Hub",
  type: "novel",
  siteUrl: "https://www.scribblehub.com",
  beta: true,

  async search(q, page, limit) {
    if (page > 1) return { items: [], total: 0, page, hasMore: false };
    const docHtml = await fetchHtml(`https://www.scribblehub.com/?s=${encodeURIComponent(q.slice(0, 60))}`, { timeoutMs: 14_000 });
    const items: MediaItem[] = [];
    const re = /<a\s[^>]*href="(https:\/\/www\.scribblehub\.com\/series\/\d+\/[^"]+\/)"[^>]*>([\s\S]{0,200}?)<\/a>/gi;
    const seen = new Set<string>();
    let m: RegExpExecArray | null;
    while ((m = re.exec(docHtml)) && items.length < limit) {
      if (seen.has(m[1])) continue;
      seen.add(m[1]);
      const title = stripHtml(m[2], 120);
      if (!title || title.length < 2) continue;
      items.push({ id: `scribblehub:${m[1].replace("https://www.scribblehub.com", "")}`, type: "novel", source: "scribblehub", sourceLabel: "Scribble Hub", title, externalUrl: m[1] });
    }
    return { items, total: items.length, page, hasMore: false };
  },

  async popular(page, limit) {
    if (page > 1) return { items: [], total: 0, page, hasMore: false };
    const docHtml = await fetchHtml("https://www.scribblehub.com/series-finder/?sf=1&sort=ratings", { timeoutMs: 14_000 }).catch(() => "");
    if (!docHtml) return { items: [], total: 0, page, hasMore: false };
    const items: MediaItem[] = [];
    const re = /<a\s[^>]*href="(https:\/\/www\.scribblehub\.com\/series\/\d+\/[^"]+\/)"[^>]*>([\s\S]{0,200}?)<\/a>/gi;
    const seen = new Set<string>();
    let m: RegExpExecArray | null;
    while ((m = re.exec(docHtml)) && items.length < limit) {
      if (seen.has(m[1])) continue;
      seen.add(m[1]);
      const title = stripHtml(m[2], 120);
      if (!title || title.length < 2) continue;
      items.push({ id: `scribblehub:${m[1].replace("https://www.scribblehub.com", "")}`, type: "novel", source: "scribblehub", sourceLabel: "Scribble Hub", title, externalUrl: m[1] });
    }
    return { items, total: items.length, page, hasMore: false };
  },

  async details(realId) {
    const url = `https://www.scribblehub.com${realId.startsWith("/") ? realId : `/${realId}`}`;
    const docHtml = await fetchHtml(url, { timeoutMs: 14_000 });
    const title = stripHtml(docHtml.match(/<div[^>]+class="novel-title[^"]*"[^>]*>\s*<h1[^>]*>([\s\S]*?)<\/h1>/)?.[1] ?? docHtml.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)?.[1]) ?? "Untitled";
    const author = stripHtml(docHtml.match(/class="author[^"]*"[^>]*>[\s\S]{0,200}?<a[^>]*>([^<]+)<\/a>/)?.[1]);
    const description = stripHtml(docHtml.match(/<div[^>]+class="novel-description[^"]*"[^>]*>([\s\S]*?)<\/div>/)?.[1], 1400);
    const cover = docHtml.match(/property=["']og:image["'][^>]+content=["']([^"']+)/)?.[1];

    const chapters: ChapterEntry[] = [];
    const chRe = /<a\s[^>]*href="(https:\/\/www\.scribblehub\.com\/read\/[^"]+|\/read\/[^"]+)"[^>]*>([\s\S]{0,150}?)<\/a>/gi;
    const seen = new Set<string>();
    let m: RegExpExecArray | null;
    while ((m = chRe.exec(docHtml)) && chapters.length < 300) {
      if (seen.has(m[1])) continue;
      seen.add(m[1]);
      chapters.push({ id: `scribblehub-ch:${m[1].replace("https://www.scribblehub.com", "")}`, label: stripHtml(m[2], 110) ?? "Chapter" });
    }

    return {
      id: `scribblehub:${realId}`,
      type: "novel",
      source: "scribblehub",
      sourceLabel: "Scribble Hub",
      title,
      authors: author ? [author] : [],
      description,
      cover,
      externalUrl: url,
      chapters: chapters.reverse(),
      readable: chapters.length > 0,
    };
  },

  async chapterPages(realId) {
    const docHtml = await fetchHtml(`https://www.scribblehub.com${realId.startsWith("/") ? realId : `/${realId}`}`, { timeoutMs: 15_000 });
    const content = docHtml.match(/<div[^>]+id="chp_raw"[^>]*>([\s\S]*?)<\/div>/)?.[1];
    return textOrThrow(content);
  },
};

/* ────────────────────────────────── MTLNovel ────────────────────────────────── */

export const mtnovel: SourceAdapter = {
  id: "mtnovel",
  label: "MTNovel",
  type: "novel",
  siteUrl: "https://www.mtlnovel.com",
  beta: true,

  async search(q, page, limit) {
    const docHtml = await fetchHtml(`https://www.mtlnovel.com/?s=${encodeURIComponent(q.slice(0, 60))}`, { timeoutMs: 14_000 });
    const items: MediaItem[] = [];
    const re = /<a\s[^>]*href="(https:\/\/www\.mtlnovel\.com\/(?:[^"]+)-[^"]*\/)"[^>]*>([\s\S]{0,200}?)<\/a>/gi;
    const seen = new Set<string>();
    let m: RegExpExecArray | null;
    while ((m = re.exec(docHtml)) && items.length < limit) {
      if (seen.has(m[1]) || /\/(category|tag|author)\//.test(m[1])) continue;
      seen.add(m[1]);
      const title = stripHtml(m[2], 120);
      if (!title || title.length < 2) continue;
      const img = m[0].match(/(?:data-src|src)="([^"]+\.(?:jpe?g|png|webp)[^"]*)"/i)?.[1];
      items.push({ id: `mtnovel:${m[1].replace("https://www.mtlnovel.com", "")}`, type: "novel", source: "mtnovel", sourceLabel: "MTNovel", title, cover: img, externalUrl: m[1] });
    }
    return { items, total: items.length, page, hasMore: false };
  },

  async popular(page, limit) {
    if (page > 1) return { items: [], total: 0, page, hasMore: false };
    const docHtml = await fetchHtml("https://www.mtlnovel.com/hot/", { timeoutMs: 14_000 }).catch(() => "");
    if (!docHtml) return { items: [], total: 0, page, hasMore: false };
    const items: MediaItem[] = [];
    const re = /<a\s[^>]*href="(https:\/\/www\.mtlnovel\.com\/[^"]+\/)"[^>]*>([\s\S]{0,200}?)<\/a>/gi;
    const seen = new Set<string>();
    let m: RegExpExecArray | null;
    while ((m = re.exec(docHtml)) && items.length < limit) {
      if (seen.has(m[1]) || /\/(category|tag|author)\//.test(m[1])) continue;
      seen.add(m[1]);
      const title = stripHtml(m[2], 120);
      if (!title || title.length < 2) continue;
      items.push({ id: `mtnovel:${m[1].replace("https://www.mtlnovel.com", "")}`, type: "novel", source: "mtnovel", sourceLabel: "MTNovel", title, externalUrl: m[1] });
    }
    return { items, total: items.length, page, hasMore: false };
  },

  async details(realId) {
    const url = `https://www.mtlnovel.com${realId.startsWith("/") ? realId : `/${realId}`}`;
    const docHtml = await fetchHtml(url, { timeoutMs: 14_000 });
    const title = stripHtml(docHtml.match(/property=["']og:title["'][^>]+content=["']([^"']+)["']/)?.[1]) ?? "Untitled";
    const author = stripHtml(docHtml.match(/Author:\s*<a[^>]*>([^<]+)/)?.[1]);
    const description = stripHtml(docHtml.match(/itemprop="description"[^>]*>([\s\S]*?)<\/div>/)?.[1], 1400);
    const cover = docHtml.match(/property=["']og:image["'][^>]+content=["']([^"']+)/)?.[1];
    const status = stripHtml(docHtml.match(/Status:[^<]*<[^>]*>\s*([^<]+)/)?.[1]);

    const chapters: ChapterEntry[] = [];
    const chRe = /<a\s[^>]*href="(https:\/\/www\.mtlnovel\.com\/[^"]+\/chapter-\d+[^"]*\/?)"[^>]*>([\s\S]{0,120}?)<\/a>/gi;
    const seen = new Set<string>();
    let m: RegExpExecArray | null;
    while ((m = chRe.exec(docHtml)) && chapters.length < 400) {
      if (seen.has(m[1])) continue;
      seen.add(m[1]);
      chapters.push({ id: `mtnovel-ch:${m[1].replace("https://www.mtlnovel.com", "")}`, label: stripHtml(m[2], 110) ?? m[1] });
    }

    return {
      id: `mtnovel:${realId}`,
      type: "novel",
      source: "mtnovel",
      sourceLabel: "MTNovel",
      title,
      authors: author ? [author] : [],
      status: status || undefined,
      description,
      cover,
      externalUrl: url,
      chapters: chapters.reverse(),
      readable: chapters.length > 0,
    };
  },

  async chapterPages(realId) {
    const docHtml = await fetchHtml(`https://www.mtlnovel.com${realId.startsWith("/") ? realId : `/${realId}`}`, { timeoutMs: 15_000 });
    const content = docHtml.match(/class="prd-_content[^"]*"[^>]*>([\s\S]*?)<\/div>/)?.[1] ?? docHtml.match(/<div[^>]+class="novel_read[^"]*"[^>]*>([\s\S]*?)<\/div>/)?.[1];
    return textOrThrow(content);
  },
};

/* ────────────────────────────────── Archive of Our Own ────────────────────────────────── */

export const ao3: SourceAdapter = {
  id: "ao3",
  label: "AO3",
  type: "novel",
  siteUrl: "https://archiveofourown.org",
  beta: true,

  async search(q, page, limit) {
    const docHtml = await fetchHtml(
      `https://archiveofourown.org/works/search?page=${page}&work_search%5Bquery%5D=${encodeURIComponent(q.slice(0, 60))}`,
      { timeoutMs: 15_000, retries: 1 },
    );
    const items: MediaItem[] = [];
    const re = /<a\s[^>]*href="(\/works\/\d+)"[^>]*>([\s\S]{0,200}?)<\/a>/gi;
    const seen = new Set<string>();
    let m: RegExpExecArray | null;
    while ((m = re.exec(docHtml)) && items.length < limit) {
      if (seen.has(m[1])) continue;
      seen.add(m[1]);
      const title = stripHtml(m[2], 120);
      if (!title || title.length < 2) continue;
      items.push({ id: `ao3:${m[1]}`, type: "novel", source: "ao3", sourceLabel: "AO3", title, externalUrl: `https://archiveofourown.org${m[1]}` });
    }
    return { items, total: items.length, page, hasMore: items.length >= limit };
  },

  async popular(page, limit) {
    if (page > 1) return { items: [], total: 0, page, hasMore: false };
    return ao3.search("fanfiction favorite", page, limit);
  },

  async details(realId) {
    const docHtml = await fetchHtml(`https://archiveofourown.org${realId.startsWith("/") ? realId : `/${realId}`}`, { timeoutMs: 15_000 });
    const title = stripHtml(docHtml.match(/<h2[^>]+class="title heading"[^>]*>([\s\S]*?)<\/h2>/)?.[1]) ?? "Untitled";
    const author = stripHtml(docHtml.match(/<h3[^>]+class="byline heading"[^>]*>([\s\S]*?)<\/h3>/)?.[1]);
    const description = stripHtml(docHtml.match(/<div[^>]+class="summary module"[^>]*>([\s\S]*?)<\/div>/)?.[1], 1400);
    const publishedAt = docHtml.match(/<dd[^>]+class="published[^"]*"[^>]*>([\d-]+)/)?.[1];

    const chapters: ChapterEntry[] = [];
    const navHtml = await fetchHtml(`https://archiveofourown.org${realId}/navigate`, { timeoutMs: 15_000 }).catch(() => "");
    const chRe = /<a\s[^>]*href="(\/works\/\d+\/chapters\/\d+)"[^>]*>([\s\S]{0,150}?)<\/a>/gi;
    let m: RegExpExecArray | null;
    const seen = new Set<string>();
    while ((m = chRe.exec(navHtml)) && chapters.length < 300) {
      if (seen.has(m[1])) continue;
      seen.add(m[1]);
      chapters.push({ id: `ao3-ch:${m[1]}`, label: stripHtml(m[2], 110) ?? "Chapter" });
    }

    return {
      id: `ao3:${realId}`,
      type: "novel",
      source: "ao3",
      sourceLabel: "AO3",
      title,
      authors: author ? [author] : [],
      description,
      publishedAt,
      externalUrl: `https://archiveofourown.org${realId}`,
      chapters,
      readable: chapters.length > 0,
    };
  },

  async chapterPages(realId) {
    const docHtml = await fetchHtml(`https://archiveofourown.org${realId.startsWith("/") ? realId : `/${realId}`}`, { timeoutMs: 15_000 });
    const userstuff = docHtml.match(/<div[^>]+class="userstuff[^"]*"[^>]*>([\s\S]*?)<\/div>/)?.[1];
    return textOrThrow(userstuff);
  },
};

/* ────────────────────────────────── FanFiction.net (m. subdomain) ────────────────────────────────── */

export const fanfiction: SourceAdapter = {
  id: "fanfiction",
  label: "FanFiction.net",
  type: "novel",
  siteUrl: "https://www.fanfiction.net",
  beta: true,

  async search(q, page, limit) {
    const docHtml = await fetchHtml(`https://m.fanfiction.net/search/?keywords=${encodeURIComponent(q.slice(0, 50))}&ready=1&type=story&page=${page}`, { timeoutMs: 14_000 });
    const items: MediaItem[] = [];
    const re = /<a\s[^>]*href="(\/s\/\d+\/[^"]+)"[^>]*>([\s\S]{0,200}?)<\/a>/gi;
    const seen = new Set<string>();
    let m: RegExpExecArray | null;
    while ((m = re.exec(docHtml)) && items.length < limit) {
      const storyId = m[1].match(/\/s\/(\d+)/)![1];
      if (seen.has(storyId)) continue;
      seen.add(storyId);
      const title = stripHtml(m[2], 120);
      if (!title || title.length < 2) continue;
      items.push({ id: `fanfiction:${storyId}`, type: "novel", source: "fanfiction", sourceLabel: "FanFiction.net", title, externalUrl: `https://www.fanfiction.net/s/${storyId}/1/` });
    }
    return { items, total: items.length, page, hasMore: items.length >= limit };
  },

  async popular(page, limit) {
    if (page > 1) return { items: [], total: 0, page, hasMore: false };
    return fanfiction.search("harry potter", page, limit);
  },

  async details(storyId) {
    const docHtml = await fetchHtml(`https://m.fanfiction.net/s/${storyId}/1/`, { timeoutMs: 14_000 });
    const title = stripHtml(docHtml.match(/<title>([^<]+)/)?.[1]?.replace(/\s*Chapter 1.*$/, "")) ?? `Story ${storyId}`;
    const author = stripHtml(docHtml.match(/<a[^>]*href="\/u\/\d+[^"]*"[^>]*>([^<]+)<\/a>/)?.[1]);
    const description = stripHtml(docHtml.match(/<div[^>]+class="summary[^"]*"[^>]*>([\s\S]*?)<\/div>/)?.[1], 1200);
    const publishedAt = docHtml.match(/data-xutime="(\d+)"/)?.[1];

    const chapters: ChapterEntry[] = [];
    const chRe = /<a\s[^>]*href="(\/s\/\d+\/\d+\/[^"]*)"[\s\S]{0,120}?>/gi;
    let m: RegExpExecArray | null;
    const seen = new Set<string>();
    while ((m = chRe.exec(docHtml)) && chapters.length < 300) {
      const n = m[1].match(/\/s\/\d+\/(\d+)/)![1];
      if (seen.has(n)) continue;
      seen.add(n);
      chapters.push({ id: `fanfiction-ch:${storyId}:${n}`, label: stripHtml(m[0].match(/>([^<]{2,110})</)?.[1] ?? `Chapter ${n}`) ?? `Chapter ${n}` });
    }

    return {
      id: `fanfiction:${storyId}`,
      type: "novel",
      source: "fanfiction",
      sourceLabel: "FanFiction.net",
      title,
      authors: author ? [author] : [],
      description,
      publishedAt: publishedAt ? new Date(Number(publishedAt) * 1000).toISOString().slice(0, 10) : undefined,
      externalUrl: `https://www.fanfiction.net/s/${storyId}/1/`,
      chapters,
      readable: true,
    };
  },

  async chapterPages(realId) {
    const [storyId, n] = realId.split(":");
    const docHtml = await fetchHtml(`https://m.fanfiction.net/s/${storyId}/${n}/`, { timeoutMs: 15_000 });
    const content = docHtml.match(/<div[^>]+id="storycontent"[^>]*>([\s\S]*?)<\/div>/)?.[1];
    return textOrThrow(content);
  },
};
