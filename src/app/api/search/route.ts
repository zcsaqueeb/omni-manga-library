import { NextRequest, NextResponse } from "next/server";
import { cachedSearch } from "@/lib/sources";
import { sanitizeLang } from "@/lib/languages";
import type { Category } from "@/lib/sources/types";

const CATEGORIES: Category[] = ["manga", "comic", "book", "novel", "audiobook"];

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const q = (sp.get("q") ?? "").trim();
  const type = (sp.get("type") ?? "manga") as Category;
  const page = Math.max(1, Math.min(50, Number(sp.get("page") ?? 1) || 1));
  const limit = Math.max(6, Math.min(48, Number(sp.get("limit") ?? 24) || 24));
  const source = sp.get("source") ?? undefined;
  const nsfw = sp.get("nsfw") === "1";
  const disabled = (sp.get("disabled") ?? "").split(",").filter(Boolean);
  const lang = sanitizeLang(sp.get("lang"));

  if (!CATEGORIES.includes(type)) {
    return NextResponse.json({ error: "Invalid category" }, { status: 400 });
  }
  if (!q) {
    return NextResponse.json({ error: "Missing query" }, { status: 400 });
  }

  try {
    const result = await cachedSearch(type, q, page, limit, source, { nsfw, disabled, lang });
    return NextResponse.json(result, {
      headers: { "Cache-Control": "public, max-age=60, stale-while-revalidate=300" },
    });
  } catch (err) {
    console.error("[api/search]", err);
    return NextResponse.json({ error: "Search failed upstream" }, { status: 502 });
  }
}
