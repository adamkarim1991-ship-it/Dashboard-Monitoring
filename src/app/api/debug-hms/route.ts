import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function GET() {
  const result: any = { steps: [] };

  try {
    // Step 1: Cek DB
    const user = await prisma.user.findFirst({
      where: { email: "manager@goto.com" },
      select: { hmsToken: true, hmsTokenUpdatedAt: true },
    });

    result.steps.push({
      step: "1. DB query",
      ok: !!user,
      tokenPrefix: user?.hmsToken?.slice(0, 30),
      tokenSuffix: user?.hmsToken?.slice(-30),
      tokenLength: user?.hmsToken?.length,
      updatedAt: user?.hmsTokenUpdatedAt,
    });

    if (!user?.hmsToken) {
      result.steps.push({ step: "ERROR", message: "No token in DB" });
      return NextResponse.json(result);
    }

    // Step 2: Test call HMS
    const hmsUrl = `${process.env.HMS_BASE_URL}/dc/v1/oneservice`;
    result.steps.push({ step: "2. HMS URL", url: hmsUrl });

    const body = {
      api_id: "7564027893345453074",
      params: {
        hub_ids: JSON.stringify(["460450593288"]),
        curr_date: new Date(Date.now() - 86400000).toISOString().slice(0, 10) + " 17:00:00",
        payment_types: '["cashless","cod"]',
        service_types: '["INS","SDS","REG","NDD","OTHERS"]',
      },
    };

    const res = await fetch(hmsUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${user.hmsToken}`,
        "Content-Type": "application/json",
        Accept: "*/*",
        "x-location": "Asia/Jakarta",
        "x-request-source": "web",
        Origin: "https://gtl-id.tokgistic.com",
        Referer: "https://gtl-id.tokgistic.com/tms/operation-performance-central",
      },
      body: JSON.stringify(body),
      cache: "no-store",
    });

    result.steps.push({
      step: "3. HMS response",
      status: res.status,
      statusText: res.statusText,
      headers: Object.fromEntries(res.headers.entries()),
    });

    const responseText = await res.text();
    result.steps.push({
      step: "4. HMS body (first 500 char)",
      body: responseText.slice(0, 500),
    });

    result.success = res.ok;
    return NextResponse.json(result);
  } catch (e: any) {
    result.steps.push({
      step: "EXCEPTION",
      name: e?.name,
      message: e?.message,
      stack: e?.stack?.split("\n").slice(0, 5),
    });
    return NextResponse.json(result, { status: 500 });
  }
}