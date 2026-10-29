import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { dbRead, dbWrite } from "@/lib/db-safe";
import { storePushedToken } from "@/lib/hms-context";
import { readTokenChunkCount, writeTokenCookies } from "@/lib/hms-token-store";
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: {
    hmsToken?: string;
    hmsRefreshToken?: string | null;
    hmsTokenExpiresAt?: number | null;
  };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { hmsToken, hmsRefreshToken, hmsTokenExpiresAt } = body;

  if (!hmsToken || typeof hmsToken !== "string" || hmsToken.length < 100) {
    return NextResponse.json(
      { error: "Invalid token", message: "Token must be >100 chars" },
      { status: 400 }
    );
  }

  const expiresAt =
    typeof hmsTokenExpiresAt === "number" && Number.isFinite(hmsTokenExpiresAt)
      ? hmsTokenExpiresAt
      : null;

  // Always make the token usable for this origin first: dashboards read it from
  // the cookie / instance cache, which keeps working when the database is down.
  const entry = storePushedToken(session.user.id, {
    token: hmsToken,
    refreshToken: hmsRefreshToken ?? null,
    expiresAt,
  });

  const current = await dbRead(
    () =>
      prisma.user.findUnique({
        where: { id: session.user.id },
        select: { hmsToken: true, hmsRefreshToken: true, hmsTokenExpiresAt: true },
      }),
    null,
    "user.findUnique"
  );

  const newExpires = expiresAt ? new Date(expiresAt) : null;
  const dbIsFresher =
    !!current?.hmsTokenExpiresAt &&
    !!newExpires &&
    current.hmsTokenExpiresAt > newExpires &&
    !!current.hmsToken;

  let persisted = false;
  let persistError: string | undefined;

  if (dbIsFresher) {
    persisted = true;
  } else {
    const data: Record<string, unknown> = {
      hmsToken,
      hmsTokenUpdatedAt: new Date(),
    };

    const accessTokenChanged = current?.hmsToken !== hmsToken;
    if (hmsRefreshToken && (!current?.hmsRefreshToken || accessTokenChanged)) {
      data.hmsRefreshToken = hmsRefreshToken;
      data.hmsRefreshTokenUpdatedAt = new Date();
    }
    if (newExpires) data.hmsTokenExpiresAt = newExpires;

    const write = await dbWrite(
      () => prisma.user.update({ where: { id: session.user.id }, data }),
      "user.update.hmsToken"
    );
    persisted = write.ok;
    if (!write.ok) persistError = write.error;
  }

  if (persistError) {
    console.warn(`[set-token] DB write skipped for ${session.user.id}: ${persistError}`);
  }

  const res = NextResponse.json({
    success: true,
    persisted,
    storage: persisted ? "database" : "cookie",
  });

  writeTokenCookies(res, entry, readTokenChunkCount(req));
  return res;
}
