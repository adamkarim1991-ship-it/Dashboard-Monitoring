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
  role?: string | null;
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

// A stored token can be revoked long before its expiry timestamp, and picking
// the "newest" one used to hand every route a dead token (401 everywhere).
// Validate candidates against HMS instead, cheapest endpoint first, and cache
// the accepted token so the probe cost is paid once per instance.
const TOKEN_CACHE_TTL_MS = 5 * 60 * 1000;
const acceptedTokens = new Map<string, { token: string; timestamp: number }>();

async function hmsAcceptsToken(token: string): Promise<boolean> {
  const base = process.env.HMS_BASE_URL;
  if (!base) return true;
  try {
    const url =
      `${base}/tms/api/lms/v1/shipments?type=order_management` +
      "&leg_type=last_mile&per_page=1&page=1";
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (res.status === 401) return false;
    return true;
  } catch {
    // Network hiccup: do not reject a token we cannot test.
    return true;
  }
}

async function pickAcceptedToken(
  userId: string,
  candidates: TokenCandidate[]
): Promise<TokenCandidate | null> {
  const ordered = candidates.filter((c) => c.token && c.token.length > 50);
  if (ordered.length === 0) return null;

  const remembered = acceptedTokens.get(userId);
  if (
    remembered &&
    Date.now() - remembered.timestamp < TOKEN_CACHE_TTL_MS &&
    ordered.some((c) => c.token === remembered.token)
  ) {
    return ordered.find((c) => c.token === remembered.token) ?? null;
  }

  for (const candidate of ordered) {
    if (await hmsAcceptsToken(candidate.token)) {
      acceptedTokens.set(userId, { token: candidate.token, timestamp: Date.now() });
      if (candidate.source !== ordered[0].source) {
        console.warn(
          `[hms] using ${candidate.source} token, HMS rejected the newer one`
        );
      }
      return candidate;
    }
  }

  console.warn("[hms] every stored token was rejected by HMS");
  return ordered[0];
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

  const fromMemory = recallToken(userId);
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

  // The hub row carries the token pushed by the GTL Bridge extension. It stays
  // valid after the per-user grant is revoked, so try it before the older ones.
  const hubRows = await dbRead(
    () =>
      prisma.hub.findMany({
        where: {
          hmsToken: { not: null },
          users: { some: { userId } },
        },
        select: { hmsToken: true, hmsTokenExpiresAt: true, hmsHubId: true },
      }),
    [] as Array<{ hmsToken: string | null; hmsTokenExpiresAt: Date | null; hmsHubId: string }>,
    "hub.hmsToken.scoped"
  );
  for (const row of hubRows) {
    if (row.hmsToken) {
      candidates.push({
        token: row.hmsToken,
        source: `hub:${row.hmsHubId}`,
        expiresAt: row.hmsTokenExpiresAt?.getTime() ?? 0,
      });
    }
  }
  const picked = await pickAcceptedToken(userId, candidates);
  if (!picked) {
    const best = newest(candidates);
    return best
      ? { token: best.token, source: best.source }
      : { token: null, source: "none" };
  }
  return { token: picked.token, source: picked.source };
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
    if (requestedHmsHubId) {
      const match = userHubs.find((uh) => uh.hub.hmsHubId === requestedHmsHubId);
      if (match) {
        const hub = match.hub;
        return { id: hub.id, name: hub.name, hmsHubId: hub.hmsHubId };
      }

      // Managers can operate hubs that are visible in the hub catalogue even
      // when they are not represented as direct userHub rows in the JWT scope.
      // This keeps /occ/<hub> separated by the requested HMS hub id instead of
      // silently falling back to the first/Jatinegara hub.
      const requestedHub = await dbRead(
        () => prisma.hub.findFirst({ where: { hmsHubId: requestedHmsHubId } }),
        null as { id: string; name: string; hmsHubId: string } | null,
        "hub.findFirstByHmsHubId"
      );
      if (requestedHub) {
        return {
          id: requestedHub.id,
          name: requestedHub.name,
          hmsHubId: requestedHub.hmsHubId,
        };
      }
      return null;
    }

    const hub = userHubs[0].hub;
    return { id: hub.id, name: hub.name, hmsHubId: hub.hmsHubId };
  }

  const sessionHubs = sessionUser?.hubs ?? [];
  if (sessionHubs.length > 0) {
    if (requestedHmsHubId) {
      const match = sessionHubs.find((h) => h.hmsHubId === requestedHmsHubId);
      if (!match) return null;
      return { id: match.id, name: match.name, hmsHubId: match.hmsHubId };
    }
    const hub = sessionHubs[0];
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


export async function resolvePublicHmsToken(
  req: NextRequest | null,
  preferredHubId?: string | null
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

  if (process.env.HMS_TOKEN) {
    candidates.push({
      token: process.env.HMS_TOKEN,
      source: "env",
      expiresAt: 0,
    });
  }

  if (preferredHubId) {
    const preferredHub = await dbRead(
      () => prisma.hub.findFirst({
        where: { hmsHubId: preferredHubId, hmsToken: { not: null } },
        select: { hmsToken: true, hmsTokenExpiresAt: true },
      }),
      null as { hmsToken: string | null; hmsTokenExpiresAt: Date | null } | null,
      "public.hubToken.preferred"
    );
    if (preferredHub?.hmsToken) {
      candidates.push({
        token: preferredHub.hmsToken,
        source: `hub:${preferredHubId}`,
        expiresAt: preferredHub.hmsTokenExpiresAt?.getTime() ?? 0,
      });
    }
  }

  const userRows = await dbRead(
    () => prisma.user.findMany({
      where: { hmsToken: { not: null } },
      select: { id: true, hmsToken: true, hmsTokenExpiresAt: true },
    }),
    [] as Array<{ id: string; hmsToken: string | null; hmsTokenExpiresAt: Date | null }>,
    "public.userTokens"
  );
  for (const row of userRows) {
    if (row.hmsToken) {
      candidates.push({
        token: row.hmsToken,
        source: `user:${row.id}`,
        expiresAt: row.hmsTokenExpiresAt?.getTime() ?? 0,
      });
    }
  }

  const hubRows = await dbRead(
    () => prisma.hub.findMany({
      where: { hmsToken: { not: null } },
      select: { hmsHubId: true, hmsToken: true, hmsTokenExpiresAt: true },
    }),
    [] as Array<{ hmsHubId: string; hmsToken: string | null; hmsTokenExpiresAt: Date | null }>,
    "public.hubTokens"
  );
  for (const row of hubRows) {
    if (row.hmsToken) {
      candidates.push({
        token: row.hmsToken,
        source: `hub:${row.hmsHubId}`,
        expiresAt: row.hmsTokenExpiresAt?.getTime() ?? 0,
      });
    }
  }

  const picked = await pickAcceptedToken(`public:${preferredHubId ?? "all"}`, candidates);
  if (!picked) {
    const best = newest(candidates);
    return best
      ? { token: best.token, source: best.source }
      : { token: null, source: "none" };
  }
  return { token: picked.token, source: picked.source };
}

