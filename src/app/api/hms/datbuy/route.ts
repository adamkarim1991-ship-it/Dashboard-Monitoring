import { auth } from "@/lib/auth";
import { resolveHmsToken } from "@/lib/hms-context";
import { buildHmsHeaders } from "@/lib/hms-headers";
import { refreshStoredHmsToken } from "@/lib/hms-token-refresh";
import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

const MAX_AWBS = 50;
const CACHE_TTL_MS = 60 * 1000;
const REQUEST_TIMEOUT_MS = 28 * 1000;
const LEGS = ["last_mile", "first_mile"] as const;
const CONTROL_ZONE_API_BASE = "https://vuvcjbjn.cn-east-fn-hj.bytedance.net";

function mapControlZoneRow(row: Record<string, unknown>): DatbuyResult {
  const lookupStatus = String(row.lookupStatus || "partial").toLowerCase();
  const sourceStatus = row.sourceStatus && typeof row.sourceStatus === "object" ? row.sourceStatus as Record<string, unknown> : {};
  const hasSourceError = Object.values(sourceStatus).some((value) => String(value).toLowerCase() === "error");
  const status = lookupStatus === "not_found" ? "not_found" : hasSourceError ? "error" : "partial";
  const message = status === "error"
    ? String(row.error || "Control Zone lookup found incomplete source data.")
    : "Verified through Control Zone Datbuy service (HMS/TMS + CSMS/OMS where available).";

  return {
    awb: String(row.awb || ""),
    status,
    sourceStatus: JSON.stringify(sourceStatus),
    message,
    package: {
      status: row.status,
      hub: row.source,
      driver: row.driver,
      paymentType: row.paymentType,
      weight: row.weight,
      shipmentId: row.shipmentId,
      omsShipmentId: row.omsShipmentId,
    },
    receiver: {
      name: row.receiverName,
      phone: row.phone,
      address: row.address,
      subdistrict: row.subdistrict,
    },
    order: {
      seller: row.seller,
      platform: row.platform,
      codPrice: row.codNominal,
      productName: row.productDetail,
      productLink: safeUrl(row.productLink),
      trackingLink: safeUrl(row.trackingLink),
    },
  };
}

async function fetchControlZoneDatbuy(awbs: string[]) {
  const url = new URL("/api/v1/datbuy/lookup", CONTROL_ZONE_API_BASE);
  url.searchParams.set("hub", "gtldsw");
  url.searchParams.set("awbs", awbs.join(","));
  const res = await fetch(url.toString(), {
    headers: { Accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Control Zone Datbuy failed: ${res.status}`);
  const json = await res.json();
  if (!Array.isArray(json?.rows)) throw new Error("Control Zone Datbuy returned invalid payload");
  const rows = new Map<string, Record<string, unknown>>();
  for (const row of json.rows as Record<string, unknown>[]) {
    const awb = String(row.awb || "").trim();
    if (awb) rows.set(awb.toLowerCase(), row);
  }
  return { rows, checkedAt: json.checkedAt, windowDays: json.windowDays };
}

type Leg = (typeof LEGS)[number];
type ShipmentRow = Record<string, unknown>;

type DatbuyResult = {
  awb: string;
  status: "partial" | "not_found" | "error";
  sourceStatus: string;
  message?: string;
  package?: Record<string, unknown>;
  receiver?: Record<string, unknown>;
  order?: Record<string, unknown>;
};

type CachedResponse = {
  success: true;
  count: number;
  maxAwbs: number;
  results: DatbuyResult[];
  meta: Record<string, unknown>;
};

const cache = new Map<string, { at: number; data: CachedResponse }>();

function normalizeAwbs(value: unknown): string[] {
  const raw = Array.isArray(value) ? value.join("\n") : String(value || "");
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw.replaceAll(",", "\n").split("\n")) {
    const awb = item.trim();
    if (!awb) continue;
    const key = awb.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(awb);
  }
  return out;
}

function readPath(row: ShipmentRow, path: string) {
  let current: unknown = row;
  for (const part of path.split(".")) {
    if (!current || typeof current !== "object") return null;
    current = (current as Record<string, unknown>)[part];
  }
  if (current === undefined || current === null || String(current).trim() === "") return null;
  return current;
}

function first(row: ShipmentRow, keys: string[]) {
  for (const key of keys) {
    const value = key.includes(".") ? readPath(row, key) : row[key];
    if (value !== undefined && value !== null && String(value).trim() !== "") return value;
  }
  return null;
}
function safeUrl(value: unknown) {
  if (!value) return null;
  try {
    const url = new URL(String(value));
    if (url.protocol === "http:" || url.protocol === "https:") return url.toString();
  } catch {
    return null;
  }
  return null;
}

function numericTime(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function rowAwb(row: ShipmentRow) {
  return String(row.awb_number || row.awb || "").trim();
}

function pickPreferred(current: ShipmentRow | undefined, next: ShipmentRow) {
  if (!current) return next;
  const currentDelivered = String(current.status || "").toLowerCase() === "delivered";
  const nextDelivered = String(next.status || "").toLowerCase() === "delivered";
  if (nextDelivered && !currentDelivered) return next;
  const currentTime = Math.max(numericTime(current.updated_at), numericTime(current.delivered_time), numericTime(current.created_at));
  const nextTime = Math.max(numericTime(next.updated_at), numericTime(next.delivered_time), numericTime(next.created_at));
  return nextTime >= currentTime ? next : current;
}

function mapShipment(requestedAwb: string, row: ShipmentRow, leg: Leg): DatbuyResult {
  const awb = rowAwb(row) || requestedAwb;
  const codPrice = first(row, ["cod_price"]);
  const productLink = safeUrl(first(row, ["product_link", "item_link", "goods_link"]));

  return {
    awb,
    status: "partial",
    sourceStatus: "hms_tms_only",
    message: "Package found in HMS/TMS. CSMS/OMS buyer, seller, platform, and product enrichment is not integrated yet; missing fields are intentionally left blank.",
    package: {
      status: first(row, ["status", "shipment_status"]),
      statusLabel: first(row, ["status_name", "status_label"]),
      legType: row.leg_type || leg,
      hub: first(row, ["actual_hub", "hub_name", "facility_name"]),
      hubId: first(row, ["hub_id", "facility_id"]),
      driver: first(row, ["assigned_drivers", "driver_name", "driver"]),
      driverCode: first(row, ["driver_code", "driver_id"]),
      paymentType: first(row, ["payment_type", "payment_method"]),
      serviceType: first(row, ["service_type", "service"]),
      createdAt: first(row, ["created_at", "created_time"]),
      updatedAt: first(row, ["updated_at", "updated_time"]),
    },
    receiver: {
      name: first(row, ["recipient_name", "receiver_name", "consignee_name", "receiver.name", "recipient.name", "consignee.name", "destination_details.receiver_name", "destination_details.recipient_name"]),
      phone: first(row, ["recipient_phone", "receiver_phone", "consignee_phone", "receiver.phone", "receiver.mobile", "receiver.phone_number", "recipient.phone", "recipient.mobile", "consignee.phone", "consignee.mobile", "destination_details.receiver_phone", "destination_details.recipient_phone", "destination_details.phone", "destination_details.mobile"]),
      address: first(row, ["recipient_address", "receiver_address", "consignee_address", "destination_address", "receiver.address", "recipient.address", "consignee.address", "destination_details.address", "destination_details.destination_address", "destination_details.full_address"]),
    },
    order: {
      seller: first(row, ["seller", "seller_name", "shop_name", "merchant_name", "seller.name", "shop.name", "merchant.name", "order.seller_name", "order.shop_name"]),
      platform: first(row, ["platform", "platform_name", "channel", "source_platform"]),
      codPrice,
      productName: first(row, ["product_name", "item_name", "goods_name", "sku_name"]),
      productLink,
    },
  };
}

async function fetchLeg(token: string, awbs: string[], leg: Leg) {
  const url = new URL(`${process.env.HMS_BASE_URL}/tms/api/lms/v1/shipments`);
  url.searchParams.set("type", "order_management");
  url.searchParams.set("leg_type", leg);
  url.searchParams.set("tab", "order_view");
  url.searchParams.set("per_page", "100");
  url.searchParams.set("page", "1");
  url.searchParams.set("awb_numbers", awbs.join(","));

  const res = await fetch(url.toString(), {
    headers: buildHmsHeaders(token),
    cache: "no-store",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (res.status === 401) return { status: 401, rows: [] as ShipmentRow[] };
  if (!res.ok) throw new Error(`HMS ${leg} lookup failed: ${res.status}`);
  const json = await res.json();
  const rows = json?.data?.shipments;
  if (!Array.isArray(rows)) throw new Error(`HMS ${leg} lookup returned invalid payload`);
  return { status: res.status, rows: rows as ShipmentRow[] };
}

async function fetchLegWithRefresh(token: string, userId: string, awbs: string[], leg: Leg) {
  let currentToken = token;
  let refreshed = false;
  let response = await fetchLeg(currentToken, awbs, leg);
  if (response.status === 401 && !refreshed) {
    const newToken = await refreshStoredHmsToken(userId, currentToken);
    if (newToken?.token) {
      currentToken = newToken.token;
      refreshed = true;
      response = await fetchLeg(currentToken, awbs, leg);
    }
  }
  return { ...response, token: currentToken, refreshed };
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const awbs = normalizeAwbs(body.awbs ?? body.query);
  const requestedHubId = String(body.hubId || "");
  if (awbs.length === 0) return NextResponse.json({ error: "Masukkan minimal satu nomor resi." }, { status: 400 });
  if (awbs.length > MAX_AWBS) return NextResponse.json({ error: `Maksimal ${MAX_AWBS} resi per pencarian.` }, { status: 400 });

  const cacheKey = awbs.map((awb) => awb.toLowerCase()).sort().join("|");
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return NextResponse.json({ ...cached.data, meta: { ...cached.data.meta, cached: true } });
  }

  const shouldTryControlZone = requestedHubId === "460450593288" || requestedHubId === "";
  if (shouldTryControlZone) {
    try {
      const controlZone = await fetchControlZoneDatbuy(awbs);
      const results = awbs.map((awb): DatbuyResult => {
        const row = controlZone.rows.get(awb.toLowerCase());
        if (!row) return { awb, status: "not_found", sourceStatus: "not_found", message: "Resi tidak ditemukan di Control Zone Datbuy." };
        return { ...mapControlZoneRow(row), awb };
      });
      const data: CachedResponse = {
        success: true,
        count: results.length,
        maxAwbs: MAX_AWBS,
        results,
        meta: {
          sources: ["Control Zone Datbuy", "HMS/TMS", "CSMS/OMS"],
          note: "Jatinegara OCC lookup is enriched through Control Zone Datbuy when available, then missing fields remain blank; phone is shown only if CSMS/OMS returns it.",
          checkedAt: controlZone.checkedAt,
          windowDays: controlZone.windowDays,
          sourceErrors: [],
        },
      };
      cache.set(cacheKey, { at: Date.now(), data });
      return NextResponse.json(data);
    } catch (error) {
      // Fall back to direct HMS/TMS below so the tab still returns package status when the shared service is unavailable.
      console.warn("Control Zone Datbuy unavailable; falling back to HMS/TMS only", error);
    }
  }
  const { token } = await resolveHmsToken(req, session.user.id, session.user);
  if (!token) {
    return NextResponse.json({ error: "Token GTL/HMS belum tersedia. Buka HMS atau sync GTL Bridge dulu." }, { status: 403 });
  }

  const hits = new Map<string, { row: ShipmentRow; leg: Leg }>();
  const remaining = new Set(awbs.map((awb) => awb.toLowerCase()));
  const sourceErrors: string[] = [];
  let currentToken = token;
  let refreshedAny = false;

  for (const leg of LEGS) {
    if (remaining.size === 0) break;
    const batch = awbs.filter((awb) => remaining.has(awb.toLowerCase()));
    try {
      const response = await fetchLegWithRefresh(currentToken, session.user.id, batch, leg);
      currentToken = response.token;
      refreshedAny = refreshedAny || response.refreshed;
      if (response.status === 401) throw new Error(`HMS ${leg} token expired`);

      for (const row of response.rows) {
        const actualAwb = rowAwb(row);
        if (!actualAwb) continue;
        const requested = batch.find((awb) => awb.toLowerCase() === actualAwb.toLowerCase());
        if (!requested) continue;
        const key = requested.toLowerCase();
        const current = hits.get(key);
        hits.set(key, { row: pickPreferred(current?.row, row), leg });
        remaining.delete(key);
      }
    } catch (error) {
      sourceErrors.push(error instanceof Error ? error.message : String(error));
    }
  }

  const results = awbs.map((awb): DatbuyResult => {
    const hit = hits.get(awb.toLowerCase());
    if (hit) return mapShipment(awb, hit.row, hit.leg);
    if (sourceErrors.length > 0) return { awb, status: "error", sourceStatus: "hms_tms_error", message: sourceErrors.join("; ") };
    return { awb, status: "not_found", sourceStatus: "not_found", message: "Resi tidak ditemukan di HMS/TMS Last Mile atau First Mile." };
  });

  const data: CachedResponse = {
    success: true,
    count: results.length,
    maxAwbs: MAX_AWBS,
    results,
    meta: {
      sources: ["HMS/TMS shipments"],
      note: "This lookup is live HMS/TMS only. CSMS/OMS enrichment is not integrated yet; COD amount is shown only from cod_price when present.",
      sourceErrors,
      refreshed: refreshedAny,
    },
  };
  cache.set(cacheKey, { at: Date.now(), data });
  return NextResponse.json(data);
}
