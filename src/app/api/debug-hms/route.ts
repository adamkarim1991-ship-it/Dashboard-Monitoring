import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

const API_ID_DEDICATED = "7591486857905554439";
const HUB_ID = "460450593288";
const JOB_ROLES_DEDICATED = '["Dedicated Rider LM 2W"]';

function toWIB(): Date {
  return new Date(Date.now() + 7 * 60 * 60 * 1000);
}

export async function GET() {
  const user = await prisma.user.findFirst({
    where: { email: "manager@goto.com" },
    select: { hmsToken: true },
  });

  if (!user?.hmsToken) {
    return NextResponse.json({ error: "No token" }, { status: 400 });
  }

  const results: any[] = [];

  // Test beberapa varian cycle time
  const variants = [
    {
      label: "HMS style (00:00-08:00)",
      cycle_start_time: String(
        Math.floor(
          Date.UTC(
            toWIB().getUTCFullYear(),
            toWIB().getUTCMonth(),
            toWIB().getUTCDate(),
            0,
            0,
            0
          ) /
            1000 -
            7 * 3600
        )
      ),
      cycle_end_time: String(
        Math.floor(
          Date.UTC(
            toWIB().getUTCFullYear(),
            toWIB().getUTCMonth(),
            toWIB().getUTCDate(),
            8,
            0,
            0
          ) /
            1000 -
            7 * 3600
        )
      ),
    },
    {
      label: "User provided",
      cycle_start_time: "1790960400",
      cycle_end_time: "1790989200",
    },
    {
      label: "Cycle 17:00 → 17:00",
      cycle_start_time: String(
        Math.floor(
          Date.UTC(
            toWIB().getUTCFullYear(),
            toWIB().getUTCMonth(),
            toWIB().getUTCDate() - 1,
            17,
            0,
            0
          ) /
            1000 -
            7 * 3600
        )
      ),
      cycle_end_time: String(
        Math.floor(
          Date.UTC(
            toWIB().getUTCFullYear(),
            toWIB().getUTCMonth(),
            toWIB().getUTCDate(),
            17,
            0,
            0
          ) /
            1000 -
            7 * 3600
        )
      ),
    },
  ];

  for (const v of variants) {
    try {
      const res = await fetch(
        `${process.env.HMS_BASE_URL}/dc/v1/oneservice`,
        {
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
            api_id: API_ID_DEDICATED,
            params: {
              hub_id: HUB_ID,
              driver_name: "",
              job_roles: JOB_ROLES_DEDICATED,
              cycle_level: "1",
              cycle_start_time: v.cycle_start_time,
              cycle_end_time: v.cycle_end_time,
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
        label: v.label,
        cycle_start: v.cycle_start_time,
        cycle_end: v.cycle_end_time,
        hmsCode: parsed?.code,
        ok: res.ok && parsed?.code === 200,
        dataLength: (() => {
          try {
            const arr = JSON.parse(parsed?.data?.data || "[]");
            return arr.length;
          } catch {
            return 0;
          }
        })(),
        dataPreview: parsed?.data?.data?.slice?.(0, 150),
      });
    } catch (e: any) {
      results.push({ label: v.label, error: e.message });
    }
  }

  return NextResponse.json({ results });
}