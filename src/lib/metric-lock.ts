// 08:00 and 12:00 WIB metric locks.
//
// HMS OPC keeps moving all day (Today's Volume stops growing at 08:00 but
// Delivered keeps rising), so any percentage recomputed from live numbers
// drifts. Each lock freezes its inputs at its own cutoff and the dashboard
// serves the frozen snapshot for the rest of the operating day.
//
// Three layers, so a database hiccup or a cold lambda cannot silently unlock a
// metric: instance memory, an origin cookie, and the MetricLock table. A lock
// is create-only: the first write wins and later writes never overwrite it.

import type { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { dbRead, dbWrite } from "@/lib/db-safe";
import { wibDate, wibHour } from "@/lib/operating-day";

export type MetricLockKind = "clean_floor_08" | "sd12_numerator_12";

export const LOCK_HOUR_WIB: Record<MetricLockKind, number> = {
  clean_floor_08: 8,
  sd12_numerator_12: 12,
};

export type MetricValues = Record<string, number>;

export type LockSource = "live" | "memory" | "database" | "cookie" | "observed";
export type LockQuality = "live" | "accurate" | "approximate";

interface StoredLock {
  facility: string;
  date: string;
  kind: MetricLockKind;
  values: MetricValues;
  value: number;
  capturedAt: string;
  source: LockSource;
}

export interface MetricLockPayload {
  values: MetricValues;
  value: number;
  is_locked: boolean;
  lock_hour_wib: number;
  captured_at: string;
  source: LockSource;
  quality: LockQuality;
  age_minutes: number;
}

export interface ResolvedMetricLock {
  payload: MetricLockPayload;
  cookie?: { name: string; value: string };
}

const COOKIE_PREFIX = "__ml_";
const memory = (): Map<string, StoredLock> => {
  const holder = globalThis as unknown as { __metricLocks?: Map<string, StoredLock> };
  if (!holder.__metricLocks) holder.__metricLocks = new Map();
  return holder.__metricLocks;
};

function keyOf(facility: string, date: string, kind: MetricLockKind): string {
  return `${facility}:${date}:${kind}`;
}

function cookieName(kind: MetricLockKind, facility: string): string {
  return `${COOKIE_PREFIX}${kind}_${facility}`;
}

function clean(values: MetricValues): MetricValues {
  const out: MetricValues = {};
  for (const [k, v] of Object.entries(values)) {
    out[k] = Number.isFinite(v) ? Math.round(v * 100) / 100 : 0;
  }
  return out;
}

function encode(lock: StoredLock): string {
  const pairs = Object.entries(lock.values)
    .map(([k, v]) => `${k}:${v}`)
    .join(",");
  return `v1|${lock.date}|${lock.capturedAt}|${lock.source}|${lock.value}|${pairs}`;
}

function decode(raw: string | undefined): StoredLock | null {
  if (!raw) return null;
  const parts = raw.split("|");
  if (parts.length !== 6 || parts[0] !== "v1") return null;
  const [, date, capturedAt, source, value, pairs] = parts;
  const values: MetricValues = {};
  for (const pair of pairs.split(",")) {
    if (!pair) continue;
    const idx = pair.lastIndexOf(":");
    if (idx <= 0) continue;
    const num = Number(pair.slice(idx + 1));
    if (Number.isFinite(num)) values[pair.slice(0, idx)] = num;
  }
  return {
    facility: "",
    date,
    kind: "clean_floor_08",
    values,
    value: Number(value) || 0,
    capturedAt,
    source: (source as LockSource) || "cookie",
  };
}

async function readLock(
  req: NextRequest | null,
  facility: string,
  date: string,
  kind: MetricLockKind
): Promise<StoredLock | null> {
  const cached = memory().get(keyOf(facility, date, kind));
  if (cached) return { ...cached, source: "memory" };

  if (req) {
    const decoded = decode(req.cookies.get(cookieName(kind, facility))?.value);
    if (decoded && decoded.date === date) {
      memory().set(keyOf(facility, date, kind), { ...decoded, facility, kind });
      return { ...decoded, facility, kind, source: "cookie" };
    }
  }

  const row = await dbRead(
    () =>
      prisma.metricLock.findUnique({
        where: { facility_date_kind: { facility, date, kind } },
      }),
    null,
    "metricLock.findUnique"
  );
  if (!row) return null;

  const stored: StoredLock = {
    facility,
    date,
    kind,
    values: clean((row.payload as MetricValues) ?? {}),
    value: Number(row.value) || 0,
    capturedAt: row.capturedAt.toISOString(),
    source: "database",
  };
  memory().set(keyOf(facility, date, kind), stored);
  return stored;
}

async function writeLock(lock: StoredLock): Promise<void> {
  memory().set(keyOf(lock.facility, lock.date, lock.kind), lock);
  await dbWrite(
    () =>
      prisma.metricLock.upsert({
        where: {
          facility_date_kind: {
            facility: lock.facility,
            date: lock.date,
            kind: lock.kind,
          },
        },
        // Create only: an existing row is the snapshot and must not move.
        update: {},
        create: {
          facility: lock.facility,
          date: lock.date,
          kind: lock.kind,
          value: lock.value,
          payload: lock.values,
          capturedAt: new Date(lock.capturedAt),
        },
      }),
    "metricLock.upsert"
  );
}

function minutesSince(iso: string): number {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return 0;
  return Math.max(0, Math.round((Date.now() - then) / 60000));
}

// The cutoff instant of a lock: <date>T<lockHour>:00 WIB.
function lockInstantIso(date: string, hour: number): string {
  const midnightUtc = Date.parse(`${date}T00:00:00.000Z`);
  return new Date(midnightUtc + (hour - 7) * 60 * 60 * 1000).toISOString();
}

// A snapshot taken within five minutes of its cutoff is the real cutoff value.
// Anything later is over-counted (HMS keeps moving) and is reported as
// approximate so the card can say so instead of pretending to be exact.
function qualityOf(capturedAt: string, date: string, hour: number): LockQuality {
  const captured = Date.parse(capturedAt);
  const instant = Date.parse(lockInstantIso(date, hour));
  if (!Number.isFinite(captured) || !Number.isFinite(instant)) return "approximate";
  const minutesLate = (captured - instant) / 60000;
  return minutesLate <= 5 ? "accurate" : "approximate";
}

export interface ResolveMetricLockParams {
  req: NextRequest | null;
  facility: string;
  kind: MetricLockKind;
  live: MetricValues;
  metric: (values: MetricValues) => number;
  date?: string;
  hour?: number;
}

export async function resolveMetricLock({
  req,
  facility,
  kind,
  live,
  metric,
  date,
  hour,
}: ResolveMetricLockParams): Promise<ResolvedMetricLock> {
  const lockHour = LOCK_HOUR_WIB[kind];
  const today = date ?? wibDate();
  const wibHourNow = hour ?? wibHour();
  const liveValues = clean(live);
  const livePayload: MetricLockPayload = {
    values: liveValues,
    value: metric(liveValues),
    is_locked: false,
    lock_hour_wib: lockHour,
    captured_at: new Date().toISOString(),
    source: "live",
    quality: "live",
    age_minutes: 0,
  };

  if (wibHourNow < lockHour) return { payload: livePayload };

  const stored = await readLock(req, facility, today, kind);
  if (stored) {
    return {
      payload: {
        values: stored.values,
        value: stored.value,
        is_locked: true,
        lock_hour_wib: lockHour,
        captured_at: stored.capturedAt,
        source: stored.source,
        // A lock taken well after the cutoff (cold start, first request of the
        // day) is still frozen, but its value is over-counted.
        quality: qualityOf(stored.capturedAt, today, lockHour),
        age_minutes: minutesSince(stored.capturedAt),
      },
    };
  }

  // No lock yet today: freeze what HMS reports right now.
  const fresh: StoredLock = {
    facility,
    date: today,
    kind,
    values: liveValues,
    value: metric(liveValues),
    capturedAt: new Date().toISOString(),
    source: "observed",
  };
  await writeLock(fresh);
  return {
    payload: {
      values: fresh.values,
      value: fresh.value,
      is_locked: true,
      lock_hour_wib: lockHour,
      captured_at: fresh.capturedAt,
      source: "observed",
      quality: qualityOf(fresh.capturedAt, today, lockHour),
      age_minutes: 0,
    },
    cookie: { name: cookieName(kind, facility), value: encode(fresh) },
  };
}

export function setMetricLockCookie(
  res: NextResponse,
  cookie: { name: string; value: string } | undefined
): void {
  if (!cookie) return;
  res.cookies.set(cookie.name, cookie.value, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 26,
  });
}

export function metricPercent(numerator: number, denominator: number): number {
  if (!denominator || denominator <= 0) return 0;
  return Math.round((numerator / denominator) * 10000) / 100;
}