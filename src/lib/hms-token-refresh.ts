// Reactive HMS token refresh.
//
// HMS access tokens are short lived. When one expires every dashboard card
// falls back to zero and the UI looks stuck on "Menunggu data". Routes refresh
// the token on the first 401 and retry, so a stale cookie no longer blanks the
// whole dashboard.

import { prisma } from "@/lib/prisma";
import { storePushedToken } from "@/lib/hms-context";
import { refreshHmsToken } from "@/app/api/auth/refresh-hms/route";

export interface RefreshedHmsToken {
  token: string;
  refreshToken: string | null;
  expiresAt: number;
}

export async function refreshStoredHmsToken(
  userId: string,
  currentAccessToken?: string | null
): Promise<RefreshedHmsToken | null> {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { hmsToken: true, hmsRefreshToken: true },
    });

    const accessToken = user?.hmsToken || currentAccessToken || "";
    const refreshToken = user?.hmsRefreshToken || "";
    if (!accessToken || !refreshToken) return null;

    const result = await refreshHmsToken(accessToken, refreshToken);
    if (!result.success || !result.accessToken) {
      console.warn(`[hms-token] refresh failed for ${userId}: ${result.error}`);
      return null;
    }

    const nextRefresh = result.refreshToken ?? refreshToken;
    const expiresAt = Date.now() + (result.expiresIn ?? 86400) * 1000;

    await prisma.user
      .update({
        where: { id: userId },
        data: {
          hmsToken: result.accessToken,
          hmsRefreshToken: nextRefresh,
          hmsTokenExpiresAt: new Date(expiresAt),
          hmsRefreshTokenUpdatedAt: new Date(),
          hmsTokenUpdatedAt: new Date(),
        },
      })
      .catch((e: any) => {
        console.warn(`[hms-token] DB persist skipped: ${e?.message ?? e}`);
      });

    storePushedToken(userId, {
      token: result.accessToken,
      refreshToken: nextRefresh,
      expiresAt,
    });

    return { token: result.accessToken, refreshToken: nextRefresh, expiresAt };
  } catch (e: any) {
    console.warn(`[hms-token] refresh error: ${e?.message ?? e}`);
    return null;
  }
}

export async function refreshStoredHubToken(
  hmsHubId: string,
  currentAccessToken?: string | null
): Promise<RefreshedHmsToken | null> {
  try {
    const hub = await prisma.hub.findUnique({
      where: { hmsHubId },
      select: { hmsToken: true, hmsRefreshToken: true },
    });

    const accessToken = hub?.hmsToken || currentAccessToken || "";
    const refreshToken = hub?.hmsRefreshToken || "";
    if (!accessToken || !refreshToken) return null;

    const result = await refreshHmsToken(accessToken, refreshToken);
    if (!result.success || !result.accessToken) {
      console.warn(`[hms-token] hub refresh failed for ${hmsHubId}: ${result.error}`);
      return null;
    }

    const nextRefresh = result.refreshToken ?? refreshToken;
    const expiresAt = Date.now() + (result.expiresIn ?? 86400) * 1000;

    await prisma.hub
      .update({
        where: { hmsHubId },
        data: {
          hmsToken: result.accessToken,
          hmsRefreshToken: nextRefresh,
          hmsTokenExpiresAt: new Date(expiresAt),
          hmsTokenUpdatedAt: new Date(),
        },
      })
      .catch((e: any) => {
        console.warn(`[hms-token] hub DB persist skipped: ${e?.message ?? e}`);
      });

    return { token: result.accessToken, refreshToken: nextRefresh, expiresAt };
  } catch (e: any) {
    console.warn(`[hms-token] hub refresh error: ${e?.message ?? e}`);
    return null;
  }
}
