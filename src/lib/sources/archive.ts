import { fetchJson } from "@/lib/http";
import { iaLangClause } from "@/lib/languages";
import type {
  ChapterEntry,
  Details,
  MediaItem,
  SearchResult,
  SourceAdapter,
} from "./types";

const SEARCH_API = "https://archive.org/advancedsearch.php";
const META_API = "https://archive.org/metadata";
const COVER_API = "https://archive.org/services/img";
const DOWNLOAD_API = "https://archive.org/download";

interface IADoc {
  identifier: string;
  title?: string | string[];
  creator?: string | string[];
  year?: string | number;
  downloads?: number;
  description?: string | string[];
}

const flat = (v: string | string[] | number | undefined): string | undefined => {
  if (v === undefined) return undefined;
  const s = Array.isArray(v) ? v[0] : String(v);
  return s.length ? s : undefined;
};

function toItem(d: IADoc, type: "comic" | "manga" | "book"): MediaItem {
  return {
    id: `archive:${d.identifier}`,
    type,
    source: "archive",
    sourceLabel: "Internet Archive",
    title: (flat(d.title) || d.identifier).replace(/_/g, " "),
    subtitle: flat(d.creator),
    cover: `${COVER_API}/${d.identifier}`,
    year: d.year ? Number(d.year) || undefined : undefined,
    description: flat(d.description)?.replace(/<[^>]+>/g, "").slice(0, 400),
    externalUrl: `https://archive.org/details/${d.identifier}`,
  };
}

function qEscape(s: string) {
  return s.replace(/[:\\]/g, " ").trim();
}

async function runQuery(queryStr: string, type: "comic" | "manga" | "book", page: number, limit: number, sort = ""): Promise<SearchResult> {
  const params = new URLSearchParams({
    q: queryStr,
    rows: String(limit),
    page: String(page),
    output: "json",
  });
  for (const f of ["identifier", "title", "creator", "year", "downloads", "description"]) {
    params.append("fl[]", f);
  }
  if (sort) params.set("sort[]", sort);

  const data = await fetchJson<{ response?: { docs?: IADoc[]; numFound?: number } }>(
    `${SEARCH_API}?${params.toString()}`,
    { timeoutMs: 14_000 },
  );
  const docs = data.response?.docs ?? [];
  const numFound = data.response?.numFound ?? docs.length;
  return {
    items: docs.map((d) => toItem(d, type)),
    total: numFound,
    page,
    hasMore: page * limit < numFound,
  };
}

export const archive: SourceAdapter = {
  id: "archive",
  label: "Internet Archive",
  type: "comic",
  siteUrl: "https://archive.org",

  async search(q, page, limit) {
    const term = qEscape(q.slice(0, 80));
    const queryStr = `(collection:(comicbooks) OR collection:(comics)) AND mediatype:(texts) AND (title:(${term}) OR creator:(${term}))`;
    return runQuery(queryStr, "comic", page, limit, "downloads desc");
  },

  async popular(page, limit) {
    return runQuery("(collection:(comicbooks) OR collection:(comics)) AND mediatype:(texts)", "comic", page, limit, "downloads desc");
  },

  async details(realId) {
    const meta = await fetchJson<{ files?: { name: string; size?: string; format?: string }[]; metadata?: Record<string, unknown> }>(
      `${META_API}/${realId}`,
      { timeoutMs: 14_000 },
    );

    const md = meta.metadata ?? {};
    const title = flat(md.title as string) || realId.replace(/_/g, " ");
    const humanSize = (bytes?: string) => {
      if (!bytes) return undefined;
      const n = Number(bytes);
      if (!Number.isFinite(n)) return undefined;
      return n > 1e9 ? `${(n / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(n / 1e6))} MB`;
    };

    const chapters: ChapterEntry[] = (meta.files ?? [])
      .filter((f) => /\.(pdf|epub|cbz|cbr)$/i.test(f.name))
      .slice(0, 24)
      .map((f) => ({
        id: `archive-file:${realId}:${f.name}`,
        label: f.name,
        file: { ext: f.name.split(".").pop()!.toLowerCase(), size: humanSize(f.size) },
      }));

    return {
      id: `archive:${realId}`,
      type: "comic",
      source: "archive",
      sourceLabel: "Internet Archive",
      title,
      subtitle: flat(md.creator as string),
      cover: `${COVER_API}/${realId}`,
      year: md.year ? Number(md.year) || undefined : undefined,
      description: flat(md.description as string)?.replace(/<[^>]+>/g, "").slice(0, 1200),
      authors: [],
      externalUrl: `https://archive.org/details/${realId}`,
      chapters,
      readable: false,
    };
  },
};

/** Manga-flavoured Internet Archive search (public-domain manga scans). */
export const archiveManga: SourceAdapter = {
  id: "archive-manga",
  label: "IA Manga Scans",
  type: "manga",
  siteUrl: "https://archive.org",

  async search(q, page, limit) {
    const term = qEscape(q.slice(0, 80));
    const queryStr = `mediatype:(texts) AND (collection:(manga) OR subject:(manga)) AND (title:(${term}) OR creator:(${term}))`;
    return runQuery(queryStr, "manga", page, limit, "downloads desc");
  },

  async popular(page, limit) {
    return runQuery("mediatype:(texts) AND (collection:(manga) OR subject:(manga))", "manga", page, limit, "downloads desc");
  },

  async details(realId) {
    return archive.details(realId);
  },
};

/** General book search on Internet Archive (excludes the comics shelves). */
export const archiveBooks: SourceAdapter = {
  id: "archive-books",
  label: "IA Books",
  type: "book",
  siteUrl: "https://archive.org",


  async search(q, page, limit, _nsfw, lang) {
    const term = qEscape(q.slice(0, 80));
    const queryStr = `mediatype:(texts) AND !collection:(comicbooks) AND !collection:(comics) AND (title:(${term}) OR creator:(${term}))${iaLangClause(lang)}`;
    return runQuery(queryStr, "book", page, limit, "downloads desc");
  },

  async popular(page, limit, _nsfw, lang) {
    return runQuery(
      `mediatype:(texts) AND subject:(fiction) AND !collection:(comicbooks) AND !collection:(comics)${iaLangClause(lang)}`,
      "book",
      page,
      limit,
      "downloads desc",
    );
  },

  async details(realId) {
    const d = await archive.details(realId);
    return { ...d, type: "book" as const };
  },
};

/** Resolve the download URL for an archive file entry. */
export function archiveFileUrl(identifier: string, fileName: string): string {
  return `${DOWNLOAD_API}/${encodeURIComponent(identifier)}/${fileName.split("/").map(encodeURIComponent).join("/")}`;
}
