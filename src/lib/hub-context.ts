import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { decrypt } from "@/lib/crypto";

export class HubAccessError extends Error {
  constructor(
    public code: "UNAUTHENTICATED" | "NO_HUB" | "FORBIDDEN" | "NO_CREDENTIAL",
    message: string
  ) {
    super(message);
    this.name = "HubAccessError";
  }
}

/**
 * Ambil hubId aktif dari session. Fallback ke hub pertama user.
 * SELALU ambil dari session, JANGAN dari request body/query mentah.
 */
export async function getActiveHubId(): Promise<string> {
  const session = await auth();
  if (!session?.user?.id) {
    throw new HubAccessError("UNAUTHENTICATED", "Not authenticated.");
  }

  const activeHubId = (session as { activeHubId?: string }).activeHubId;

  if (activeHubId) {
    const membership = await prisma.userHub.findUnique({
      where: { userId_hubId: { userId: session.user.id, hubId: activeHubId } },
    });
    if (membership) return activeHubId;
  }

  const first = await prisma.userHub.findFirst({
    where: { userId: session.user.id },
    orderBy: { createdAt: "asc" },
  });

  if (!first) {
    throw new HubAccessError("NO_HUB", "User tidak punya akses ke hub manapun.");
  }

  return first.hubId;
}

/**
 * Verifikasi user punya akses ke hub tertentu.
 */
export async function requireHubAccess(hubId: string) {
  const session = await auth();
  if (!session?.user?.id) {
    throw new HubAccessError("UNAUTHENTICATED", "Not authenticated.");
  }

  const membership = await prisma.userHub.findUnique({
    where: { userId_hubId: { userId: session.user.id, hubId } },
    include: { hub: true },
  });

  if (!membership) {
    throw new HubAccessError("FORBIDDEN", "Akses ditolak ke hub ini.");
  }

  return { session, membership, hub: membership.hub };
}

/**
 * Ambil credential HMS aktif untuk hub (decrypt cookie).
 */
export async function getHubCredential(hubId: string) {
  const cred = await prisma.hubCredential.findFirst({
    where: { hubId, status: "ACTIVE" },
    orderBy: { updatedAt: "desc" },
  });

  if (!cred) {
    throw new HubAccessError(
      "NO_CREDENTIAL",
      "Hub belum punya token HMS. Install extension Chrome dan pairing."
    );
  }

  if (cred.expiresAt && cred.expiresAt < new Date()) {
    await prisma.hubCredential.update({
      where: { id: cred.id },
      data: { status: "EXPIRED" },
    });
    throw new HubAccessError(
      "NO_CREDENTIAL",
      "Token HMS expired. Refresh via extension."
    );
  }

  const cookie = decrypt(cred.cookieEncrypted);
  const apiIds = cred.apiIds as {
    main?: string;
    cycle1?: string;
    ops?: string;
    courier?: string;
  };

  return { credential: cred, cookie, apiIds };
}

/**
 * Konversi HubAccessError jadi response object.
 */
export function hubErrorToResponse(error: unknown) {
  if (error instanceof HubAccessError) {
    const statusMap: Record<HubAccessError["code"], number> = {
      UNAUTHENTICATED: 401,
      NO_HUB: 403,
      FORBIDDEN: 403,
      NO_CREDENTIAL: 409,
    };
    return {
      status: statusMap[error.code],
      body: { success: false, error: error.message, code: error.code },
    };
  }
  return {
    status: 500,
    body: {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
      code: "INTERNAL",
    },
  };
}