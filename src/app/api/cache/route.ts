import { NextResponse } from "next/server";
import { allCacheStats } from "@/lib/cache";
import { imgCacheStats } from "@/lib/img-cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/cache — visibility into the shared cache: every entry here is
 * content fetched ONCE from upstream and served to ALL users from then on.
 */
export async function GET() {
  return NextResponse.json({
    caches: allCacheStats(),
    images: imgCacheStats(),
    note: "hits = requests served without touching upstream (shared across every user)",
  });
}
