import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { createSession, hashPassword, validateCredentials } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/auth/register { username, password } → creates a private account. */
export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  const { username, password } = (body ?? {}) as { username?: string; password?: string };

  const invalid = validateCredentials(username, password);
  if (invalid) return NextResponse.json({ error: invalid }, { status: 400 });

  const name = (username as string).trim();
  try {
    const exists = await db.account.findUnique({ where: { username: name } });
    if (exists) {
      return NextResponse.json(
        { error: "That username is taken — try another." },
        { status: 409 },
      );
    }
    const account = await db.account.create({
      data: { username: name, passwordHash: await hashPassword(password as string) },
    });
    await createSession(account.id);
    return NextResponse.json({ user: { id: account.id, username: account.username } });
  } catch (err) {
    console.error("register failed", err);
    return NextResponse.json({ error: "Could not create the account." }, { status: 500 });
  }
}
