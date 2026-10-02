import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

const API_ID_MAIN = "7564027893345453074";
const HUB_ID = "460450593288";
const PAYMENT_TYPES_ALL = '["cashless","cod"]';
const SERVICE_TYPES = '["INS","SDS","REG","NDD","OTHERS"]';

async function testCall(token: string, label: string, params: any) {
  try {
    const res = await fetch(`${process.env.HMS_BASE_URL}/dc/v1/oneservice`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "*/*",
        "x-location": "Asia/Jakarta",
        "x-request-source": "web",
        Origin: "https://gtl-id.tokgistic.com",
        Referer:
          "https://gtl-id.tokgistic.com/tms/operation-performance-central",
      },
      body: JSON.stringify({ api_id: API_ID_MAIN, params }),
      cache: "no-store",
    });
    const body = await res.text();
    let parsed: any = {};
    try {
      parsed = JSON.parse(body);
    } catch {}
    return {
      label,
      params,
      hmsCode: parsed?.code,
      hmsMsg: parsed?.data?.base_resp?.message || parsed?.msg,
      ok: res.ok && parsed?.code === 200,
      dataPreview:
        typeof parsed?.data?.data === "string"
          ? parsed.data.data.slice(0, 150)
          : parsed?.data?.data,
    };
  } catch (e: any) {
    return { label, params, error: e.message };
  }
}

export async function GET() {
  const user = await prisma.user.findFirst({
    where: { email: "manager@goto.com" },
    select: { hmsToken: true },
  });

  if (!user?.hmsToken) {
    return NextResponse.json({ error: "No token" }, { status: 400 });
  }

  const nowWIB = new Date(Date.now() + 7 * 60 * 60 * 1000);
  nowWIB.setUTCDate(nowWIB.getUTCDate() - 1);
  const currDate = `${nowWIB.getUTCFullYear()}-${String(
    nowWIB.getUTCMonth() + 1
  ).padStart(2, "0")}-${String(nowWIB.getUTCDate()).padStart(2, "0")} 17:00:00`;

  const results: any[] = [];

  // BASELINE
  results.push(
    await testCall(user.hmsToken, "BASELINE (all payment)", {
      hub_ids: JSON.stringify([HUB_ID]),
      curr_date: currDate,
      payment_types: PAYMENT_TYPES_ALL,
      service_types: SERVICE_TYPES,
    })
  );

  // URGENT variants
  for (const key of [
    "is_urgent",
    "urgent",
    "urgent_filter",
    "is_urgent_filter",
    "urgent_flag",
  ]) {
    results.push(
      await testCall(user.hmsToken, `URGENT: ${key}="true"`, {
        hub_ids: JSON.stringify([HUB_ID]),
        curr_date: currDate,
        payment_types: PAYMENT_TYPES_ALL,
        service_types: SERVICE_TYPES,
        [key]: "true",
      })
    );
  }

  // COD variants
  for (const pt of ['["cod"]', '["COD"]', "cod", '["cod","COD"]']) {
    results.push(
      await testCall(user.hmsToken, `COD: payment_types=${pt}`, {
        hub_ids: JSON.stringify([HUB_ID]),
        curr_date: currDate,
        payment_types: pt,
        service_types: SERVICE_TYPES,
      })
    );
  }

  return NextResponse.json({ results });
}