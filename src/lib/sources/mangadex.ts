import { fetchJson } from "@/lib/http";
import type {
  ChapterEntry,
  Details,
  MediaItem,
  SearchResult,
  SourceAdapter,
} from "./types";

const API = "https://api.mangadex.org";
const COVERS = "https://uploads.mangadex.org/covers";

const RATINGS_SAFE = ["safe", "suggestive"];
const RATINGS_ALL = ["safe", "suggestive", "erotica", "pornographic"];
const NSFW_RATINGS = new Set(["erotica", "pornographic"]);

const loc = (d: Record<string, string> | null | undefined, lang = "en") =>
  d ? d[lang] || Object.values(d)[0] || undefined : undefined;

interface MDManga {
  id: string;
  attributes: {
    title: Record<string, string>;
    altTitles: Record<string, string>[];
    description: Record<string, string>;
    status: string;
    year: number | null;
    contentRating?: string;
    tags: { attributes: { name: Record<string, string>; group: string } }[];
  };
  relationships: { type: string; attributes?: Record<string, unknown> }[];
}

function coverOf(item: MDManga): string | undefined {
  const rel = item.relationships?.find((r) => r.type === "cover_art");
  const fileName = rel?.attributes?.fileName as string | undefined;
  return fileName ? `${COVERS}/${item.id}/${fileName}.256.jpg` : undefined;
}

function toItem(m: MDManga): MediaItem {
  const alt = m.attributes.altTitles?.map((t) => Object.values(t)[0]) ?? [];
  const rating = m.attributes.contentRating;
  return {
    id: `mangadex:${m.id}`,
    type: "manga",
    source: "mangadex",
    sourceLabel: "MangaDex",
    title: loc(m.attributes.title) || alt[0] || "Untitled",
    subtitle: alt.find((t) => t !== loc(m.attributes.title)),
    cover: coverOf(m),
    year: m.attributes.year ?? undefined,
    tags: (m.attributes.tags ?? [])
      .filter((t) => t.attributes.group === "genre")
      .slice(0, 4)
      .map((t) => loc(t.attributes.name) || "")
      .filter(Boolean),
    description: loc(m.attributes.description)?.slice(0, 600),
    externalUrl: `https://mangadex.org/title/${m.id}`,
    nsfw: rating ? NSFW_RATINGS.has(rating) : undefined,
  };
}

interface MDChapter {
  id: string;
  attributes: {
    chapter: string | null;
    volume: string | null;
    title: string | null;
    translatedLanguage: string;
    pages: number;
    publishAt: string;
    externalUrl: string | null;
    /** true → the chapter was removed / region-blocked upstream — dead link. */
    isUnavailable?: boolean;
  };
  relationships: { type: string; attributes?: { name?: string } }[];
}

async function query(params: Record<string, string | number>, nsfw = false): Promise<SearchResult> {
  const qs = new URLSearchParams();
  const page = Number(params.page ?? 1) || 1;
  for (const [k, v] of Object.entries(params)) {
    if (k !== "page") qs.set(k, String(v)); // MangaDex rejects a `page` param — offset only
  }
  for (const r of nsfw ? RATINGS_ALL : RATINGS_SAFE) qs.append("contentRating[]", r);
  qs.set("includes[]", "cover_art");
  qs.set("hasAvailableChapters", "true");
  const data = await fetchJson<{ data: MDManga[]; total: number }>(`${API}/manga?${qs}`, {
    timeoutMs: 12_000,
  });
  return {
    items: data.data.map(toItem),
    total: data.total ?? data.data.length,
    page,
    hasMore: (Number(params.offset ?? 0) || 0) + data.data.length < (data.total ?? 0),
  };
}

export const mangadex: SourceAdapter = {
  id: "mangadex",
  label: "MangaDex",
  type: "manga",
  siteUrl: "https://mangadex.org",
  // Mixed safe/erotica/pornographic catalogue with per-item content ratings —
  // in 18+-only mode we keep it in the pool and filter to nsfw-rated titles.
  perItemRatings: true,

  async search(q, page, limit, nsfw) {
    return query(
      {
        title: q.slice(0, 100),
        limit,
        page,
        offset: (page - 1) * limit,
        "order[relevance]": "desc",
      },
      nsfw,
    );
  },

  async popular(page, limit, nsfw) {
    return query({ limit, page, offset: (page - 1) * limit, "order[followedCount]": "desc" }, !!nsfw);
  },

  /** Hoisted standalone resolver — kept as a property so the adapter reports
   * itself as readable everywhere (search stamps, download routing). */
  chapterPages,

  async details(realId) {
    // Feed fetch with graceful widening:
    //  1. primary pass asks for the site's main languages,
    //  2. empty → retry with EVERY language (some titles only exist in
    //     es-la / vi / pt-br… — those used to show "Nothing published here yet"),
    //  3. every content rating is allowed — the user already opened this exact
    //     title, and restricting ratings here blanked 18+ chapter feeds.
    const feedUrl = (langs: string) =>
      `${API}/manga/${realId}/feed?${langs}order[chapter]=desc&order[volume]=desc&limit=500&includes[]=scanlation_group` +
      `&contentRating[]=safe&contentRating[]=suggestive&contentRating[]=erotica&contentRating[]=pornographic`;
    const fetchFeed = (langs: string) =>
      fetchJson<{ data: MDChapter[] }>(feedUrl(langs), { timeoutMs: 15_000 }).catch(
        () => ({ data: [] as MDChapter[] }),
      );

    const [mRes, feed] = await Promise.all([
      fetchJson<{ data: MDManga }>(`${API}/manga/${realId}?includes[]=cover_art&includes[]=author&includes[]=artist`),
      (async () => {
        const primary = await fetchFeed(
          "translatedLanguage[]=en&translatedLanguage[]=ja&translatedLanguage[]=es&translatedLanguage[]=es-la&translatedLanguage[]=pt-br&",
        );
        if (primary.data.length) return primary;
        return fetchFeed(""); // every language — better than an empty list
      })(),
    ]);

    const m = mRes.data;
    const base = toItem(m);
    const authors = m.relationships
      .filter((r) => (r.type === "author" || r.type === "artist") && r.attributes?.name)
      .map((r) => r.attributes!.name as string);

    // Label dedupe across languages — when the same label exists in several
    // languages (untitled chapters all become "Ch. 5"), prefer the English
    // entry so normalizeChapters receives it for its EN-first number dedupe.
    const byLabel = new Map<string, ChapterEntry>();
    const order: string[] = [];
    for (const c of feed.data) {
      // Dead links (removed/unavailable on MangaDex AND the publisher) are useless.
      if (c.attributes.isUnavailable) continue;
      const num = c.attributes.chapter;
      const label = num
        ? `Ch. ${num}${c.attributes.title ? ` — ${c.attributes.title}` : ""}`
        : c.attributes.title || "Oneshot";
      // Official chapters (MangaPlus etc.) carry externalUrl: keep them as
      // direct links to the publisher reader instead of dropping them —
      // dropping them made huge official titles (Naruto, One Piece…) show
      // an empty chapter list / "Nothing published here yet".
      const href = c.attributes.externalUrl ?? undefined;
      const entry: ChapterEntry = {
        id: `mangadex-ch:${c.id}`,
        label,
        lang: c.attributes.translatedLanguage.toUpperCase(),
        pages: c.attributes.pages || undefined,
        group: c.relationships?.find((r) => r.type === "scanlation_group")?.attributes?.name,
        date: c.attributes.publishAt?.slice(0, 10),
        ...(href ? { href } : {}),
      };
      const prev = byLabel.get(label);
      if (!prev) {
        byLabel.set(label, entry);
        order.push(label);
      } else {
        // Same label twice (several groups/languages): a readable in-app
        // chapter always beats a publisher link, then EN beats the rest —
        // this is what keeps "Open"-only rows out of the chapter list.
        const prevInternal = !prev.href;
        const entryInternal = !entry.href;
        const better =
          prevInternal !== entryInternal
            ? entryInternal
            : entry.lang === "EN" && prev.lang !== "EN";
        if (better) byLabel.set(label, entry);
      }
    }
    const chapters: ChapterEntry[] = order.map((l) => byLabel.get(l)!);

    return {
      ...base,
      cover: base.cover ? base.cover.replace(".256.jpg", ".512.jpg") : undefined,
      authors: [...new Set(authors)].slice(0, 4),
      status: m.attributes.status?.replace(/^\w/, (s) => s.toUpperCase()),
      // ascending for prev/next navigation — keep the NEWEST 300, not the oldest
      chapters: chapters.reverse().slice(-300),
      readable: true,
      description: loc(m.attributes.description)?.slice(0, 1200),
    };
  },
};

/** Resolve a chapter into readable/downloadable page URLs. */
export async function chapterPages(chapterId: string): Promise<string[]> {
  const data = await fetchJson<{
    baseUrl: string;
    chapter: { hash: string; data: string[]; dataSaver: string[] };
  }>(`${API}/at-home/server/${chapterId}`, { timeoutMs: 12_000 });
  if (!data?.baseUrl || !data.chapter?.data?.length) return [];
  return data.chapter.data.map((p) => `${data.baseUrl}/data/${data.chapter.hash}/${p}`);
}
