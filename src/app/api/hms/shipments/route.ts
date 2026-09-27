import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Ambil token HMS milik user dari database
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { hmsToken: true, hmsTokenUpdatedAt: true },
  });

  if (!user?.hmsToken) {
    return NextResponse.json(
      {
        error: "No HMS token",
        message:
          "Token HMS belum tersedia. Buka HMS di tab lain dengan extension GTL Bridge aktif.",
      },
      { status: 403 }
    );
  }

  const { searchParams } = new URL(req.url);
  const page = searchParams.get("page") ?? "1";

  const now = Math.floor(Date.now() / 1000);
  const fromTs = searchParams.get("from") ?? String(now - 24 * 60 * 60);
  const toTs = searchParams.get("to") ?? String(now);

  const url = new URL(
    `${process.env.HMS_BASE_URL}/tms/api/lms/v1/shipments`
  );
  url.searchParams.set("type", "order_management");
  url.searchParams.set("leg_type", "last_mile");
  url.searchParams.set("per_page", "100");
  url.searchParams.set("tab", "order_view");
  url.searchParams.set("created_at_from", fromTs);
  url.searchParams.set("created_at_to", toTs);
  url.searchParams.set("page", page);

  const hmsRes = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${user.hmsToken}`,
      Accept: "application/json, text/plain, */*",
      "Accept-Language": "en",
      Origin: "https://gtl-id.tokgistic.com",
      Referer: "https://gtl-id.tokgistic.com/hms/order-management",
    },
    cache: "no-store",
  });

  if (!hmsRes.ok) {
    const text = await hmsRes.text();

    // Kalau 401, berarti token user expired
    if (hmsRes.status === 401) {
      return NextResponse.json(
        {
          error: "HMS token expired",
          message:
            "Token HMS kamu expired. Buka HMS lagi di tab lain untuk refresh.",
        },
        { status: 401 }
      );
    }

    return NextResponse.json(
      {
        error: "HMS API failed",
        status: hmsRes.status,
        detail: text.slice(0, 500),
      },
      { status: 502 }
    );
  }

  const data = await hmsRes.json();
  return NextResponse.json(data);
}