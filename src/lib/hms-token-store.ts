// HMS token propagation that does not depend on the database.
//
// The browser extension pushes the HMS access token to /api/user/set-token.
// Historically that token was only persisted in Postgres, so a database
// outage left every dashboard without a token. The token is now also kept in
// (a) a per-instance memory cache and (b) httpOnly cookies of this origin,
// which survive cold starts and new lambda instances.

import { gzipSync, gunzipSync } from "zlib";
import type { NextRequest, NextResponse } from "next/server";

export interface TokenEntry {
  token: string;
  refreshToken?: string | null;
  expiresAt?: number | null;
  updatedAt: number;
}

const CHUNK_SIZE = 3200;
const PREFIX = "__hms_tk_";
const COUNT_COOKIE = "__hms_tk_n";
const PAYLOAD_COOKIE = "__hms_tk_p";
const MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

const cache = globalThis as unknown as {
  __hmsTokens?: Map<string, TokenEntry>;
  __hmsLastToken?: TokenEntry;
};

function memory(): Map<string, TokenEntry> {
  if (!cache.__hmsTokens) cache.__hmsTokens = new Map();
  return cache.__hmsTokens;
}

export function rememberToken(userId: string, entry: TokenEntry): void {
  const store = memory();
  store.set(userId, entry);
  cache.__hmsLastToken = entry;
  if (store.size > 50) {
    const oldest = store.keys().next().value;
    if (oldest && oldest !== userId) store.delete(oldest);
  }
}

export function recallToken(userId: string): TokenEntry | null {
  return memory().get(userId) ?? null;
}

/** Last token pushed to this instance, used when the push came from another session id. */
export function recallLastToken(): TokenEntry | null {
  return cache.__hmsLastToken ?? null;
}

function encode(value: string): string {
  return gzipSync(Buffer.from(value, "utf8")).toString("base64url");
}

function decode(value: string): string | null {
  try {
    return gunzipSync(Buffer.from(value, "base64url")).toString("utf8");
  } catch {
    return null;
  }
}

export function readTokenFromCookies(req: NextRequest): TokenEntry | null {
  const count = Number(req.cookies.get(COUNT_COOKIE)?.value ?? 0);
  if (!count || Number.isNaN(count)) return null;

  let encoded = "";
  for (let i = 0; i < count; i += 1) {
    const part = req.cookies.get(`${PREFIX}${i}`)?.value;
    if (!part) return null;
    encoded += part;
  }

  const token = decode(encoded);
  if (!token) return null;

  const rawExpires = req.cookies.get(PAYLOAD_COOKIE)?.value;
  const expiresAt = rawExpires ? Number(rawExpires) : null;

  return {
    token,
    expiresAt: expiresAt && Number.isFinite(expiresAt) ? expiresAt : null,
    updatedAt: Date.now(),
  };
}

function cookieMaxAge(entry: TokenEntry): number {
  if (!entry.expiresAt) return MAX_AGE_SECONDS;
  const remaining = Math.floor((entry.expiresAt - Date.now()) / 1000);
  // Keep a just-expired token briefly: HMS may still accept it.
  if (remaining <= 0) return 600;
  return Math.min(remaining, MAX_AGE_SECONDS);
}

export function readTokenChunkCount(req: NextRequest): number {
  const value = Number(req.cookies.get(COUNT_COOKIE)?.value ?? 0);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

export function writeTokenCookies(
  res: NextResponse,
  entry: TokenEntry,
  previousChunks = 0
): void {
  const encoded = encode(entry.token);
  const chunks: string[] = [];
  for (let i = 0; i < encoded.length; i += CHUNK_SIZE) {
    chunks.push(encoded.slice(i, i + CHUNK_SIZE));
  }

  const maxAge = cookieMaxAge(entry);
  const base = {
    httpOnly: true,
    secure: true,
    sameSite: "lax" as const,
    path: "/",
    maxAge,
  };

  chunks.forEach((chunk, index) => {
    res.cookies.set(`${PREFIX}${index}`, chunk, base);
  });
  res.cookies.set(COUNT_COOKIE, String(chunks.length), base);
  res.cookies.set(PAYLOAD_COOKIE, String(entry.expiresAt ?? ""), base);

  // Drop chunks from a previously longer token.
  for (let i = chunks.length; i < Math.min(previousChunks, 8); i += 1) {
    res.cookies.delete({ name: `${PREFIX}${i}`, path: "/" });
  }
}

export function clearTokenCookies(res: NextResponse): void {
  for (let i = 0; i < 8; i += 1) {
    res.cookies.delete({ name: `${PREFIX}${i}`, path: "/" });
  }
  res.cookies.delete({ name: COUNT_COOKIE, path: "/" });
  res.cookies.delete({ name: PAYLOAD_COOKIE, path: "/" });
}
