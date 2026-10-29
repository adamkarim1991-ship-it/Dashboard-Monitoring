import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { dbRead } from "@/lib/db-safe";
import { getHubScope, type SessionUser } from "@/lib/rbac";
import { NextResponse } from "next/server";

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = session.user as SessionUser;

  const hubs = await dbRead(
    () =>
      prisma.hub.findMany({
        where: getHubScope(user),
        include: { cluster: true },
        orderBy: { name: "asc" },
      }),
    [],
    "hub.findMany"
  );

  if (hubs.length === 0) {
    // Database unavailable: the JWT already carries the user's hub membership.
    const sessionHubs = (user.hubs ?? []).map((h) => ({
      id: h.id,
      name: h.name,
      hmsHubId: h.hmsHubId,
      region: "",
      clusterId: "",
      clusterName: "",
    }));

    return NextResponse.json({
      success: true,
      degraded: true,
      hubs: sessionHubs,
      clusters: [],
      regions: [],
    });
  }

  const clusters = await dbRead(
    () =>
      prisma.cluster.findMany({
        where: { id: { in: user.clusterIds } },
        orderBy: { name: "asc" },
      }),
    [],
    "cluster.findMany"
  );

  const regionSet = new Set<string>();
  hubs.forEach((h) => {
    if (h.region) regionSet.add(h.region);
  });
  const regions = Array.from(regionSet).sort();

  return NextResponse.json({
    success: true,
    hubs: hubs.map((h) => ({
      id: h.id,
      name: h.name,
      hmsHubId: h.hmsHubId,
      region: h.region,
      clusterId: h.clusterId,
      clusterName: h.cluster?.name ?? "",
    })),
    clusters: clusters.map((c) => ({ id: c.id, name: c.name })),
    regions,
  });
}
