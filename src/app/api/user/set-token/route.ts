import { getToken } from "next-auth/jwt";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  console.log("=== ROUTE HIT: /api/user/set-token ===");

  const token = await getToken({
    req,
    secret: process.env.NEXTAUTH_SECRET!,
  });

  console.log("[set-token] Token:", token ? "FOUND" : "NONE");

  if (!token?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Parse body
  let body: { hmsToken?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { hmsToken } = body;

  console.log("[set-token] Received token length:", hmsToken?.length ?? 0);

  if (!hmsToken || typeof hmsToken !== "string" || hmsToken.length < 100) {
    return NextResponse.json(
      { error: "Invalid token format" },
      { status: 400 }
    );
  }

  await prisma.user.update({
    where: { id: token.id as string },
    data: {
      hmsToken,
      hmsTokenUpdatedAt: new Date(),
    },
  });

  console.log(`[set-token] ✅ Token saved for user ${token.id}`);

  return NextResponse.json({ ok: true });
}