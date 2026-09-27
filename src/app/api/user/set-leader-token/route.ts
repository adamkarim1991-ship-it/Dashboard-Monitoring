import { getToken } from "next-auth/jwt";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  console.log("=== ROUTE HIT: /api/user/set-leader-token ===");

  const token = await getToken({
    req,
    secret: process.env.NEXTAUTH_SECRET!,
  });

  console.log("[set-leader-token] Token:", token ? "FOUND" : "NONE");

  if (!token?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { leaderHmsToken?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { leaderHmsToken } = body;

  console.log(
    "[set-leader-token] Received token length:",
    leaderHmsToken?.length ?? 0
  );

  if (
    !leaderHmsToken ||
    typeof leaderHmsToken !== "string" ||
    leaderHmsToken.length < 100
  ) {
    return NextResponse.json(
      { error: "Invalid token format" },
      { status: 400 }
    );
  }

  await prisma.user.update({
    where: { id: token.id as string },
    data: {
      leaderHmsToken,
    },
  });

  console.log(`[set-leader-token] Leader token saved for user ${token.id}`);

  return NextResponse.json({ ok: true });
}
