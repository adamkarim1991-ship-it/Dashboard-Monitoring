// Token + hub resolution shared by the dashboard data routes.
//
// Resolution order is designed so a dashboard keeps serving live HMS data even
// when Postgres is unreachable: the identity data needed (user id, hub list)
// already lives in the NextAuth JWT, and the HMS token can come from the
// extension push (cookie / instance memory) instead of the database.

import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { dbRead } from "@/lib/db-safe";
import {
  recallLastToken,
  recallToken,
  readTokenFromCookies,
  rememberToken,
  type TokenEntry,
} from "@/lib/hms-token-store";

export const DEFAULT_HUB = {
  hmsHubId: process.env.HMS_DEFAULT_HUB_ID || "460450593288",
  name: process.env.HMS_DEFAULT_HUB_NAME || "GTL Jatinegara Hub",
};

export interface SessionHub {
  id?: string;
  name: string;
  hmsHubId: string;
  role?: string;
}

export interface SessionUserLike {
  id?: string;
  hubs?: SessionHub[];
  hmsHubIds?: string[];
  activeHubId?: string | null;
  hmsToken?: string | null;
}

export interface ResolvedHub {
  id?: string;
  name: string;
  hmsHubId: string;
}

interface TokenCandidate {
  token: string;
  source: string;
  expiresAt: number;
}

function newest(candidates: TokenCandidate[]): TokenCandidate | null {
  const usable = candidates.filter((c) => c.token && c.token.length > 50);
  if (usable.length === 0) return null;
  return usable.reduce((best, current) =>
    current.expiresAt > best.expiresAt ? current : best
  );
}

/**
 * Resolve the HMS access token for a request.
 * cookie (fresh extension push) > instance memory > database > session JWT > env.
 */
export async function resolveHmsToken(
  req: NextRequest | null,
  userId: string,
  sessionUser?: SessionUserLike
): Promise<{ token: string | null; source: string }> {
  const candidates: TokenCandidate[] = [];

  const fromCookie = req ? readTokenFromCookies(req) : null;
  if (fromCookie) {
    candidates.push({
      token: fromCookie.token,
      source: "cookie",
      expiresAt: fromCookie.expiresAt ?? 0,
    });
  }

  const fromMemory = recallToken(userId) ?? recallLastToken();
  if (fromMemory) {
    candidates.push({
      token: fromMemory.token,
      source: "memory",
      expiresAt: fromMemory.expiresAt ?? 0,
    });
  }

  const dbRow = await dbRead(
    () =>
      prisma.user.findUnique({
        where: { id: userId },
        select: { hmsToken: true, hmsTokenExpiresAt: true },
      }),
    null,
    "user.hmsToken"
  );

  if (dbRow?.hmsToken) {
    candidates.push({
      token: dbRow.hmsToken,
      source: "database",
      expiresAt: dbRow.hmsTokenExpiresAt?.getTime() ?? 0,
    });
  }

  if (sessionUser?.hmsToken) {
    candidates.push({
      token: sessionUser.hmsToken,
      source: "session",
      expiresAt: 0,
    });
  }

  if (process.env.HMS_TOKEN) {
    candidates.push({
      token: process.env.HMS_TOKEN,
      source: "env",
      expiresAt: 0,
    });
  }

  const best = newest(candidates);
  return best ? { token: best.token, source: best.source } : { token: null, source: "none" };
}

/** Keep a pushed token available to this instance even if the DB write fails. */
export function storePushedToken(
  userId: string,
  data: { token: string; refreshToken?: string | null; expiresAt?: number | null }
): TokenEntry {
  const entry: TokenEntry = {
    token: data.token,
    refreshToken: data.refreshToken ?? null,
    expiresAt: data.expiresAt ?? null,
    updatedAt: Date.now(),
  };
  rememberToken(userId, entry);
  return entry;
}

/**
 * Resolve the active hub. Falls back to the hub list embedded in the JWT when
 * the database is unavailable, then to the default (Jatinegara) hub.
 */
export async function resolveActiveHub(
  userId: string,
  requestedHmsHubId: string | null,
  sessionUser?: SessionUserLike
): Promise<ResolvedHub | null> {
  const userHubs = await dbRead(
    () => prisma.userHub.findMany({ where: { userId }, include: { hub: true } }),
    [] as Array<{ hub: { id: string; name: string; hmsHubId: string } }>,
    "userHub.findMany"
  );

  if (userHubs.length > 0) {
    const match = requestedHmsHubId
      ? userHubs.find((uh) => uh.hub.hmsHubId === requestedHmsHubId)
      : undefined;
    const hub = (match ?? userHubs[0]).hub;
    return { id: hub.id, name: hub.name, hmsHubId: hub.hmsHubId };
  }

  const sessionHubs = sessionUser?.hubs ?? [];
  if (sessionHubs.length > 0) {
    const match = requestedHmsHubId
      ? sessionHubs.find((h) => h.hmsHubId === requestedHmsHubId)
      : undefined;
    const hub = match ?? sessionHubs[0];
    return { id: hub.id, name: hub.name, hmsHubId: hub.hmsHubId };
  }

  if (requestedHmsHubId || DEFAULT_HUB.hmsHubId) {
    return {
      hmsHubId: requestedHmsHubId || DEFAULT_HUB.hmsHubId,
      name: DEFAULT_HUB.name,
    };
  }

  return null;
}
