import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  console.log("=== /api/hms/oneservice ===");

  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { hmsToken: true },
  });

  if (!user?.hmsToken) {
    return NextResponse.json({ error: "No HMS token" }, { status: 403 });
  }

  let body: { api_id?: string; params?: any };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.api_id) {
    return NextResponse.json({ error: "api_id required" }, { status: 400 });
  }

  const url = `${process.env.HMS_BASE_URL}/dc/v1/oneservice`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${user.hmsToken}`,
        "Content-Type": "application/json",
        Accept: "application/json, text/plain, */*",
        Origin: "https://gtl-id.tokgistic.com",
        Referer: "https://gtl-id.tokgistic.com/tms/operation-performance-central",
      },
      body: JSON.stringify({
        api_id: body.api_id,
        params: body.params || {},
      }),
    });

    const text = await res.text();
    console.log(`[oneservice] api_id=${body.api_id} status=${res.status} size=${text.length}`);

    if (!res.ok) {
      return NextResponse.json(
        { error: "HMS failed", status: res.status, detail: text.slice(0, 500) },
        { status: 502 }
      );
    }

    return NextResponse.json(JSON.parse(text));
  } catch (e: any) {
    console.error("[oneservice] Error:", e.message);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}