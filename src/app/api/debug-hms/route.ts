import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

const API_ID_COURIER = "7514949742451868679";
const HUB_ID = "460450593288";

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
  const todayWIB = new Date(Date.now() + 7 * 60 * 60 * 1000);
  const todayDate = `${todayWIB.getUTCFullYear()}-${String(
    todayWIB.getUTCMonth() + 1
  ).padStart(2, "0")}-${String(todayWIB.getUTCDate()).padStart(2, "0")}`;

  const results: any[] = [];

  // Filter untuk tiap job role
  const filters = [
    {
      label: "ALL",
      job_roles:
        '["Rider LM 2W - Mitra Prioritas","Ops LM - Mitra","Ops LM - Mitra Oncall","Rider LM 2W","Dedicated Rider LM 2W","Ops LM"]',
    },
    { label: "DEDICATED ONLY", job_roles: '["Dedicated Rider LM 2W"]' },
    { label: "RIDER ONLY", job_roles: '["Rider LM 2W"]' },
    { label: "OPS ONLY", job_roles: '["Ops LM","Ops LM - Mitra","Ops LM - Mitra Oncall"]' },
  ];

  for (const f of filters) {
    try {
      const res = await fetch(
        `${process.env.HMS_BASE_URL}/dc/v1/oneservice`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${user.hmsToken}`,
            "Content-Type": "application/json",
            Accept: "*/*",
            Origin: "https://gtl-id.tokgistic.com",
            Referer:
              "https://gtl-id.tokgistic.com/tms/operation-performance-central",
          },
          body: JSON.stringify({
            api_id: API_ID_COURIER,
            params: {
              hub_ids: JSON.stringify([HUB_ID]),
              curr_date_start: currDate,
              date: todayDate,
              job_roles: f.job_roles,
            },
          }),
          cache: "no-store",
        }
      );
      const body = await res.text();
      let parsed: any = {};
      try {
        parsed = JSON.parse(body);
      } catch {}
      results.push({
        label: f.label,
        job_roles: f.job_roles,
        hmsCode: parsed?.code,
        ok: res.ok && parsed?.code === 200,
        data: parsed?.data?.data,
        fields: parsed?.data?.fields?.map((x: any) => x.name),
      });
    } catch (e: any) {
      results.push({ label: f.label, error: e.message });
    }
  }

  return NextResponse.json({ results });
}