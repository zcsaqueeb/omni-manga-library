/**
 * CBZ (zip) range-reader — lets the site READ comic-book archives without
 * downloading them whole.
 *
 * The server fetches only the ZIP central directory (last ~64KB) and then
 * pulls individual page images with HTTP Range requests. A 400 MB archive
 * becomes a streamable, page-by-page reader with megabyte-sized reads.
 *
 * Works for every CBZ/ZIP the sources expose: Internet Archive comic scans,
 * Open Library scans packaged as zip, and any future direct-zip source.
 */

import { inflateRawSync } from "node:zlib";
import { upstreamFetch } from "@/lib/http";

export interface ZipEntryRef {
  name: string;
  /** 0 = stored, 8 = deflate */
  method: number;
  compressedSize: number;
  /** absolute offset of the local file header inside the zip */
  localOffset: number;
}

interface ZipDirectory {
  entries: ZipEntryRef[];
  /** Ordered page images (jpg/png/webp) in natural page order. */
  pages: ZipEntryRef[];
}

/* ── small LRU so repeated page fetches skip directory re-parsing ── */
const dirCache = new Map<string, ZipDirectory>();
const DIR_CACHE_MAX = 24;

async function fetchRange(url: string, start?: number, end?: number): Promise<Buffer> {
  const range = start === undefined ? "bytes=-65536" : `bytes=${start}-${end ?? ""}`;
  const res = await upstreamFetch(url, {
    headers: { Range: range, Accept: "*/*" },
    timeoutMs: 25_000,
    retries: 1,
  });
  if (!res.ok && res.status !== 206) {
    throw new Error(`Upstream ${res.status} for zip range`);
  }
  return Buffer.from(await res.arrayBuffer());
}

function u16(b: Buffer, o: number): number {
  return b.readUInt16LE(o);
}
function u32(b: Buffer, o: number): number {
  return b.readUInt32LE(o);
}

const IMAGE_RE = /\.(jpe?g|png|webp|gif)$/i;

/** Natural sort so page-2 comes before page-10. */
function naturalCompare(a: string, b: string): number {
  return a.replace(/\d+/g, (d) => d.padStart(10, "0")).localeCompare(
    b.replace(/\d+/g, (d) => d.padStart(10, "0")),
  );
}

/** Fetch & parse the ZIP central directory of a remote archive. */
export async function readZipDirectory(url: string): Promise<ZipDirectory> {
  const cached = dirCache.get(url);
  if (cached) {
    // refresh LRU position
    dirCache.delete(url);
    dirCache.set(url, cached);
    return cached;
  }

  // 1) locate the End-Of-Central-Directory record in the last 64KB
  const tail = await fetchRange(url);
  const eocd = tail.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd === -1) throw new Error("Not a zip archive (no EOCD)");

  const cdSize = u32(tail, eocd + 12);
  const cdOffset = u32(tail, eocd + 16);
  if (cdOffset === 0xffffffff || cdSize === 0xffffffff) {
    throw new Error("ZIP64 archives are not supported for in-browser reading");
  }

  // 2) reuse the tail when the whole directory happens to sit inside it,
  //    otherwise fetch the directory range explicitly
  const cdStartInTail = eocd - cdSize;
  let cd: Buffer;
  if (cdSize > 0 && cdStartInTail >= 0 && u32(tail, cdStartInTail) === 0x02014b50) {
    cd = tail.subarray(cdStartInTail, cdStartInTail + cdSize);
  } else {
    cd = await fetchRange(url, cdOffset, cdOffset + cdSize - 1);
  }

  // 3) walk central-directory records
  const entries: ZipEntryRef[] = [];
  let p = 0;
  while (p + 46 <= cd.length && entries.length < 5000) {
    if (u32(cd, p) !== 0x02014b50) break;
    const nameLen = u16(cd, p + 28);
    const extraLen = u16(cd, p + 30);
    const commentLen = u16(cd, p + 32);
    const method = u16(cd, p + 10);
    const compressedSize = u32(cd, p + 20);
    const localOffset = u32(cd, p + 42);
    const name = cd.subarray(p + 46, p + 46 + nameLen).toString("utf8");
    if (name) entries.push({ name, method, compressedSize, localOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }

  const pages = entries
    .filter((e) => IMAGE_RE.test(e.name) && !e.name.includes("__MACOSX"))
    .sort((a, b) => naturalCompare(a.name, b.name));

  const dir: ZipDirectory = { entries, pages };
  dirCache.set(url, dir);
  if (dirCache.size > DIR_CACHE_MAX) {
    dirCache.delete(dirCache.keys().next().value as string);
  }
  return dir;
}

/** Extract one file from the remote zip — ideally a single ranged request:
 * over-fetch header+extra padding, then slice the payload out of the buffer. */
export async function readZipEntry(url: string, entry: ZipEntryRef): Promise<Buffer> {
  const pad = 30 + entry.name.length + 1024; // local header + name + extra slack
  const buf = await fetchRange(url, entry.localOffset, entry.localOffset + pad + entry.compressedSize - 1);

  if (u32(buf, 0) === 0x04034b50) {
    const nameLen = u16(buf, 26);
    const extraLen = u16(buf, 28);
    const dataStart = 30 + nameLen + extraLen;
    if (dataStart + entry.compressedSize <= buf.length) {
      const data = buf.subarray(dataStart, dataStart + entry.compressedSize);
      if (entry.method === 0) return Buffer.from(data);
      if (entry.method === 8) return inflateRawSync(data);
      throw new Error(`Unsupported compression method ${entry.method}`);
    }
  }

  // fall back: header slice didn't cover the payload — read data precisely
  const head = await fetchRange(url, entry.localOffset, entry.localOffset + 29);
  if (u32(head, 0) !== 0x04034b50) throw new Error("Bad local header");
  const nameLen = u16(head, 26);
  const extraLen = u16(head, 28);
  const dataStartAbs = entry.localOffset + 30 + nameLen + extraLen;
  const data = await fetchRange(url, dataStartAbs, dataStartAbs + entry.compressedSize - 1);
  if (entry.method === 0) return data;
  if (entry.method === 8) return inflateRawSync(data);
  throw new Error(`Unsupported compression method ${entry.method}`);
}

export function imageContentType(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "png":
      return "image/png";
    case "webp":
      return "image/webp";
    case "gif":
      return "image/gif";
    default:
      return "image/jpeg";
  }
}
