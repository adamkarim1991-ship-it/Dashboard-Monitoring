import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  console.log("=== ROUTE HIT: /api/user/set-leader-token ===");

  const session = await auth();

  console.log("[set-leader-token] Session:", session ? "FOUND" : "NONE");

  if (!session?.user?.id) {
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
    where: { id: session.user.id },
    data: {
      leaderHmsToken,
    },
  });

  console.log(`[set-leader-token] Leader token saved for user ${session.user.id}`);

  return NextResponse.json({ ok: true });
}
