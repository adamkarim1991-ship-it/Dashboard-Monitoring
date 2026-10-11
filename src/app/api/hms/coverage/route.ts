import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

const API_ID_MAIN = "7564027893345453074";
const PAYMENT_TYPES = '["cashless","cod"]';
const SERVICE_TYPES = '["INS","SDS","REG","NDD","OTHERS"]';

function toWIB(): Date {
  return new Date(Date.now() + 7 * 60 * 60 * 1000);
}

function getMainCurrDate(): string {
  const d = toWIB();
  d.setUTCDate(d.getUTCDate() - 1);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  const day = d.getUTCDate();
  return `${y}-${String(m + 1).padStart(2, "0")}-${String(day).padStart(2, "0")} 17:00:00`;
}

async function callHMS(
  token: string,
  apiId: string,
  params: Record<string, any>,
  retries = 2
) {
  const url = `${process.env.HMS_BASE_URL}/dc/v1/oneservice`;
  
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Accept: "*/*",
          "x-location": "Asia/Jakarta",
          "x-request-source": "web",
          Origin: "https://gtl-id.tokgistic.com",
          Referer: "https://gtl-id.tokgistic.com/tms/operation-performance-central",
        },
        body: JSON.stringify({ api_id: apiId, params }),
        cache: "no-store",
      });
      
      if (!res.ok) throw new Error(`HMS HTTP ${res.status}`);
      const json = await res.json();
      
      if (json.code !== 200) {
        // Retry kalau bukan attempt terakhir
        if (attempt < retries) {
          await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
          continue;
        }
        throw new Error(`HMS code ${json.code}`);
      }
      return json;
    } catch (e: any) {
      if (attempt === retries) throw e;
      await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
    }
  }
  throw new Error("HMS retry exhausted");
}

function parseCompact(dataStr: string, fields: { name: string }[]) {
  const rows = JSON.parse(dataStr);
  if (rows.length === 0) return null;
  const obj: Record<string, any> = {};
  const row = rows[0];
  fields.forEach((f, i) => {
    obj[f.name] = row[i];
  });
  return obj;
}

async function fetchHubSummary(
  token: string,
  hubId: string,
  hubName: string,
  currDate: string
) {
  try {
    const mainRes = await callHMS(token, API_ID_MAIN, {
      hub_ids: JSON.stringify([hubId]),
      curr_date: currDate,
      payment_types: PAYMENT_TYPES,
      service_types: SERVICE_TYPES,
    });

    const main = parseCompact(mainRes.data.data, mainRes.data.fields);
    if (!main) {
      return { hubId, hubName, success: false, error: "Empty response" };
    }

    const justArrived = Number(main.just_arrived) || 0;
    const backlog = Number(main.backlog) || 0;
    const delivered = Number(main.delivered) || 0;
    const ongoing = Number(main.ongoing_delivery) || 0;
    const ftd = Number(main.ftd) || 0;
    const others = Number(main.others) || 0;

    const todayVolume = justArrived + backlog;
    const deliveredPct = todayVolume > 0 ? (delivered / todayVolume) * 100 : 0;
    const freshSuccess =
      justArrived > 0
        ? ((Number(main.delivered_just_arrived) || 0) / justArrived) * 100
        : 0;

    return {
      hubId,
      hubName,
      success: true,
      just_arrived: justArrived,
      backlog,
      today_volume: todayVolume,
      delivered,
      ongoing_delivery: ongoing,
      ftd,
      others,
      delivered_percentage: parseFloat(deliveredPct.toFixed(2)),
      fresh_success: parseFloat(freshSuccess.toFixed(2)),
      sd_before_12: parseFloat(main.sd_before_12) || 0,
      cod_fd: parseFloat(main.cod_fd) || 0,
    };
  } catch (e: any) {
    return { hubId, hubName, success: false, error: e.message };
  }
}

// Batch fetch: proses hub satu batch kecil sekaligus + delay antar batch
async function fetchInBatches(
  hubs: Array<{ hubId: string; hubName: string }>,
  token: string,
  currDate: string,
  batchSize = 3,
  delayMs = 500
) {
  const results: any[] = [];
  for (let i = 0; i < hubs.length; i += batchSize) {
    const batch = hubs.slice(i, i + batchSize);
    const batchResults = await Promise.all(
      batch.map((h) => fetchHubSummary(token, h.hubId, h.hubName, currDate))
    );
    results.push(...batchResults);
    // Delay antar batch (kecuali batch terakhir)
    if (i + batchSize < hubs.length) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  return results;
}

export async function GET(req: NextRequest) {
  console.log("=== HIT /api/hms/coverage ===");

  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userHubs = await prisma.userHub.findMany({
    where: { userId: session.user.id },
    include: { hub: true },
  });

  if (userHubs.length === 0) {
    return NextResponse.json({ error: "No hub access" }, { status: 403 });
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { hmsToken: true },
  });

  if (!user?.hmsToken) {
    return NextResponse.json(
      { error: "No HMS token", message: "Buka HMS dulu." },
      { status: 403 }
    );
  }

  const currDate = getMainCurrDate();

  // Batch fetch (3 hub per batch + delay 500ms)
  const results = await fetchInBatches(
    userHubs.map((uh) => ({
      hubId: uh.hub.hmsHubId,
      hubName: uh.hub.name,
    })),
    user.hmsToken,
    currDate,
    3,   // batch size
    500  // delay ms
  );

  const aggregated = results.reduce(
    (acc, r: any) => {
      if (!r.success) return acc;
      acc.total_volume += r.today_volume || 0;
      acc.total_delivered += r.delivered || 0;
      acc.total_ongoing += r.ongoing_delivery || 0;
      acc.total_ftd += r.ftd || 0;
      return acc;
    },
    { total_volume: 0, total_delivered: 0, total_ongoing: 0, total_ftd: 0 }
  );

  const avgSuccess =
    aggregated.total_volume > 0
      ? parseFloat(
          ((aggregated.total_delivered / aggregated.total_volume) * 100).toFixed(2)
        )
      : 0;

  const successCount = results.filter((r: any) => r.success).length;

  return NextResponse.json({
    success: true,
    meta: {
      hubs_count: userHubs.length,
      success_count: successCount,
      fail_count: userHubs.length - successCount,
      fetched_at: new Date().toISOString(),
    },
    aggregated: {
      ...aggregated,
      avg_success: avgSuccess,
    },
    hubs: results,
  });
}