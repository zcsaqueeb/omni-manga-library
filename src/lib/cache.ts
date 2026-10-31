/**
 * Central shared cache layer.
 *
 * Everything here lives in the server process, so ONE fetch serves ALL
 * users: user A opens a manga → details/chapters/pages land in these caches;
 * user B opening the same manga is served instantly from memory without a
 * single upstream request. Expired entries are still served immediately
 * while a fresh copy refreshes in the background (stale-while-revalidate),
 * so content only re-fetches when necessary — and never blocks a reader.
 */

import type { Details, ChapterPayload, SearchResult } from "./sources/types";

interface Entry<T> {
  value: T;
  expires: number;
  stored: number;
}

export class TTLCache<T = unknown> {
  private store = new Map<string, Entry<T>>();
  private inflight = new Map<string, Promise<T>>();
  private readonly max: number;
  /** counters — exposed via /api/cache to show cross-user sharing */
  hits = 0;
  misses = 0;
  backgroundRefreshes = 0;

  constructor(maxEntries = 500) {
    this.max = maxEntries;
  }

  get size(): number {
    return this.store.size;
  }

  get inflightCount(): number {
    return this.inflight.size;
  }

  get(key: string): T | undefined {
    const hit = this.store.get(key);
    if (!hit) return undefined;
    // refresh LRU position
    this.store.delete(key);
    this.store.set(key, hit);
    return hit.value;
  }

  peek(key: string): { value: T; stale: boolean } | undefined {
    const hit = this.store.get(key);
    if (!hit) return undefined;
    return { value: hit.value, stale: hit.expires < Date.now() };
  }

  set(key: string, value: T, ttlMs: number) {
    if (this.store.size >= this.max) {
      const oldest = this.store.keys().next().value;
      if (oldest) this.store.delete(oldest);
    }
    this.store.set(key, { value, expires: Date.now() + ttlMs, stored: Date.now() });
  }

  delete(key: string) {
    this.store.delete(key);
  }

  /**
   * Resolve a value through the cache. While a fetch is in flight, concurrent
   * callers (even different users) share the same promise — the upstream site
   * is hit exactly once. Expired values are served instantly while a fresh
   * copy loads in the background (stale-while-revalidate).
   *
   * `ttlFor` lets the caller pick a shorter TTL for weak results — e.g. an
   * empty chapter list is only cached for a minute, so a transient upstream
   * hiccup never locks every user out of a title for the full TTL.
   */
  async wrap(key: string, ttlMs: number, loader: () => Promise<T>, ttlFor?: (value: T) => number): Promise<T> {
    const fresh = this.store.get(key);
    if (fresh && fresh.expires >= Date.now()) {
      this.hits++;
      return fresh.value;
    }
    if (fresh) {
      // stale-but-present: counted as a hit (user saw content with zero wait)
      this.hits++;
      this.backgroundRefreshes++;
    } else {
      this.misses++;
    }

    const pending = this.inflight.get(key);
    if (pending) return pending;

    const p = (async () => {
      try {
        const value = await loader();
        this.set(key, value, ttlFor ? ttlFor(value) : ttlMs);
        return value;
      } catch (err) {
        // on failure, serve stale data if we have it
        const stale = this.store.get(key);
        if (stale) return stale.value;
        throw err;
      } finally {
        this.inflight.delete(key);
      }
    })();

    this.inflight.set(key, p);

    // stale-while-revalidate: serve old value immediately, refresh behind it
    if (fresh && fresh.expires < Date.now()) {
      const staleValue = fresh.value;
      p.catch(() => {});
      return staleValue;
    }

    return p;
  }
}

/* ────────────────────────── shared named caches ────────────────────────── */

/** Per-source search results — the unit that is shared across ALL users
 * regardless of their personal source on/off switches (merging happens
 * after the cache, per request). */
export const sourceSearchCache = new TTLCache<SearchResult>(2000);

/** Per-source "popular" rows, shared across users for the home grids. */
export const sourcePopularCache = new TTLCache<SearchResult>(300);

/** Item details + chapter lists (manga/comic/book/novel detail sheets). */
export const detailsCache = new TTLCache<Details>(600);

/** Reader page URL lists — chapters are immutable once published, so these
 * are kept for hours and refreshed in the background only when needed. */
export const pagesCache = new TTLCache<ChapterPayload>(500);

/** TTL presets — "refresh only when necessary". */
export const TTL = {
  sourceSearch: 10 * 60_000, // 10 min
  sourcePopular: 15 * 60_000, // 15 min
  details: 30 * 60_000, // 30 min (+ background SWR refresh)
  pages: 6 * 60 * 60_000, // 6 h — chapter page lists barely ever change
  /** Failed/empty results are remembered for just 10 seconds: a hiccup can
   * never lock users out for a minute, let alone half an hour — the next
   * request retries the source for real. */
  negative: 10_000,
} as const;

export interface CacheStats {
  name: string;
  entries: number;
  hits: number;
  misses: number;
  inflight: number;
  backgroundRefreshes: number;
}

export function allCacheStats(): CacheStats[] {
  const named: [string, TTLCache][] = [
    ["sourceSearch", sourceSearchCache],
    ["sourcePopular", sourcePopularCache],
    ["details", detailsCache],
    ["pages", pagesCache],
  ];
  return named.map(([name, c]) => ({
    name,
    entries: c.size,
    hits: c.hits,
    misses: c.misses,
    inflight: c.inflightCount,
    backgroundRefreshes: c.backgroundRefreshes,
  }));
}
