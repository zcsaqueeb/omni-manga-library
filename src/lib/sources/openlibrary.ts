import { fetchJson } from "@/lib/http";
import { languageDef } from "@/lib/languages";
import type {
  ChapterEntry,
  Details,
  MediaItem,
  SearchResult,
  SourceAdapter,
} from "./types";

const OL = "https://openlibrary.org";
const IA_DL = "https://archive.org/download";

interface OLDoc {
  key: string;
  title: string;
  author_name?: string[];
  cover_i?: number;
  first_publish_year?: number;
  ia?: string[];
  edition_count?: number;
  first_sentence?: string[];
}

const FIELDS = "key,title,author_name,cover_i,first_publish_year,ia,edition_count,first_sentence";

function toItem(d: OLDoc): MediaItem {
  const workId = d.key.replace("/works/", "");
  return {
    id: `openlibrary:${workId}`,
    type: "book",
    source: "openlibrary",
    sourceLabel: "Open Library",
    title: d.title,
    subtitle: d.author_name?.slice(0, 2).join(", "),
    cover: d.cover_i ? `https://covers.openlibrary.org/b/id/${d.cover_i}-M.jpg` : undefined,
    year: d.first_publish_year,
    tags: d.edition_count ? [`${d.edition_count} editions`] : undefined,
    externalUrl: `https://openlibrary.org/works/${workId}`,
  };
}

async function run(params: Record<string, string>, page: number, limit: number): Promise<SearchResult> {
  const qs = new URLSearchParams({ ...params, limit: String(limit), page: String(page), fields: FIELDS });
  const data = await fetchJson<{ docs: OLDoc[]; numFound: number }>(`${OL}/search.json?${qs}`, {
    timeoutMs: 13_000,
  });
  return {
    items: (data.docs ?? []).map(toItem),
    total: data.numFound ?? 0,
    page,
    hasMore: page * limit < (data.numFound ?? 0),
  };
}

export const openlibrary: SourceAdapter = {
  id: "openlibrary",
  label: "Open Library",
  type: "book",
  siteUrl: "https://openlibrary.org",

  async search(q, page, limit, _nsfw, lang) {
    const def = languageDef(lang);
    return run({ q: `${q.slice(0, 100)}${def ? ` AND language:(${def.ol})` : ""}` }, page, limit);
  },

  async popular(page, limit, _nsfw, lang) {
    // "the classics" heuristic — highly editioned public-domain works
    const def = languageDef(lang);
    return run({ q: `subject:classics${def ? ` AND language:(${def.ol})` : ""}` }, page, limit);
  },

  async details(realId) {
    const [work, editions] = await Promise.all([
      fetchJson<{ title: string; description?: string | { value: string }; subjects?: string[]; authors?: { author: { key: string } }[] }>(
        `${OL}/works/${realId}.json`,
      ).catch(() => ({ title: realId, description: undefined, subjects: [] })),
      fetchJson<{ entries?: { ia?: string[]; title?: string }[] }>(
        `${OL}/works/${realId}/editions.json?limit=50`,
      ).catch(() => ({ entries: [] })),
    ]);

    const desc =
      typeof work.description === "string"
        ? work.description
        : work.description?.value;

    // Free (non-lending) IA scans → downloadable files
    const chapters: ChapterEntry[] = [];
    const seen = new Set<string>();
    for (const e of editions.entries ?? []) {
      const ocaid = e.ia?.[0];
      if (!ocaid || seen.has(ocaid)) continue;
      seen.add(ocaid);
      for (const [label, tail, ext] of [
        ["PDF scan", ".pdf", "pdf"],
        ["EPUB", ".epub", "epub"],
        ["Full text", "_djvu.txt", "txt"],
      ] as const) {
        chapters.push({
          id: `openlibrary-file:${ocaid}:${tail}`,
          label: `${label} — ${ocaid}`,
          file: { ext },
        });
      }
      break; // first free scan is enough
    }

    return {
      id: `openlibrary:${realId}`,
      type: "book",
      source: "openlibrary",
      sourceLabel: "Open Library",
      title: work.title,
      cover: undefined,
      description: desc?.slice(0, 1200) || "Open Library catalogue work.",
      authors: [],
      tags: work.subjects?.slice(0, 4),
      externalUrl: `https://openlibrary.org/works/${realId}`,
      chapters,
      readable: false,
    };
  },
}

/** Resolve an Open Library IA file entry to its archive.org download URL. */
export function olFileUrl(ocaid: string, tail: string): string {
  return `${IA_DL}/${encodeURIComponent(ocaid)}/${encodeURIComponent(ocaid)}${tail}`;
}
