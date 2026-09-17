import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/prisma";

export type AppRole = "MANAGER" | "SPV" | "HUB_LEAD";

export const { handlers, auth, signIn, signOut } = NextAuth({
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
        const clusterIds = Array.from(
          new Set(user.hubs.map((h) => h.hub.clusterId))
        );

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role as AppRole,
          hubIds,
          clusterIds,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = user.role;
        token.hubIds = user.hubIds;
        token.clusterIds = user.clusterIds;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id;
        session.user.role = token.role;
        session.user.hubIds = token.hubIds;
        session.user.clusterIds = token.clusterIds;
      }
      return session;
    },
  },
});