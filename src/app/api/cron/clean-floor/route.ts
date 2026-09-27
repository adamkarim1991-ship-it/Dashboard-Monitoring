import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

// ============================================================
// CRON: Capture Clean Floor snapshot at 08:00 WIB
// Auth: Bearer CRON_SECRET
// Idempotent: skip kalau snapshot hari ini sudah ada
// ============================================================

const HUB_ID_JATINEGARA = "460450593288";
const API_ID_MAIN = "7564027893345453074";
const PAYMENT_TYPES_ALL = '["cashless","cod"]';
const SERVICE_TYPES = '["INS","SDS","REG","NDD","OTHERS"]';

function getWIBDate(): { date: string; hour: number } {
  const nowWIB = new Date(Date.now() + 7 * 60 * 60 * 1000);
  const y = nowWIB.getUTCFullYear();
  const m = nowWIB.getUTCMonth();
  const d = nowWIB.getUTCDate();
  const h = nowWIB.getUTCHours();
  return {
    date: `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`,
    hour: h,
  };
}

function getMainCurrDate(): string {
  const nowWIB = new Date(Date.now() + 7 * 60 * 60 * 1000);
  const y = nowWIB.getUTCFullYear();
  const m = nowWIB.getUTCMonth();
  const d = nowWIB.getUTCDate() - 1;
  return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")} 17:00:00`;
}

async function callHMS(token: string, apiId: string, params: Record<string, any>) {
  const url = `${process.env.HMS_BASE_URL}/dc/v1/oneservice`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "*/*",
      "Accept-Language": "en-US,en;q=0.9",
      "x-location": "Asia/Jakarta",
      "x-request-source": "web",
      Origin: "https://gtl-id.tokgistic.com",
      Referer: "https://gtl-id.tokgistic.com/tms/operation-performance-central",
    },
    body: JSON.stringify({ api_id: apiId, params }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`HMS ${res.status}`);
  const json = await res.json();
  if (json.code !== 200) throw new Error(`HMS error: ${json.msg}`);
  return json;
}

function parseCompact(dataStr: string, fields: { name: string }[]) {
  const rows = JSON.parse(dataStr);
  if (rows.length === 0) return null;
  const obj: Record<string, any> = {};
  const row = rows[0];
  fields.forEach((f, i) => { obj[f.name] = row[i]; });
  return obj;
}

function toSafeNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

export async function POST(req: NextRequest) {
  // 1. Auth
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const wib = getWIBDate();
  console.log(`[cron/clean-floor] Triggered at WIB ${wib.date} ${wib.hour}:xx`);

  // 2. Safety: hanya jalan antara jam 8-9 WIB
  if (wib.hour < 8 || wib.hour > 9) {
    return NextResponse.json({
      skipped: true,
      reason: `WIB hour ${wib.hour} di luar window 8-9`,
      wib,
    });
  }

  // 3. Cek idempotency
  const snapshotKey = { facility: HUB_ID_JATINEGARA, date: wib.date };
  const existing = await prisma.cleanFloorSnapshot.findUnique({
    where: { facility_date: snapshotKey },
  });
  if (existing) {
    return NextResponse.json({
      skipped: true,
      reason: "Snapshot hari ini sudah ada",
      captured_at: existing.capturedAt.toISOString(),
    });
  }

  // 4. Ambil HMS token dari user MANAGER pertama yang punya token
  const manager = await prisma.user.findFirst({
    where: { role: "MANAGER", hmsToken: { not: null } },
    select: { hmsToken: true, email: true },
  });
  if (!manager?.hmsToken) {
    return NextResponse.json(
      { error: "No HMS token available. Pastikan ada user MANAGER dengan token." },
      { status: 403 }
    );
  }

  // 5. Call HMS MAIN
  try {
    const mainRes = await callHMS(manager.hmsToken, API_ID_MAIN, {
      hub_ids: JSON.stringify([HUB_ID_JATINEGARA]),
      curr_date: getMainCurrDate(),
      payment_types: PAYMENT_TYPES_ALL,
      service_types: SERVICE_TYPES,
    });
    const mainAll = parseCompact(mainRes.data.data, mainRes.data.fields);
    if (!mainAll) throw new Error("Empty HMS response");

    const delivered = toSafeNumber(mainAll.delivered);
    const ongoing = toSafeNumber(mainAll.ongoing_delivery);
    const ftd = toSafeNumber(mainAll.ftd);
    const others = toSafeNumber(mainAll.others);
    const justArrived = toSafeNumber(mainAll.just_arrived);
    const backlog = toSafeNumber(mainAll.backlog);
    const denominator = justArrived + backlog;
    const numerator = ongoing + delivered + ftd + others;
    const value = denominator > 0 ? (numerator / denominator) * 100 : 0;

    // 6. Create snapshot (idempotent via unique constraint)
    try {
      const created = await prisma.cleanFloorSnapshot.create({
        data: {
          ...snapshotKey,
          value,
          numerator,
          denominator,
          delivered,
          ongoing,
          ftd,
          others,
        },
      });
      console.log(`[cron/clean-floor] Created snapshot: value=${value.toFixed(2)}%`);
      return NextResponse.json({
        success: true,
        captured_at: created.capturedAt.toISOString(),
        value: parseFloat(created.value.toFixed(2)),
        breakdown: { delivered, ongoing, ftd, others, today_volume: denominator },
        triggered_by: manager.email,
      });
    } catch (error: any) {
      if (error.code === "P2002") {
        // Race: ada yang create duluan
        const winner = await prisma.cleanFloorSnapshot.findUnique({
          where: { facility_date: snapshotKey },
        });
        return NextResponse.json({
          skipped: true,
          reason: "Race condition — snapshot sudah dibuat request lain",
          captured_at: winner?.capturedAt.toISOString(),
        });
      }
      throw error;
    }
  } catch (e: any) {
    console.error("[cron/clean-floor] Error:", e.message);
    return NextResponse.json(
      { error: "HMS failed", detail: e.message },
      { status: 502 }
    );
  }
}