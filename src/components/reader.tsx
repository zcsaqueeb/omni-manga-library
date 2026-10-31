"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeftRight,
  ChevronLeft,
  ChevronRight,
  Download,
  Headphones,
  Loader2,
  RectangleVertical,
  Rows3,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { downloadChapter, downloadFile } from "@/lib/download";
import { useApp } from "@/store/app-store";
import type { ReaderState } from "@/store/app-store";

type Payload =
  | { pages: string[]; count: number }
  | { text: string }
  | { pdf: string }
  | { audio: string }
  | null;

/** Inner body keyed by chapter id — all setState calls happen in async callbacks. */
function ReaderBody({ reader }: { reader: ReaderState }) {
  const closeReader = useApp((s) => s.closeReader);
  const openReaderAt = useApp((s) => s.openReaderAt);

  const [payload, setPayload] = useState<Payload>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "failed">("loading");
  const [index, setIndex] = useState(0);
  const [mode, setMode] = useState<"single" | "long">("single");
  const [rtl, setRtl] = useState(false);
  const longRef = useRef<HTMLDivElement | null>(null);

  const pages = payload && "pages" in payload ? payload.pages : [];
  const text = payload && "text" in payload ? payload.text : null;
  const pdf = payload && "pdf" in payload ? payload.pdf : null;
  const audio = payload && "audio" in payload ? payload.audio : null;
  const chapters = reader.chapters ?? [];
  const chapterIndex = reader.chapterIndex ?? -1;
  const entry = chapterIndex >= 0 ? chapters[chapterIndex] : undefined;
  const isFileChapter = !!entry?.file?.ext;
  const isAudioItem = reader.item?.type === "audiobook";

  useEffect(() => {
    const ctrl = new AbortController();
    const ext = entry?.file?.ext ? `&ext=${encodeURIComponent(entry.file.ext)}` : "";
    fetch(`/api/chapter?id=${encodeURIComponent(reader.chapterId)}${ext}`, { signal: ctrl.signal })
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json() as Promise<Payload>;
      })
      .then((d) => {
        setPayload(d);
        const hasPages = d && "pages" in d && d.pages.length > 0;
        const hasText = d && "text" in d && !!d.text;
        const hasPdf = d && "pdf" in d && !!d.pdf;
        const hasAudio = d && "audio" in d && !!d.audio;
        setStatus(hasPages || hasText || hasPdf || hasAudio ? "ready" : "failed");
        if (hasText) setMode("long");
      })
      .catch((err: Error) => {
        if (err.name !== "AbortError") setStatus("failed");
      });
    return () => ctrl.abort();
  }, [reader.chapterId, entry?.file?.ext]);

  const gotoChapter = useCallback(
    (dir: 1 | -1) => {
      if (!chapters.length || chapterIndex < 0) return;
      // never land on an external-link chapter (it has no in-app pages) —
      // skip over them in either direction
      let next = chapterIndex + dir;
      while (next >= 0 && next < chapters.length && chapters[next]?.href) next += dir;
      if (next < 0 || next >= chapters.length) return;
      openReaderAt(chapters, next, reader.itemTitle, reader.item ?? null);
    },
    [chapters, chapterIndex, openReaderAt, reader.itemTitle, reader.item],
  );

  const step = useCallback(
    (dir: 1 | -1) => {
      setIndex((i) => {
        const next = rtl ? i - dir : i + dir;
        if (next >= pages.length && dir > 0) {
          gotoChapter(1);
          return i;
        }
        if (next < 0 && dir < 0) {
          gotoChapter(-1);
          return i;
        }
        return Math.min(Math.max(next, 0), pages.length - 1);
      });
    },
    [pages.length, rtl, gotoChapter],
  );

  // keyboard navigation + Esc
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeReader();
      if (e.key === "]") gotoChapter(1);
      if (e.key === "[") gotoChapter(-1);
      if (mode !== "single" || text) return;
      if (e.key === "ArrowRight") step(rtl ? -1 : 1);
      if (e.key === "ArrowLeft") step(rtl ? 1 : -1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode, step, rtl, closeReader, gotoChapter, text]);

  // preload upcoming pages for smooth turns
  useEffect(() => {
    if (!pages.length) return;
    for (let n = 1; n <= 2; n++) {
      const p = pages[index + n];
      if (p) {
        const img = new Image();
        img.src = p;
      }
    }
  }, [index, pages]);

  // scroll to top on chapter change in long mode
  useEffect(() => {
    longRef.current?.closest(".overflow-y-auto")?.scrollTo({ top: 0 });
  }, [reader.chapterId]);

  const ready = status === "ready";
  const hasPrev = chapterIndex > 0;
  const hasNext = chapterIndex >= 0 && chapterIndex < chapters.length - 1;

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-black"
      role="dialog"
      aria-label={`Reading ${reader.itemTitle} — ${reader.chapterLabel}`}
    >
      {/* top bar */}
      <div className="flex h-12 shrink-0 items-center gap-1 bg-black/85 px-2 text-white backdrop-blur sm:h-14 sm:px-3">
        <Button
          variant="ghost"
          size="icon"
          className="size-9 text-white hover:bg-white/15"
          onClick={closeReader}
          aria-label="Close reader"
        >
          <X className="size-5" aria-hidden />
        </Button>
        <div className="min-w-0 flex-1 px-1">
          <p className="truncate text-xs font-medium sm:text-sm">{reader.itemTitle}</p>
          <p className="truncate text-[10px] text-white/60 sm:text-xs">{reader.chapterLabel}</p>
        </div>
        {/* chapter prev/next */}
        <Button
          variant="ghost"
          size="icon"
          className="size-9 text-white hover:bg-white/15 disabled:text-white/25"
          onClick={() => gotoChapter(-1)}
          disabled={!hasPrev}
          aria-label="Previous chapter"
        >
          <ChevronLeft className="size-5" aria-hidden />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-9 text-white hover:bg-white/15 disabled:text-white/25"
          onClick={() => gotoChapter(1)}
          disabled={!hasNext}
          aria-label="Next chapter"
        >
          <ChevronRight className="size-5" aria-hidden />
        </Button>
        {!text && !pdf && !audio && (
          <>
            <Button
              variant="ghost"
              size="icon"
              className="hidden size-9 text-white hover:bg-white/15 sm:grid"
              onClick={() => setMode((m) => (m === "single" ? "long" : "single"))}
              aria-label={mode === "single" ? "Switch to scroll mode" : "Switch to page mode"}
            >
              {mode === "single" ? (
                <Rows3 className="size-5" aria-hidden />
              ) : (
                <RectangleVertical className="size-5" aria-hidden />
              )}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="hidden size-9 text-white hover:bg-white/15 sm:grid"
              onClick={() => setRtl((v) => !v)}
              aria-label={rtl ? "Reading left-to-right" : "Reading right-to-left (manga)"}
            >
              <ArrowLeftRight className="size-5" aria-hidden />
            </Button>
          </>
        )}
        <Button
          variant="ghost"
          size="icon"
          className="size-9 text-white hover:bg-white/15 disabled:text-white/25"
          aria-label={
            isFileChapter
              ? "Download file"
              : isAudioItem
                ? "Download track as MP3"
                : "Download chapter as CBZ"
          }
          disabled={!reader.item || !entry}
          onClick={() =>
            reader.item &&
            entry &&
            (isFileChapter
              ? downloadFile(reader.item, entry)
              : downloadChapter(reader.item, { id: reader.chapterId, label: reader.chapterLabel }))
          }
        >
          <Download className="size-5" aria-hidden />
        </Button>
      </div>

      {/* stage */}
      <div className="relative flex-1 overflow-y-auto overscroll-contain">
        {status === "loading" && (
          <div className="grid h-full place-items-center">
            <div className="flex flex-col items-center gap-3 text-white/70">
              <Loader2 className="size-8 animate-spin" aria-hidden />
              <p className="text-sm">{isAudioItem ? "Loading track…" : "Loading pages…"}</p>
            </div>
          </div>
        )}

        {status === "failed" && (
          <div className="grid h-full place-items-center px-6 text-center">
            <div>
              <p className="max-w-sm text-sm text-white/70">
                Could not load this chapter — it may have been removed or the source is temporarily
                unavailable.
              </p>
              <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
                {hasNext && (
                  <Button size="sm" variant="outline" className="rounded-full text-black" onClick={() => gotoChapter(1)}>
                    Try next chapter
                  </Button>
                )}
                {reader.item?.externalUrl && (
                  <Button size="sm" variant="outline" asChild className="rounded-full text-black">
                    <a href={reader.item.externalUrl} target="_blank" rel="noopener noreferrer">
                      Open on source site
                    </a>
                  </Button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* image modes */}
        {ready && pages.length > 0 && mode === "single" && (
          <div
            className="relative flex h-full items-center justify-center"
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const x = e.clientX - rect.left;
              const w = rect.width;
              if (x < w * 0.3) step(-1);
              else if (x > w * 0.7) step(1);
            }}
          >
            <img
              key={pages[index]}
              src={pages[index]}
              alt={`Page ${index + 1}`}
              draggable={false}
              className="max-h-full w-auto max-w-full object-contain select-none"
            />
            <button
              className="absolute inset-y-0 left-0 w-[30%] cursor-w-resize"
              onClick={(e) => {
                e.stopPropagation();
                step(-1);
              }}
              aria-label="Previous page"
            />
            <button
              className="absolute inset-y-0 right-0 w-[70%] cursor-e-resize"
              onClick={(e) => {
                e.stopPropagation();
                step(1);
              }}
              aria-label="Next page"
            />
            {index > 0 && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  step(-1);
                }}
                className="absolute left-2 top-1/2 hidden -translate-y-1/2 rounded-full bg-black/45 p-2 text-white opacity-40 transition-opacity hover:opacity-100 md:block"
                aria-label="Previous page"
              >
                <ChevronLeft className="size-6" aria-hidden />
              </button>
            )}
            {index < pages.length - 1 && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  step(1);
                }}
                className="absolute right-2 top-1/2 hidden -translate-y-1/2 rounded-full bg-black/45 p-2 text-white opacity-40 transition-opacity hover:opacity-100 md:block"
                aria-label="Next page"
              >
                <ChevronRight className="size-6" aria-hidden />
              </button>
            )}
          </div>
        )}

        {ready && pages.length > 0 && mode === "long" && (
          <div ref={longRef} className="mx-auto flex max-w-3xl flex-col items-center">
            {pages.map((p, i) => (
              <img
                key={p}
                src={p}
                alt={`Page ${i + 1}`}
                loading={i < 2 ? "eager" : "lazy"}
                decoding="async"
                draggable={false}
                className="w-full select-none"
              />
            ))}
          </div>
        )}

        {/* PDF mode — books & scans rendered by the browser's native viewer */}
        {ready && pdf && (
          <iframe
            src={pdf}
            title="PDF reader"
            className="size-full border-0 bg-white"
          />
        )}

        {/* audio mode — audiobooks stream right in the reader */}
        {ready && audio && (
          <div className="grid h-full place-items-center px-5">
            <div className="w-full max-w-lg text-center">
              <div className="mx-auto grid size-20 place-items-center rounded-full bg-white/5">
                <Headphones className="size-9 text-white/50" aria-hidden />
              </div>
              <p className="mt-4 truncate text-sm font-medium text-white/90">{reader.chapterLabel}</p>
              <p className="mt-1 truncate text-xs text-white/50">{reader.itemTitle}</p>
              <audio
                controls
                autoPlay
                className="mt-6 w-full"
                src={audio}
              />
              <p className="mt-3 text-[11px] text-white/40">
                Streamed from {reader.item?.sourceLabel ?? "the source"} · free to listen &amp; keep
              </p>
            </div>
          </div>
        )}

        {/* text mode (novels / web fiction) */}
        {ready && text && (
          <article className="mx-auto max-w-2xl px-5 py-8 text-white/90 sm:px-6">
            <div className="space-y-4 text-[15px] leading-7 sm:text-base sm:leading-8">
              {text
                .split(/\n{2,}/)
                .map((para) => para.trim())
                .filter(Boolean)
                .map((para, i) => (
                  <p key={i} className="whitespace-pre-wrap">
                    {para.replace(/\n/g, " ")}
                  </p>
                ))}
            </div>
            {hasNext && (
              <div className="mt-10 flex justify-center border-t border-white/10 pt-6">
                <Button variant="outline" className="rounded-full text-black" onClick={() => gotoChapter(1)}>
                  Next chapter <ChevronRight className="size-4" aria-hidden />
                </Button>
              </div>
            )}
          </article>
        )}
      </div>

      {/* page indicator */}
      {ready && pages.length > 0 && mode === "single" && (
        <div className="pointer-events-none absolute bottom-4 left-1/2 z-10 -translate-x-1/2">
          <span className="rounded-full bg-black/70 px-3.5 py-1.5 text-xs font-medium text-white backdrop-blur">
            {index + 1} / {pages.length}
          </span>
        </div>
      )}
    </div>
  );
}

export function Reader() {
  const reader = useApp((s) => s.reader);
  const closeReader = useApp((s) => s.closeReader);

  // lock body scroll while the reader is open
  useEffect(() => {
    if (!reader) return;
    document.body.classList.add("reader-open");
    return () => document.body.classList.remove("reader-open");
  }, [reader, closeReader]);

  if (!reader) return null;
  return <ReaderBody key={reader.chapterId} reader={reader} />;
}
