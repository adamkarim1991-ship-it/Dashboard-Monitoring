import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getHubScope, type SessionUser } from "@/lib/rbac";
import { NextResponse } from "next/server";

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = session.user as SessionUser;

  const hubs = await prisma.hub.findMany({
    where: getHubScope(user),
    include: { cluster: true },
    orderBy: { name: "asc" },
  });

  const clusters = await prisma.cluster.findMany({
    where: { id: { in: user.clusterIds } },
    orderBy: { name: "asc" },
  });

  // Kumpulkan region unik dari hubs
  const regionSet = new Set<string>();
  hubs.forEach((h) => {
    if (h.region) regionSet.add(h.region);
  });
  const regions = Array.from(regionSet).sort();

  return NextResponse.json({
    hubs: hubs.map((h) => ({
      id: h.id,
      name: h.name,
      region: h.region,
      clusterId: h.clusterId,
      clusterName: h.cluster.name,
    })),
    clusters: clusters.map((c) => ({ id: c.id, name: c.name })),
    regions,
  });
}