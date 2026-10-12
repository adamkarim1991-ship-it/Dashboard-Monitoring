import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { hubId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { hubId } = body;
  if (!hubId) {
    return NextResponse.json({ error: "hubId is required" }, { status: 400 });
  }

  // Verifikasi user punya akses ke hub ini
  const membership = await prisma.userHub.findUnique({
    where: { userId_hubId: { userId: session.user.id, hubId } },
    include: { hub: true },
  });

  if (!membership) {
    return NextResponse.json(
      { error: "Akses ditolak ke hub ini" },
      { status: 403 }
    );
  }

  return NextResponse.json({
    success: true,
    hubId,
    hub: {
      id: membership.hub.id,
      name: membership.hub.name,
      hmsHubId: membership.hub.hmsHubId,
      role: membership.role,
    },
  });
}

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const memberships = await prisma.userHub.findMany({
    where: { userId: session.user.id },
    include: { hub: { include: { cluster: true } } },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json({
    success: true,
    hubs: memberships.map((m) => ({
      id: m.hubId,
      name: m.hub.name,
      hmsHubId: m.hub.hmsHubId,
      region: m.hub.region,
      cluster: m.hub.cluster?.name ?? null,
      role: m.role,
    })),
  });
}