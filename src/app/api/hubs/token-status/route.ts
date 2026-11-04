import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { readTokenChunkCount, readTokenFromCookies } from "@/lib/hms-token-store";

// Diagnostic only: reports whether a hub token exists and whether HMS accepts
// it. Never returns the token itself.
const API_ID_MAIN = "7564027893345453074";

function wibCurrDate(): string {
  const wib = new Date(Date.now() + 7 * 60 * 60 * 1000);
  wib.setUTCDate(wib.getUTCDate() - 1);
  const y = wib.getUTCFullYear();
  const m = String(wib.getUTCMonth() + 1).padStart(2, "0");
  const d = String(wib.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d} 17:00:00`;
}

async function probe(token: string | null | undefined, hubId: string) {
  if (!token) return { sent: false };
  try {
    const res = await fetch(`${process.env.HMS_BASE_URL}/dc/v1/oneservice`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        Origin: "https://gtl-id.tokgistic.com",
      },
      body: JSON.stringify({
        api_id: API_ID_MAIN,
        params: {
          hub_ids: JSON.stringify([hubId]),
          curr_date: wibCurrDate(),
          payment_types: '["cashless","cod"]',
          service_types: '["INS","SDS","REG","NDD","OTHERS"]',
        },
      }),
      cache: "no-store",
    });
    const text = await res.text();
    let rows = -1;
    try {
      rows = JSON.parse((JSON.parse(text).data || {}).data || "[]").length;
    } catch {}
    return { sent: true, status: res.status, rows, body_head: text.slice(0, 120) };
  } catch (e: any) {
    return { sent: true, error: String(e?.message ?? e) };
  }
}

export async function GET(req: NextRequest) {
  const hubId = req.nextUrl.searchParams.get("hubId") || "460450593288";
  const hub = await prisma.hub
    .findUnique({
      where: { hmsHubId: hubId },
      select: {
        name: true,
        hmsToken: true,
        hmsTokenUpdatedAt: true,
        hmsTokenExpiresAt: true,
        hmsRefreshToken: true,
      },
    })
    .catch(() => null);

  const cookieToken = readTokenFromCookies(req)?.token ?? null;

  return NextResponse.json({
    hub_id: hubId,
    hub_name: hub?.name ?? null,
    has_hub_token: Boolean(hub?.hmsToken),
    hub_token_length: hub?.hmsToken?.length ?? 0,
    hub_token_updated_at: hub?.hmsTokenUpdatedAt ?? null,
    hub_token_expires_at: hub?.hmsTokenExpiresAt ?? null,
    has_hub_refresh: Boolean(hub?.hmsRefreshToken),
    has_cookie_token: Boolean(cookieToken),
    same_token: Boolean(cookieToken && hub?.hmsToken && cookieToken === hub.hmsToken),
    curr_date: wibCurrDate(),
    probe_hub_token: await probe(hub?.hmsToken, hubId),
    probe_cookie_token: await probe(cookieToken, hubId),
    now: new Date().toISOString(),
  });
}