import { auth } from "@/lib/auth";
import { resolveHmsToken } from "@/lib/hms-context";
import { buildHmsHeaders } from "@/lib/hms-headers";
import { refreshStoredHmsToken } from "@/lib/hms-token-refresh";
import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

const MAX_AWBS = 50;
const CACHE_TTL_MS = 60 * 1000;
const REQUEST_TIMEOUT_MS = 55 * 1000;
const CSMS_TIMEOUT_MS = 12 * 1000;
const LEGS = ["last_mile", "first_mile"] as const;

type Leg = (typeof LEGS)[number];
type Row = Record<string, unknown>;

type DatbuyResult = {
  awb: string;
  status: "found" | "partial" | "not_found" | "error";
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

type HmsHit = { row: Row; leg: Leg };
type OmsHit = { search?: Row; detail?: Row; status: "verified" | "partial" | "not_found" | "error"; error?: string };

const cache = new Map<string, { at: number; data: CachedResponse }>();

function normalizeAwb(awb: unknown) {
  return String(awb || "").normalize("NFKC").trim().replace(/\s+/g, "").toUpperCase();
}

function normalizeAwbs(value: unknown): string[] {
  const raw = Array.isArray(value) ? value.join("\n") : String(value || "");
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw.replaceAll(",", "\n").split("\n")) {
    const awb = normalizeAwb(item);
    if (!awb) continue;
    if (seen.has(awb)) continue;
    seen.add(awb);
    out.push(awb);
  }
  return out;
}

function readPath(row: unknown, path: string) {
  let current = row;
  for (const part of path.split(".")) {
    if (!current || typeof current !== "object") return null;
    current = (current as Row)[part];
  }
  if (current === undefined || current === null || String(current).trim() === "") return null;
  return current;
}

function first(row: unknown, keys: string[]) {
  for (const key of keys) {
    const value = readPath(row, key);
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

function numericCod(value: unknown) {
  if (typeof value === "boolean" || value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function rowAwb(row: unknown) {
  return normalizeAwb(first(row, ["awb_number", "awb", "airwaybill", "awbNumber", "order.awb_number"]));
}

function sameAwb(row: unknown, awb: string) {
  return rowAwb(row) === normalizeAwb(awb);
}

function pickPreferred(current: Row | undefined, next: Row) {
  if (!current) return next;
  const currentDelivered = String(first(current, ["status"]) || "").toLowerCase() === "delivered";
  const nextDelivered = String(first(next, ["status"]) || "").toLowerCase() === "delivered";
  if (nextDelivered && !currentDelivered) return next;
  const currentTime = Math.max(numericTime(first(current, ["updated_at", "delivered_time", "created_at"])));
  const nextTime = Math.max(numericTime(first(next, ["updated_at", "delivered_time", "created_at"])));
  return nextTime >= currentTime ? next : current;
}

function hmsHeaders(token: string) {
  return buildHmsHeaders(token);
}

async function fetchJsonWithTimeout(url: URL, token: string, timeoutMs = REQUEST_TIMEOUT_MS, allowBadRequest = false) {
  const res = await fetch(url.toString(), {
    headers: hmsHeaders(token),
    cache: "no-store",
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (res.status === 401) return { status: 401, json: null as any };
  if (res.status === 400 && allowBadRequest) return { status: 400, json: null as any };
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return { status: res.status, json: await res.json() };
}

async function fetchLeg(token: string, awbs: string[], leg: Leg, hubId: string) {
  const url = new URL(`${process.env.HMS_BASE_URL}/tms/api/lms/v1/shipments`);
  url.searchParams.set("type", "order_management");
  url.searchParams.set("leg_type", leg);
  url.searchParams.set("tab", "order_view");
  url.searchParams.set("per_page", "100");
  url.searchParams.set("page", "1");
  url.searchParams.set("awb_numbers", awbs.join(","));
  if (hubId) url.searchParams.set("hub_id", hubId);

  const { status, json } = await fetchJsonWithTimeout(url, token);
  if (status === 401) return { status, rows: [] as Row[] };
  const rows = json?.data?.shipments ?? json?.data?.list ?? json?.data?.rows ?? json?.shipments;
  if (!Array.isArray(rows)) throw new Error(`HMS ${leg} lookup returned invalid payload`);
  return { status, rows: rows as Row[] };
}

async function fetchLegWithRefresh(token: string, userId: string, awbs: string[], leg: Leg, hubId: string) {
  let currentToken = token;
  let refreshed = false;
  let response = await fetchLeg(currentToken, awbs, leg, hubId);
  if (response.status === 401) {
    const newToken = await refreshStoredHmsToken(userId, currentToken);
    if (newToken?.token) {
      currentToken = newToken.token;
      refreshed = true;
      response = await fetchLeg(currentToken, awbs, leg, hubId);
    }
  }
  return { ...response, token: currentToken, refreshed };
}

function extractRows(json: any): Row[] {
  const candidates = [json?.data?.list, json?.data?.rows, json?.data?.shipments, json?.data?.items, json?.list, json?.rows, json?.shipments, json?.items, json?.data];
  for (const value of candidates) if (Array.isArray(value)) return value as Row[];
  return [];
}

async function searchOms(token: string, awb: string, hubId: string): Promise<OmsHit> {
  try {
    const url = new URL(`${process.env.HMS_BASE_URL}/api/csms/shipment/v1/ui/shipment/search`);
    url.searchParams.set("page", "1");
    url.searchParams.set("limit", "20");
    url.searchParams.set("page_size", "20");
    url.searchParams.set("awb", awb);
    url.searchParams.set("awb_number", awb);
    url.searchParams.set("keyword", awb);
    url.searchParams.set("query", awb);
    if (hubId) {
      url.searchParams.set("hub_id", hubId);
      url.searchParams.set("facility_id", hubId);
    }

    const { status, json } = await fetchJsonWithTimeout(url, token, CSMS_TIMEOUT_MS, true);
    if (status === 401) return { status: "error", error: "CSMS/OMS token expired" };
    if (status === 400) return { status: "not_found", error: "CSMS/OMS search rejected this AWB query" };
    const matches = extractRows(json).filter((row) => sameAwb(row, awb));
    if (matches.length === 0) return { status: "not_found" };
    const search = matches.sort((a, b) => numericTime(first(b, ["updated_at", "created_at", "shipment.updated_at"])) - numericTime(first(a, ["updated_at", "created_at", "shipment.updated_at"])))[0];
    const id = first(search, ["id", "shipment_id", "shipmentId", "oms_shipment_id"]);
    if (!id) return { search, status: "partial" };

    const detailUrl = new URL(`${process.env.HMS_BASE_URL}/api/csms/shipment/v1/ui/shipment/${id}`);
    const detailRes = await fetchJsonWithTimeout(detailUrl, token, CSMS_TIMEOUT_MS, true);
    if (detailRes.status === 401) return { search, status: "partial", error: "CSMS/OMS detail token expired" };
    if (detailRes.status === 400) return { search, status: "partial", error: "CSMS/OMS detail rejected the candidate ID; using verified search/HMS data only" };
    const detail = (detailRes.json?.data ?? detailRes.json) as Row;
    if (detail && typeof detail === "object" && sameAwb(detail, awb)) return { search, detail, status: "verified" };
    return { search, status: "partial", error: "CSMS/OMS detail AWB mismatch or missing" };
  } catch (error) {
    return { status: "error", error: error instanceof Error ? error.message : String(error) };
  }
}

async function mapLimit<T, R>(items: T[], limit: number, mapper: (item: T) => Promise<R>) {
  const out: R[] = new Array(items.length);
  let index = 0;
  async function worker() {
    while (index < items.length) {
      const current = index++;
      out[current] = await mapper(items[current]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

function sourceStatus(hms?: HmsHit, oms?: OmsHit) {
  return JSON.stringify({ hmsTms: hms ? "verified" : "not_found", csmsOms: oms?.status ?? "not_found" });
}

function mapResult(awb: string, hms?: HmsHit, oms?: OmsHit): DatbuyResult {
  const h = hms?.row;
  const search = oms?.search;
  const detail = oms?.detail;
  const cod = numericCod(first(detail, ["detail.cod_price", "cod_price"]));
  const hasAny = !!h || !!search || !!detail;
  const status: DatbuyResult["status"] = h && oms?.status === "verified" ? "found" : hasAny ? "partial" : oms?.status === "error" ? "error" : "not_found";

  return {
    awb,
    status,
    sourceStatus: sourceStatus(hms, oms),
    message: status === "found"
      ? "HMS/TMS and CSMS/OMS matched the requested AWB."
      : status === "partial"
        ? `Partial Datbuy result. ${oms?.error || "One source did not return complete data."}`
        : status === "error"
          ? `Datbuy lookup failed: ${oms?.error || "source error"}`
          : "Resi tidak ditemukan pada scope lookup Datbuy.",
    package: {
      status: first(h, ["status", "shipment_status"]) ?? first(detail, ["status"]) ?? first(search, ["status"]),
      statusLabel: first(h, ["status_name", "status_label"]),
      legType: hms?.leg,
      hub: first(h, ["actual_hub", "hub_name", "facility_name", "destination_details.hub_name"]),
      hubId: first(h, ["hub_id", "facility_id"]),
      driver: first(h, ["route.driver_name", "assigned_drivers", "driver_name", "driver"]),
      paymentType: first(h, ["payment_type", "payment_method"]) ?? (first(detail, ["is_cod"]) === true ? "cod" : null),
      weight: first(h, ["package_details.weight"]) ?? first(detail, ["detail.weight"]),
      shipmentId: first(detail, ["id", "shipment_id", "shipmentId"]) ?? first(search, ["id", "shipment_id", "shipmentId"]),
      omsShipmentId: first(detail, ["oms_shipment_id", "omsShipmentId"]) ?? first(search, ["oms_shipment_id", "omsShipmentId"]),
    },
    receiver: {
      name: first(h, ["destination_details.destination_name"]) ?? first(detail, ["destination_address.contact_name", "buyer_info.name"]) ?? first(search, ["buyer_info.name"]),
      phone: first(h, ["destination_details.destination_phone"]) ?? first(detail, ["destination_address.phone_number"]),
      address: first(h, ["destination_details.destination_address"]) ?? first(detail, ["destination_address.address"]),
      subdistrict: first(h, ["destination_details.destination_sub_district_name"]) ?? first(detail, ["destination_address.metadata.sub_district"]),
    },
    order: {
      seller: first(detail, ["seller_info.seller_name"]) ?? first(search, ["seller_info.seller_name"]) ?? first(h, ["seller_details.name"]),
      platform: first(detail, ["company_partner_name"]) ?? first(search, ["detail.company_partner_name"]),
      codPrice: cod,
      packagePrice: numericCod(first(detail, ["detail.product_price", "detail.package_price", "detail.item_price", "detail.price", "detail.original_price", "detail.goods_price", "detail.goods_value", "detail.item_value", "detail.product_value", "detail.order_amount", "detail.total_price", "detail.total_amount", "detail.amount", "product_price", "package_price", "item_price", "price", "original_price", "goods_price", "goods_value", "item_value", "product_value", "order_amount", "total_price", "total_amount", "amount"])),
      productName: first(detail, ["detail.product_name", "product_name"]),
      productLink: safeUrl(first(detail, ["detail.product_url", "product_url"])),
      trackingLink: safeUrl(first(h, ["destination_details.live_tracking_url"]) ?? first(detail, ["live_tracking_url"])),
    },
  };
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const awbs = normalizeAwbs(body.awbs ?? body.query);
  const requestedHubId = String(body.hubId ?? "460450593288");
  const scopedHubId = requestedHubId === "all" ? "" : requestedHubId;
  if (awbs.length === 0) return NextResponse.json({ error: "Masukkan minimal satu nomor resi." }, { status: 400 });
  if (awbs.length > MAX_AWBS) return NextResponse.json({ error: `Maksimal ${MAX_AWBS} resi per pencarian.` }, { status: 400 });
  if (awbs.some((awb) => awb.length > 80 || !/^[A-Z0-9_-]+$/.test(awb))) {
    return NextResponse.json({ error: "Format resi tidak valid. Gunakan huruf, angka, underscore, atau minus." }, { status: 400 });
  }

  const cacheKey = `${requestedHubId || "all"}:${awbs.map((awb) => awb.toLowerCase()).sort().join("|")}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return NextResponse.json({ ...cached.data, meta: { ...cached.data.meta, cached: true } });

  const { token } = await resolveHmsToken(req, session.user.id, session.user);
  if (!token) return NextResponse.json({ error: "Token GTL/HMS belum tersedia. Buka HMS atau sync GTL Bridge dulu." }, { status: 403 });

  const hmsHits = new Map<string, HmsHit>();
  const sourceErrors: string[] = [];
  let currentToken = token;
  let refreshedAny = false;

  for (const leg of LEGS) {
    try {
      const response = await fetchLegWithRefresh(currentToken, session.user.id, awbs, leg, scopedHubId);
      currentToken = response.token;
      refreshedAny = refreshedAny || response.refreshed;
      if (response.status === 401) throw new Error(`HMS ${leg} token expired`);
      for (const row of response.rows) {
        const actualAwb = rowAwb(row);
        const requested = awbs.find((awb) => normalizeAwb(awb) === actualAwb);
        if (!requested) continue;
        const key = requested.toLowerCase();
        hmsHits.set(key, { row: pickPreferred(hmsHits.get(key)?.row, row), leg });
      }
    } catch (error) {
      sourceErrors.push(error instanceof Error ? error.message : String(error));
    }
  }

  const omsList = await mapLimit(awbs, 5, (awb) => searchOms(currentToken, awb, scopedHubId));
  const omsHits = new Map<string, OmsHit>();
  awbs.forEach((awb, index) => omsHits.set(awb.toLowerCase(), omsList[index]));

  const results = awbs.map((awb) => mapResult(awb, hmsHits.get(awb.toLowerCase()), omsHits.get(awb.toLowerCase())));
  const data: CachedResponse = {
    success: true,
    count: results.length,
    maxAwbs: MAX_AWBS,
    results,
    meta: {
      sources: ["HMS/TMS shipments", "CSMS/OMS shipment search/detail"],
      note: "Datbuy now calls HMS/TMS and CSMS/OMS directly with the authorized GTL session. Receiver/phone are shown only from the documented response fields; missing fields are not guessed.",
      sourceErrors,
      refreshed: refreshedAny,
    },
  };
  cache.set(cacheKey, { at: Date.now(), data });
  return NextResponse.json(data);
}
