import { NextRequest } from "next/server";
import { Readable } from "node:stream";
import type { ReadableStream as NodeWebReadable } from "node:stream/web";
import { upstreamFetch, fetchJson, pooled } from "@/lib/http";
import { ZipWriter } from "@/lib/zip";
import { chapterPages as mangadexChapterPages } from "@/lib/sources/mangadex";
import { archiveFileUrl } from "@/lib/sources/archive";
import { olFileUrl } from "@/lib/sources/openlibrary";
import { getSource } from "@/lib/sources";

export const runtime = "nodejs";
export const maxDuration = 120;

function safeName(s: string): string {
  return s.replace(/[^\w\d .()-]+/g, "_").slice(0, 120).trim() || "download";
}

/** Some page-image CDNs check the Referer (MangaDex.network ports,
 * fanfox's zjcdn…) — present the reader site's own origin. */
function refererForImage(pageUrl: string, fallbackSite?: string): string | undefined {
  try {
    const host = new URL(pageUrl).hostname;
    if (/mangadex/.test(host)) return "https://mangadex.org/";
    if (/(?:zjcdn\.mangafox|mfcdn\.net|fanfox|fmximg)/.test(host)) return "https://fanfox.net/";
    if (fallbackSite) return `${new URL(fallbackSite).origin}/`;
  } catch {
    /* ignore */
  }
  return fallbackSite ? `${fallbackSite.replace(/\/$/, "")}/` : undefined;
}

async function gutenbergFormatUrl(bookId: string, mime: string): Promise<string> {
  // prefer the direct gutenberg.org file endpoints; gutendex is often rate-limited
  const fallbacks: Record<string, string> = {
    "application/epub+zip": `.epub3.images`,
    "application/pdf": `.pdf` ,
    "application/x-mobipocket-ebook": `.kf8.images`,
  };
  const suffix = fallbacks[mime];
  if (suffix) {
    const probe = await upstreamFetch(`https://www.gutenberg.org/ebooks/${encodeURIComponent(bookId)}${suffix}`, {
      method: "HEAD",
      timeoutMs: 10_000,
      retries: 0,
    }).catch(() => null);
    if (probe?.ok) return `https://www.gutenberg.org/ebooks/${encodeURIComponent(bookId)}${suffix}`;
  }
  const data = await fetchJson<{ formats: Record<string, string> }>(
    `https://gutendex.com/books/${bookId}`,
    { timeoutMs: 12_000 },
  );
  const url = data.formats[mime];
  if (!url) throw new Error("Format unavailable");
  return url;
}

function attachment(name: string, inline = false): string {
  const disposition = inline ? "inline" : "attachment";
  return `${disposition}; filename="${name.replace(/"/g, "")}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

function nodeStream(web: ReadableStream): Readable {
  return Readable.fromWeb(web as unknown as NodeWebReadable);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Stream an upstream file straight to the browser (attachment by default,
 * inline when the in-browser reader needs to render it — PDFs).
 * Retries land on different archive.org datanodes via a fresh redirect each time. */
async function streamFile(url: string, name: string, contentType?: string, inline = false) {
  const res = await upstreamFetch(url, { timeoutMs: 40_000, retries: 2 });
  if (!res.ok || !res.body) throw new Error(`Upstream ${res.status}`);
  const headers = new Headers({
    "Content-Type": contentType ?? res.headers.get("content-type") ?? "application/octet-stream",
    "Content-Disposition": attachment(name, inline),
    "Cache-Control": inline ? "public, max-age=3600" : "no-store",
  });
  const len = res.headers.get("content-length");
  if (len) headers.set("Content-Length", len);
  return new Response(Readable.toWeb(nodeStream(res.body)) as unknown as ReadableStream, { headers });
}

/**
 * Fetch chapter pages in bounded batches and stream a CBZ (store-method zip —
 * images stay bit-exact and the CPU cost is near zero). Works for every
 * source that exposes chapterPages (MangaDex, Madara instances, aggregators…).
 */
async function streamCbz(pages: string[], name: string, siteUrl?: string) {

  const zip = new ZipWriter();
  const done = (async () => {
    try {
      const BATCH = 14;
      for (let start = 0; start < pages.length; start += BATCH) {
        const batch = pages.slice(start, start + BATCH);
        const buffers = await pooled(batch, 4, async (pageUrl, i) => {
          // protocol-relative reader URLs ("//cdn.example/p.jpg") — fetch needs absolute
          const absUrl = pageUrl.startsWith("//") ? `https:${pageUrl}` : pageUrl;
          const referer = refererForImage(absUrl, siteUrl);
          for (let attempt = 0; attempt < 3; attempt++) {
            try {
              const res = await upstreamFetch(absUrl, {
                timeoutMs: 20_000,
                retries: 0,
                headers: referer ? { Referer: referer } : undefined,
              });
              if (!res.ok || !res.body) throw new Error(String(res.status));
              return Buffer.from(await res.arrayBuffer());
            } catch {
              if (attempt === 2) return null; // skip failed page, keep the rest
              await sleep(400 * (attempt + 1));
            }
          }
          return null;
        });

        for (let i = 0; i < buffers.length; i++) {
          const buf = buffers[i];
          if (!buf) continue;
          const ext = pages[start + i].split(".").pop()?.split("?")[0] || "jpg";
          await zip.addFile(`${String(start + i + 1).padStart(3, "0")}.${ext}`, buf);
        }
      }
      await zip.finalize();
    } catch (err) {
      zip.destroy(err instanceof Error ? err : new Error("zip failed"));
    }
  })();

  return new Response(Readable.toWeb(zip.stream) as unknown as ReadableStream, {
    headers: {
      "Content-Type": "application/vnd.comicbook+zip",
      "Content-Disposition": attachment(name.endsWith(".cbz") ? name : `${name}.cbz`),
      "Cache-Control": "no-store",
    },
  });
}

async function resolveChapterPages(id: string): Promise<string[]> {
  const [sourceId] = id.split("-ch:");
  const realId = id.slice(id.indexOf("-ch:") + 4);
  if (sourceId === "mangadex") return mangadexChapterPages(realId);
  const adapter = getSource(sourceId);
  if (!adapter?.chapterPages) throw new Error(`Source ${sourceId} is not readable`);
  const payload = await adapter.chapterPages(realId);
  if (!Array.isArray(payload)) throw new Error("Text chapters cannot be packaged as CBZ");
  return payload;
}

/** Full payload for a readable chapter — pages, novel text or an audiobook stream. */
async function resolveChapterPayload(id: string) {
  const [sourceId] = id.split("-ch:");
  const realId = id.slice(id.indexOf("-ch:") + 4);
  if (sourceId === "mangadex") return mangadexChapterPages(realId);
  const adapter = getSource(sourceId);
  if (!adapter?.chapterPages) throw new Error(`Source ${sourceId} is not readable`);
  return adapter.chapterPages(realId);
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const id = sp.get("id") ?? "";
  const title = safeName(sp.get("title") ?? "download");
  const inline = sp.get("inline") === "1"; // reader mode — render instead of download
  const [kind, ...rest] = id.split(":");
  const payload = rest.join(":");

  try {
    switch (kind) {
      case "mangadex-ch": {
        if (!payload) return new Response("Bad id", { status: 400 });
        const pages = await resolveChapterPages(id);
        if (!pages.length) throw new Error("No pages found");
        return await streamCbz(pages, title, "https://mangadex.org");
      }
      case "archive-file": {
        // archive-file:{identifier}:{fileName}
        const sep = payload.indexOf(":");
        const identifier = payload.slice(0, sep);
        const fileName = payload.slice(sep + 1);
        if (!identifier || !fileName) return new Response("Bad id", { status: 400 });
        const url = archiveFileUrl(identifier, fileName);
        return await streamFile(url, safeName(fileName), undefined, inline);
      }
      case "standardebooks-file": {
        // standardebooks-file:<base64url href>
        const href = Buffer.from(payload, "base64url").toString("utf8");
        if (!href.startsWith("https://standardebooks.org/")) return new Response("Bad id", { status: 400 });
        const ext = href.includes(".azw3") ? "azw3" : href.includes(".kepub") ? "kepub.epub" : "epub";
        return await streamFile(href, `${title}.${ext}`);
      }
      case "gutenberg-fmt": {
        // gutenberg-fmt:{bookId}:{mime}
        const sep = payload.indexOf(":");
        const bookId = payload.slice(0, sep);
        const mime = payload.slice(sep + 1);
        if (!bookId || !mime) return new Response("Bad id", { status: 400 });
        const url = await gutenbergFormatUrl(bookId, mime);
        const ext = mime.includes("epub")
          ? "epub"
          : mime.includes("pdf")
            ? "pdf"
            : mime.includes("mobipocket")
              ? "mobi"
              : "txt";
        return await streamFile(url, `${title}.${ext}`, undefined, inline);
      }
      case "gutenberg-direct": {
        // gutenberg-direct:{bookId}:{suffix} — e.g. .epub3.images
        const sep = payload.indexOf(":");
        const bookId = payload.slice(0, sep);
        const suffix = payload.slice(sep + 1);
        if (!bookId || !suffix || !suffix.startsWith(".")) return new Response("Bad id", { status: 400 });
        const ext = suffix.includes("epub") ? "epub" : suffix.includes("kf8") ? "mobi" : "txt";
        return await streamFile(`https://www.gutenberg.org/ebooks/${encodeURIComponent(bookId)}${suffix}`, `${title}.${ext}`);
      }
      case "librivox-ch": {
        // librivox-ch:{identifier}:{fileName} — one mp3 track
        const sep = payload.indexOf(":");
        const identifier = payload.slice(0, sep);
        const fileName = payload.slice(sep + 1);
        if (!identifier || !fileName) return new Response("Bad id", { status: 400 });
        const url = `https://archive.org/download/${encodeURIComponent(identifier)}/${fileName
          .split("/")
          .map(encodeURIComponent)
          .join("/")}`;
        return await streamFile(url, `${title}.mp3`, "audio/mpeg");
      }
      case "librivox-zip": {
        // librivox-zip:{identifier} — the whole audiobook as one zip
        if (!payload) return new Response("Bad id", { status: 400 });
        const url = `https://archive.org/compress/${encodeURIComponent(
          payload,
        )}/formats=64KBPS%20MP3&file=/${encodeURIComponent(payload)}.zip`;
        return await streamFile(url, `${title}.zip`, "application/zip");
      }
      case "ia-audio-zip": {
        // ia-audio-zip:{identifier} — whole audiobook as one zip; the format
        // filter is resolved from live metadata so the archive endpoint
        // produces one complete zip of exactly the playable tracks
        if (!payload) return new Response("Bad id", { status: 400 });
        const meta = await fetchJson<{ files?: { name: string; format?: string }[] }>(
          `https://archive.org/metadata/${encodeURIComponent(payload)}`,
          { timeoutMs: 15_000 },
        );
        const playable = (meta.files ?? []).filter((f) => /\.(mp3|ogg)$/i.test(f.name));
        if (!playable.length) throw new Error("No audio files in this item");
        const fmts = [...new Set(playable.map((f) => (f.format ?? "").trim()).filter(Boolean))];
        const formatQ = fmts.length === 1 ? `/formats=${encodeURIComponent(fmts[0])}` : "";
        const zipUrl = `https://archive.org/compress/${encodeURIComponent(payload)}${formatQ}`;
        return await streamFile(zipUrl, `${title}.zip`, "application/zip");
      }
      case "openlibrary-file": {
        // openlibrary-file:{ocaid}:{tail}
        const sep = payload.indexOf(":");
        const ocaid = payload.slice(0, sep);
        const tail = payload.slice(sep + 1);
        if (!ocaid || !tail) return new Response("Bad id", { status: 400 });
        const ext = tail.includes("epub") ? "epub" : tail.includes("pdf") ? "pdf" : "txt";
        return await streamFile(olFileUrl(ocaid, tail), `${title}.${ext}`, undefined, inline);
      }
      default: {
        // generic readable chapter from any adapter → CBZ / TXT / MP3
        if (/^[a-z0-9-]+-ch:/.test(id)) {
          const result = await resolveChapterPayload(id);
          if (Array.isArray(result)) {
            if (!result.length) throw new Error("No pages found");
            const sourceId = id.split("-ch:")[0];
            const site = getSource(sourceId)?.siteUrl;
            return await streamCbz(result, title, site);
          }
          if ("text" in result) {
            if (!result.text?.trim()) throw new Error("Empty chapter text");
            // novel chapters download as clean plain-text files
            return new Response(result.text, {
              headers: {
                "Content-Type": "text/plain; charset=utf-8",
                "Content-Disposition": attachment(`${title}.txt`),
                "Cache-Control": "no-store",
              },
            });
          }
          if ("audio" in result && result.audio) {
            return await streamFile(result.audio, `${title}.mp3`, "audio/mpeg");
          }
          throw new Error("Unsupported chapter payload");
        }
        return new Response("Unsupported download kind", { status: 400 });
      }
    }
  } catch (err) {
    console.error("[api/download]", id, err);
    return new Response("Download failed upstream", { status: 502 });
  }
}

// zip writer: custom store-method implementation (src/lib/zip.ts)
