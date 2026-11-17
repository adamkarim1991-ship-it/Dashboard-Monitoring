import { auth } from "@/lib/auth";
import { dbRead } from "@/lib/db-safe";
import { resolveHmsToken } from "@/lib/hms-context";
import { buildHmsHeaders } from "@/lib/hms-headers";
import { refreshStoredHmsToken } from "@/lib/hms-token-refresh";
import { prisma } from "@/lib/prisma";
import { createHash } from "crypto";
import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

const MAX_AWBS = 50;
const CACHE_TTL_MS = 60 * 1000;
const REQUEST_TIMEOUT_MS = 55 * 1000;
const CSMS_TIMEOUT_MS = 12 * 1000;
const LEGS = ["last_mile", "first_mile"] as const;
const DEFAULT_HUB_ID = "460450593288";
const EAST_HUB_IDS = ["460450593288", "272"];

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

type CacheEntry = { at: number; userId: string; tokenHash: string; scopeKey: string; data: CachedResponse };
type HmsHit = { row: Row; leg: Leg; hubId: string };
type OmsHit = { search?: Row; detail?: Row; status: "verified" | "partial" | "not_found" | "error"; hubId?: string; error?: string };
type DatbuyScope = { requested: string; label: string; hubIds: string[]; scopeKey: string };
type TokenChoice = { token: string; source: string };

const cache = new Map<string, CacheEntry>();

function normalizeAwb(awb: unknown) {
  return String(awb || "").normalize("NFKC").trim().replace(/\s+/g, "").toUpperCase();
}

function normalizeAwbs(value: unknown): string[] {
  const raw = Array.isArray(value) ? value.join("\n") : String(value || "");
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw.replaceAll(",", "\n").split("\n")) {
    const awb = normalizeAwb(item);
    if (!awb || seen.has(awb)) continue;
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

function rowHubId(row: unknown) {
  const value = first(row, ["hub_id", "facility_id", "hub.id", "facility.id", "detail.hub_id", "detail.facility_id", "shipment.hub_id", "shipment.facility_id"]);
  return value === null ? null : String(value);
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
  url.searchParams.set("hub_id", hubId);

  const { status, json } = await fetchJsonWithTimeout(url, token);
  if (status === 401) return { status, rows: [] as Row[] };
  const rows = json?.data?.shipments ?? json?.data?.list ?? json?.data?.rows ?? json?.shipments;
  if (!Array.isArray(rows)) throw new Error(`HMS ${leg} lookup returned invalid payload`);
  return { status, rows: rows as Row[] };
}

async function fetchLegWithRefresh(token: string, userId: string | null, awbs: string[], leg: Leg, hubId: string) {
  let currentToken = token;
  let refreshed = false;
  let response = await fetchLeg(currentToken, awbs, leg, hubId);
  if (response.status === 401 && userId) {
    const newToken = await refreshStoredHmsToken(userId, currentToken);
    if (newToken?.token) {
      currentToken = newToken.token;
      refreshed = true;
      response = await fetchLeg(currentToken, awbs, leg, hubId);
    }
  }
  return { ...response, token: currentToken, refreshed };
}

async function resolveSharedHubTokens(hubIds: string[]): Promise<Record<string, TokenChoice>> {
  const queryIds = expandHubQueryIds(hubIds);
  const rows = await dbRead(
    () =>
      prisma.hub.findMany({
        where: { hmsHubId: { in: queryIds }, hmsToken: { not: null } },
        select: { hmsHubId: true, hmsToken: true, hmsTokenExpiresAt: true, hmsTokenUpdatedAt: true },
        orderBy: [{ hmsTokenExpiresAt: "desc" }, { hmsTokenUpdatedAt: "desc" }],
      }),
    [] as Array<{ hmsHubId: string; hmsToken: string | null; hmsTokenExpiresAt: Date | null; hmsTokenUpdatedAt: Date | null }>,
    "datbuy.sharedHubToken"
  );

  const out: Record<string, TokenChoice> = {};
  for (const row of rows) {
    if (!row.hmsToken) continue;
    try {
      const probe = await fetchLeg(row.hmsToken, ["GTL_DUMMY_PROBE"], "last_mile", row.hmsHubId);
      if (probe.status !== 401) out[row.hmsHubId] = { token: row.hmsToken, source: `shared-hub:${row.hmsHubId}` };
    } catch {
      // Network or upstream hiccup: keep trying other stored shared tokens.
    }
  }

  return out;
}

function uniqueTokenChoices(choices: Array<TokenChoice | null | undefined>) {
  const seen = new Set<string>();
  const out: TokenChoice[] = [];
  for (const choice of choices) {
    if (!choice?.token) continue;
    const key = `${choice.source}:${choice.token}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(choice);
  }
  return out;
}

function chooseHubToken(hubId: string, sharedTokens: Record<string, TokenChoice>, fallback: TokenChoice | null) {
  return sharedTokens[hubId] ?? fallback;
}

function summarizeTokenSources(choices: TokenChoice[]) {
  return choices.map((choice) => choice.source).join(", ");
}

function extractRows(json: any): Row[] {
  const candidates = [json?.data?.list, json?.data?.rows, json?.data?.shipments, json?.data?.items, json?.list, json?.rows, json?.shipments, json?.items, json?.data];
  for (const value of candidates) if (Array.isArray(value)) return value as Row[];
  return [];
}

const HUB_FACILITY_CODES: Record<string, string> = {
  "460450593288": "GTLJTN",
  "272": "GTLDSW",
  "207": "GTLDSW",
};

const HUB_QUERY_ALIASES: Record<string, string[]> = {
  // HMS exposes Duren Sawit as internal hub id 207 in some endpoints and TMS hub
  // id 272 in other payloads. Query both but keep the external scope as DSW only.
  "272": ["272", "207"],
};

function expandHubQueryIds(hubIds: string[]) {
  return Array.from(new Set(hubIds.flatMap((hubId) => HUB_QUERY_ALIASES[hubId] ?? [hubId])));
}

function allowedHubIds(hubIds: string[]) {
  return new Set(expandHubQueryIds(hubIds));
}

const CSMS_LOOKBACK_DAYS = 45;

function wibIsoDayStart(offsetDays: number) {
  // WIB = UTC+7. Build an ISO-8601 timestamp with the +07:00 offset that the
  // CSMS shipment search endpoint validates against.
  const now = new Date(Date.now() + 7 * 60 * 60 * 1000);
  const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + offsetDays));
  const y = day.getUTCFullYear();
  const m = String(day.getUTCMonth() + 1).padStart(2, "0");
  const d = String(day.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}T00:00:00+07:00`;
}

function csmsHubCode(row: unknown) {
  const code = first(row, ["detail.current_hub.hub_code", "current_hub.hub_code", "hub_code"]);
  return code === null ? null : String(code).toUpperCase();
}

// Verified CSMS/OMS UI contract (captured from the live OMS order-management page):
//   GET /api/csms/shipment/v1/ui/shipment/search?page=1&limit=200&awb=<AWB>
//        &created_at_gte=<ISO +07:00>&created_at_lte=<ISO +07:00>
// Any extra query parameter (page_size, awb_number, keyword, query, hub_id,
// facility_id) makes CSMS answer HTTP 400, which is exactly what broke the
// previously working Datbuy lookups. Facility scoping is validated from the
// response (current_hub.hub_code), not by injecting a hub filter into the query.
async function queryOmsAcrossHubs(token: string, awb: string, hubIds: string[]): Promise<OmsHit> {
  const url = new URL(`${process.env.HMS_BASE_URL}/api/csms/shipment/v1/ui/shipment/search`);
  url.searchParams.set("page", "1");
  url.searchParams.set("limit", "200");
  url.searchParams.set("awb", awb);
  url.searchParams.set("created_at_gte", wibIsoDayStart(-CSMS_LOOKBACK_DAYS));
  url.searchParams.set("created_at_lte", wibIsoDayStart(1));

  const { status, json } = await fetchJsonWithTimeout(url, token, CSMS_TIMEOUT_MS, true);
  if (status === 401) return { status: "error", error: "CSMS/OMS token expired" };
  if (status === 403) return { status: "error", error: "CSMS/OMS token is not allowed to read shipments" };
  if (status === 400) return { status: "error", error: "CSMS/OMS rejected the shipment search query" };

  const matches = extractRows(json).filter((row) => sameAwb(row, awb));
  if (matches.length === 0) return { status: "not_found" };

  const allowedCodes = new Set(expandHubQueryIds(hubIds).map((hubId) => HUB_FACILITY_CODES[hubId]).filter(Boolean) as string[]);
  const scoped = matches.filter((row) => {
    const code = csmsHubCode(row);
    if (!code) return true; // facility not exposed on the search row: validate on detail
    return allowedCodes.has(code);
  });
  if (scoped.length === 0) {
    return { status: "not_found", error: "CSMS/OMS returned this AWB outside the Jatinegara/Duren Sawit facility scope" };
  }

  const search = scoped.sort((a, b) => numericTime(first(b, ["updated_at", "created_at", "shipment.updated_at"])) - numericTime(first(a, ["updated_at", "created_at", "shipment.updated_at"])))[0];
  const id = first(search, ["id", "shipment_id", "shipmentId", "oms_shipment_id"]);
  if (!id) return { search, status: "partial", error: "CSMS/OMS search row has no shipment id" };

  // Verified detail route used by the OMS UI: /ui/shipment/<id> (the
  // /ui/shipment/detail endpoint answers 401/400 for this session).
  const detailUrl = new URL(`${process.env.HMS_BASE_URL}/api/csms/shipment/v1/ui/shipment/${id}`);
  const detailRes = await fetchJsonWithTimeout(detailUrl, token, CSMS_TIMEOUT_MS, true);
  if (detailRes.status === 401) return { search, status: "partial", error: "CSMS/OMS detail token expired" };
  if (!detailRes.json) return { search, status: "partial", error: "CSMS/OMS detail returned no payload" };

  const detail = (detailRes.json?.data?.shipment ?? detailRes.json?.data ?? detailRes.json) as Row;
  if (!detail || typeof detail !== "object") return { search, status: "partial", error: "CSMS/OMS detail payload is not an object" };
  if (!sameAwb(detail, awb)) return { search, status: "partial", error: "CSMS/OMS detail AWB mismatch" };

  const code = csmsHubCode(detail);
  if (code && !allowedCodes.has(code)) {
    return { search, status: "not_found", error: "CSMS/OMS detail belongs to a facility outside Jatinegara/Duren Sawit" };
  }
  return { search, detail, status: "verified" };
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

async function queryOmsAcrossTokens(tokens: TokenChoice[], awb: string, hubIds: string[]): Promise<OmsHit> {
  const rank: Record<OmsHit["status"], number> = {
    error: 0,
    not_found: 1,
    partial: 2,
    verified: 3,
  };
  let best: OmsHit = { status: "error", error: "CSMS/OMS token is not available for this lookup" };
  for (const choice of uniqueTokenChoices(tokens)) {
    const hit = await queryOmsAcrossHubs(choice.token, awb, hubIds);
    if (rank[hit.status] >= rank[best.status]) best = hit;
    if (hit.status === "verified") return hit;
  }
  return best;
}

function sourceStatus(hms?: HmsHit, oms?: OmsHit) {
  return JSON.stringify({ hmsTms: hms ? "verified" : "not_found", hmsHubId: hms?.hubId, csmsOms: oms?.status ?? "not_found", csmsHubId: oms?.hubId });
}

function packageDetails(hmsRow?: Row, omsRow?: Row) {
  return {
    weight: first(hmsRow, ["package.weight", "package_details.weight", "weight"]) ?? first(omsRow, ["detail.weight", "weight"]),
    volume: first(hmsRow, ["package.volume", "package_details.volume", "volume"]),
    dimension: first(hmsRow, ["package.dimension", "package_details.dimension", "dimension"]),
    size: first(hmsRow, ["package.size", "package_details.size", "size"]),
    invoiceNumber: first(hmsRow, ["invoice_number", "invoice_no"]) ?? first(omsRow, ["invoice_number", "invoice_no"]),
    serviceType: first(hmsRow, ["service_type", "shipping_type"]) ?? first(omsRow, ["service_name", "detail.service_name"]),
    orderType: first(hmsRow, ["order_type"]) ?? first(omsRow, ["detail.order_type"]),
    shippingType: first(hmsRow, ["shipping_type"]) ?? first(omsRow, ["detail.shipping_type", "shipping_type"]),
  };
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
      ? "HMS/TMS and CSMS/OMS matched the requested AWB inside the allowed hub scope."
      : status === "partial"
        ? `Partial Datbuy result. ${oms?.error || "One source did not return complete data."}`
        : status === "error"
          ? `Datbuy lookup failed: ${oms?.error || "source error"}`
          : "Resi tidak ditemukan pada scope lookup Datbuy yang diizinkan untuk akun ini.",
    package: {
      status: first(h, ["status", "shipment_status"]) ?? first(detail, ["status"]) ?? first(search, ["status"]),
      statusLabel: first(h, ["status_name", "status_label"]),
      legType: hms?.leg,
      hub: first(h, ["actual_hub", "hub_name", "facility_name", "destination_details.hub_name"]),
      hubId: hms?.hubId ?? first(h, ["hub_id", "facility_id"]) ?? first(detail, ["hub_id", "facility_id"]),
      driver: first(h, ["route.driver_name", "assigned_drivers", "driver_name", "driver"]),
      paymentType: first(h, ["payment_type", "payment_method"]) ?? (first(detail, ["is_cod"]) === true ? "cod" : null),
      physicalDetails: packageDetails(h, detail),
      weight: packageDetails(h, detail).weight,
      shipmentId: first(detail, ["id", "shipment_id", "shipmentId"]) ?? first(search, ["id", "shipment_id", "shipmentId"]),
      omsShipmentId: first(detail, ["oms_shipment_id", "omsShipmentId"]) ?? first(search, ["oms_shipment_id", "omsShipmentId"]),
    },
    receiver: {
      name: first(h, [
        "destination_details.destination_name",
        "receiver_name",
        "recipient_name",
        "consignee_name",
      ]) ?? first(detail, [
        "destination_address.contact_name",
        "destination_address.name",
        "receiver.name",
        "receiver_name",
        "recipient.name",
        "recipient_name",
        "buyer_info.name",
      ]) ?? first(search, ["buyer_info.name", "receiver_name", "recipient_name"]),
      phone: first(h, [
        "destination_details.destination_phone",
        "destination_details.phone",
        "destination_details.phone_number",
        "receiver_phone",
        "recipient_phone",
        "consignee_phone",
        "phone",
        "phone_number",
      ]) ?? first(detail, [
        "destination_address.phone_number",
        "destination_address.phone",
        "destination_address.contact_phone",
        "destination_address.mobile",
        "receiver.phone",
        "receiver.phone_number",
        "receiver.mobile",
        "recipient.phone",
        "recipient.phone_number",
        "recipient.mobile",
        "buyer_info.phone",
        "buyer_info.phone_number",
        "buyer_info.mobile",
        "receiver_phone",
        "recipient_phone",
        "consignee_phone",
      ]) ?? first(search, [
        "destination_address.phone_number",
        "destination_address.phone",
        "receiver.phone",
        "receiver_phone",
        "recipient.phone",
        "recipient_phone",
        "buyer_info.phone",
        "buyer_info.phone_number",
      ]),
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

function tokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex").slice(0, 16);
}

async function getUserHubIds(userId: string, sessionUser: any): Promise<string[]> {
  const rows = await dbRead(
    () => prisma.userHub.findMany({ where: { userId }, include: { hub: true } }),
    [] as Array<{ hub: { hmsHubId: string } }>,
    "datbuy.userHubScope"
  );
  const fromDb = rows.map((row) => row.hub.hmsHubId).filter(Boolean);
  const fromSession = Array.isArray(sessionUser?.hmsHubIds) ? sessionUser.hmsHubIds.map(String) : [];
  return Array.from(new Set([...fromDb, ...fromSession])).sort();
}

function resolveScope(requested: string, userHubIds: string[]): DatbuyScope | { error: string; status: number } {
  const normalized = requested.trim().toLowerCase();
  if (normalized === "east") {
    // Temporary rollback-safe rollout: East Datbuy is deliberately constrained to
    // the two hubs that were already working for the operator account.  Do not
    // fan out to the full East cluster until SPV shared-team coverage is verified.
    const hubIds = EAST_HUB_IDS;
    return { requested: "east", label: "Jatinegara + Duren Sawit coverage", hubIds, scopeKey: `jtn-dsw:${hubIds.join(",")}` };
  }
  if (normalized === "all") {
    if (userHubIds.length === 0) return { status: 403, error: "Akun ini belum punya akses hub untuk Datbuy." };
    return { requested: "all", label: "assigned hub coverage", hubIds: userHubIds, scopeKey: `assigned:${userHubIds.join(",")}` };
  }
  const hubId = requested || DEFAULT_HUB_ID;
  if (!userHubIds.includes(hubId)) return { status: 403, error: `Akses ditolak untuk hub ${hubId}. Datbuy hanya boleh memakai hub yang assigned ke akun ini.` };
  return { requested: hubId, label: `hub ${hubId}`, hubIds: [hubId], scopeKey: `hub:${hubId}` };
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const awbs = normalizeAwbs(body.awbs ?? body.query);
  const requestedHubId = String(body.hubId ?? DEFAULT_HUB_ID);
  if (awbs.length === 0) return NextResponse.json({ error: "Masukkan minimal satu nomor resi." }, { status: 400 });
  if (awbs.length > MAX_AWBS) return NextResponse.json({ error: `Maksimal ${MAX_AWBS} resi per pencarian.` }, { status: 400 });
  if (awbs.some((awb) => awb.length > 80 || !/^[A-Z0-9_-]+$/.test(awb))) {
    return NextResponse.json({ error: "Format resi tidak valid. Gunakan huruf, angka, underscore, atau minus." }, { status: 400 });
  }

  const userHubIds = await getUserHubIds(session.user.id, session.user);
  const scope = resolveScope(requestedHubId, userHubIds);
  if ("error" in scope) return NextResponse.json({ error: scope.error }, { status: scope.status });

  const resolvedUserToken = await resolveHmsToken(req, session.user.id, session.user);
  let userTokenChoice: TokenChoice | null = resolvedUserToken.token ? { token: resolvedUserToken.token, source: resolvedUserToken.source } : null;
  const sharedTokens = scope.requested === "east" ? await resolveSharedHubTokens(scope.hubIds) : {} as Record<string, TokenChoice>;
  const queryHubIds = expandHubQueryIds(scope.hubIds);
  const availableTokens = uniqueTokenChoices([...queryHubIds.map((hubId) => sharedTokens[hubId]), userTokenChoice]);
  if (availableTokens.length === 0) return NextResponse.json({ error: "Token GTL/HMS belum tersedia. Datbuy membutuhkan token shared hub Jatinegara/Duren Sawit atau sync GTL Bridge." }, { status: 403 });

  const keyTokenHash = tokenHash(availableTokens.map((choice) => choice.token).sort().join("|"));
  const cacheKey = JSON.stringify([session.user.id, keyTokenHash, scope.scopeKey, awbs.map((awb) => awb.toLowerCase()).sort()]);
  const cached = cache.get(cacheKey);
  if (cached && cached.userId === session.user.id && cached.tokenHash === keyTokenHash && cached.scopeKey === scope.scopeKey && Date.now() - cached.at < CACHE_TTL_MS) {
    return NextResponse.json({ ...cached.data, meta: { ...cached.data.meta, cached: true } });
  }

  const hmsHits = new Map<string, HmsHit>();
  const sourceErrors: string[] = [];
  let refreshedAny = false;

  const acceptedHubIds = allowedHubIds(scope.hubIds);

  for (const hubId of queryHubIds) {
    for (const leg of LEGS) {
      const tokenChoice = chooseHubToken(hubId, sharedTokens, userTokenChoice);
      if (!tokenChoice?.token) {
        sourceErrors.push(`No HMS token available for hub ${hubId}`);
        continue;
      }
      try {
        const usingSharedToken = !!sharedTokens[hubId];
        const response = await fetchLegWithRefresh(tokenChoice.token, usingSharedToken ? null : session.user.id, awbs, leg, hubId);
        if (!usingSharedToken && response.token !== tokenChoice.token) {
          userTokenChoice = { token: response.token, source: `${tokenChoice.source}:refreshed` };
        }
        refreshedAny = refreshedAny || response.refreshed;
        if (response.status === 401) throw new Error(`HMS ${leg} token expired for hub ${hubId}`);
        for (const row of response.rows) {
          const actualAwb = rowAwb(row);
          const requested = awbs.find((awb) => normalizeAwb(awb) === actualAwb);
          if (!requested) continue;
          const foundHub = rowHubId(row);
          if (foundHub && !acceptedHubIds.has(foundHub)) continue;
          const key = requested.toLowerCase();
          hmsHits.set(key, { row: pickPreferred(hmsHits.get(key)?.row, row), leg, hubId: foundHub || hubId });
        }
      } catch (error) {
        sourceErrors.push(error instanceof Error ? error.message : String(error));
      }
    }
  }

  const omsList = await mapLimit(awbs, 4, (awb) => {
    const hmsHit = hmsHits.get(awb.toLowerCase());
    const tokenChoices = uniqueTokenChoices([
      hmsHit ? chooseHubToken(hmsHit.hubId, sharedTokens, userTokenChoice) : null,
      ...queryHubIds.map((hubId) => chooseHubToken(hubId, sharedTokens, userTokenChoice)),
      userTokenChoice,
    ]);
    return queryOmsAcrossTokens(tokenChoices, awb, scope.hubIds);
  });
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
      note: "Datbuy uses only GTL Jatinegara and GTL Duren Sawit when East coverage is requested for the temporary rollout. The final East-wide SPV coverage remains disabled until its official shared-team credential scope is verified.",
      scope: scope.label,
      requestedScope: scope.requested,
      hubIds: scope.hubIds,
      tokenSource: summarizeTokenSources(availableTokens),
      sourceErrors,
      refreshed: refreshedAny,
    },
  };
  cache.set(cacheKey, { at: Date.now(), userId: session.user.id, tokenHash: keyTokenHash, scopeKey: scope.scopeKey, data });
  return NextResponse.json(data);
}