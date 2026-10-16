import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

// Helper: hitung 00:00 WIB hari ini dalam unix timestamp (detik)
function getTodayStartWIB(): number {
  const now = new Date();
  // WIB = UTC+7
  const wibOffsetMs = 7 * 60 * 60 * 1000;
  const nowWIB = new Date(now.getTime() + wibOffsetMs);
  // Set ke 00:00 WIB
  nowWIB.setUTCHours(0, 0, 0, 0);
  // Convert balik ke unix timestamp (detik)
  const todayStartWIBMs = nowWIB.getTime() - wibOffsetMs;
  return Math.floor(todayStartWIBMs / 1000);
}

// Helper: hitung sekarang dalam unix timestamp (detik)
function getNowUnix(): number {
  return Math.floor(Date.now() / 1000);
}

// Fetch 1 halaman dari HMS
async function fetchHMSPage(
  token: string,
  page: number,
  fromTs: number,
  toTs: number
) {
  const url = new URL(
    `${process.env.HMS_BASE_URL}/tms/api/lms/v1/shipments`
  );
  url.searchParams.set("type", "order_management");
  url.searchParams.set("leg_type", "last_mile");
  url.searchParams.set("per_page", "100");
  url.searchParams.set("tab", "order_view");
  url.searchParams.set("created_at_from", String(fromTs));
  url.searchParams.set("created_at_to", String(toTs));
  url.searchParams.set("page", String(page));

  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json, text/plain, */*",
      "Accept-Language": "en",
      Origin: "https://gtl-id.tokgistic.com",
      Referer: "https://gtl-id.tokgistic.com/hms/order-management",
    },
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(`HMS page ${page} failed: ${res.status}`);
  }

  return res.json();
}

export async function GET(req: NextRequest) {
  console.log("=== HIT /api/hms/performance ===");

  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Ambil HMS token user dari DB
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { hmsToken: true },
  });

  if (!user?.hmsToken) {
    return NextResponse.json(
      {
        error: "No HMS token",
        message: "Buka HMS di tab lain untuk sync token.",
      },
      { status: 403 }
    );
  }

  const hmsToken = user.hmsToken;

  const fromTs = getTodayStartWIB();
  const toTs = getNowUnix();

  console.log(`[performance] Fetching WIB today: ${fromTs} - ${toTs}`);
  console.log(
    `[performance] WIB range: ${new Date(fromTs * 1000).toISOString()} - ${new Date(toTs * 1000).toISOString()}`
  );

  try {
    // Fetch halaman 1 untuk tahu total records
    const firstPage = await fetchHMSPage(hmsToken, 1, fromTs, toTs);

    const totalRecords = firstPage?.data?.total_records || 0;
    const totalPages = Math.ceil(totalRecords / 100);

    console.log(
      `[performance] Total records: ${totalRecords}, Total pages: ${totalPages}`
    );

    let allShipments = firstPage?.data?.shipments || [];

    // Fetch halaman sisa secara paralel (batch 5)
    if (totalPages > 1) {
      const pagesToFetch = Array.from(
        { length: totalPages - 1 },
        (_, i) => i + 2
      );

      const batchSize = 5;
      for (let i = 0; i < pagesToFetch.length; i += batchSize) {
        const batch = pagesToFetch.slice(i, i + batchSize);
        const results = await Promise.all(
          batch.map((page) =>
            fetchHMSPage(hmsToken, page, fromTs, toTs).catch((e) => {
              console.error(`Page ${page} error:`, e.message);
              return null;
            })
          )
        );

        for (const result of results) {
          if (result?.data?.shipments) {
            allShipments = allShipments.concat(result.data.shipments);
          }
        }
      }
    }

    console.log(`[performance] Total fetched: ${allShipments.length}`);

    // Deduplicate by AWB
    const uniqueMap = new Map();
    for (const s of allShipments) {
      if (s.awb_number && !uniqueMap.has(s.awb_number)) {
        uniqueMap.set(s.awb_number, s);
      }
    }
    const uniqueShipments = Array.from(uniqueMap.values());

    console.log(`[performance] After dedup: ${uniqueShipments.length}`);

    // Filter: cuma GTL Jatinegara Hub
    const JATINEGARA_HUB = "GTL Jatinegara Hub";
    const filtered = uniqueShipments.filter(
      (s) => s.actual_hub === JATINEGARA_HUB
    );

    console.log(`[performance] Jatinegara only: ${filtered.length}`);

    return NextResponse.json({
      success: true,
      meta: {
        fromTs,
        toTs,
        totalRecords,
        totalFetched: allShipments.length,
        afterDedup: uniqueShipments.length,
        afterFilter: filtered.length,
        fetchedAt: new Date().toISOString(),
      },
      shipments: filtered,
    });
  } catch (e: any) {
    console.error("[performance] Error:", e.message);
    return NextResponse.json(
      { error: "HMS fetch failed", detail: e.message },
      { status: 502 }
    );
  }
}
