import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getAuthUser, UNAUTHORIZED } from "@/lib/auth";
import type { MediaItem } from "@/lib/sources/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_FAVORITES = 200;
const MAX_HISTORY = 48;

/** GET /api/library → the signed-in user's private favorites + history. */
export async function GET() {
  const user = await getAuthUser();
  if (!user) return NextResponse.json(UNAUTHORIZED, { status: 401 });

  const [favs, hist] = await Promise.all([
    db.favorite.findMany({
      where: { accountId: user.id },
      orderBy: { createdAt: "desc" },
      take: MAX_FAVORITES,
    }),
    db.historyEntry.findMany({
      where: { accountId: user.id },
      orderBy: { viewedAt: "desc" },
      take: MAX_HISTORY,
    }),
  ]);

  const parse = (rows: { itemId: string; data: string }[]): MediaItem[] =>
    rows
      .map((r) => {
        try {
          return JSON.parse(r.data) as MediaItem;
        } catch {
          return null;
        }
      })
      .filter((m): m is MediaItem => !!m);

  return NextResponse.json({ favorites: parse(favs), history: parse(hist) });
}

/**
 * POST /api/library — one-shot merge used right after sign-in: pushes the
 * device's local favorites/history into the account, then returns the merged
 * private state (server wins on conflicts; nothing is duplicated).
 */
export async function POST(req: Request) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json(UNAUTHORIZED, { status: 401 });

  let body: { favorites?: MediaItem[]; history?: MediaItem[] };
  try {
    body = (await req.json()) ?? {};
  } catch {
    body = {};
  }
  const favorites = Array.isArray(body.favorites) ? body.favorites.slice(0, MAX_FAVORITES) : [];
  const history = Array.isArray(body.history) ? body.history.slice(0, MAX_HISTORY) : [];

  try {
    await db.$transaction(async (tx) => {
      for (const item of favorites) {
        if (!item?.id) continue;
        await tx.favorite.upsert({
          where: { accountId_itemId: { accountId: user.id, itemId: item.id } },
          create: { accountId: user.id, itemId: item.id, data: JSON.stringify(item) },
          update: {}, // keep the stored copy — earliest save wins
        });
      }
      for (const item of history) {
        if (!item?.id) continue;
        await tx.historyEntry.upsert({
          where: { accountId_itemId: { accountId: user.id, itemId: item.id } },
          create: { accountId: user.id, itemId: item.id, data: JSON.stringify(item) },
          update: { viewedAt: new Date() },
        });
      }
      // trim history beyond the cap
      const rows = await tx.historyEntry.findMany({
        where: { accountId: user.id },
        orderBy: { viewedAt: "desc" },
        skip: MAX_HISTORY,
        select: { id: true },
      });
      if (rows.length) {
        await tx.historyEntry.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } });
      }
    });

    const [favs, hist] = await Promise.all([
      db.favorite.findMany({
        where: { accountId: user.id },
        orderBy: { createdAt: "desc" },
        take: MAX_FAVORITES,
      }),
      db.historyEntry.findMany({
        where: { accountId: user.id },
        orderBy: { viewedAt: "desc" },
        take: MAX_HISTORY,
      }),
    ]);
    const parse = (rows: { data: string }[]): MediaItem[] =>
      rows
        .map((r) => {
          try {
            return JSON.parse(r.data) as MediaItem;
          } catch {
            return null;
          }
        })
        .filter((m): m is MediaItem => !!m);

    return NextResponse.json({ favorites: parse(favs), history: parse(hist) });
  } catch (err) {
    console.error("library sync failed", err);
    return NextResponse.json({ error: "Sync failed." }, { status: 500 });
  }
}
