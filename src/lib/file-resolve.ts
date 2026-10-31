/**
 * Resolve `-file:` chapter ids (archive / openlibrary / gutenberg) into real
 * upstream URLs. Shared by the reader paths (/api/chapter, /api/cbz/page) and
 * the inline streaming in /api/download.
 */

import { fetchJson, upstreamFetch } from "@/lib/http";
import { archiveFileUrl } from "@/lib/sources/archive";
import { olFileUrl } from "@/lib/sources/openlibrary";

/** Probe gutenberg.org direct endpoints, falling back to the Gutendex format map. */
export async function gutenbergFileUrl(bookId: string, mime: string): Promise<string> {
  const fallbacks: Record<string, string> = {
    "application/epub+zip": `.epub3.images`,
    "application/pdf": `.pdf`,
    "application/x-mobipocket-ebook": `.kf8.images`,
  };
  const suffix = fallbacks[mime];
  if (suffix) {
    const probe = await upstreamFetch(
      `https://www.gutenberg.org/ebooks/${encodeURIComponent(bookId)}${suffix}`,
      { method: "HEAD", timeoutMs: 10_000, retries: 0 },
    ).catch(() => null);
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

/** Gutenberg's always-present UTF-8 plain-text URL. */
export function gutenbergTextUrl(bookId: string): string {
  return `https://www.gutenberg.org/ebooks/${encodeURIComponent(bookId)}.txt.utf-8`;
}

export interface ResolvedFile {
  url: string;
  name?: string;
}

/**
 * Resolve any `<source>-file:<…>` entry id into an upstream URL.
 * The id shapes are owned by the adapters in src/lib/sources.
 */
export async function resolveFileUrl(id: string): Promise<ResolvedFile> {
  const [kind, ...rest] = id.split(":");
  const payload = rest.join(":");

  switch (kind) {
    case "archive-file": {
      // archive-file:{identifier}:{fileName}
      const sep = payload.indexOf(":");
      const identifier = payload.slice(0, sep);
      const fileName = payload.slice(sep + 1);
      if (!identifier || !fileName) throw new Error("Bad archive file id");
      return { url: archiveFileUrl(identifier, fileName), name: fileName };
    }
    case "openlibrary-file": {
      // openlibrary-file:{ocaid}:{tail}
      const sep = payload.indexOf(":");
      const ocaid = payload.slice(0, sep);
      const tail = payload.slice(sep + 1);
      if (!ocaid || !tail) throw new Error("Bad Open Library file id");
      const ext = tail.includes("epub") ? "epub" : tail.includes("pdf") ? "pdf" : "txt";
      return { url: olFileUrl(ocaid, tail), name: `${ocaid}.${ext}` };
    }
    case "gutenberg-fmt": {
      // gutenberg-fmt:{bookId}:{mime}
      const sep = payload.indexOf(":");
      const bookId = payload.slice(0, sep);
      const mime = payload.slice(sep + 1);
      if (!bookId || !mime) throw new Error("Bad Gutenberg file id");
      return { url: await gutenbergFileUrl(bookId, mime), name: `gutenberg-${bookId}` };
    }
    case "gutenberg-direct": {
      // gutenberg-direct:{bookId}:{suffix}
      const sep = payload.indexOf(":");
      const bookId = payload.slice(0, sep);
      const suffix = payload.slice(sep + 1);
      if (!bookId || !suffix || !suffix.startsWith(".")) throw new Error("Bad Gutenberg file id");
      return {
        url: `https://www.gutenberg.org/ebooks/${encodeURIComponent(bookId)}${suffix}`,
        name: `gutenberg-${bookId}`,
      };
    }
    default:
      throw new Error(`Unsupported file id: ${kind}`);
  }
}
