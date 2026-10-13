import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

const API_ID_MAIN = "7564027893345453074";
const PAYMENT_TYPES = '["cashless","cod"]';
const SERVICE_TYPES = '["INS","SDS","REG","NDD","OTHERS"]';

function toWIB(): Date {
  return new Date(Date.now() + 7 * 60 * 60 * 1000);
}

function formatDateYMD(d: Date): string {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  const day = d.getUTCDate();
  return `${y}-${String(m + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function getMainCurrDate(): string {
  const d = toWIB();
  d.setUTCDate(d.getUTCDate() - 1);
  return `${formatDateYMD(d)} 17:00:00`;
}

function getTodayDate(): string {
  return formatDateYMD(toWIB());
}

function toSafeNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

async function callHMS(
  token: string,
  params: Record<string, any>
) {
  const url = `${process.env.HMS_BASE_URL}/dc/v1/oneservice`;
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
    body: JSON.stringify({ api_id: API_ID_MAIN, params }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`HMS HTTP ${res.status}`);
  const json = await res.json();
  if (json.code !== 200) throw new Error(`HMS code ${json.code}`);
  return json;
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

/**
 * Cari "super token" — token HMS yang punya akses luas.
 * Priority:
 * 1. User dengan role MANAGER + hmsToken (biasanya manager global)
 * 2. User dengan role HUB_LEAD + hmsToken
 * 3. User manapun yang punya hmsToken
 */
async function getSuperToken(): Promise<string | null> {
  const manager = await prisma.user.findFirst({
    where: { role: "MANAGER", hmsToken: { not: null } },
    orderBy: { createdAt: "asc" },
    select: { hmsToken: true },
  });
  if (manager?.hmsToken) return manager.hmsToken;

  const leader = await prisma.user.findFirst({
    where: { role: "HUB_LEAD", hmsToken: { not: null } },
    orderBy: { createdAt: "asc" },
    select: { hmsToken: true },
  });
  if (leader?.hmsToken) return leader.hmsToken;

  const anyUser = await prisma.user.findFirst({
    where: { hmsToken: { not: null } },
    orderBy: { createdAt: "asc" },
    select: { hmsToken: true },
  });
  return anyUser?.hmsToken || null;
}

export async function GET(req: NextRequest) {
  return handler(req);
}

export async function POST(req: NextRequest) {
  return handler(req);
}

async function handler(req: NextRequest) {
  console.log("=== HIT /api/cron/clean-floor ===");

  // Auth
  const authHeader = req.headers.get("authorization");
  const secret = process.env.CRON_SECRET;

  if (!secret) {
    console.error("[cron] CRON_SECRET not set");
    return NextResponse.json(
      { error: "Server not configured" },
      { status: 500 }
    );
  }

  const providedToken =
    authHeader?.replace(/^Bearer\s+/i, "") ||
    req.nextUrl.searchParams.get("secret");

  if (providedToken !== secret) {
    console.warn("[cron] Unauthorized — bad secret");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Get super token
  const token = await getSuperToken();
  if (!token) {
    return NextResponse.json(
      { error: "No HMS token available in DB" },
      { status: 500 }
    );
  }

  // Get all hubs
  const hubs = await prisma.hub.findMany({
    select: { id: true, name: true, hmsHubId: true },
  });

  if (hubs.length === 0) {
    return NextResponse.json(
      { error: "No hubs in DB" },
      { status: 400 }
    );
  }

  const todayDate = getTodayDate();
  const currDate = getMainCurrDate();

  const results: Array<{
    hubId: string;
    hubName: string;
    status: "created" | "existing" | "failed";
    value?: number;
    error?: string;
  }> = [];

  for (const hub of hubs) {
    try {
      // Skip kalau snapshot hari ini sudah ada
      const existing = await prisma.cleanFloorSnapshot.findUnique({
        where: {
          facility_date: { facility: hub.hmsHubId, date: todayDate },
        },
      });

      if (existing) {
        console.log(
          `[cron] Skip ${hub.name} — snapshot exists (${existing.value.toFixed(2)}%)`
        );
        results.push({
          hubId: hub.hmsHubId,
          hubName: hub.name,
          status: "existing",
          value: parseFloat(existing.value.toFixed(2)),
        });
        continue;
      }

      // Fetch HMS
      const res = await callHMS(token, {
        hub_ids: JSON.stringify([hub.hmsHubId]),
        curr_date: currDate,
        payment_types: PAYMENT_TYPES,
        service_types: SERVICE_TYPES,
      });

      const main = parseCompact(res.data.data, res.data.fields);
      if (!main) {
        console.warn(`[cron] Empty HMS response for ${hub.name}`);
        results.push({
          hubId: hub.hmsHubId,
          hubName: hub.name,
          status: "failed",
          error: "Empty HMS response",
        });
        continue;
      }

      // Compute Clean Floor
      const delivered = toSafeNumber(main.delivered);
      const ongoing = toSafeNumber(main.ongoing_delivery);
      const ftd = toSafeNumber(main.ftd);
      const others = toSafeNumber(main.others);
      const justArrived = toSafeNumber(main.just_arrived);
      const backlog = toSafeNumber(main.backlog);
      const todayVolume = justArrived + backlog;
      const numerator = ongoing + delivered + ftd + others;
      const value =
        todayVolume > 0 ? (numerator / todayVolume) * 100 : 0;

      // Save
      const created = await prisma.cleanFloorSnapshot.create({
        data: {
          facility: hub.hmsHubId,
          date: todayDate,
          value,
          numerator,
          denominator: todayVolume,
          delivered,
          ongoing,
          ftd,
          others,
        },
      });

      console.log(
        `[cron] Created snapshot ${hub.name}: ${created.value.toFixed(2)}%`
      );
      results.push({
        hubId: hub.hmsHubId,
        hubName: hub.name,
        status: "created",
        value: parseFloat(created.value.toFixed(2)),
      });
    } catch (e: any) {
      console.error(`[cron] Error ${hub.name}:`, e.message);
      results.push({
        hubId: hub.hmsHubId,
        hubName: hub.name,
        status: "failed",
        error: e.message,
      });
    }

    // Delay kecil antar hub (rate limit HMS)
    await new Promise((r) => setTimeout(r, 300));
  }

  const summary = {
    total: hubs.length,
    created: results.filter((r) => r.status === "created").length,
    existing: results.filter((r) => r.status === "existing").length,
    failed: results.filter((r) => r.status === "failed").length,
  };

  return NextResponse.json({
    success: true,
    date: todayDate,
    summary,
    results,
  });
}