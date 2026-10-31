import { NextRequest, NextResponse } from "next/server";
import { pagesCache, TTL } from "@/lib/cache";
import { getSource } from "@/lib/sources";
import { chapterPages as mangadexChapterPages } from "@/lib/sources/mangadex";
import { readZipDirectory } from "@/lib/cbz";
import { resolveFileUrl, gutenbergTextUrl } from "@/lib/file-resolve";
import { upstreamFetch } from "@/lib/http";
import type { ChapterPayload } from "@/lib/sources/types";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Resolve any readable chapter id — `<sourceId>-ch:<realId>` — into pages or text. */
async function resolvePages(id: string): Promise<ChapterPayload> {
  const [sourceId] = id.split("-ch:");
  const realId = id.slice(id.indexOf("-ch:") + 4);

  if (sourceId === "mangadex") {
    return mangadexChapterPages(realId);
  }

  const adapter = getSource(sourceId);
  if (!adapter?.chapterPages) throw new Error(`Source ${sourceId} is not readable`);
  return adapter.chapterPages(realId);
}

/* ─────────── file-source reading: CBZ page images · PDF inline · TXT text ─────────── */

/** Files the in-browser reader can open: CBZ → images, PDF → inline viewer, TXT → text. */
export const READABLE_FILE_EXTS = ["cbz", "pdf", "txt"];

/** Build the reader payload for a `-file:` entry based on its extension. */
async function resolveFilePayload(id: string, ext: string): Promise<string[] | { text: string } | { pdf: string }> {
  if (ext === "cbz") {
    // list the archive's page images and hand back proxied page URLs
    const { url } = await resolveFileUrl(id);
    const dir = await readZipDirectory(url);
    if (!dir.pages.length) throw new Error("No page images inside the archive");
    return dir.pages.map(
      (e) => `/api/cbz/page?id=${encodeURIComponent(id)}&entry=${encodeURIComponent(e.name)}`,
    );
  }

  if (ext === "pdf") {
    // browsers render PDFs natively — stream it inline through our proxy
    return { pdf: `/api/download?id=${encodeURIComponent(id)}&inline=1` };
  }

  if (ext === "txt") {
    const text = await fetchFileText(id);
    return { text };
  }

  throw new Error(`.${ext} files can't be opened in the reader — download instead`);
}

/** Fetch a plain-text book, trimming Gutenberg's license boilerplate. */
async function fetchFileText(id: string): Promise<string> {
  let url: string;
  if (id.startsWith("gutenberg-fmt:") || id.startsWith("gutenberg-direct:")) {
    const bookId = id.split(":")[1];
    url = gutenbergTextUrl(bookId);
  } else {
    ({ url } = await resolveFileUrl(id));
  }

  const res = await upstreamFetch(url, { timeoutMs: 30_000, retries: 1 });
  if (!res.ok) throw new Error(`Upstream ${res.status} for text`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > 4 * 1024 * 1024) throw new Error("Text too large to read in browser");

  let text = buf.toString("utf8");
  // trim Project Gutenberg header/footer when present
  const start = text.match(/\*\*\*\s*START OF (?:THE|THIS) PROJECT GUTENBERG EBOOK[^*]*\*\*\*/i);
  const end = text.match(/\*\*\*\s*END OF (?:THE|THIS) PROJECT GUTENBERG EBOOK/i);
  if (start?.index !== undefined) {
    text = text.slice(start.index + start[0].length);
  }
  if (end?.index !== undefined) {
    text = text.slice(0, end.index);
  }
  return text.trim();
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const id = sp.get("id") ?? "";

  // file-source entries (archive / openlibrary / gutenberg) — read by extension
  const isFileEntry = id.includes("-file:") || /^gutenberg-(fmt|direct):/.test(id);
  if (isFileEntry) {
    const ext = (sp.get("ext") ?? "").toLowerCase();
    if (!READABLE_FILE_EXTS.includes(ext)) {
      return NextResponse.json(
        { error: "This file type can't be read in the browser — download it instead." },
        { status: 400 },
      );
    }
    try {
      // listings/text are immutable — cached centrally for hours, shared by all users.
      // Empty results only stick for 10 seconds (TTL.negative): a transient
      // upstream hiccup must never lock readers out for hours.
      const payload = await pagesCache.wrap(
        `pf:${id}:${ext}`,
        TTL.pages,
        () => resolveFilePayload(id, ext),
        (val) => {
          if (Array.isArray(val)) return val.length ? TTL.pages : TTL.negative;
          if ("text" in val) return val.text?.trim() ? TTL.pages : TTL.negative;
          if ("pdf" in val) return val.pdf ? TTL.pages : TTL.negative;
          return TTL.negative;
        },
      );

      if (Array.isArray(payload)) {
        if (!payload.length) {
          return NextResponse.json({ error: "No readable pages found" }, { status: 404 });
        }
        return NextResponse.json(
          { pages: payload, count: payload.length },
          { headers: { "Cache-Control": "public, max-age=1800, stale-while-revalidate=86400" } },
        );
      }
      if ("pdf" in payload) {
        return NextResponse.json(payload, {
          headers: { "Cache-Control": "public, max-age=1800, stale-while-revalidate=86400" },
        });
      }
      if ("text" in payload) {
        if (!payload.text?.trim()) {
          return NextResponse.json({ error: "Chapter text unavailable" }, { status: 404 });
        }
        return NextResponse.json(
          { text: payload.text },
          { headers: { "Cache-Control": "public, max-age=1800, stale-while-revalidate=86400" } },
        );
      }
      return NextResponse.json(
        { error: "Nothing readable for this entry" },
        { status: 404 },
      );
    } catch (err) {
      console.error("[api/chapter/file]", id, err);
      return NextResponse.json(
        { error: "Could not open this file in the reader — try downloading it." },
        { status: 502 },
      );
    }
  }

  // readable sources (manga aggregators, madara, mangadex, novels…)
  if (!id.includes("-ch:")) {
    return NextResponse.json({ error: "Unsupported chapter id" }, { status: 400 });
  }

  try {
    // Chapter page lists are shared by every reader and barely ever change —
    // cached for hours centrally, refreshed in the background when stale.
    // Empty payloads (a source hiccup) are only remembered for 10 seconds so
    // the very next request retries for real — hiccups never stick.
    const payload = await pagesCache.wrap(`p:${id}`, TTL.pages, () => resolvePages(id), (val) => {
      if (Array.isArray(val)) return val.length ? TTL.pages : TTL.negative;
      if ("text" in val) return val.text?.trim() ? TTL.pages : TTL.negative;
      if ("audio" in val) return val.audio ? TTL.pages : TTL.negative;
      return TTL.negative;
    });

    if (Array.isArray(payload)) {
      if (!payload.length) {
        return NextResponse.json({ error: "Chapter pages unavailable" }, { status: 404 });
      }
      const proxied = payload.map((p) => `/api/img?url=${encodeURIComponent(p)}`);
      return NextResponse.json(
        { pages: proxied, count: proxied.length },
        { headers: { "Cache-Control": "public, max-age=1800, stale-while-revalidate=86400" } },
      );
    }

    // audiobook track — one streamable URL, cached like everything else
    if ("audio" in payload) {
      if (!payload.audio) {
        return NextResponse.json({ error: "Audio track unavailable" }, { status: 404 });
      }
      return NextResponse.json(
        { audio: payload.audio },
        { headers: { "Cache-Control": "public, max-age=1800, stale-while-revalidate=86400" } },
      );
    }

    // text chapter (novels / web fiction) — the only remaining payload kind
    if (!("text" in payload) || !payload.text?.trim()) {
      return NextResponse.json({ error: "Chapter text unavailable" }, { status: 404 });
    }
    return NextResponse.json(
      { text: payload.text },
      { headers: { "Cache-Control": "public, max-age=1800, stale-while-revalidate=86400" } },
    );
  } catch (err) {
    console.error("[api/chapter]", id, err);
    return NextResponse.json({ error: "Failed to resolve pages" }, { status: 502 });
  }
}
