import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

const API_ID_MAIN = "7564027893345453074";
const API_ID_CYCLE1 = "7657180282079970311";
const API_ID_OPS = "7517597334683780103";
const API_ID_COURIER = "7514949742451868679";
const HUB_ID = "460450593288";
const JOB_ROLES_CYCLE =
  '["Rider LM 2W - Mitra Prioritas","Ops LM - Mitra","Ops LM - Mitra Oncall","Rider LM 2W","Dedicated Rider LM 2W","Ops LM"]';
const PAYMENT_TYPES = '["cashless","cod"]';
const SERVICE_TYPES = '["INS","SDS","REG","NDD","OTHERS"]';

function getMainCurrDate(): string {
  const nowWIB = new Date(Date.now() + 7 * 60 * 60 * 1000);
  const y = nowWIB.getUTCFullYear();
  const m = nowWIB.getUTCMonth();
  const d = nowWIB.getUTCDate() - 1;
  return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")} 17:00:00`;
}

function getTodayDate(): string {
  const nowWIB = new Date(Date.now() + 7 * 60 * 60 * 1000);
  const y = nowWIB.getUTCFullYear();
  const m = nowWIB.getUTCMonth();
  const d = nowWIB.getUTCDate();
  return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function getCycleList(): string {
  const nowWIB = new Date(Date.now() + 7 * 60 * 60 * 1000);
  const y = nowWIB.getUTCFullYear();
  const m = nowWIB.getUTCMonth();
  const d = nowWIB.getUTCDate() - 1;
  const startMs = Date.UTC(y, m, d, 17, 0, 0) - 7 * 60 * 60 * 1000;
  const endMs = Date.UTC(y, m, d + 1, 17, 0, 0) - 7 * 60 * 60 * 1000;
  return JSON.stringify([
    `${Math.floor(startMs / 1000)}-${Math.floor(endMs / 1000)}`,
  ]);
}

export async function GET() {
  const result: any = { tests: [] };

  const user = await prisma.user.findFirst({
    where: { email: "manager@goto.com" },
    select: { hmsToken: true },
  });

  if (!user?.hmsToken) {
    return NextResponse.json({ error: "No token" }, { status: 400 });
  }

  const currDate = getMainCurrDate();
  const todayDate = getTodayDate();
  const cycleList = getCycleList();

  const configs = [
    {
      name: "MAIN",
      apiId: API_ID_MAIN,
      params: {
        hub_ids: JSON.stringify([HUB_ID]),
        curr_date: currDate,
        payment_types: PAYMENT_TYPES,
        service_types: SERVICE_TYPES,
      },
    },
    {
      name: "CYCLE1",
      apiId: API_ID_CYCLE1,
      params: {
        hub_id: HUB_ID,
        driver_name: "",
        job_roles: JOB_ROLES_CYCLE,
        cycle_list: cycleList,
      },
    },
    {
      name: "OPS",
      apiId: API_ID_OPS,
      params: {
        hub_ids: JSON.stringify([HUB_ID]),
        curr_date_start: currDate,
        date: todayDate,
      },
    },
    {
      name: "COURIER",
      apiId: API_ID_COURIER,
      params: {
        hub_ids: JSON.stringify([HUB_ID]),
        curr_date_start: currDate,
        date: todayDate,
        job_roles: JOB_ROLES_CYCLE,
      },
    },
  ];

  for (const cfg of configs) {
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
        body: JSON.stringify({ api_id: cfg.apiId, params: cfg.params }),
        cache: "no-store",
      });

      const body = await res.text();
      let parsed: any = {};
      try {
        parsed = JSON.parse(body);
      } catch {}
      result.tests.push({
        name: cfg.name,
        apiId: cfg.apiId,
        status: res.status,
        hmsCode: parsed?.code,
        ok: res.ok && parsed?.code === 200,
        params: cfg.params,
        bodyPreview: body.slice(0, 400),
      });
    } catch (e: any) {
      result.tests.push({ name: cfg.name, apiId: cfg.apiId, error: e.message });
    }
  }

  return NextResponse.json(result);
}