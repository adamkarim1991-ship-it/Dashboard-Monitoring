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

  // Ambil 48 jam terakhir (buffer timezone)
  const now = new Date();
  const from = new Date(now.getTime() - 48 * 60 * 60 * 1000);

  const metrics = await prisma.hourlyMetric.findMany({
    where: {
      hubId: { in: targetHubIds },
      hourTimestamp: { gte: from },
    },
    orderBy: { hourTimestamp: "asc" },
  });

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

  return NextResponse.json({
    data,
    totals,
    hubCount: targetHubIds.length,
  });
}