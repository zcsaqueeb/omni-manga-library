import { NextRequest } from "next/server";
import { readZipDirectory, readZipEntry, imageContentType } from "@/lib/cbz";
import { resolveFileUrl } from "@/lib/file-resolve";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Reader pages cap at this width — archive scans are often 2000-3000px wide. */
const MAX_READER_WIDTH = 1400;

/**
 * GET /api/cbz/page?id=<fileId>&entry=<zipEntryName>
 *
 * Serves ONE page image out of a remote CBZ/zip using HTTP Range requests —
 * the whole archive is never downloaded server-side. Oversized scans are
 * downscaled with sharp so pages load fast; downloads keep the original.
 */
export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id") ?? "";
  const entryName = req.nextUrl.searchParams.get("entry") ?? "";
  if (!id || !entryName) {
    return new Response("Missing id or entry", { status: 400 });
  }

  try {
    const { url } = await resolveFileUrl(id);
    const dir = await readZipDirectory(url);
    const entry =
      dir.pages.find((e) => e.name === entryName) ??
      dir.entries.find((e) => e.name === entryName);
    if (!entry) return new Response("Page not found in archive", { status: 404 });

    let buf = await readZipEntry(url, entry);
    let contentType = imageContentType(entry.name);

    // Downscale huge scans for fast reading (originals still go out via /api/download)
    if (buf.length > 500_000) {
      try {
        const sharp = (await import("sharp")).default;
        const optimized = await sharp(buf)
          .rotate()
          .resize({ width: MAX_READER_WIDTH, withoutEnlargement: true })
          .jpeg({ quality: 82, progressive: true, mozjpeg: true })
          .toBuffer();
        if (optimized.length < buf.length) {
          buf = optimized;
          contentType = "image/jpeg";
        }
      } catch {
        /* keep original bytes when sharp is unavailable or fails */
      }
    }

    return new Response(new Uint8Array(buf), {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
      },
    });
  } catch (err) {
    console.error("[api/cbz/page]", id, entryName, err);
    return new Response("Could not extract page from archive", { status: 502 });
  }
}
