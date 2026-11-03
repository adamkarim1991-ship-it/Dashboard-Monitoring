import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { readTokenChunkCount } from "@/lib/hms-token-store";

// Diagnostic only: reports whether a hub token exists and when it was pushed.
// Never returns the token itself.
export async function GET(req: NextRequest) {
  const hubId = req.nextUrl.searchParams.get("hubId") || "460450593288";
  const hub = await prisma.hub
    .findUnique({
      where: { hmsHubId: hubId },
      select: {
        name: true,
        hmsToken: true,
        hmsTokenUpdatedAt: true,
        hmsTokenExpiresAt: true,
        hmsRefreshToken: true,
      },
    })
    .catch(() => null);

  return NextResponse.json({
    hub_id: hubId,
    hub_name: hub?.name ?? null,
    has_hub_token: Boolean(hub?.hmsToken),
    hub_token_length: hub?.hmsToken?.length ?? 0,
    hub_token_updated_at: hub?.hmsTokenUpdatedAt ?? null,
    hub_token_expires_at: hub?.hmsTokenExpiresAt ?? null,
    has_hub_refresh: Boolean(hub?.hmsRefreshToken),
    cookie_chunks: readTokenChunkCount(req),
    now: new Date().toISOString(),
  });
}