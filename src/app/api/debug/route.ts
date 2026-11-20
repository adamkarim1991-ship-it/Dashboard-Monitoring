import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function GET() {
  const result: any = {
    timestamp: new Date().toISOString(),
    env: {
      hasDatabaseUrl: !!process.env.DATABASE_URL,
      // Never expose any part of DATABASE_URL or other secrets, even partially.
      hasNextAuthSecret: !!process.env.NEXTAUTH_SECRET,
      nextAuthSecretLen: process.env.NEXTAUTH_SECRET?.length || 0,
      hasNextAuthUrl: !!process.env.NEXTAUTH_URL,
      hasCronSecret: !!process.env.CRON_SECRET,
      hasHmsBaseUrl: !!process.env.HMS_BASE_URL,
      debugRouteVersion: "d2409fd",
      railwayGitSha: process.env.RAILWAY_GIT_COMMIT_SHA || process.env.RAILWAY_GIT_SHA || null,
      vercelGitSha: process.env.VERCEL_GIT_COMMIT_SHA || null,
    },
    database: { connected: false, userCount: 0, error: null },
  };

  try {
    const userCount = await prisma.user.count();
    result.database.connected = true;
    result.database.userCount = userCount;
  } catch (e: any) {
    result.database.error = e?.message || "unknown";
  }

  return NextResponse.json(result);
}
