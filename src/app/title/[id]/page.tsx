"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowDownUp,
  ArrowLeft,
  BookOpen,
  Calendar,
  ChevronLast,
  Download,
  ExternalLink,
  Headphones,
  Heart,
  Info,
  Loader2,
  Search,
  ShieldAlert,
  User,
} from "lucide-react";
import { formatChapterNumber } from "@/lib/chapter-order";
import { toast } from "sonner";
import { AppHeader } from "@/components/app-header";
import { AppFooter } from "@/components/footer";
import { AppOverlays } from "@/components/app-overlays";
import { MediaCard, MediaCardSkeleton } from "@/components/media-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { readPreDetail } from "@/lib/nav";
import { downloadChapter, downloadFile } from "@/lib/download";
import { proxiedImg, useApp } from "@/store/app-store";
import type { ChapterEntry, Details, MediaItem } from "@/lib/sources/types";

/** Chapters rendered before "Show all" — lists stay fast even for 1000+ chapter manga. */
const CHAPTER_WINDOW = 60;

/** File types the in-browser reader can open from file sources (CBZ→images, PDF→viewer, TXT→text). */
const READABLE_FILE_EXTS = ["cbz", "pdf", "txt"];

type FallbackPhase = "idle" | "searching" | "loading" | "ready" | "none";

/**
 * Auto-fallback engine — the "no dead ends" layer.
 *
 * Triggers when the opened source can't really be read:
 *  - zero chapters (nothing published, or a temporary upstream hiccup), or
 *  - "official only" — nearly every entry is just a link to the publisher
 *    (MangaPlus etc. expose only the first few + newest chapters), so the
 *    in-app reading experience would be nearly empty.
 *
 * It then searches every other source carrying the same title, auto-loads
 * the best readable one's details, and surfaces the alternatives grid so the
 * user stays in control. One search feeds both the inline chapters and grid.
 */
function useChapterFallback(details: Details | null | undefined) {
  const [phase, setPhase] = useState<FallbackPhase>("idle");
  const [alternatives, setAlternatives] = useState<MediaItem[] | null>(null);
  const [fallback, setFallback] = useState<Details | null>(null);

  useEffect(() => {
    const hrefCount = details ? details.chapters.filter((c) => c.href).length : 0;
    const internalCount = details?.readable ? details.chapters.length - hrefCount : 0;
    const officialOnly = !!details?.readable && hrefCount >= 5 && internalCount < 3;
    const shouldFallback = !!details && (details.chapters.length === 0 || officialOnly);
    if (!shouldFallback) {
      setPhase("idle");
      setAlternatives(null);
      setFallback(null);
      return;
    }
    let cancelled = false;
    setPhase("searching");
    setAlternatives(null);
    setFallback(null);
    (async () => {
      try {
        const cleanTitle = details.title.replace(/\s*\([^)]*\)\s*/g, " ").trim().slice(0, 80);
        const res = await fetch(
          `/api/search?q=${encodeURIComponent(cleanTitle)}&type=${details.type}&limit=24`,
        );
        const data: { items?: MediaItem[] } = res.ok ? await res.json() : {};
        const alts = (data.items ?? []).filter((i) => i.source !== details.source);
        if (cancelled) return;

        // Rank by how well the title matches: exact > starts-with > contains,
        // with a penalty for doujinshi side-works when hunting the main series.
        const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
        const target = norm(cleanTitle);
        const dj = (s: string) => /\b(?:dj|doujinshi)\b/.test(norm(s));
        const score = (i: MediaItem) => {
          const t = norm(i.title);
          const pen = dj(i.title) && !dj(cleanTitle) ? 25 : 0;
          if (t === target) return 100 - pen;
          if (t.startsWith(target)) return 60 - pen;
          if (t.includes(target)) return 40 - pen;
          return 10 - pen;
        };
        const ranked = [...alts].sort(
          (a, b) =>
            score(b) - score(a) ||
            Number(!!b.readable) - Number(!!a.readable),
        );
        setAlternatives(ranked.slice(0, 12));
        const candidates = ranked.filter((i) => i.readable !== false).slice(0, 5);
        if (!candidates.length) {
          setPhase("none");
          return;
        }
        setPhase("loading");
        for (const cand of candidates) {
          try {
            const r = await fetch(`/api/details?id=${encodeURIComponent(cand.id)}`);
            const d: Details | null = r.ok ? await r.json() : null;
            if (cancelled) return;
            if (d?.chapters?.length) {
              setFallback(d);
              setPhase("ready");
              return;
            }
          } catch {
            /* try the next candidate */
          }
        }
        if (!cancelled) setPhase("none");
      } catch {
        if (!cancelled) setPhase("none");
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [details?.id, details?.chapters?.length]);

  return { phase, alternatives, fallback };
}

/** One chapter/file row — used for the main list AND the official-links block.
 * Every row gets the same primary action (Read / Listen — in-app when the
 * chapter is hosted, the publisher's reader when it is an external link) plus
 * a download button for everything that can actually be packaged. */
function ChapterRow({ details, ch }: { details: Details; ch: ChapterEntry }) {
  const chapterIndex = details.chapters.findIndex((c) => c.id === ch.id);
  const fileExt = (ch.file?.ext ?? "").toLowerCase();
  const fileReadable = !ch.href && READABLE_FILE_EXTS.includes(fileExt);
  const isAudio = details.type === "audiobook";
  const primaryLabel = isAudio ? "Listen" : "Read";
  const PrimaryIcon = isAudio ? Headphones : BookOpen;
  return (
    <div className="group flex items-center gap-2 rounded-xl border bg-card/60 px-3 py-2.5 transition-colors hover:border-primary/40 hover:bg-accent sm:px-4">
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 text-sm font-medium">
          {ch.num !== undefined && (
            <span
              className="shrink-0 rounded-md bg-primary/10 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-primary"
              title={`Chapter ${ch.num}`}
            >
              #{formatChapterNumber(ch.num)}
            </span>
          )}
          <span className="truncate">{ch.label}</span>
        </p>
        <p className="truncate text-[11px] text-muted-foreground">
          {[
            ch.group,
            ch.lang,
            ch.date,
            ch.pages ? (isAudio ? `${ch.pages} min` : `${ch.pages} pages`) : ch.file?.ext?.toUpperCase(),
            ch.file?.size,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </div>
      {ch.href ? (
        <Button
          size="sm"
          variant="outline"
          asChild
          className="h-8 shrink-0 gap-1.5 rounded-full text-xs"
        >
          <a
            href={ch.href}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`${primaryLabel} ${ch.label} on the publisher site`}
            title="This chapter streams from the publisher — opens in a new tab"
          >
            <PrimaryIcon className="size-3.5" aria-hidden />
            {primaryLabel}
            <ExternalLink className="size-3 opacity-60" aria-hidden />
          </a>
        </Button>
      ) : details.readable || fileReadable ? (
        <Button
          size="sm"
          className="h-8 shrink-0 gap-1.5 rounded-full text-xs"
          aria-label={`${primaryLabel} ${ch.label}`}
          onClick={() => useApp.getState().openReaderAt(details.chapters, chapterIndex, details.title, details)}
        >
          <PrimaryIcon className="size-3.5" aria-hidden />
          {primaryLabel}
        </Button>
      ) : null}
      {!ch.href && (
        <Button
          size="sm"
          variant="outline"
          className="h-8 shrink-0 gap-1.5 rounded-full text-xs"
          aria-label={`Download ${ch.label}`}
          onClick={() =>
            details.readable && !ch.file?.ext ? downloadChapter(details, ch) : downloadFile(details, ch)
          }
        >
          <Download className="size-3.5" aria-hidden />
          {!details.readable && <span className="hidden sm:inline">{fileExt.toUpperCase() || "Save"}</span>}
        </Button>
      )}
    </div>
  );
}

export default function TitlePage() {
  const router = useRouter();
  const params = useParams<{ id?: string | string[] }>();
  const id = useMemo(() => {
    const raw = Array.isArray(params?.id) ? params.id[0] : params?.id;
    try {
      return decodeURIComponent(raw ?? "");
    } catch {
      return raw ?? "";
    }
  }, [params]);

  const searchRef = useRef<HTMLInputElement | null>(null);
  const pushHistory = useApp((s) => s.pushHistory);
  const toggleFavorite = useApp((s) => s.toggleFavorite);
  const isFavorite = useApp((s) => s.favorites.some((f) => f.id === id));
  const headerQuery = useApp((s) => s.query);

  // The header search box is shared across pages — typing here while on a
  // title page must take the user back to the results grid (only the home
  // page renders results, so a stale title page would look "broken").
  // The query that was already set when the page mounted (i.e. the search the
  // user clicked a result FROM) must NOT bounce the user back — only react to
  // edits made while this page is open.
  const mountQuery = useRef(headerQuery);
  useEffect(() => {
    if (headerQuery.trim() && headerQuery !== mountQuery.current) router.push("/");
  }, [headerQuery, router]);

  /** Snapshot of the card the user clicked — paints cover/title before details arrive. */
  const [pre, setPre] = useState<MediaItem | null>(null);
  const [loaded, setLoaded] = useState<{ details?: Details; failed?: boolean } | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [chapterFilter, setChapterFilter] = useState("");
  const [showAllChapters, setShowAllChapters] = useState(false);
  const [newestFirst, setNewestFirst] = useState(false);
  const historyPushed = useRef<string | null>(null);

  // instant-paint snapshot (after mount — sessionStorage is client-only)
  useEffect(() => {
    setPre(readPreDetail(id));
  }, [id]);

  // full details — served from the shared server cache, usually in milliseconds
  useEffect(() => {
    if (!id) return;
    const ctrl = new AbortController();
    setLoaded(null);
    fetch(`/api/details?id=${encodeURIComponent(id)}`, { signal: ctrl.signal })
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json() as Promise<Details>;
      })
      .then((details) => {
        setLoaded({ details });
        if (historyPushed.current !== id) {
          historyPushed.current = id;
          pushHistory({ ...details, cover: details.cover ?? readPreDetail(id)?.cover });
        }
      })
      .catch((err: Error) => {
        if (err.name !== "AbortError") setLoaded({ failed: true });
      });
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const details = loaded?.details;
  const failed = loaded?.failed ?? false;
  const loading = !loaded;
  // what we know right now: snapshot while loading, details once loaded
  const item: MediaItem | null = details ?? pre;
  const readable = details ? details.readable : (item?.readable ?? true);

  // no-dead-ends engine: when this source has zero chapters (or only official
  // publisher links), auto-load the best readable alternative into this list
  const fb = useChapterFallback(details);
  const hrefCount = useMemo(() => (details ? details.chapters.filter((c) => c.href).length : 0), [details]);
  const officialOnly =
    !!details?.readable && hrefCount >= 5 && details.chapters.length - hrefCount < 3;
  /** The opened source can't really be read — the fallback list takes over. */
  const shouldFallback = !!details && (details.chapters.length === 0 || officialOnly);
  /** The details whose chapters this page actually renders. */
  const activeDetails: Details | null = shouldFallback && fb.fallback ? fb.fallback : (details ?? null);
  const usingFallback = activeDetails !== null && activeDetails !== details;
  /** The opened source's own (link-only) entries, preserved in a collapsible. */
  const officialChapters = useMemo(
    () => (usingFallback && details ? details.chapters : []),
    [usingFallback, details],
  );

  // file sources can still be partially readable — CBZ/PDF/TXT open in the reader
  const readableFileCount = useMemo(
    () =>
      activeDetails
        ? activeDetails.chapters.filter(
            (ch) => !ch.href && READABLE_FILE_EXTS.includes((ch.file?.ext ?? "").toLowerCase()),
          ).length
        : 0,
    [activeDetails],
  );
  const firstReadableFileIndex = useMemo(() => {
    if (!activeDetails) return -1;
    return activeDetails.chapters.findIndex(
      (ch) => !ch.href && READABLE_FILE_EXTS.includes((ch.file?.ext ?? "").toLowerCase()),
    );
  }, [activeDetails]);
  /** Chapters that open in the in-app reader (external links excluded). */
  const internalCount = useMemo(
    () => (activeDetails?.readable ? activeDetails.chapters.filter((c) => !c.href).length : 0),
    [activeDetails],
  );
  const firstInternalIndex = useMemo(
    () => (activeDetails ? activeDetails.chapters.findIndex((c) => !c.href) : -1),
    [activeDetails],
  );
  const lastInternalIndex = useMemo(() => {
    if (!activeDetails) return -1;
    for (let i = activeDetails.chapters.length - 1; i >= 0; i--) {
      if (!activeDetails.chapters[i].href) return i;
    }
    return -1;
  }, [activeDetails]);
  const allExternal = internalCount === 0 && !!activeDetails?.readable && activeDetails.chapters.length > 0;
  const hasStartable = internalCount > 0 || readableFileCount > 0;

  const visibleChapters = useMemo(() => {
    if (!activeDetails) return [];
    const f = chapterFilter.trim().toLowerCase().replace(/^#/, "");
    const base = f
      ? activeDetails.chapters.filter(
          (c) =>
            c.label.toLowerCase().includes(f) ||
            (c.num !== undefined && String(c.num).includes(f)),
        )
      : activeDetails.chapters;
    // server returns oldest→newest; flip for "Newest first"
    const ordered = newestFirst ? [...base].reverse() : base;
    // until "Show all", surface the most recent slice in either direction
    if (f || showAllChapters || base.length <= CHAPTER_WINDOW) return ordered;
    return newestFirst ? ordered.slice(0, CHAPTER_WINDOW) : ordered.slice(-CHAPTER_WINDOW);
  }, [activeDetails, chapterFilter, showAllChapters, newestFirst]);

  const hiddenCount = useMemo(() => {
    if (!activeDetails || showAllChapters || chapterFilter.trim()) return 0;
    return Math.max(0, activeDetails.chapters.length - CHAPTER_WINDOW);
  }, [activeDetails, showAllChapters, chapterFilter]);

  const metaRows = useMemo(() => {
    if (!details) return [];
    const rows: { icon: typeof User; text: string }[] = [];
    if (details.authors?.length) rows.push({ icon: User, text: details.authors.join(", ") });
    if (details.publishedAt || item?.year)
      rows.push({ icon: Calendar, text: details.publishedAt ?? String(item?.year) });
    if (details.status) rows.push({ icon: BookOpen, text: details.status });
    return rows;
  }, [details, item?.year]);

  const startReading = (index: number) => {
    if (!activeDetails?.chapters.length) return;
    const idx = Math.min(Math.max(index, 0), activeDetails.chapters.length - 1);
    useApp.getState().openReaderAt(activeDetails.chapters, idx, activeDetails.title, activeDetails);
  };

  if (!id) {
    return (
      <div className="flex min-h-screen flex-col">
        <AppHeader search={searchRef} />
        <main className="flex flex-1 items-center justify-center px-4">
          <div className="text-center">
            <p className="text-sm text-muted-foreground">This title link is broken or incomplete.</p>
            <Button className="mt-4 rounded-full" onClick={() => router.push("/")}>
              <ArrowLeft className="size-4" aria-hidden /> Back to browse
            </Button>
          </div>
        </main>
        <AppFooter />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col">
      <AppHeader search={searchRef} />

      <main className="flex-1">
        <div className="mx-auto max-w-5xl px-3 py-4 sm:px-4 sm:py-6">
          {/* top nav */}
          <div className="mb-4 flex items-center justify-between gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="-ml-2 gap-1.5 rounded-full"
              onClick={() => router.push("/")}
            >
              <ArrowLeft className="size-4" aria-hidden />
              Browse
            </Button>
            {item && (
              <Badge variant="secondary" className="rounded-full text-[10px]">
                {item.sourceLabel}
              </Badge>
            )}
          </div>

          {/* ── hero ─────────────────────────────────────────────── */}
          <section className="flex flex-col gap-5 sm:flex-row sm:gap-6" aria-label="Title details">
            <div className="relative mx-auto aspect-[2/3] w-40 shrink-0 overflow-hidden rounded-xl bg-muted cover-shadow sm:mx-0 sm:w-48 lg:w-52">
              {item?.cover ? (
                <img
                  src={proxiedImg(item.cover)}
                  alt={`${item.title} cover`}
                  className="size-full object-cover"
                  onError={(e) => (e.currentTarget.style.display = "none")}
                />
              ) : loading ? (
                <Skeleton className="absolute inset-0 rounded-xl" />
              ) : (
                <div className="grid size-full place-items-center bg-gradient-to-br from-violet-900/60 to-fuchsia-900/40 text-4xl font-bold text-white/80">
                  {(item?.title ?? "?").slice(0, 1)}
                </div>
              )}
            </div>

            <div className="min-w-0 flex-1 text-center sm:text-left">
              {item ? (
                <h1 className="text-xl font-bold tracking-tight sm:text-3xl">{item.title}</h1>
              ) : (
                <Skeleton className="mx-auto h-8 w-3/4 sm:mx-0" />
              )}

              <p className="mt-1.5 text-sm text-muted-foreground">
                {details?.authors?.length
                  ? details.authors.join(" · ")
                  : item?.subtitle || (loading ? " " : "Unknown author")}
              </p>

              {/* badges */}
              <div className="mt-3 flex flex-wrap items-center justify-center gap-1.5 sm:justify-start">
                {item ? (
                  !details ? (
                    readable ? (
                      <Badge variant="outline" className="gap-1 border-emerald-500/40 bg-emerald-500/10 text-[10px] text-emerald-600 dark:text-emerald-400">
                        <BookOpen className="size-3" aria-hidden /> Readable here
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="gap-1 border-amber-500/40 bg-amber-500/10 text-[10px] text-amber-600 dark:text-amber-400">
                        <Download className="size-3" aria-hidden /> Download only
                      </Badge>
                    )
                  ) : details.readable ? (
                    <Badge variant="outline" className="gap-1 border-emerald-500/40 bg-emerald-500/10 text-[10px] text-emerald-600 dark:text-emerald-400">
                      <BookOpen className="size-3" aria-hidden /> Readable here
                    </Badge>
                  ) : readableFileCount > 0 ? (
                    <Badge variant="outline" className="gap-1 border-emerald-500/40 bg-emerald-500/10 text-[10px] text-emerald-600 dark:text-emerald-400">
                      <BookOpen className="size-3" aria-hidden /> Read &amp; download
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="gap-1 border-amber-500/40 bg-amber-500/10 text-[10px] text-amber-600 dark:text-amber-400">
                      <Download className="size-3" aria-hidden /> Download only
                    </Badge>
                  )
                ) : (
                  <Skeleton className="h-5 w-24 rounded-full" />
                )}
                {activeDetails && (
                  <Badge variant="outline" className="text-[10px]">
                    {activeDetails.type === "audiobook"
                      ? `${activeDetails.chapters.length} track${activeDetails.chapters.length === 1 ? "" : "s"}`
                      : activeDetails.readable
                        ? `${activeDetails.chapters.length} chapter${activeDetails.chapters.length === 1 ? "" : "s"}`
                        : `${activeDetails.chapters.length} file${activeDetails.chapters.length === 1 ? "" : "s"}`}
                  </Badge>
                )}
                {details?.status && (
                  <Badge variant="outline" className="text-[10px]">
                    {details.status}
                  </Badge>
                )}
                {(item?.nsfw || details?.nsfw) && (
                  <Badge variant="destructive" className="gap-1 px-1.5 text-[10px]">
                    <ShieldAlert className="size-3" aria-hidden /> 18+
                  </Badge>
                )}
                {item?.year ? (
                  <Badge variant="outline" className="text-[10px]">
                    {item.year}
                  </Badge>
                ) : null}
              </div>

              {/* tags */}
              {item?.tags && item.tags.length > 0 && (
                <div className="mt-2.5 flex flex-wrap justify-center gap-1 sm:justify-start">
                  {item.tags.slice(0, 10).map((t) => (
                    <Badge
                      key={t}
                      variant="secondary"
                      className="rounded-full px-2 text-[10px] font-normal text-muted-foreground"
                    >
                      {t}
                    </Badge>
                  ))}
                </div>
              )}

              {/* actions */}
              {activeDetails && details && (
                <div className="mt-4 flex flex-wrap items-center justify-center gap-2 sm:justify-start">
                  {hasStartable && (
                    <>
                      <Button
                        size="lg"
                        className="h-11 gap-2 rounded-full px-6 shadow-md"
                        onClick={() =>
                          startReading(
                            activeDetails.readable
                              ? Math.max(0, firstInternalIndex)
                              : firstReadableFileIndex,
                          )
                        }
                      >
                        {activeDetails.type === "audiobook" ? (
                          <Headphones className="size-5" aria-hidden />
                        ) : (
                          <BookOpen className="size-5" aria-hidden />
                        )}
                        {activeDetails.type === "audiobook" ? "Start listening" : "Start reading"}
                      </Button>
                      {activeDetails.readable && internalCount > 1 && (
                        <Button
                          size="lg"
                          variant="outline"
                          className="h-11 gap-2 rounded-full"
                          onClick={() =>
                            startReading(lastInternalIndex >= 0 ? lastInternalIndex : activeDetails.chapters.length - 1)
                          }
                        >
                          <ChevronLast className="size-4" aria-hidden />
                          {activeDetails.type === "audiobook" ? "Latest track" : "Latest chapter"}
                        </Button>
                      )}
                    </>
                  )}
                  {allExternal && (
                    <p className="flex items-center gap-2 rounded-full border border-sky-500/30 bg-sky-500/10 px-4 py-2 text-xs text-sky-700 dark:text-sky-400">
                      <Info className="size-3.5 shrink-0" aria-hidden />
                      All chapters are on the official publisher — tap Open on any chapter below.
                    </p>
                  )}
                  <Button
                    size="lg"
                    variant={isFavorite ? "default" : "outline"}
                    className="h-11 gap-2 rounded-full"
                    onClick={() => {
                      toggleFavorite(details);
                      toast.success(isFavorite ? "Removed from favorites" : "Added to favorites", {
                        description: details.title,
                      });
                    }}
                  >
                    <Heart className={`size-4 ${isFavorite ? "fill-current" : ""}`} aria-hidden />
                    {isFavorite ? "Saved" : "Save"}
                  </Button>
                  {item?.externalUrl && (
                    <Button size="lg" variant="outline" asChild className="h-11 gap-2 rounded-full">
                      <a href={item.externalUrl} target="_blank" rel="noopener noreferrer">
                        <ExternalLink className="size-4" aria-hidden />
                        Source site
                      </a>
                    </Button>
                  )}
                </div>
              )}

              {/* meta rows */}
              {metaRows.length > 0 && (
                <div className="mt-4 space-y-1">
                  {metaRows.map((row, i) => (
                    <p
                      key={i}
                      className="flex items-center justify-center gap-2 text-xs text-muted-foreground sm:justify-start"
                    >
                      <row.icon className="size-3.5 shrink-0" aria-hidden />
                      <span className="truncate">{row.text}</span>
                    </p>
                  ))}
                </div>
              )}
            </div>
          </section>

          {/* description */}
          {(details?.description || item?.description) && (
            <>
              <Separator className="my-5" />
              <p
                className={`mx-auto max-w-3xl text-sm leading-relaxed text-muted-foreground ${
                  expanded ? "" : "line-clamp-4"
                }`}
              >
                {details?.description || item?.description}
              </p>
              {(details?.description || item?.description || "").length > 220 && (
                <button
                  onClick={() => setExpanded((v) => !v)}
                  className="mx-auto mt-1 block text-xs font-medium text-primary hover:underline sm:mx-0"
                >
                  {expanded ? "Show less" : "Show more"}
                </button>
              )}
            </>
          )}

          {/* ── chapters / files ─────────────────────────────────── */}
          <Separator className="my-5" />
          <section aria-label={activeDetails?.type === "audiobook" ? "Tracks" : activeDetails?.readable === false ? "Files" : "Chapters"}>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-base font-semibold sm:text-lg">
                {activeDetails
                  ? activeDetails.type === "audiobook"
                    ? "Tracks"
                    : activeDetails.readable || readableFileCount > 0
                      ? "Chapters & files"
                      : "Downloads"
                  : "Loading…"}
              </h2>
              <div className="flex items-center gap-2">
                {activeDetails && activeDetails.chapters.length > 1 && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-9 gap-1.5 rounded-full px-3 text-xs"
                    onClick={() => setNewestFirst((v) => !v)}
                    aria-label={newestFirst ? "Sort oldest first" : "Sort newest first"}
                  >
                    <ArrowDownUp className="size-3.5" aria-hidden />
                    {newestFirst ? "Newest first" : "Oldest first"}
                  </Button>
                )}
                {activeDetails && activeDetails.chapters.length > 30 && (
                <div className="relative w-44 sm:w-60">
                  <Search
                    className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
                    aria-hidden
                  />
                  <Input
                    value={chapterFilter}
                    onChange={(e) => setChapterFilter(e.target.value)}
                    placeholder="Filter chapters…"
                    className="h-9 rounded-full bg-muted/60 pl-8 text-xs"
                    aria-label="Filter chapters"
                  />
                </div>
                )}
              </div>
            </div>

            {!activeDetails?.readable && activeDetails && activeDetails.chapters.length > 0 && readableFileCount === 0 &&
              (activeDetails.chapters.every((c) => !!c.href) ? (
                <p className="mb-3 flex items-start gap-2 rounded-xl border border-sky-500/30 bg-sky-500/10 p-3 text-xs leading-relaxed text-sky-700 dark:text-sky-400 sm:text-sm">
                  <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
                  <span>
                    This source hosts its chapters on its own site — the Open buttons take you
                    straight to them.
                  </span>
                </p>
              ) : (
                <p className="mb-3 flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs leading-relaxed text-amber-700 dark:text-amber-400 sm:text-sm">
                  <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
                  <span>
                    This source shares downloadable files only ({activeDetails.chapters.length} below).
                    CBZ, PDF and TXT files also open right in the reader — everything is free.
                  </span>
                </p>
              ))}

            {hiddenCount > 0 && (
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-muted/40 px-3.5 py-2.5">
                <p className="text-xs text-muted-foreground">
                  Showing the latest {CHAPTER_WINDOW} of {activeDetails?.chapters.length}{" "}
                  {activeDetails?.type === "audiobook" ? "tracks" : "chapters"}.
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 gap-1.5 rounded-full px-3 text-xs"
                  onClick={() => setShowAllChapters(true)}
                >
                  Show all
                </Button>
              </div>
            )}

            {loading && (
              <div className="space-y-2">
                {Array.from({ length: 8 }).map((_, i) => (
                  <Skeleton key={i} className="h-12 w-full rounded-lg" />
                ))}
              </div>
            )}

            {failed && (
              <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-4">
                <p className="text-sm text-destructive">
                  Could not load this title from {item?.sourceLabel ?? "its source"}. It may be
                  temporarily unavailable.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" className="gap-1.5 rounded-full" onClick={() => router.push("/")}>
                    <ArrowLeft className="size-3.5" aria-hidden /> Back to browse
                  </Button>
                  {item?.externalUrl && (
                    <Button size="sm" variant="outline" asChild className="gap-1.5 rounded-full">
                      <a href={item.externalUrl} target="_blank" rel="noopener noreferrer">
                        <ExternalLink className="size-3.5" aria-hidden /> Open on source
                      </a>
                    </Button>
                  )}
                </div>
              </div>
            )}

            {shouldFallback && details && (
              <div className="space-y-3">
                {(fb.phase === "searching" || fb.phase === "loading") && (
                  <div className="flex items-center gap-3 rounded-xl border border-violet-500/30 bg-violet-500/5 p-4">
                    <Loader2 className="size-5 shrink-0 animate-spin text-violet-500" aria-hidden />
                    <div className="min-w-0">
                      <p className="text-sm font-medium">
                        {officialOnly
                          ? `${details.sourceLabel} only links to the official publisher for this title — searching sources you can read in-app…`
                          : `Nothing published on ${details.sourceLabel} yet — searching other sources…`}
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {fb.phase === "loading"
                          ? "Found a source carrying this title — loading its chapters for you."
                          : "Checking every source that carries this title for readable chapters."}
                      </p>
                    </div>
                  </div>
                )}
                {usingFallback && fb.fallback && (
                  <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4">
                    <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">
                      Showing {fb.fallback.chapters.length} chapter{fb.fallback.chapters.length === 1 ? "" : "s"} from {fb.fallback.sourceLabel}
                    </p>
                    <p className="mt-0.5 text-xs leading-relaxed text-emerald-700/80 dark:text-emerald-400/80">
                      {officialOnly
                        ? `${details.sourceLabel} only offers the publisher's free chapters for this title (kept in the list below) — the full readable list is brought over automatically.`
                        : `${details.sourceLabel} has nothing published here yet — the list below is brought over automatically. Read, download and save everything as usual.`}
                    </p>
                  </div>
                )}
                {fb.phase === "none" && (
                  <p className="rounded-xl border bg-muted/40 p-4 text-sm leading-relaxed text-muted-foreground">
                    {officialOnly
                      ? `${details.sourceLabel} only links to the official publisher for this title, and no other readable source carries it right now. The official chapters are listed below.`
                      : details.readable
                        ? "No chapters found here, and none of the other sources carrying this title have readable chapters right now. New releases usually appear within hours — check back soon."
                        : details.externalUrl
                          ? "Nothing to read or download here — this source is an index/catalogue. Open it on the source site, or pick another source below."
                          : "No files found for this title yet — other sources carrying it are listed below."}
                  </p>
                )}
              </div>
            )}

            {/* same title elsewhere — skeletons while the fallback engine searches */}
            {shouldFallback && details && fb.alternatives === null &&
              (fb.phase === "searching" || fb.phase === "loading") && (
              <section className="mt-8" aria-label="Other sources with this title">
                <h3 className="mb-3 text-sm font-semibold sm:text-base">Find it on other sources</h3>
                <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6">
                  {Array.from({ length: 6 }).map((_, i) => <MediaCardSkeleton key={i} />)}
                </div>
              </section>
            )}

            {shouldFallback && details && fb.alternatives && fb.alternatives.length > 0 && (
              <section className="mt-8" aria-label="Other sources with this title">
                <h3 className="mb-1 text-sm font-semibold sm:text-base">Find it on other sources</h3>
                <p className="mb-3 text-xs text-muted-foreground">
                  Same title elsewhere — readable sources are listed first.
                </p>
                <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6">
                  {fb.alternatives.map((alt) => <MediaCard key={alt.id} item={alt} />)}
                </div>
              </section>
            )}

            {activeDetails && activeDetails.chapters.length > 0 && (
              <div className="space-y-1.5">
                {visibleChapters.map((ch) => (
                  <ChapterRow key={ch.id} details={activeDetails} ch={ch} />
                ))}
                {visibleChapters.length === 0 && chapterFilter.trim() && (
                  <p className="py-6 text-center text-sm text-muted-foreground">
                    No {activeDetails.type === "audiobook" ? "tracks" : "chapters"} match &ldquo;{chapterFilter.trim()}&rdquo;.
                  </p>
                )}
                {hiddenCount > 0 && (
                  <div className="pt-2 text-center">
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1.5 rounded-full"
                      onClick={() => setShowAllChapters(true)}
                    >
                      <ChevronLast className="size-3.5 rotate-90" aria-hidden />
                      Show all {activeDetails.chapters.length}{" "}
                      {activeDetails.type === "audiobook" ? "tracks" : "chapters"}
                    </Button>
                  </div>
                )}
              </div>
            )}

            {/* The opened source's own listings (official publisher links) —
                preserved in a collapsible when the fallback list takes over. */}
            {officialChapters.length > 0 && details && (
              <details className="group mt-4 rounded-xl border bg-muted/30">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-3 text-sm font-medium [&::-webkit-details-marker]:hidden">
                  <span className="flex min-w-0 items-center gap-2">
                    <ExternalLink className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                    <span className="truncate">
                      {details.sourceLabel} listings ({officialChapters.length})
                      {officialOnly ? " — official publisher links" : ""}
                    </span>
                  </span>
                  <ChevronLast
                    className="size-4 shrink-0 rotate-90 text-muted-foreground transition-transform group-open:-rotate-90"
                    aria-hidden
                  />
                </summary>
                <div className="space-y-1.5 px-3 pb-3">
                  {officialChapters.map((ch) => (
                    <ChapterRow key={ch.id} details={details} ch={ch} />
                  ))}
                </div>
              </details>
            )}
          </section>
        </div>
      </main>

      <AppFooter />
      <AppOverlays />
    </div>
  );
}
