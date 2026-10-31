import { NextRequest, NextResponse } from "next/server";
import { detailsCache, TTL } from "@/lib/cache";
import { getSource } from "@/lib/sources";
import { formatChapterNumber, normalizeChapters } from "@/lib/chapter-order";
import type { Details } from "@/lib/sources/types";

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id") ?? "";
  const [sourceId, ...rest] = id.split(":");
  const realId = rest.join(":");

  const adapter = getSource(sourceId);
  if (!adapter || !realId) {
    return NextResponse.json({ error: "Unknown item id" }, { status: 400 });
  }

  try {
    // Shared centrally: first visitor fetches, everyone else reads from memory.
    // Stale copies are served instantly while a background refresh runs.
    // Chapters are normalized here (deduped + strictly ascending by chapter
    // number) so EVERY user gets the same clean in-order list, cached once.
    //
    // Resilience: one transient upstream failure is retried once before we
    // give up, and empty chapter lists are only cached for 60s — a hiccup
    // must never show every user "Nothing published here yet" for 30 minutes.
    const details = await detailsCache.wrap(
      `d2:${id}`,
      TTL.details,
      async () => {
        let lastErr: unknown;
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            const raw = await adapter.details(realId);
            const norm = normalizeChapters(raw.chapters, raw.readable);
            return {
              ...raw,
              chapters: norm.chapters,
              latest:
                raw.latest ??
                (norm.maxNumber !== null ? `Ch. ${formatChapterNumber(norm.maxNumber)}` : undefined),
            } satisfies Details;
          } catch (err) {
            lastErr = err;
            if (attempt === 0) await new Promise((r) => setTimeout(r, 400));
          }
        }
        throw lastErr instanceof Error ? lastErr : new Error("details failed");
      },
      (val) => (val.chapters?.length ? TTL.details : TTL.negative),
    );
    return NextResponse.json(details satisfies Details, {
      headers: { "Cache-Control": "public, max-age=600, stale-while-revalidate=3600" },
    });
  } catch (err) {
    console.error("[api/details]", id, err);
    return NextResponse.json({ error: "Could not load details" }, { status: 502 });
  }
}
