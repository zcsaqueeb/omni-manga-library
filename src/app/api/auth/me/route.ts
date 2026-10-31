import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/auth/me → { user: { id, username } | null } */
export async function GET() {
  const user = await getAuthUser();
  return NextResponse.json({ user });
}
