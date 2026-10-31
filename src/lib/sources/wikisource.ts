import { fetchJson, stripHtml } from "@/lib/http";
import type {
  ChapterEntry,
  Details,
  MediaItem,
  SearchResult,
  SourceAdapter,
} from "./types";

/**
 * Wikisource — Wikimedia's library of free, proofread source texts
 * (public-domain novels, classics, speeches, historical documents).
 * Public MediaWiki API; a polite descriptive UA keeps it happy, and the
 * shared cache means we hit it at most once per query for ALL users.
 */

const API = "https://en.wikisource.org/w/api.php";
const UA = "OmniLibrary/1.0 (https://omnilibrary.example; book reader aggregator)";

const params = (extra: Record<string, string | number>) => {
  const qs = new URLSearchParams({ format: "json", formatversion: "2", origin: "*" });
  for (const [k, v] of Object.entries(extra)) qs.set(k, String(v));
  return qs;
};

async function wikiJson<T>(extra: Record<string, string | number>): Promise<T> {
  const res = await fetch(`${API}?${params(extra)}`, {
    headers: { "User-Agent": UA },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Wikisource ${res.status}`);
  return (await res.json()) as T;
}

interface WikiSearchItem {
  ns: number;
  title: string;
  pageid: number;
  wordcount?: number;
  snippet?: string;
}

const wikiUrl = (title: string) => `https://en.wikisource.org/wiki/${encodeURIComponent(title.replace(/ /g, "_"))}`;

function toItem(s: WikiSearchItem): MediaItem {
  return {
    id: `wikisource:${s.title}`,
    type: "novel",
    source: "wikisource",
    sourceLabel: "Wikisource",
    title: s.title,
    description: stripHtml(s.snippet, 300),
    externalUrl: wikiUrl(s.title),
  };
}
/** Last complete-day pageview top list — cached by Wikimedia's CDN. */
async function topTitles(): Promise<string[]> {
  const day = new Date(Date.now() - 3 * 86_400_000).toISOString().slice(0, 10).replace(/-/g, "/");
  try {
    const data = await fetchJson<{
      items?: { articles?: { article: string; views: number }[] }[];
    }>(`https://wikimedia.org/api/rest_v1/metrics/pageviews/top/en.wikisource/all-access/${day}`, {
      timeoutMs: 10_000,
      retries: 0,
      headers: { "User-Agent": UA },
    });
    return (data.items?.[0]?.articles ?? [])
      // The pageview list is dominated by site furniture, not works: "Main
      // Page", community/namespace pages ("Wikisource:", "Portal:", "Author:",
      // "Help:"…) and other non-content pages must never reach the grid.
      .filter((a) => {
        const title = a.article;
        if (title === "Main_Page" || title.startsWith("Main Page")) return false;
        if (/^(Special|Wikisource|Portal|Author|Help|Category|Template|Talk|Template_talk|Wikisource_talk|Sponsor|Translation|Scriptorium|Index|Page):/i.test(title)) return false;
        // any remaining "Something:"-prefixed title is a namespace page, not a work
        if (/^[A-Za-z][A-Za-z _-]{1,20}:/.test(title)) return false;
        return true;
      })
      .slice(0, 40)
      .map((a) => a.article.replace(/_/g, " "));
  } catch {
    return [];
  }
}

export const wikisource: SourceAdapter = {
  id: "wikisource",
  label: "Wikisource",
  type: "novel",
  siteUrl: "https://en.wikisource.org",
  note: "Proofread public-domain library — classics read as clean text",

  async search(q, page, limit) {
    const data = await wikiJson<{ query?: { search?: WikiSearchItem[]; searchinfo?: { totalhits: number } } }>({
      action: "query",
      list: "search",
      srsearch: q.slice(0, 90),
      srlimit: Math.min(limit, 25),
      sroffset: (page - 1) * Math.min(limit, 25),
    });
    const items = (data.query?.search ?? []).filter((s) => s.ns === 0).map(toItem);
    return { items, total: data.query?.searchinfo?.totalhits ?? items.length, page, hasMore: items.length >= 25 };
  },

  async popular(page, limit) {
    const tops = await topTitles();
    const slice = tops.slice((page - 1) * limit, page * limit);
    if (!slice.length) return { items: [], total: 0, page, hasMore: false };
    // resolve the batch of titles to real pages in one call
    const data = await wikiJson<{
      query?: { pages?: { title: string; ns: number; pageid: number }[] };
    }>({
      action: "query",
      titles: slice.join("|"),
    });
    const items = (data.query?.pages ?? [])
      .filter((p) => p.ns === 0 && !p.title.startsWith("Special:"))
      .slice(0, limit)
      .map((p) => ({ ...toItem({ ns: 0, title: p.title, pageid: p.pageid }) }));
    return { items, total: tops.length, page, hasMore: page * limit < tops.length };
  },

  async details(realId) {
    const title = decodeURIComponent(realId.replace(/_/g, " "));

    const [sub, meta] = await Promise.all([
      wikiJson<{ query?: { prefixsearch?: { title: string; ns: number }[] } }>({
        action: "query",
        list: "prefixsearch",
        pssearch: `${title}/`,
        pslimit: "max",
      }).catch(() => ({ query: undefined }) as Awaited<ReturnType<typeof wikiJson<{ query?: { prefixsearch?: { title: string; ns: number }[] } }>>>),
      wikiJson<{
        query?: {
          pages?: { title: string; extract?: string; missing?: boolean }[];
        };
      }>({
        action: "query",
        prop: "extracts",
        explaintext: 1,
        exintro: 1,
        titles: title,
      }).catch(() => ({ query: undefined }) as Awaited<ReturnType<typeof wikiJson<{ query?: { pages?: { title: string; extract?: string; missing?: boolean }[] } }>>>),
    ]);

    // the API ignores a trailing "/" and returns the root page too — keep
    // only real subpages ("Title/Chapter N")
    const subs = (sub.query?.prefixsearch ?? []).filter(
      (p) => p.ns === 0 && p.title.startsWith(`${title}/`),
    );
    const intro = meta.query?.pages?.[0]?.extract;

    const chapters: ChapterEntry[] = subs.length
      ? subs.map((p) => ({
          id: `wikisource-ch:${encodeURIComponent(p.title)}`,
          // "Alice's Adventures in Wonderland (1866)/Chapter 1" → "Chapter 1"
          label: p.title.slice(title.length + 1).replace(/_/g, " ") || p.title,
        }))
      : [{ id: `wikisource-ch:${encodeURIComponent(title)}`, label: "Full text" }];

    return {
      id: `wikisource:${title}`,
      type: "novel",
      source: "wikisource",
      sourceLabel: "Wikisource",
      title,
      authors: [],
      description: intro?.slice(0, 1400),
      externalUrl: wikiUrl(title),
      chapters,
      readable: true,
    } satisfies Details;
  },

  async chapterPages(realId) {
    const title = decodeURIComponent(realId.replace(/_/g, " "));

    // 1) plain-text extracts (fast path, works for most pages)
    try {
      const data = await wikiJson<{ query?: { pages?: { extract?: string; missing?: boolean }[] } }>({
        action: "query",
        prop: "extracts",
        explaintext: 1,
        titles: title,
      });
      const text = data.query?.pages?.[0]?.extract?.trim();
      if (text) return { text };
    } catch {
      /* fall through to the HTML parser */
    }

    // 2) rendered HTML (TextExtracts returns "" for transclusion-heavy pages)
    const parsed = await wikiJson<{ parse?: { text?: string } }>({
      action: "parse",
      page: title,
      prop: "text",
    });
    const htmlDoc = parsed.parse?.text ?? "";
    if (!htmlDoc) throw new Error("Chapter text unavailable");

    const paras = htmlDoc
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .split(/<\/p>/i)
      .map((p) => stripHtml(p, 20_000)?.trim())
      .filter((p): p is string => !!p);
    const text = paras.join("\n\n").trim();
    if (!text) throw new Error("Chapter text unavailable");
    return { text };
  },
};
