import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getAuthUser, UNAUTHORIZED } from "@/lib/auth";
import type { MediaItem } from "@/lib/sources/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/library/favorites { item, action: "add" | "remove" }
 * Mutates ONE favorite of the signed-in user only.
 */
export async function POST(req: Request) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json(UNAUTHORIZED, { status: 401 });

  let body: { item?: MediaItem; action?: string };
  try {
    body = (await req.json()) ?? {};
  } catch {
    return NextResponse.json({ error: "Invalid body." }, { status: 400 });
  }
  const item = body.item;
  const action = body.action === "remove" ? "remove" : "add";
  if (!item?.id) return NextResponse.json({ error: "Missing item." }, { status: 400 });

  try {
    if (action === "remove") {
      await db.favorite.deleteMany({
        where: { accountId: user.id, itemId: item.id },
      });
    } else {
      await db.favorite.upsert({
        where: { accountId_itemId: { accountId: user.id, itemId: item.id } },
        create: { accountId: user.id, itemId: item.id, data: JSON.stringify(item) },
        update: { data: JSON.stringify(item) },
      });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("favorite mutation failed", err);
    return NextResponse.json({ error: "Could not update favorites." }, { status: 500 });
  }
}
