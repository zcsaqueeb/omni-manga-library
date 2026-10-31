import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getAuthUser, UNAUTHORIZED } from "@/lib/auth";
import type { MediaItem } from "@/lib/sources/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/library/history { item } — upsert as most-recent for this user. */
export async function POST(req: Request) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json(UNAUTHORIZED, { status: 401 });

  let body: { item?: MediaItem };
  try {
    body = (await req.json()) ?? {};
  } catch {
    return NextResponse.json({ error: "Invalid body." }, { status: 400 });
  }
  const item = body.item;
  if (!item?.id) return NextResponse.json({ error: "Missing item." }, { status: 400 });

  try {
    await db.historyEntry.upsert({
      where: { accountId_itemId: { accountId: user.id, itemId: item.id } },
      create: { accountId: user.id, itemId: item.id, data: JSON.stringify(item) },
      update: { viewedAt: new Date(), data: JSON.stringify(item) },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("history push failed", err);
    return NextResponse.json({ error: "Could not save history." }, { status: 500 });
  }
}

/** DELETE /api/library/history — clears ONLY this user's history. */
export async function DELETE() {
  const user = await getAuthUser();
  if (!user) return NextResponse.json(UNAUTHORIZED, { status: 401 });

  try {
    await db.historyEntry.deleteMany({ where: { accountId: user.id } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("history clear failed", err);
    return NextResponse.json({ error: "Could not clear history." }, { status: 500 });
  }
}
