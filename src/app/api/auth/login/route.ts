import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { createSession, verifyPassword } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/auth/login { username, password } → session cookie. */
export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  const { username, password } = (body ?? {}) as { username?: string; password?: string };
  if (typeof username !== "string" || typeof password !== "string" || !username.trim()) {
    return NextResponse.json({ error: "Username and password are required." }, { status: 400 });
  }

  try {
    const account = await db.account.findUnique({
      where: { username: username.trim() },
    });
    if (!account || !(await verifyPassword(password, account.passwordHash))) {
      return NextResponse.json({ error: "Wrong username or password." }, { status: 401 });
    }
    await createSession(account.id);
    return NextResponse.json({ user: { id: account.id, username: account.username } });
  } catch (err) {
    console.error("login failed", err);
    return NextResponse.json({ error: "Could not sign in." }, { status: 500 });
  }
}
