import { prisma } from "@/lib/prisma";
import { decrypt } from "@/lib/crypto";

export type HubTokenSource =
  | "hub_credential"
  | "caller_token"
  | "hub_lead_global"
  | "manager_global"
  | "hub_lead_membership"
  | "manager_membership";

export interface HubTokenResult {
  token: string;
  source: HubTokenSource;
  credentialId?: string;
}

/**
 * Get HMS token untuk sebuah hub. Prioritas:
 * 1. HubCredential (ACTIVE) — per-hub token dari extension
 * 2. Caller's own token — kalau caller (SPV/Manager) punya akses luas
 * 3. Global HUB_LEAD — biasanya punya akses luas
 * 4. Global MANAGER
 * 5. Per-hub HUB_LEAD membership
 * 6. Per-hub MANAGER membership
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

  // 2. Caller's own token (SPV biasanya punya akses lebih luas)
  if (callerUserId) {
    const user = await prisma.user.findUnique({
      where: { id: callerUserId },
      select: { hmsToken: true, leaderHmsToken: true },
    });
    const token = user?.leaderHmsToken || user?.hmsToken;
    if (token) return { token, source: "caller_token" };
  }

  // 3. Global HUB_LEAD
  const hubLeadGlobal = await prisma.user.findFirst({
    where: {
      hmsToken: { not: null },
      role: "HUB_LEAD",
    },
    orderBy: { createdAt: "asc" },
  });
  if (hubLeadGlobal?.hmsToken) {
    return { token: hubLeadGlobal.hmsToken, source: "hub_lead_global" };
  }

  // 4. Global MANAGER
  const managerGlobal = await prisma.user.findFirst({
    where: {
      hmsToken: { not: null },
      role: "MANAGER",
    },
    orderBy: { createdAt: "asc" },
  });
  if (managerGlobal?.hmsToken) {
    return { token: managerGlobal.hmsToken, source: "manager_global" };
  }

  // 5. Per-hub HUB_LEAD membership
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
    if (token) return { token, source: "hub_lead_membership" };
  }

  // 6. Per-hub MANAGER membership
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
    if (token) return { token, source: "manager_membership" };
  }

  throw new Error(`No HMS token available for hub ${hubInternalId}`);
}