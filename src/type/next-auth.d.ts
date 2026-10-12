import "next-auth";
import "next-auth/jwt";
import type { AppRole, HubRole, UserHubInfo } from "@/type/auth";

export type { AppRole, HubRole, UserHubInfo };

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: "MANAGER" | "SPV" | "HUB_LEAD";
      hubIds: string[];
      hmsHubIds: string[];
      clusterIds: string[];
      hmsToken?: string | null;
      leaderHmsToken?: string | null;
      name?: string | null;
      email?: string | null;
      image?: string | null;
    };
  }

  interface User {
    id: string;
    role: "MANAGER" | "SPV" | "HUB_LEAD";
    hubIds: string[];
    hmsHubIds: string[];
    clusterIds: string[];
    hmsToken?: string | null;
    leaderHmsToken?: string | null;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string;
    role: "MANAGER" | "SPV" | "HUB_LEAD";
    hubIds: string[];
    hmsHubIds: string[];
    clusterIds: string[];
    hmsToken?: string | null;
    leaderHmsToken?: string | null;
  }
}