import crypto from "crypto";
import { cookies } from "next/headers";
import type { NextResponse } from "next/server";

export type Session = { name: string };

const COOKIE_NAME = "courseops_session";

function requireSecret() {
  const secret = String(process.env.COURSEOPS_SESSION_SECRET || "");
  if (!secret) throw new Error("COURSEOPS_SESSION_SECRET is required");
  return secret;
}

function b64url(input: string) {
  return Buffer.from(input, "utf8").toString("base64url");
}

function sign(data: string, secret: string) {
  return crypto.createHmac("sha256", secret).update(data).digest("base64url");
}

function encodeSession(session: Session, secret: string) {
  const now = Date.now();
  const payload = JSON.stringify({ ...session, iat: now, exp: now + 30 * 24 * 60 * 60 * 1000 });
  const token = b64url(payload);
  const sig = sign(token, secret);
  return `${token}.${sig}`;
}

function decodeSession(raw: string, secret: string): Session | null {
  const parts = String(raw || "").split(".");
  if (parts.length !== 2) return null;
  const [token, sig] = parts;
  const expected = sign(token, secret);
  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  } catch {
    return null;
  }
  let payload: any = null;
  try {
    payload = JSON.parse(Buffer.from(token, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!payload || typeof payload !== "object") return null;
  const exp = Number(payload.exp || 0);
  if (!exp || Date.now() > exp) return null;
  const name = String(payload.name || "").trim();
  if (!name) return null;
  return { name };
}

export async function getSession(): Promise<Session | null> {
  const secret = requireSecret();
  const jar = cookies();
  const raw = jar.get(COOKIE_NAME)?.value || "";
  return decodeSession(raw, secret);
}

export async function requireSession(): Promise<Session> {
  const s = await getSession();
  if (!s) throw new Error("unauthorized");
  return s;
}

export function setSessionCookie(res: NextResponse, session: Session) {
  const secret = requireSecret();
  res.cookies.set({
    name: COOKIE_NAME,
    value: encodeSession(session, secret),
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
}

export function clearSessionCookie(res: NextResponse) {
  res.cookies.set({ name: COOKIE_NAME, value: "", path: "/", maxAge: 0 });
}
