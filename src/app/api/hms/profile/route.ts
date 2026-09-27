import { cookies } from "next/headers";
import { NextResponse } from "next/server";

export async function GET() {
  const cookieStore = await cookies();
  const hasSession = cookieStore.getAll().some(
    (c) =>
      c.name.includes("authjs.session-token") ||
      c.name.includes("next-auth.session-token")
  );

  if (!hasSession) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const res = await fetch(
    `${process.env.HMS_BASE_URL}/tms/api/lms/v1/profile`,
    {
      headers: {
        Authorization: `Bearer ${process.env.HMS_TOKEN}`,
        Accept: "application/json, text/plain, */*",
        "Accept-Language": "en",
        Origin: "https://gtl-id.tokgistic.com",
        Referer: "https://gtl-id.tokgistic.com/hms/order-management",
      },
      cache: "no-store",
    }
  );

  const text = await res.text();
  console.log("=== HMS PROFILE RESPONSE ===");
  console.log("Status:", res.status);
  console.log("Body:", text.slice(0, 1000));

  return NextResponse.json({
    status: res.status,
    body: text.slice(0, 5000),
  });
}