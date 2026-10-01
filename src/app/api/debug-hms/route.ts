import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

const API_IDS = {
  MAIN: "7564027893345453074",
  CYCLE1: "7657180282079970311",
  OPS: "7517597334683780103",
  COURIER: "7514949742451868679",
};

export async function GET() {
  const result: any = { tests: [] };

  const user = await prisma.user.findFirst({
    where: { email: "manager@goto.com" },
    select: { hmsToken: true },
  });

  if (!user?.hmsToken) {
    return NextResponse.json({ error: "No token" }, { status: 400 });
  }

  for (const [name, apiId] of Object.entries(API_IDS)) {
    try {
      const res = await fetch(`${process.env.HMS_BASE_URL}/dc/v1/oneservice`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${user.hmsToken}`,
          "Content-Type": "application/json",
          Accept: "*/*",
          "x-location": "Asia/Jakarta",
          "x-request-source": "web",
          Origin: "https://gtl-id.tokgistic.com",
          Referer:
            "https://gtl-id.tokgistic.com/tms/operation-performance-central",
        },
        body: JSON.stringify({
          api_id: apiId,
          params: {
            hub_ids: JSON.stringify(["460450593288"]),
            curr_date:
              new Date(Date.now() - 86400000).toISOString().slice(0, 10) +
              " 17:00:00",
            payment_types: '["cashless","cod"]',
            service_types: '["INS","SDS","REG","NDD","OTHERS"]',
          },
        }),
        cache: "no-store",
      });

      const body = await res.text();
      result.tests.push({
        name,
        apiId,
        status: res.status,
        ok: res.ok,
        bodyPreview: body.slice(0, 300),
      });
    } catch (e: any) {
      result.tests.push({ name, apiId, error: e.message });
    }
  }

  return NextResponse.json(result);
}