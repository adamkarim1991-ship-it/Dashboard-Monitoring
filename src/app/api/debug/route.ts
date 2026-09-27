import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function GET() {
  const result: any = {
    timestamp: new Date().toISOString(),
    env: {
      hasDatabaseUrl: !!process.env.DATABASE_URL,
      databaseUrlPrefix: process.env.DATABASE_URL?.slice(0, 40) + "...",
      hasNextAuthSecret: !!process.env.NEXTAUTH_SECRET,
      nextAuthSecretLen: process.env.NEXTAUTH_SECRET?.length || 0,
      hasNextAuthUrl: !!process.env.NEXTAUTH_URL,
      nextAuthUrl: process.env.NEXTAUTH_URL,
      hasCronSecret: !!process.env.CRON_SECRET,
      hasHmsBaseUrl: !!process.env.HMS_BASE_URL,
      hmsBaseUrl: process.env.HMS_BASE_URL,
    },
    database: { connected: false, userCount: 0, error: null },
  };

  try {
    const userCount = await prisma.user.count();
    result.database.connected = true;
    result.database.userCount = userCount;
  } catch (e: any) {
    result.database.error = e.message;
  }

  return NextResponse.json(result);
}