import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canAccessHub, type SessionUser } from "@/lib/rbac";
import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = session.user as SessionUser;
  const { searchParams } = new URL(req.url);
  const hubIdParam = searchParams.get("hubId");

  let targetHubIds: string[];
  if (hubIdParam) {
    if (!canAccessHub(user, hubIdParam)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    targetHubIds = [hubIdParam];
  } else {
    targetHubIds = user.hubIds;
  }

  const now = new Date();
  const from = new Date(now.getTime() - 48 * 60 * 60 * 1000);

  const metrics = await prisma.hourlyMetric.findMany({
    where: {
      hubId: { in: targetHubIds },
      hourTimestamp: { gte: from },
    },
    orderBy: { hourTimestamp: "asc" },
  });

  const hubs = await prisma.hub.findMany({
    where: { id: { in: targetHubIds } },
  });
  const hubMap = new Map(hubs.map((h) => [h.id, h]));

  type Row = {
    hourTimestamp: Date;
    inbound: number;
    outbound: number;
    delivered: number;
    pending: number;
    slaBreach: number;
    activeCouriers: number;
  };
  const byHour = new Map<string, Row>();

  for (const m of metrics) {
    const key = m.hourTimestamp.toISOString();
    const existing = byHour.get(key);
    if (existing) {
      existing.inbound += m.inbound;
      existing.outbound += m.outbound;
      existing.delivered += m.delivered;
      existing.pending += m.pending;
      existing.slaBreach += m.slaBreach;
      existing.activeCouriers += m.activeCouriers;
    } else {
      byHour.set(key, {
        hourTimestamp: m.hourTimestamp,
        inbound: m.inbound,
        outbound: m.outbound,
        delivered: m.delivered,
        pending: m.pending,
        slaBreach: m.slaBreach,
        activeCouriers: m.activeCouriers,
      });
    }
  }

  const data = Array.from(byHour.values())
    .sort((a, b) => a.hourTimestamp.getTime() - b.hourTimestamp.getTime())
    .map((r) => {
      const h = new Date(r.hourTimestamp).getHours();
      return {
        ...r,
        hourTimestamp: r.hourTimestamp.toISOString(),
        hour: h,
        label: `${String(h).padStart(2, "0")}:00`,
      };
    });

  const totals = data.reduce(
    (acc, r) => ({
      inbound: acc.inbound + r.inbound,
      outbound: acc.outbound + r.outbound,
      delivered: acc.delivered + r.delivered,
      pending: acc.pending + r.pending,
      slaBreach: acc.slaBreach + r.slaBreach,
      activeCouriers: r.activeCouriers,
    }),
    {
      inbound: 0,
      outbound: 0,
      delivered: 0,
      pending: 0,
      slaBreach: 0,
      activeCouriers: 0,
    }
  );

  // Aggregate by region
  const byRegionMap = new Map<
    string,
    {
      region: string;
      inbound: number;
      outbound: number;
      delivered: number;
      pending: number;
      slaBreach: number;
      activeCouriers: number;
      hubCount: number;
    }
  >();

  for (const m of metrics) {
    const hub = hubMap.get(m.hubId);
    const region = hub?.region || "Lainnya";
    const existing = byRegionMap.get(region) || {
      region,
      inbound: 0,
      outbound: 0,
      delivered: 0,
      pending: 0,
      slaBreach: 0,
      activeCouriers: 0,
      hubCount: 0,
    };
    existing.inbound += m.inbound;
    existing.outbound += m.outbound;
    existing.delivered += m.delivered;
    existing.pending += m.pending;
    existing.slaBreach += m.slaBreach;
    existing.activeCouriers = Math.max(existing.activeCouriers, m.activeCouriers);
    byRegionMap.set(region, existing);
  }

  // Count hubs per region
  for (const hub of hubs) {
    const region = hub.region || "Lainnya";
    const existing = byRegionMap.get(region);
    if (existing) {
      existing.hubCount++;
    }
  }

  const byRegion = Array.from(byRegionMap.values())
    .map((r) => ({
      ...r,
      successRate:
        r.inbound > 0 ? (r.delivered / r.inbound) * 100 : 0,
    }))
    .sort((a, b) => b.inbound - a.inbound);

  return NextResponse.json({
    data,
    totals,
    byRegion,
    hubCount: targetHubIds.length,
  });
}