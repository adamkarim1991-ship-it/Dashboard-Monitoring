import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import type { AppRole, HubRole, UserHubInfo } from "@/type/auth";

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  secret: process.env.NEXTAUTH_SECRET,
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const parsed = z
          .object({
            email: z.string().email(),
            password: z.string().min(1),
          })
          .safeParse(credentials);

        if (!parsed.success) return null;

        const user = await prisma.user.findUnique({
          where: { email: parsed.data.email },
          include: {
            hubs: {
              include: { hub: { include: { cluster: true } } },
            },
          },
        });

        if (!user) return null;

        const valid = await bcrypt.compare(parsed.data.password, user.password);
        if (!valid) return null;

        const hubIds = user.hubs.map((h) => h.hubId);
        const hmsHubIds = user.hubs.map((h) => h.hub.hmsHubId);
        const clusterIds = Array.from(
          new Set(user.hubs.map((h) => h.hub.clusterId))
        );

        // Build hubs info untuk hub switcher
        const hubs: UserHubInfo[] = user.hubs.map((uh) => ({
          id: uh.hub.id,
          name: uh.hub.name,
          hmsHubId: uh.hub.hmsHubId,
          role: uh.role as HubRole,
        }));

        // Default active hub = hub pertama
        const activeHubId = hubs[0]?.id ?? null;

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role as AppRole,
          hubIds,
          hmsHubIds,
          clusterIds,
          hmsToken: user.hmsToken,
          leaderHmsToken: user.leaderHmsToken,
          hubs,
          activeHubId,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user, trigger, session }) {
      if (user) {
        token.id = user.id;
        token.role = user.role;
        token.hubIds = user.hubIds;
        token.hmsHubIds = user.hmsHubIds;
        token.clusterIds = user.clusterIds;
        token.hmsToken = user.hmsToken;
        token.leaderHmsToken = user.leaderHmsToken;
        token.hubs = user.hubs;
        token.activeHubId = user.activeHubId;
      }

      // Handle update dari client (mis. HubSwitcher)
      if (trigger === "update" && session?.activeHubId) {
        // Verifikasi user masih punya akses ke hub itu
        const hasAccess = token.hubs?.some(
          (h) => h.id === session.activeHubId
        );
        if (hasAccess) {
          token.activeHubId = session.activeHubId;
        }
      }

      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id;
        session.user.role = token.role;
        session.user.hubIds = token.hubIds;
        session.user.hmsHubIds = token.hmsHubIds;
        session.user.clusterIds = token.clusterIds;
        session.user.hmsToken = token.hmsToken;
        session.user.leaderHmsToken = token.leaderHmsToken;
        session.user.hubs = token.hubs;
        session.user.activeHubId = token.activeHubId;
      }
      return session;
    },
  },
});