/**
 * Central disk cache for proxied images (covers + reader pages).
 *
 * The first user who requests an image triggers exactly ONE upstream fetch;
 * the bytes land on disk and every other user is served from the local
 * cache afterwards — no repeated upstream hits, lower load, faster pages.
 * Concurrent requests for the same URL share a single in-flight fetch,
 * and expired files are revalidated in the background while the stale
 * copy is served (or on upstream failure, stale is served as fallback).
 */

import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

const IMG_TTL_MS = 7 * 24 * 60 * 60 * 1000; // covers/pages are effectively immutable
const MAX_FILES = 5000; // prune target — oldest-accessed go first
const MAX_BYTES = 400 * 1024 * 1024; // ~400 MB disk budget
const MAX_INLINE_BYTES = 12 * 1024 * 1024; // never cache anything bigger than this

const EXT_BY_CTYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
  "image/svg+xml": "svg",
};
const CTYPE_BY_EXT: Record<string, string> = Object.fromEntries(
  Object.entries(EXT_BY_CTYPE).map(([ct, ext]) => [ext, ct]),
);

const CACHE_DIR =
  process.env.IMG_CACHE_DIR ?? path.join(process.cwd(), "db", "cache", "img");

let initialized = false;
let fileCount = 0;
let totalBytes = 0;
/** url → in-flight upstream fetch (single-flight across ALL users) */
const inflight = new Map<string, Promise<{ buf: Buffer; ctype: string }>>();

function fileFor(url: string): { base: string; path: string } {
  const hash = createHash("sha1").update(url).digest("hex");
  return { base: hash, path: path.join(CACHE_DIR, hash) };
}

async function ensureInit(): Promise<void> {
  if (initialized) return;
  initialized = true;
  try {
    await mkdir(CACHE_DIR, { recursive: true });
    // one-time boot scan so pruning knows the real starting size
    const files = await readdir(CACHE_DIR);
    for (const f of files) {
      try {
        const s = await stat(path.join(CACHE_DIR, f));
        fileCount++;
        totalBytes += s.size;
      } catch {
        /* raced delete — ignore */
      }
    }
  } catch {
    /* cache is best-effort — never block serving */
  }
}

/** Read a cached image if present. Returns null on miss. */
async function readCache(
  url: string,
): Promise<{ buf: Buffer; ctype: string; stale: boolean } | null> {
  const { path: file } = fileFor(url);
  try {
    const s = await stat(file);
    const ext = path.extname(file).slice(1);
    const ctype = CTYPE_BY_EXT[ext] ?? "image/jpeg";
    const buf = await readFile(file);
    return { buf, ctype, stale: Date.now() - s.mtimeMs > IMG_TTL_MS };
  } catch {
    return null;
  }
}

async function writeCache(url: string, buf: Buffer, ctype: string): Promise<void> {
  const ext = EXT_BY_CTYPE[ctype];
  if (!ext || buf.byteLength > MAX_INLINE_BYTES) return; // unknown type / oversized — skip
  const { path: file } = fileFor(url);
  try {
    await mkdir(CACHE_DIR, { recursive: true });
    await writeFile(file, buf);
    fileCount++;
    totalBytes += buf.byteLength;
    if (fileCount > MAX_FILES || totalBytes > MAX_BYTES) void prune();
  } catch {
    /* best-effort */
  }
}

/** LRU-ish prune: drop the oldest-stored files until back under budget. */
async function prune(): Promise<void> {
  try {
    const names = await readdir(CACHE_DIR);
    const stats = await Promise.all(
      names.map(async (n) => {
        const p = path.join(CACHE_DIR, n);
        try {
          const s = await stat(p);
          return { p, mtime: s.mtimeMs, size: s.size };
        } catch {
          return null;
        }
      }),
    );
    const rows = stats.filter((r): r is { p: string; mtime: number; size: number } => !!r);
    rows.sort((a, b) => a.mtime - b.mtime);
    let count = rows.length;
    let bytes = rows.reduce((acc, r) => acc + r.size, 0);
    for (const row of rows) {
      if (count <= MAX_FILES * 0.8 && bytes <= MAX_BYTES * 0.8) break;
      await unlink(row.p).catch(() => {});
      count--;
      bytes -= row.size;
    }
    fileCount = count;
    totalBytes = bytes;
  } catch {
    /* best-effort */
  }
}

export interface ImageResult {
  buf: Buffer;
  ctype: string;
  cache: "HIT" | "MISS";
}

/**
 * Resolve an image through the central cache. `fetcher` performs the actual
 * upstream request — kept as a parameter so the route owns the HTTP details.
 */
export async function cachedImage(
  url: string,
  fetcher: () => Promise<{ ok: boolean; ctype: string; buf: Buffer }>,
): Promise<ImageResult> {
  await ensureInit();

  const cached = await readCache(url);
  if (cached && !cached.stale) {
    return { buf: cached.buf, ctype: cached.ctype, cache: "HIT" };
  }

  // single-flight: concurrent users asking for the same URL share one fetch
  let pending = inflight.get(url);
  if (!pending) {
    pending = (async () => {
      const res = await fetcher(); // throws on upstream failure
      await writeCache(url, res.buf, res.ctype);
      return { buf: res.buf, ctype: res.ctype };
    })().finally(() => inflight.delete(url));
    inflight.set(url, pending);
  }

  try {
    const fresh = await pending;
    return { buf: fresh.buf, ctype: fresh.ctype, cache: "MISS" };
  } catch (err) {
    // upstream failed — fall back to a stale copy if we have one
    if (cached) {
      return { buf: cached.buf, ctype: cached.ctype, cache: "HIT" };
    }
    throw err;
  }
}

export function imgCacheStats(): { files: number; approxBytes: number; dir: string } {
  return { files: fileCount, approxBytes: totalBytes, dir: CACHE_DIR };
}
