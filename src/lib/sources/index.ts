import type { Category, MediaItem, SourceAdapter } from "./types";
import { mangadex } from "./mangadex";
import { archive, archiveManga, archiveBooks } from "./archive";
import { gutenberg } from "./gutenberg";
import { openlibrary } from "./openlibrary";
import { standardebooks } from "./standardebooks";
import { getcomics } from "./comics";
import { weebcentral, mangahere } from "./aggregators";
import { MADARA_INSTANCES } from "./madara";
import { GENERIC_INSTANCES } from "./generic";
import { royalroad, lightnovelpub, novelupdates, scribblehub, novelbin, mtnovel, ao3, fanfiction } from "./novels";
import { webnovel } from "./webnovel";
import { wattpad } from "./wattpad";
import { wikisource } from "./wikisource";
import { librivox } from "./librivox";
import { iaAudio } from "./iaaudio";
import { sourceSearchCache, sourcePopularCache, TTL } from "@/lib/cache";

export const SOURCES: SourceAdapter[] = [
  mangadex,
  ...MADARA_INSTANCES,
  ...GENERIC_INSTANCES,
  weebcentral,
  mangahere,
  getcomics,
  archiveManga,
  archive,
  archiveBooks,
  gutenberg,
  openlibrary,
  standardebooks,
  royalroad,
  lightnovelpub,
  novelupdates,
  scribblehub,
  novelbin,
  mtnovel,
  ao3,
  fanfiction,
  wattpad,
  webnovel,
  wikisource,
  librivox,
  iaAudio,
];

export const SOURCES_BY_TYPE: Record<Category, SourceAdapter[]> = {
  manga: SOURCES.filter((s) => s.type === "manga"),
  comic: SOURCES.filter((s) => s.type === "comic"),
  book: SOURCES.filter((s) => s.type === "book"),
  novel: SOURCES.filter((s) => s.type === "novel"),
  audiobook: SOURCES.filter((s) => s.type === "audiobook"),
  official: [],
};

export function getSource(sourceId: string): SourceAdapter | undefined {
  return SOURCES.find((s) => s.id === sourceId);
}

export function sourceCatalog() {
  return SOURCES.map((s) => ({
    id: s.id,
    label: s.label,
    type: s.type,
    siteUrl: s.siteUrl,
    nsfw: s.nsfw ?? false,
    beta: s.beta ?? false,
    note: s.note,
  }));
}

export interface UnifiedResult {
  items: MediaItem[];
  total: number;
  page: number;
  hasMore: boolean;
  sources: { id: string; label: string; count: number; ok: boolean }[];
}

export interface SearchOptions {
  /** ids of sources the user turned off */
  disabled?: string[];
  /** 18+ switch — when false, nsfw-flagged sources are excluded entirely */
  nsfw?: boolean;
  /** ISO 639-1 language filter ("hi", "ur", "en"…) — sources that support
   * it (LibriVox, IA Audio, Gutenberg, Open Library, IA Books) filter results;
   * the rest ignore it. "all"/undefined = no filter. */
  lang?: string;
}

function pickAdapters(type: Category, sourceFilter?: string, opts: SearchOptions = {}): SourceAdapter[] {
  let pool = SOURCES_BY_TYPE[type] ?? [];
  if (sourceFilter && sourceFilter !== "all") pool = pool.filter((s) => s.id === sourceFilter);
  if (opts.disabled?.length) pool = pool.filter((s) => !opts.disabled!.includes(s.id));
  // 18+ switch: OFF hides adult sources entirely; ON shows ONLY adult content —
  // dedicated 18+ sites plus per-item-rated sources (filtered to nsfw titles).
  pool = opts.nsfw
    ? pool.filter((s) => s.nsfw || s.perItemRatings)
    : pool.filter((s) => !s.nsfw);
  return pool;
}

/** Stamp every item with the source's read capability so the UI can show
 * "Read" vs "Download only" without an extra details request. Also stamps
 * the 18+ flag for dedicated adult sources whose scrapers may omit it. */
function stampReadable(adapter: SourceAdapter, items: MediaItem[]): MediaItem[] {
  const readable = typeof adapter.chapterPages === "function";
  return items.map((i) => {
    let out = i;
    if (out.readable !== readable) out = { ...out, readable };
    if (adapter.nsfw && !out.nsfw) out = { ...out, nsfw: true };
    return out;
  });
}

/** Per-source watchdog: a hanging source must not delay the whole search. */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, rej) => setTimeout(() => rej(new Error("source timeout")), ms)),
  ]);
}

/** Round-robin interleave by source so every site stays visible on the first screen. */
function interleave(items: MediaItem[]): MediaItem[] {
  const bySource = new Map<string, MediaItem[]>();
  for (const item of items) {
    const list = bySource.get(item.source) ?? [];
    list.push(item);
    bySource.set(item.source, list);
  }
  const out: MediaItem[] = [];
  let added = true;
  while (added) {
    added = false;
    for (const list of bySource.values()) {
      const next = list.shift();
      if (next) {
        out.push(next);
        added = true;
      }
    }
  }
  return out;
}

/* ─────────── per-source shared cache: ONE fetch serves ALL users ─────────── */

/**
 * Cached per-source search. The cache unit is a single source's answer, so
 * users with different personal source switches still share the same cached
 * payload — personal filtering happens AFTER the cache, at merge time.
 * Transient failures get ONE fast in-process retry; persistent failures get a
 * 10s negative cache (see TTL.negative) so a hiccup never sticks.
 */
async function cachedSourceSearch(
  adapter: SourceAdapter,
  q: string,
  page: number,
  perSource: number,
  nsfw?: boolean,
  lang?: string,
) {
  const key = `src:${adapter.id}:${q.trim().toLowerCase()}:${page}:${nsfw ? 1 : 0}:${lang ?? "all"}`;
  return sourceSearchCache.wrap(key, TTL.sourceSearch, async () => {
    let lastErr: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return await withTimeout(adapter.search(q, page, perSource, nsfw, lang), 9_000);
      } catch (err) {
        lastErr = err;
        // watchdog timeouts already burned 9s — retrying them doubles the
        // wait for everyone; only quick failures get one fast retry
        if (err instanceof Error && err.message === "source timeout") break;
        if (attempt === 0) await new Promise((r) => setTimeout(r, 300));
      }
    }
    sourceSearchCache.set(key, { items: [], total: 0, page, hasMore: false }, TTL.negative);
    throw lastErr instanceof Error ? lastErr : new Error("source failed");
  });
}

/** Cached per-source popular row — shared by every visitor of the home grid.
 * nsfw mode gets its own cache slot (adult ratings differ from safe ones).
 * Dead sources are negative-cached for just 10s (see TTL.negative). */
async function cachedSourcePopular(adapter: SourceAdapter, page: number, perSource: number, nsfw?: boolean, lang?: string) {
  const key = `pop:${adapter.id}:${page}:${nsfw ? 1 : 0}:${lang ?? "all"}`;
  return sourcePopularCache.wrap(key, TTL.sourcePopular, async () => {
    let lastErr: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return await withTimeout(
          (adapter.popular ?? adapter.search.bind(adapter, ""))(page, perSource, nsfw, lang),
          9_000,
        );
      } catch (err) {
        lastErr = err;
        if (err instanceof Error && err.message === "source timeout") break;
        if (attempt === 0) await new Promise((r) => setTimeout(r, 300));
      }
    }
    sourcePopularCache.set(key, { items: [], total: 0, page, hasMore: false }, TTL.negative);
    throw lastErr instanceof Error ? lastErr : new Error("source failed");
  });
}

export async function unifiedSearch(
  type: Category,
  q: string,
  page: number,
  limit: number,
  sourceFilter?: string,
  opts: SearchOptions = {},
): Promise<UnifiedResult> {
  // Cache pool ignores personal switches — only category/source/18+ shape it.
  const pool = pickAdapters(type, sourceFilter, { nsfw: opts.nsfw });
  const perSource = Math.max(6, Math.ceil(limit / Math.max(1, pool.length)) + 4);

  const settled = await Promise.allSettled(
    pool.map((a) => cachedSourceSearch(a, q, page, perSource, opts.nsfw, opts.lang)),
  );

  const items: MediaItem[] = [];
  const sourceStats: UnifiedResult["sources"] = [];
  let total = 0;
  let hasMore = false;

  settled.forEach((res, i) => {
    const adapter = pool[i];
    // personal switches applied here — never inside the cache
    if (opts.disabled?.includes(adapter.id)) return;
    if (res.status === "fulfilled") {
      sourceStats.push({ id: adapter.id, label: adapter.label, count: res.value.items.length, ok: true });
      total += res.value.total;
      hasMore = hasMore || res.value.hasMore;
      items.push(...stampReadable(adapter, res.value.items));
    } else {
      sourceStats.push({ id: adapter.id, label: adapter.label, count: 0, ok: false });
    }
  });

  const mixed = interleave(items).filter((i) => (opts.nsfw ? !!i.nsfw : !i.nsfw));
  return { items: mixed.slice(0, limit), total, page, hasMore, sources: sourceStats };
}

export async function cachedSearch(
  type: Category,
  q: string,
  page: number,
  limit: number,
  sourceFilter?: string,
  opts: SearchOptions = {},
): Promise<UnifiedResult> {
  // NOTE: personal "disabled" switches are deliberately NOT part of the key —
  // every user shares one cached aggregation; filtering happens per request.
  return unifiedSearch(type, q, page, limit, sourceFilter, opts);
}

/* ───────────────────── streaming search: results arrive source-by-source ───────────────────── */

export type StreamEvent =
  | { t: "meta"; sources: { id: string; label: string; beta?: boolean }[] }
  | { t: "source"; id: string; label: string; ok: boolean; ms: number; items: MediaItem[] }
  | { t: "done"; total: number; ms: number };

/**
 * Fire every source at once, but resolve the stream as soon as each individual
 * source answers — the UI paints progressively instead of waiting for the
 * slowest site. Deduplication/interleaving happens client-side.
 */
export async function* streamSearch(
  type: Category,
  q: string,
  limit: number,
  sourceFilter?: string,
  opts: SearchOptions = {},
): AsyncGenerator<StreamEvent> {
  const started = Date.now();
  // Cache pool ignores personal switches; per-source answers are shared.
  const adapters = pickAdapters(type, sourceFilter, { nsfw: opts.nsfw });
  const perSource = Math.max(6, Math.ceil(limit / Math.max(1, adapters.length)) + 4);

  yield { t: "meta", sources: adapters.map((a) => ({ id: a.id, label: a.label, beta: a.beta })) };

  const tasks = adapters.map(async (adapter) => {
    const t0 = Date.now();
    try {
      const res = await cachedSourceSearch(adapter, q, 1, perSource, opts.nsfw, opts.lang);
      const items = stampReadable(
        adapter,
        (opts.nsfw ? res.items.filter((i) => i.nsfw) : res.items.filter((i) => !i.nsfw)).slice(0, perSource),
      );
      return { adapter, ok: true, ms: Date.now() - t0, items };
    } catch {
      return { adapter, ok: false, ms: Date.now() - t0, items: [] as MediaItem[] };
    }
  });

  let total = 0;
  for (const task of tasks) {
    const { adapter, ok, ms, items } = await task;
    if (ok) total += items.length;
    yield { t: "source", id: adapter.id, label: adapter.label, ok, ms, items };
  }
  yield { t: "done", total, ms: Date.now() - started };
}

export async function unifiedPopular(
  type: Category,
  page: number,
  limit: number,
  opts: SearchOptions = {},
): Promise<{ items: MediaItem[]; sources: { id: string; label: string; ok: boolean }[] }> {
  // Shared cache pool — personal switches applied after the cache.
  const adapters = pickAdapters(type, undefined, { nsfw: opts.nsfw });
  const perSource = Math.max(8, Math.ceil(limit / Math.max(1, adapters.length)) + 4);

  const settled = await Promise.allSettled(
    adapters.map((a) => cachedSourcePopular(a, page, perSource, opts.nsfw, opts.lang)),
  );

  const items: MediaItem[] = [];
  const sources: { id: string; label: string; ok: boolean }[] = [];
  settled.forEach((res, i) => {
    const a = adapters[i];
    if (opts.disabled?.includes(a.id)) return;
    if (res.status === "fulfilled") {
      sources.push({ id: a.id, label: a.label, ok: true });
      items.push(...stampReadable(a, res.value.items));
    } else {
      sources.push({ id: a.id, label: a.label, ok: false });
    }
  });

  return { items: interleave(items).filter((i) => (opts.nsfw ? !!i.nsfw : !i.nsfw)).slice(0, limit), sources };
}

export type { Category, MediaItem, Details, ChapterEntry, SearchResult, SourceAdapter } from "./types";
