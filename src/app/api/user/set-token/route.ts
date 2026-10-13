import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  console.log("=== HIT /api/user/set-token ===");

  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: {
    hmsToken?: string;
    hmsRefreshToken?: string | null;
    hmsTokenExpiresAt?: number | null;
  };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { hmsToken, hmsRefreshToken, hmsTokenExpiresAt } = body;

  if (!hmsToken || typeof hmsToken !== "string" || hmsToken.length < 100) {
    return NextResponse.json(
      { error: "Invalid token", message: "Token must be >100 chars" },
      { status: 400 }
    );
  }

  const data: any = {
    hmsToken,
    hmsTokenUpdatedAt: new Date(),
  };

  if (hmsRefreshToken) {
    data.hmsRefreshToken = hmsRefreshToken;
    data.hmsRefreshTokenUpdatedAt = new Date();
  }

  if (hmsTokenExpiresAt) {
    data.hmsTokenExpiresAt = new Date(hmsTokenExpiresAt);
  }

  await prisma.user.update({
    where: { id: session.user.id },
    data,
  });

  console.log(
    `[set-token] ✅ Updated user ${session.user.id} — token + refresh saved`
  );

  return NextResponse.json({ success: true });
}