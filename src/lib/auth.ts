import { randomBytes, scrypt as _scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { cookies } from "next/headers";
import { db } from "@/lib/db";

const scrypt = promisify(_scrypt) as (
  password: string,
  salt: string,
  keylen: number,
) => Promise<Buffer>;

export const SESSION_COOKIE = "ol_session";
const SESSION_DAYS = 30;

/* ─────────────────────────── passwords ─────────────────────────── */

/** scrypt hash with embedded random salt → "salt:hash" (hex). */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const hash = await scrypt(password, salt, 64);
  return `${salt}:${hash.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [salt, hex] = stored.split(":");
  if (!salt || !hex) return false;
  const hash = await scrypt(password, salt, 64);
  const expected = Buffer.from(hex, "hex");
  return hash.length === expected.length && timingSafeEqual(hash, expected);
}

/* ─────────────────────────── validation ─────────────────────────── */

export function validateCredentials(username: unknown, password: unknown): string | null {
  if (typeof username !== "string" || typeof password !== "string") {
    return "Username and password are required.";
  }
  const name = username.trim();
  if (name.length < 3 || name.length > 24) {
    return "Username must be 3–24 characters.";
  }
  if (!/^[a-zA-Z0-9_.-]+$/.test(name)) {
    return "Username may only contain letters, numbers, dots, dashes and underscores.";
  }
  if (typeof password !== "string" || password.length < 4 || password.length > 128) {
    return "Password must be 4–128 characters.";
  }
  return null;
}

/* ─────────────────────────── sessions ─────────────────────────── */

export async function createSession(accountId: string): Promise<void> {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  await db.session.create({ data: { token, accountId, expiresAt } });
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  });
  // opportunistic cleanup of expired sessions
  await db.session.deleteMany({ where: { expiresAt: { lt: new Date() } } }).catch(() => {});
}

export async function destroySession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) {
    await db.session.deleteMany({ where: { token } }).catch(() => {});
  }
  jar.delete(SESSION_COOKIE);
}

export interface AuthUser {
  id: string;
  username: string;
}

/** Resolve the logged-in user from the session cookie (null when guest). */
export async function getAuthUser(): Promise<AuthUser | null> {
  try {
    const jar = await cookies();
    const token = jar.get(SESSION_COOKIE)?.value;
    if (!token) return null;
    const session = await db.session.findUnique({
      where: { token },
      include: { account: { select: { id: true, username: true } } },
    });
    if (!session) return null;
    if (session.expiresAt.getTime() < Date.now()) {
      await db.session.deleteMany({ where: { token } }).catch(() => {});
      return null;
    }
    return { id: session.account.id, username: session.account.username };
  } catch {
    return null;
  }
}

/** Standard 401 body for library routes when not signed in. */
export const UNAUTHORIZED = { error: "Sign in to use your library." };
