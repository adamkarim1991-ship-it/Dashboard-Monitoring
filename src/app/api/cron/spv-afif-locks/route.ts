import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { dbRead } from "@/lib/db-safe";
import { buildHmsHeaders } from "@/lib/hms-headers";
import { resolveMetricLock, metricPercent } from "@/lib/metric-lock";
import { wibDate, wibHour, opcCurrDate } from "@/lib/operating-day";
import { SPV_AFIF_HUBS } from "@/lib/spv-afif-hubs";

const API_ID_MAIN = "7564027893345453074";
const PAYMENT_TYPES = '["cashless","cod"]';
const SERVICE_TYPES = '["INS","SDS","REG","NDD","OTHERS"]';

function parseCompact(dataStr: string, fields: { name: string }[]) {
  const rows = JSON.parse(dataStr);
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const obj: Record<string, any> = {};
  rows[0].forEach((val: any, i: number) => {
    obj[fields[i]?.name ?? `col_${i}`] = val;
  });
  return obj;
}

async function callHMS(
  token: string,
  hubId: string,
  currDate: string
): Promise<Record<string, any> | null> {
  const url = `${process.env.HMS_BASE_URL}/dc/v1/oneservice`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      ...buildHmsHeaders(token),
    },
    body: JSON.stringify({
      api_id: API_ID_MAIN,
      params: {
        hub_ids: JSON.stringify([hubId]),
        curr_date: currDate,
        payment_types: PAYMENT_TYPES,
        service_types: SERVICE_TYPES,
      },
    }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`HMS HTTP ${res.status}`);
  const json = await res.json();
  if (json.code !== 200) throw new Error(`HMS code ${json.code}`);
  return parseCompact(json.data.data, json.data.fields);
}

async function resolveToken(): Promise<string | null> {
  // Try user tokens first (newest expiry)
  const user = await dbRead(
    () =>
      prisma.user.findFirst({
        where: {
          hmsToken: { not: null },
          hmsTokenExpiresAt: { gt: new Date() },
        },
        orderBy: { hmsTokenExpiresAt: "desc" },
        select: { hmsToken: true },
      }),
    null as { hmsToken: string | null } | null,
    "cron-lock.userToken"
  );
  if (user?.hmsToken) return user.hmsToken;

  // Fallback: any user token (may be expired but worth trying)
  const anyUser = await dbRead(
    () =>
      prisma.user.findFirst({
        where: { hmsToken: { not: null } },
        select: { hmsToken: true },
      }),
    null as { hmsToken: string | null } | null,
    "cron-lock.anyUserToken"
  );
  if (anyUser?.hmsToken) return anyUser.hmsToken;

  // Fallback: hub tokens
  const hub = await dbRead(
    () =>
      prisma.hub.findFirst({
        where: { hmsToken: { not: null } },
        select: { hmsToken: true },
      }),
    null as { hmsToken: string | null } | null,
    "cron-lock.hubToken"
  );
  return hub?.hmsToken ?? null;
}

export async function POST(req: NextRequest) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(req.url);
  const kindParam = url.searchParams.get("kind"); // "clean_floor_08" | "sd12_numerator_12" | null (both)
  const forceHour = url.searchParams.get("hour"); // override WIB hour check for manual runs

  const today = wibDate();
  const currDate = opcCurrDate();
  const hourNow = forceHour ? parseInt(forceHour, 10) : wibHour();

  const token = await resolveToken();
  if (!token) {
    return NextResponse.json(
      { error: "No HMS token available in database" },
      { status: 400 }
    );
  }

  const doCleanFloor = !kindParam || kindParam === "clean_floor_08";
  const doSd12 = !kindParam || kindParam === "sd12_numerator_12";

  // Only capture at/after the lock hour to avoid premature snapshots
  const cleanFloorReady = hourNow >= 8;
  const sd12Ready = hourNow >= 12;

  const results: any[] = [];

  for (const hub of SPV_AFIF_HUBS) {
    const result: any = {
      hub: hub.name,
      hmsHubId: hub.hmsHubId,
      clean_floor: null,
      sd12: null,
      error: null,
    };

    try {
      const main = await callHMS(token, hub.hmsHubId, currDate);
      if (!main) {
        result.error = "Empty HMS response";
        results.push(result);
        continue;
      }

      const toCount = (v: unknown) => Number(v) || 0;
      const totalVolume = toCount(main.today_volume);
      const justArrived = toCount(main.just_arrived);
      const backlog = toCount(main.backlog);
      const ongoing = toCount(main.ongoing_delivery);
      const delivered = toCount(main.delivered);
      const ftd = toCount(main.ftd);
      const others = toCount(main.others);
      const pendingAtHub = toCount(main.pending_at_hub);
      const deliveredFresh = toCount(main.delivered_just_arrived);
      const processedLive = ongoing + delivered + ftd + others;

      // Clean Floor lock (08:00 WIB)
      if (doCleanFloor && cleanFloorReady) {
        const cfLock = await resolveMetricLock({
          req: null,
          facility: hub.hmsHubId,
          kind: "clean_floor_08",
          live: {
            today_volume: totalVolume,
            just_arrived: justArrived,
            backlog,
            ongoing,
            delivered,
            ftd,
            others,
            pending_at_hub: pendingAtHub,
            clean_floor_numerator: processedLive,
            clean_floor_denominator: totalVolume,
          },
          metric: (values) =>
            Math.min(
              metricPercent(
                values.clean_floor_numerator,
                values.clean_floor_denominator
              ),
              100
            ),
          date: today,
          hour: hourNow,
        });
        result.clean_floor = {
          locked: cfLock.payload.is_locked,
          quality: cfLock.payload.quality,
          value: cfLock.payload.value,
          captured_at: cfLock.payload.captured_at,
        };
      }

      // SD12 numerator lock (12:00 WIB)
      if (doSd12 && sd12Ready) {
        const sdLock = await resolveMetricLock({
          req: null,
          facility: hub.hmsHubId,
          kind: "sd12_numerator_12",
          live: { delivered_fresh: deliveredFresh },
          metric: (values) => values.delivered_fresh,
          date: today,
          hour: hourNow,
        });
        result.sd12 = {
          locked: sdLock.payload.is_locked,
          quality: sdLock.payload.quality,
          value: sdLock.payload.value,
          captured_at: sdLock.payload.captured_at,
        };
      }
    } catch (e: any) {
      result.error = e.message;
    }

    results.push(result);
  }

  const summary = {
    ok: true,
    date: today,
    wib_hour: hourNow,
    curr_date: currDate,
    hubs: SPV_AFIF_HUBS.length,
    clean_floor_captured: doCleanFloor && cleanFloorReady,
    sd12_captured: doSd12 && sd12Ready,
    results,
  };

  return NextResponse.json(summary);
}

export async function GET(req: NextRequest) {
  return POST(req);
}
