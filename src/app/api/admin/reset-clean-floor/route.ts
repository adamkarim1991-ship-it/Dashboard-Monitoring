import { getToken } from "next-auth/jwt";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

const HUB_ID_JATINEGARA = "460450593288";

export async function POST(req: NextRequest) {
  const token = await getToken({
    req,
    secret: process.env.NEXTAUTH_SECRET!,
  });

  if (!token?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Hapus snapshot hari ini
  const now = new Date();
  const wibOffsetMs = 7 * 60 * 60 * 1000;
  const nowWIB = new Date(now.getTime() + wibOffsetMs);
  const y = nowWIB.getUTCFullYear();
  const m = nowWIB.getUTCMonth();
  const d = nowWIB.getUTCDate();
  const today = `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

  const deleted = await prisma.cleanFloorSnapshot.deleteMany({
    where: { facility: HUB_ID_JATINEGARA, date: today },
  });

  return NextResponse.json({
    success: true,
    deleted: deleted.count,
    date: today,
  });
}