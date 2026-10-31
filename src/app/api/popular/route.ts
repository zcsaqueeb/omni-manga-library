import { NextRequest, NextResponse } from "next/server";
import { unifiedPopular } from "@/lib/sources";
import { sanitizeLang } from "@/lib/languages";
import type { Category } from "@/lib/sources/types";

const CATEGORIES: Category[] = ["manga", "comic", "book", "novel", "audiobook"];

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const type = (sp.get("type") ?? "manga") as Category;
  const page = Math.max(1, Math.min(20, Number(sp.get("page") ?? 1) || 1));
  const nsfw = sp.get("nsfw") === "1";
  const disabled = (sp.get("disabled") ?? "").split(",").filter(Boolean);
  const lang = sanitizeLang(sp.get("lang"));

  if (!CATEGORIES.includes(type)) {
    return NextResponse.json({ error: "Invalid category" }, { status: 400 });
  }

  const limit = 24;

  try {
    // unifiedPopular is backed by the shared per-source popular cache: each
    // source's row is fetched ONCE for all visitors; personal switches
    // (nsfw / disabled sources) are applied after the cache, per request.
    const row = await unifiedPopular(type, page, limit, { nsfw, disabled, lang });

    return NextResponse.json(row, {
      headers: { "Cache-Control": "public, max-age=120, stale-while-revalidate=600" },
    });
  } catch (err) {
    console.error("[api/popular]", err);
    return NextResponse.json({ error: "Upstream popular failed" }, { status: 502 });
  }
}
