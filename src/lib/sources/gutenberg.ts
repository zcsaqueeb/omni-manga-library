import { fetchHtml, fetchJson, html, upstreamFetch } from "@/lib/http";
import { languageDef } from "@/lib/languages";
import type {
  ChapterEntry,
  Details,
  MediaItem,
  SearchResult,
  SourceAdapter,
} from "./types";

const API = "https://gutendex.com/books";

interface GBBook {
  id: number;
  title: string;
  authors: { name: string; birth_year: number | null; death_year: number | null }[];
  translators?: { name: string }[];
  subjects: string[];
  bookshelves: string[];
  languages: string[];
  copyright: boolean | null;
  media_type: string;
  formats: Record<string, string>;
  download_count: number;
  summaries?: string[];
}

const humanSize = (bytes?: string) => {
  if (!bytes) return undefined;
  const n = Number(bytes);
  if (!Number.isFinite(n)) return undefined;
  return n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`;
};

function cleanAuthor(name: string): string {
  return name.replace(/,\s*$/, "").replace(/\s*\(\d+.*?\)\s*$/, "");
}

function lifeRange(b: GBBook): string {
  const a = b.authors?.[0];
  if (!a) return "Unknown author";
  const years =
    a.birth_year && a.death_year ? ` (${a.birth_year}–${a.death_year})` : "";
  return cleanAuthor(a.name) + years;
}

const FORMATS: [string, string, string][] = [
  ["application/epub+zip", "EPUB", "epub"],
  ["application/pdf", "PDF", "pdf"],
  ["application/x-mobipocket-ebook", "Kindle (.mobi)", "mobi"],
  ["text/plain; charset=us-ascii", "Plain text", "txt"],
  ["text/plain", "Plain text (UTF-8)", "txt"],
];

function fileEntries(b: GBBook): ChapterEntry[] {
  const out: ChapterEntry[] = [];
  const seen = new Set<string>();
  for (const [mime, label, ext] of FORMATS) {
    const url = b.formats?.[mime];
    if (!url || seen.has(ext)) continue;
    seen.add(ext);
    out.push({
      id: `gutenberg-fmt:${b.id}:${mime}`,
      label: `${label} download`,
      file: { ext, size: humanSize((b.formats as Record<string, string>)[`${mime};size`] ?? undefined) },
    });
  }
  return out;
}

function toItem(b: GBBook): MediaItem {
  return {
    id: `gutenberg:${b.id}`,
    type: "book",
    source: "gutenberg",
    sourceLabel: "Gutenberg",
    title: b.title || `Book #${b.id}`,
    subtitle: lifeRange(b),
    cover: b.formats?.["image/jpeg"],
    tags: (b.bookshelves?.length ? b.bookshelves : b.subjects)?.slice(0, 3).map((s) => s.replace(/ -- /g, " · ")),
    externalUrl: `https://www.gutenberg.org/ebooks/${b.id}`,
  };
}

async function run(params: Record<string, string>, lang?: string): Promise<SearchResult> {
  try {
    const qs = new URLSearchParams(params);
    // Gutendex language facet — ISO 639-1 via the bracketed list key it expects
    const def = languageDef(lang);
    if (def) qs.append("languages[]", def.code);
    const data = await fetchJson<{ results: GBBook[]; count: number }>(`${API}?${qs}`, {
      timeoutMs: 9_000,
      retries: 0,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
      },
    });
    const page = Number(params.page ?? 1);
    return {
      items: data.results.map(toItem),
      total: data.count ?? 0,
      page,
      hasMore: data.results.length >= 32,
    };
  } catch {
    // gutendex unreachable / rate-limited → scrape gutenberg.org search results directly
    return gutenbergSiteSearch(params);
  }
}

/** Fallback: gutenberg.org's own search page (works even when gutendex is down). */
async function gutenbergSiteSearch(params: Record<string, string>): Promise<SearchResult> {
  const page = Number(params.page ?? 1) || 1;
  const q = params.search ?? "";
  const docHtml = await fetchHtml(
    q
      ? `https://www.gutenberg.org/ebooks/search/?query=${encodeURIComponent(q)}&page=${page}`
      : `https://www.gutenberg.org/ebooks/search/?sort_order=downloads&start_index=${(page - 1) * 25 + 1}`,
    { timeoutMs: 14_000, retries: 0 },
  );
  const doc = html(docHtml);
  const items: MediaItem[] = [];
  for (const a of doc.links("/ebooks/", 25)) {
    const bookId = a.href.match(/\/ebooks\/(\d+)/)?.[1];
    if (!bookId) continue;
    const title = a.text.replace(/\s+by\s+.+$/, "").trim() || a.text;
    const author = a.text.match(/\s+by\s+(.+)$/)?.[1];
    items.push({
      id: `gutenberg:${bookId}`,
      type: "book",
      source: "gutenberg",
      sourceLabel: "Gutenberg",
      title,
      subtitle: author,
      authors: author ? [author.replace(/\s*\(\d+.*?\)\s*$/, "")] : undefined,
      cover: `https://www.gutenberg.org/cache/epub/${bookId}/pg${bookId}.cover.medium.jpg`,
      externalUrl: `https://www.gutenberg.org/ebooks/${bookId}`,
    });
  }
  return { items, total: items.length, page, hasMore: items.length >= 20 };
}

/** Well-known direct file patterns on gutenberg.org — no API required. */
const DIRECT_PATTERNS: [string, string, string][] = [
  [".epub3.images", "EPUB download", "epub"],
  [".epub.noimages", "EPUB (basic) download", "epub"],
  [".kf8.images", "Kindle (.mobi) download", "mobi"],
  [".txt.utf-8", "Plain text download", "txt"],
];

/** When gutendex is rate-limited, probe gutenberg.org's direct download URLs with HEADs. */
async function fallbackDetails(realId: string): Promise<Details> {
  const probes = await Promise.allSettled(
    DIRECT_PATTERNS.map(async ([suffix, label, ext]) => {
      const res = await upstreamFetch(`https://www.gutenberg.org/ebooks/${realId}${suffix}`, {
        method: "HEAD",
        timeoutMs: 8_000,
        retries: 0,
      });
      return res.ok ? { label, ext, suffix } : null;
    }),
  );
  const chapters: ChapterEntry[] = probes
    .map((p) => (p.status === "fulfilled" ? p.value : null))
    .filter((v): v is { label: string; ext: string; suffix: string } => v !== null)
    .map((v) => ({ id: `gutenberg-direct:${realId}:${v.suffix}`, label: v.label, file: { ext: v.ext } }));

  return {
    id: `gutenberg:${realId}`,
    type: "book",
    source: "gutenberg",
    sourceLabel: "Gutenberg",
    title: `Gutenberg #${realId}`,
    authors: [],
    description: "Public-domain edition from Project Gutenberg.",
    chapters,
    readable: false,
    externalUrl: `https://www.gutenberg.org/ebooks/${realId}`,
  };
}

export const gutenberg: SourceAdapter = {
  id: "gutenberg",
  label: "Gutenberg",
  type: "book",
  siteUrl: "https://www.gutenberg.org",

  async search(q, page, limit, _nsfw, lang) {
    return run({ search: q.slice(0, 100), page: String(page) }, lang);
  },

  async popular(page, _limit, _nsfw, lang) {
    return run({ page: String(page) }, lang); // Gutendex default ordering = popularity
  },

  async details(realId) {
    try {
      const b = await fetchJson<GBBook>(`${API}/${realId}`, {
        timeoutMs: 12_000,
        retries: 0,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
        },
      });
      return {
        ...toItem(b),
        description:
          b.summaries?.[0] ||
          b.subjects?.slice(0, 6).join(" · ") ||
          "Public-domain title from Project Gutenberg.",
        authors: b.authors?.map((a) => cleanAuthor(a.name)) ?? [],
        status: b.languages?.join(", ").toUpperCase(),
        chapters: fileEntries(b),
        readable: false,
        externalUrl: `https://www.gutenberg.org/ebooks/${b.id}`,
      };
    } catch {
      // gutendex rate-limited or down — probe gutenberg.org directly
      return fallbackDetails(realId);
    }
  },
};
