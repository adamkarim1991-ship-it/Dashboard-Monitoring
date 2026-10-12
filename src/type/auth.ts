export type AppRole = "MANAGER" | "SPV" | "HUB_LEAD";
export type HubRole = "MANAGER" | "SPV" | "HUB_LEAD" | "VIEWER";

export type UserHubInfo = {
  id: string;
  name: string;
  hmsHubId: string;
  role: HubRole;
};