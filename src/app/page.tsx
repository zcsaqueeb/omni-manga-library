"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Loader2, RefreshCw, ShieldAlert, Sparkles, Zap } from "lucide-react";
import { AppHeader } from "@/components/app-header";
import { AppFooter } from "@/components/footer";
import { CategoryTabs } from "@/components/category-tabs";
import { MediaGrid } from "@/components/media-grid";
import { AppOverlays } from "@/components/app-overlays";
import { SourcesSheet, OfficialGrid } from "@/components/sources-sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useApp } from "@/store/app-store";
import { CATALOG } from "@/lib/sources/catalog";
import type { Category, MediaItem } from "@/lib/sources/types";

interface PageResp {
  items: MediaItem[];
  total?: number;
  hasMore?: boolean;
  sources?: { id: string; label: string; ok: boolean }[];
}

interface SourceStatus {
  id: string;
  label: string;
  ok: boolean;
  count: number;
  ms?: number;
}

const PAGE_SIZE = 24;

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

const TAB_TITLES: Record<Category, string> = {
  manga: "Popular manga & manhwa",
  comic: "Popular comics",
  book: "Popular books",
  novel: "Popular novels & web fiction",
  audiobook: "Popular audiobooks",
  official: "Official platforms",
};

const SUGGESTIONS: Record<Category, string[]> = {
  manga: ["one piece", "berserk", "solo leveling", "chainsaw man"],
  comic: ["superman", "batman", "spider-man", "judge dredd"],
  book: ["sherlock holmes", "frankenstein", "dracula", "jane eyre"],
  novel: ["primal hunter", "the beginning after the end", "he who fights with monsters"],
  audiobook: ["sherlock holmes", "frankenstein", "dracula", "pride and prejudice"],
  official: [],
};

/** Result snapshot cache — makes tab/search switching feel instant. */
interface Snapshot {
  items: MediaItem[];
  sources: SourceStatus[];
  total: number | null;
  ms: number;
}

const emptyAcc = (): Snapshot => ({ items: [], sources: [], total: null, ms: 0 });

export default function Home() {
  const { tab, query, sourceFilter, lang, adult, disabledSources } = useApp();
  const debouncedQ = useDebounced(query.trim(), 300);
  const searching = debouncedQ.length > 0;

  const [items, setItems] = useState<MediaItem[]>([]);
  const [sources, setSources] = useState<SourceStatus[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [streaming, setStreaming] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);

  const esRef = useRef<EventSource | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const homeCacheRef = useRef<Map<string, PageResp>>(new Map());
  const searchCacheRef = useRef<Map<string, Snapshot>>(new Map());
  const searchRef = useRef<HTMLInputElement | null>(null);

  const optsKey = `${adult ? 1 : 0}|${sourceFilter}|${lang}|${disabledSources.join(",")}`;
  const keyOf = (t: string, sf: string, q: string) => `${t}|${sf}|${q}|${adult ? 1 : 0}|${lang}|${disabledSources.join(",")}`;
  const currentKey = keyOf(tab, sourceFilter, debouncedQ);
  const stale = loadedKey !== currentKey;

  /** Progressive streaming search — every source paints as soon as it answers. */
  const runStream = useCallback(
    (q: string, cat: Category, sf: string, key: string) => {
      esRef.current?.close();
      const t0 = Date.now();
      const es = new EventSource(
        `/api/search/stream?q=${encodeURIComponent(q)}&type=${cat}&limit=36&nsfw=${adult ? 1 : 0}` +
          `&source=${sf !== "all" ? sf : ""}&disabled=${disabledSources.join(",")}&lang=${lang}`,
      );
      esRef.current = es;

      const buckets = new Map<string, MediaItem[]>();
      const acc: Snapshot = emptyAcc();
      const sourceOrder: { id: string; label: string; ok: boolean; ms?: number }[] = [];
      let finished = false;
      setStreaming(true);
      setLoading(true);
      setError(null);
      setItems([]);
      setSources([]);
      setTotal(null);

      /** Rebuild the interleaved grid from per-source buckets (round-robin, non-destructive). */
      const repaint = () => {
        const lists = [...buckets.values()];
        const out: MediaItem[] = [];
        for (let i = 0; out.length < 240; i++) {
          let added = false;
          for (const list of lists) {
            if (list[i]) {
              out.push(list[i]);
              added = true;
            }
          }
          if (!added) break;
        }
        acc.items = out;
        setItems(out);
        setSources(sourceOrder.map((s) => ({ ...s, count: 0 })));
        setLoadedKey(key);
      };

      es.onmessage = (ev) => {
        try {
          const data = JSON.parse(ev.data) as
            | { t: "meta" }
            | { t: "source"; id: string; label: string; ok: boolean; ms: number; items: MediaItem[] }
            | { t: "done"; total: number; ms: number };

          if (data.t === "source") {
            sourceOrder.push({ id: data.id, label: data.label, ok: data.ok, ms: data.ms });
            const seen = new Set<string>();
            for (const item of data.items) {
              if (seen.has(item.id)) continue;
              seen.add(item.id);
              const list = buckets.get(data.id) ?? [];
              list.push(item);
              buckets.set(data.id, list);
            }
            repaint();
          } else if (data.t === "done") {
            finished = true;
            acc.total = data.total;
            acc.ms = Date.now() - t0;
            es.close();
            setStreaming(false);
            setLoading(false);
            setTotal(data.total);
            setElapsed(acc.ms);
            setHasMore(false);
            searchCacheRef.current.set(key, { ...acc, items: [...acc.items], sources: sourceOrder.map((s) => ({ ...s, count: 0 })) });
            if (searchCacheRef.current.size > 30) {
              searchCacheRef.current.delete(searchCacheRef.current.keys().next().value as string);
            }
          }
        } catch {
          /* malformed event — ignore */
        }
      };

      es.onerror = () => {
        // the server closes the stream when done — only treat this as a real
        // failure if nothing was received at all and the stream never finished
        if (finished || buckets.size > 0) {
          es.close();
          setStreaming(false);
          setLoading(false);
          return;
        }
        // give the done event a brief grace period before declaring failure
        setTimeout(() => {
          if (!finished && buckets.size === 0) {
            setError("Connection lost while searching. Please retry.");
          }
          setStreaming(false);
          setLoading(false);
          es.close();
        }, 1200);
      };
    },
    [adult, disabledSources, lang],
  );

  const loadPopular = useCallback(
    async (targetPage: number, append: boolean) => {
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      const fetchKey = keyOf(tab, sourceFilter, "");

      if (append) setLoadingMore(true);
      else setLoading(true);
      setError(null);

      try {
        const params = new URLSearchParams({ type: tab, page: String(targetPage), limit: String(PAGE_SIZE) });
        if (sourceFilter !== "all") params.set("source", sourceFilter);
        params.set("nsfw", adult ? "1" : "0");
        params.set("lang", lang);
        if (disabledSources.length) params.set("disabled", disabledSources.join(","));

        const res = await fetch(`/api/popular?${params}`, { signal: ctrl.signal });
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as PageResp;

        setSources((data.sources ?? []).map((s) => ({ ...s, count: 0 })));
        setTotal(null);
        setHasMore(true);
        setLoadedKey(fetchKey);

        if (append) {
          setItems((prev) => {
            const seen = new Set(prev.map((p) => p.id));
            return [...prev, ...data.items.filter((i) => !seen.has(i.id))];
          });
        } else {
          setItems(data.items);
          homeCacheRef.current.set(`${tab}:${sourceFilter}:${adult ? 1 : 0}:${lang}:${disabledSources.join(",")}`, data);
        }
        setPage(targetPage);
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          setError("Something went wrong reaching the sources. Please retry.");
        }
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [tab, sourceFilter, lang, adult, disabledSources],
  );

  // main effect: search streams / popular loads / cache paints instantly
  useEffect(() => {
    if (tab === "official") {
      setLoading(false);
      setStreaming(false);
      setError(null);
      setLoadedKey(currentKey);
      setItems([]);
      setSources([]);
      esRef.current?.close();
      return;
    }

    if (searching) {
      const cached = searchCacheRef.current.get(currentKey);
      if (cached) {
        esRef.current?.close();
        setItems(cached.items);
        setSources(cached.sources);
        setTotal(cached.total);
        setElapsed(cached.ms);
        setHasMore(false);
        setLoading(false);
        setStreaming(false);
        setError(null);
        setLoadedKey(currentKey);
      } else {
        runStream(debouncedQ, tab, sourceFilter, currentKey);
      }
    } else {
      esRef.current?.close();
      const cached = homeCacheRef.current.get(`${tab}:${sourceFilter}:${adult ? 1 : 0}:${lang}:${disabledSources.join(",")}`);
      if (cached) {
        abortRef.current?.abort();
        setItems(cached.items);
        setSources((cached.sources ?? []).map((s) => ({ ...s, count: 0 })));
        setTotal(null);
        setHasMore(true);
        setPage(1);
        setLoading(false);
        setError(null);
        setLoadedKey(keyOf(tab, sourceFilter, ""));
      } else {
        loadPopular(1, false);
      }
    }
    // main data loading — driven by tab/source/query/language/adult changes
  }, [tab, sourceFilter, debouncedQ, searching, adult, lang, disabledSources, currentKey, runStream, loadPopular]);

  // "/" focuses search
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "/" && document.activeElement?.tagName !== "INPUT" && document.activeElement?.tagName !== "TEXTAREA") {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // close stream on unmount
  useEffect(() => () => esRef.current?.close(), []);

  const loadMore = () => loadPopular(page + 1, true);

  const liveCount = CATALOG.filter((c) => c.adapterId).length;
  const readySources = sources.filter((s) => s.ok).length;
  /** Anything actively fetching — powers the top progress bar & searching pill. */
  const busy = tab !== "official" && (loading || streaming || (stale && searching));

  return (
    <div className="flex min-h-screen flex-col">
      <AppHeader search={searchRef} />

      {/* indeterminate progress bar while search fans out to sources */}
      {busy && <div className="ol-loading-bar h-[3px] w-full shrink-0" aria-hidden />}

      <main className="flex-1">
        <div className="mx-auto max-w-7xl px-3 py-4 sm:px-4 sm:py-6">
          {/* hero — home mode only */}
          {!searching && (
            <section className="mb-5 sm:mb-7" aria-label="Welcome">
              <div className="flex flex-col gap-1.5">
                <h1 className="text-xl font-bold tracking-tight sm:text-3xl">
                  Read &amp; download{" "}
                  <span className="bg-gradient-to-r from-violet-500 to-fuchsia-500 bg-clip-text text-transparent">
                    manga, comics, books, novels &amp; audiobooks
                  </span>
                </h1>
                <p className="max-w-2xl text-xs leading-relaxed text-muted-foreground sm:text-sm">
                  One fast, organized place searching {liveCount}+ live sources — read chapters in
                  your browser with next/prev navigation, listen to audiobooks, or grab CBZ, EPUB, PDF and MP3 files. An 18+
                  switch keeps adult sources hidden until you turn them on.
                </p>
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  <Badge variant="secondary" className="gap-1 rounded-full">
                    <Zap className="size-3 text-primary" aria-hidden />
                    {liveCount} live sources
                  </Badge>
                  <Badge variant="secondary" className="rounded-full">{CATALOG.length} sites catalogued</Badge>
                  <Badge variant="secondary" className="rounded-full">CBZ · EPUB · PDF · TXT · MP3</Badge>
                  <Badge variant="secondary" className="hidden rounded-full sm:inline-flex">
                    Press / to search
                  </Badge>
                </div>
              </div>
            </section>
          )}

          {/* tabs + source filter */}
          <div className="mb-4">
            <CategoryTabs />
          </div>

          {/* status row */}
          <div className="mb-3.5 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold sm:text-base">
              {searching ? (
                <>
                  Results for <span className="text-primary">&ldquo;{debouncedQ}&rdquo;</span>
                  {!stale && total !== null && <span className="ml-1.5 font-normal text-muted-foreground">{total.toLocaleString()} found</span>}
                </>
              ) : (
                TAB_TITLES[tab]
              )}
            </h2>
            {!stale && sources.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5" aria-label="Source health">
                {streaming && (
                  <span className="mr-1 flex items-center gap-1 text-[10px] font-medium text-primary sm:text-[11px]">
                    <Loader2 className="size-3 animate-spin" aria-hidden />
                    {readySources}/{sources.length}
                  </span>
                )}
                {sources.map((s) => (
                  <span key={s.id} className="flex items-center gap-1 text-[10px] text-muted-foreground sm:text-[11px]" title={s.ok ? `${s.count ?? 0} results${s.ms ? ` in ${s.ms}ms` : ""}` : "offline or blocked"}>
                    <span
                      className={`size-1.5 rounded-full ${s.ok ? "bg-emerald-500" : "bg-destructive"}`}
                      aria-hidden
                    />
                    {s.label}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* suggestion chips (home, empty grid state) */}
          {!searching && tab !== "official" && !loading && !stale && items.length === 0 && !error && (
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted-foreground">Try:</span>
              {SUGGESTIONS[tab].map((s) => (
                <Button
                  key={s}
                  size="sm"
                  variant="secondary"
                  className="h-7 rounded-full px-3 text-xs"
                  onClick={() => useApp.getState().setQuery(s)}
                >
                  {s}
                </Button>
              ))}
            </div>
          )}

          {/* 18+ only mode — no adult sources for this category */}
          {adult && !searching && tab !== "official" && !loading && !stale && items.length === 0 && !error && (
            <p className="mb-4 flex items-start gap-2 rounded-xl border border-destructive/25 bg-destructive/5 p-3.5 text-xs leading-relaxed text-muted-foreground sm:text-sm">
              <ShieldAlert className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
              <span>
                18+ only mode is ON — this category has no adult sources yet. Adult &amp; hentai
                sources live mostly in the <strong className="font-semibold">Manga</strong> tab;
                MangaDex titles are filtered to 18+-rated ones.
              </span>
            </p>
          )}

          {/* error banner */}
          {error && (
            <div className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3">
              <p className="flex items-center gap-2 text-sm text-destructive">
                <AlertTriangle className="size-4 shrink-0" aria-hidden />
                {error}
              </p>
              <Button size="sm" variant="outline" className="shrink-0 gap-1.5" onClick={() => (searching ? runStream(debouncedQ, tab, sourceFilter, currentKey) : loadPopular(1, false))}>
                <RefreshCw className="size-3.5" aria-hidden />
                Retry
              </Button>
            </div>
          )}

          {/* “Searching…” pill — visible until the first source paints results */}
          {busy && searching && items.length === 0 && !error && (
            <div className="mb-4 flex justify-center" role="status" aria-live="polite">
              <span className="inline-flex items-center gap-2.5 rounded-full border bg-card/90 px-4 py-2 text-xs text-muted-foreground shadow-sm sm:text-sm">
                <span className="flex items-end gap-1" aria-hidden>
                  <span className="ol-dot size-1.5 rounded-full bg-primary" style={{ animationDelay: "0ms" }} />
                  <span className="ol-dot size-1.5 rounded-full bg-primary" style={{ animationDelay: "140ms" }} />
                  <span className="ol-dot size-1.5 rounded-full bg-primary" style={{ animationDelay: "280ms" }} />
                </span>
                Searching {sources.length > 0 ? `${readySources}/${sources.length} ` : ""}sources…
              </span>
            </div>
          )}

          {/* grid */}
          {tab === "official" ? (
            <OfficialGrid />
          ) : (
            <MediaGrid items={stale ? [] : items} loading={loading || stale} />
          )}

          {/* empty search result */}
          {tab !== "official" && !loading && !stale && !error && items.length === 0 && searching && (
            <p className="py-10 text-center text-sm text-muted-foreground">
              Nothing found for &ldquo;{debouncedQ}&rdquo; in this category. Try a different spelling
              or switch sources.
            </p>
          )}

          {/* load more */}
          {tab !== "official" && !loading && !stale && !error && items.length > 0 && !searching && (
            <div className="mt-7 flex justify-center">
              {hasMore ? (
                <Button
                  variant="outline"
                  className="min-w-40 gap-2 rounded-full"
                  onClick={loadMore}
                  disabled={loadingMore}
                >
                  {loadingMore && <Loader2 className="size-4 animate-spin" aria-hidden />}
                  {loadingMore ? "Loading…" : "Load more"}
                </Button>
              ) : (
                <p className="text-xs text-muted-foreground">— end of results —</p>
              )}
            </div>
          )}

          {/* search finished note */}
          {searching && !streaming && !stale && items.length > 0 && (
            <p className="mt-6 flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground">
              <Sparkles className="size-3 text-primary" aria-hidden />
              {readySources}/{sources.length} sources answered{elapsed ? ` in ${(elapsed / 1000).toFixed(1)}s` : ""}
            </p>
          )}
        </div>
      </main>

      <AppFooter />

      {/* overlays */}
      <AppOverlays />
    </div>
  );
}
