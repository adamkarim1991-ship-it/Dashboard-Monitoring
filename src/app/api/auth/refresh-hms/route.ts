import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

const HMS_BASE_URL = process.env.HMS_BASE_URL || "https://gtl-id.tokgistic.com";
const CLIENT_ID = "gtl-frontend";
const REFRESH_THRESHOLD_HOURS = 6; // Refresh kalau token < 6 jam

interface RefreshResult {
  email: string;
  status: "refreshed" | "skipped" | "failed";
  reason?: string;
  oldExpiresAt?: string;
  newExpiresAt?: string;
}

/**
 * Refresh HMS access token untuk 1 user pakai refresh_token.
 * Endpoint: POST https://gtl-id.tokgistic.com/auth/token
 * Header: Authorization: Bearer <old_access_token>
 * Body: { grant: "refresh_token", client_id, refresh_token }
 */
async function refreshUserToken(user: {
  id: string;
  email: string;
  hmsToken: string | null;
  hmsRefreshToken: string | null;
  hmsTokenExpiresAt: Date | null;
}): Promise<RefreshResult> {
  if (!user.hmsToken || !user.hmsRefreshToken) {
    return { email: user.email, status: "skipped", reason: "No token/refresh" };
  }

  // Cek apakah perlu refresh
  const now = Date.now();
  const expiresAt = user.hmsTokenExpiresAt?.getTime() || 0;
  const hoursLeft = (expiresAt - now) / (1000 * 60 * 60);

  if (hoursLeft > REFRESH_THRESHOLD_HOURS) {
    return {
      email: user.email,
      status: "skipped",
      reason: `Still valid (${hoursLeft.toFixed(1)}h left)`,
    };
  }

  // Refresh!
  try {
    const url = `${HMS_BASE_URL}/auth/token`;
    const body = {
      grant: "refresh_token",
      client_id: CLIENT_ID,
      refresh_token: user.hmsRefreshToken,
    };

    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${user.hmsToken}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text();
      return {
        email: user.email,
        status: "failed",
        reason: `HTTP ${res.status}: ${errText.slice(0, 100)}`,
      };
    }

    const json = await res.json();
    const newAccess = json.access_token;
    const newRefresh = json.refresh_token;
    const expiresIn = Number(json.expires_in) || 86400;

    if (!newAccess) {
      return {
        email: user.email,
        status: "failed",
        reason: "No access_token in response",
      };
    }

    const newExpiresAt = new Date(Date.now() + expiresIn * 1000);

    await prisma.user.update({
      where: { id: user.id },
      data: {
        hmsToken: newAccess,
        hmsRefreshToken: newRefresh || user.hmsRefreshToken, // rotation
        hmsTokenExpiresAt: newExpiresAt,
        hmsTokenUpdatedAt: new Date(),
        hmsRefreshTokenUpdatedAt: new Date(),
      },
    });

    return {
      email: user.email,
      status: "refreshed",
      oldExpiresAt: user.hmsTokenExpiresAt?.toISOString(),
      newExpiresAt: newExpiresAt.toISOString(),
    };
  } catch (e: any) {
    return {
      email: user.email,
      status: "failed",
      reason: e.message || "Unknown error",
    };
  }
}

export async function GET(req: NextRequest) {
  return handler(req);
}

export async function POST(req: NextRequest) {
  return handler(req);
}

async function handler(req: NextRequest) {
  console.log("=== HIT /api/auth/refresh-hms ===");

  // Auth: CRON_SECRET atau query param secret
  const authHeader = req.headers.get("authorization");
  const secret = process.env.CRON_SECRET;
  const providedToken =
    authHeader?.replace(/^Bearer\s+/i, "") ||
    req.nextUrl.searchParams.get("secret");

  // Kalau ada CRON_SECRET, wajib match
  // Kalau nggak ada CRON_SECRET (dev), skip auth
  if (secret && providedToken !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Ambil user yang punya refresh token
  const users = await prisma.user.findMany({
    where: {
      hmsToken: { not: null },
      hmsRefreshToken: { not: null },
    },
    select: {
      id: true,
      email: true,
      hmsToken: true,
      hmsRefreshToken: true,
      hmsTokenExpiresAt: true,
    },
  });

  console.log(`[refresh-hms] Found ${users.length} users with refresh token`);

  const results: RefreshResult[] = [];

  for (const user of users) {
    const result = await refreshUserToken(user);
    console.log(`[refresh-hms] ${result.email}: ${result.status} ${result.reason || ""}`);
    results.push(result);
  }

  const summary = {
    total: results.length,
    refreshed: results.filter((r) => r.status === "refreshed").length,
    skipped: results.filter((r) => r.status === "skipped").length,
    failed: results.filter((r) => r.status === "failed").length,
  };

  return NextResponse.json({
    success: true,
    summary,
    results,
  });
}