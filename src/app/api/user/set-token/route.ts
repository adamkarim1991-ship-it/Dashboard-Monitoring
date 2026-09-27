import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  console.log("=== ROUTE HIT: /api/user/set-token ===");

  const session = await auth();

  console.log("[set-token] Session:", session ? "FOUND" : "NONE");

  if (!session?.user?.id) {
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
    where: { id: session.user.id },
    data: {
      hmsToken,
      hmsTokenUpdatedAt: new Date(),
    },
  });

  console.log(`[set-token] ✅ Token saved for user ${session.user.id}`);

  return NextResponse.json({ ok: true });
}