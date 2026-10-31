"use client";

import { toast } from "sonner";
import { useApp, type DownloadEntry } from "@/store/app-store";
import type { ChapterEntry, MediaItem } from "@/lib/sources/types";

function dlUrl(item: MediaItem, chapter: ChapterEntry): string {
  const params = new URLSearchParams({
    id: chapter.id,
    title: `${item.title} - ${chapter.label}`.slice(0, 140),
  });
  return `/api/download?${params.toString()}`;
}

function stamp(): string {
  return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function register(entryId: string, title: string, kind: DownloadEntry["kind"]): DownloadEntry {
  const entry: DownloadEntry = {
    id: entryId,
    title,
    kind,
    startedAt: Date.now(),
    status: "downloading",
  };
  useApp.getState().addDownload(entry);
  return entry;
}

/** Manga chapter → streaming CBZ fetched as a blob (gives us completion/error
 * states). Novel text chapters come back as plain text and are saved as .txt —
 * the server decides, the filename follows the response. */
export async function downloadChapter(item: MediaItem, chapter: ChapterEntry) {
  const entry = register(`dl:${Date.now()}:${Math.random()}`, `${item.title} — ${chapter.label}`, "chapter");
  toast.loading("Preparing download…", { id: entry.id, description: chapter.label });
  try {
    const res = await fetch(dlUrl(item, chapter));
    if (!res.ok) throw new Error(`Server ${res.status}`);
    const blob = await res.blob();
    const isText = (res.headers.get("content-type") ?? "").includes("text/plain");
    const ext = isText ? "txt" : "cbz";
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(item.title || "chapter").replace(/[^\w\d .()-]+/g, "_")} - ${chapter.label.replace(/[^\w\d .()-]+/g, "_")}.${ext}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    useApp.getState().updateDownload(entry.id, { status: "done" });
    toast.success(isText ? "Text file ready" : "CBZ ready", { id: entry.id, description: a.download });
  } catch (err) {
    useApp.getState().updateDownload(entry.id, {
      status: "error",
      message: err instanceof Error ? err.message : "failed",
    });
    toast.error("Download failed", { id: entry.id, description: chapter.label });
  }
}

/** Books / comics → hand the browser a direct attachment URL (native progress UI). */
export function downloadFile(item: MediaItem, chapter: ChapterEntry) {
  const entry = register(`dl:${Date.now()}:${Math.random()}`, `${item.title} — ${chapter.label}`, "file");
  toast.info("Download started", { id: entry.id, description: `${chapter.file?.ext?.toUpperCase() ?? "file"} · ${stamp()}` });
  const a = document.createElement("a");
  a.href = dlUrl(item, chapter);
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  // no reliable completion signal for native downloads — mark done shortly after
  setTimeout(() => useApp.getState().updateDownload(entry.id, { status: "done" }), 2500);
}
