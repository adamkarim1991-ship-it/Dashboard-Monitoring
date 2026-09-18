export type AppRole = "MANAGER" | "SPV" | "HUB_LEAD";

export type SessionUser = {
  id: string;
  name?: string | null;
  email?: string | null;
  role: AppRole;
  hubIds: string[];
  clusterIds: string[];
};

export function getHubScope(user: SessionUser) {
  switch (user.role) {
    case "MANAGER":
      return { clusterId: { in: user.clusterIds } };
    case "SPV":
    case "HUB_LEAD":
      return { id: { in: user.hubIds } };
    default:
      return { id: "__none__" };
  }
}

export function getMetricScope(user: SessionUser) {
  switch (user.role) {
    case "MANAGER":
      return { hub: { clusterId: { in: user.clusterIds } } };
    case "SPV":
    case "HUB_LEAD":
      return { hubId: { in: user.hubIds } };
    default:
      return { hubId: "__none__" };
  }
}

export function canAccessHub(user: SessionUser, hubId: string): boolean {
  return user.hubIds.includes(hubId);
}

export function getFilterOptions(user: SessionUser) {
  return {
    canFilterCluster: user.role === "MANAGER",
    canFilterHub: user.role === "MANAGER" || user.role === "SPV",
    fixedHubId: user.role === "HUB_LEAD" ? user.hubIds[0] : null,
  };
}