import { prisma } from "@/lib/prisma";
import { decrypt } from "@/lib/crypto";

export type HubTokenSource =
  | "hub_credential"
  | "hub_lead_token"
  | "manager_token"
  | "caller_token";

export interface HubTokenResult {
  token: string;
  source: HubTokenSource;
  credentialId?: string;
}

/**
 * Get HMS token for a hub. Priority:
 * 1. HubCredential (ACTIVE) — per-hub token captured from extension
 * 2. HUB_LEAD member's hmsToken/leaderHmsToken
 * 3. MANAGER member's hmsToken/leaderHmsToken
 * 4. Caller's own token (last resort)
 *
 * @param hubInternalId Hub.id (CUID), BUKAN Hub.hmsHubId
 * @param callerUserId  optional fallback
 */
export async function getHubToken(
  hubInternalId: string,
  callerUserId?: string
): Promise<HubTokenResult> {
  // 1. Per-hub credential
  const cred = await prisma.hubCredential.findFirst({
    where: { hubId: hubInternalId, status: "ACTIVE" },
    orderBy: { updatedAt: "desc" },
  });

  if (cred) {
    if (cred.expiresAt && cred.expiresAt < new Date()) {
      await prisma.hubCredential.update({
        where: { id: cred.id },
        data: { status: "EXPIRED" },
      });
    } else {
      try {
        const token = decrypt(cred.cookieEncrypted);
        return { token, source: "hub_credential", credentialId: cred.id };
      } catch (e) {
        console.warn(
          `[getHubToken] decrypt failed ${cred.id}:`,
          (e as Error).message
        );
      }
    }
  }

  // 2. HUB_LEAD member
  const hubLead = await prisma.userHub.findFirst({
    where: {
      hubId: hubInternalId,
      role: "HUB_LEAD",
      user: { hmsToken: { not: null } },
    },
    include: { user: { select: { hmsToken: true, leaderHmsToken: true } } },
    orderBy: { createdAt: "asc" },
  });

  if (hubLead?.user) {
    const token = hubLead.user.hmsToken || hubLead.user.leaderHmsToken;
    if (token) return { token, source: "hub_lead_token" };
  }

  // 3. MANAGER member
  const manager = await prisma.userHub.findFirst({
    where: {
      hubId: hubInternalId,
      role: "MANAGER",
      user: { hmsToken: { not: null } },
    },
    include: { user: { select: { hmsToken: true, leaderHmsToken: true } } },
    orderBy: { createdAt: "asc" },
  });

  if (manager?.user) {
    const token = manager.user.hmsToken || manager.user.leaderHmsToken;
    if (token) return { token, source: "manager_token" };
  }

  // 4. Caller's own token
  if (callerUserId) {
    const user = await prisma.user.findUnique({
      where: { id: callerUserId },
      select: { hmsToken: true, leaderHmsToken: true },
    });
    const token = user?.hmsToken || user?.leaderHmsToken;
    if (token) return { token, source: "caller_token" };
  }

  throw new Error(`No HMS token available for hub ${hubInternalId}`);
}