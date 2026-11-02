// Clean Floor morning lock.
//
// Clean Floor % = (ongoing + delivered + FTD + others) / Volume Overall.
// Volume Overall keeps growing until the end of the operating day, so using
// the live value as denominator made the percentage fall on its own even when
// nothing bad happened. The denominator is therefore frozen at the Volume
// Overall captured at 08:00 WIB, while the numerator keeps updating live.
//
// The lock is kept in three layers so a database outage cannot unlock it:
// instance memory, an origin cookie, and the cleanFloorSnapshot table.

import type { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { dbRead, dbWrite } from "@/lib/db-safe";

export const LOCK_HOUR_WIB = 8;
export const LOCK_COOKIE_PREFIX = "__cf_lock_";

export interface CleanFloorLive {
  delivered: number;
  ongoing: number;
  ftd: number;
  others: number;
  pending: number;
  todayVolume: number;
}

export interface CleanFloorBreakdown {
  delivered: number;
  ongoing: number;
  ftd: number;
  others: number;
  pending: number;
  today_volume: number;
  numerator: number;
}

export interface CleanFloorPayload {
  value: number;
  breakdown: CleanFloorBreakdown;
  is_locked: boolean;
  locked_at: string;
  quality: "accurate" | "approximate" | "live";
  captured_at: string;
  lock_source: "database" | "cookie" | "memory" | "observed" | "live";
}

export interface CleanFloorCookie {
  name: string;
  value: string;
  maxAge: number;
}

export interface CleanFloorResult {
  payload: CleanFloorPayload;
  cookie?: CleanFloorCookie;
}

interface LockEntry {
  denominator: number;
  capturedAt: string;
  source: "database" | "cookie" | "memory" | "observed";
}

const store = globalThis as unknown as {
  __cleanFloorLocks?: Map<string, LockEntry>;
};

function lockMemory(): Map<string, LockEntry> {
  if (!store.__cleanFloorLocks) store.__cleanFloorLocks = new Map();
  return store.__cleanFloorLocks;
}

function lockKey(facility: string, date: string): string {
  return `${facility}:${date}`;
}

export function cleanFloorLockedAt(date: string): string {
  return `${date}T01:00:00.000Z`;
}

export function cleanFloorCookieName(facility: string): string {
  return `${LOCK_COOKIE_PREFIX}${facility}`;
}

function encodeCookie(entry: LockEntry, date: string): string {
  return [date, entry.denominator, entry.capturedAt, entry.source].join("|");
}

function decodeCookie(raw: string | undefined, date: string): LockEntry | null {
  if (!raw) return null;
  const parts = raw.split("|");
  if (parts.length < 4) return null;
  if (parts[0] !== date) return null;
  const denominator = Number(parts[1]);
  if (!Number.isFinite(denominator) || denominator <= 0) return null;
  const capturedAt = parts[2];
  if (!capturedAt) return null;
  const source =
    parts[3] === "database" || parts[3] === "cookie" || parts[3] === "memory"
      ? (parts[3] as LockEntry["source"])
      : "cookie";
  return { denominator, capturedAt, source };
}

function qualityOf(entry: LockEntry, date: string): "accurate" | "approximate" {
  const captured = Date.parse(entry.capturedAt);
  const lockStart = Date.parse(cleanFloorLockedAt(date));
  if (!Number.isFinite(captured)) return "approximate";
  const minutesAfterLock = (captured - lockStart) / 60000;
  return minutesAfterLock >= -1 && minutesAfterLock <= 60 ? "accurate" : "approximate";
}

function buildBreakdown(
  live: CleanFloorLive,
  denominator: number,
  numerator: number
): CleanFloorBreakdown {
  return {
    delivered: live.delivered,
    ongoing: live.ongoing,
    ftd: live.ftd,
    others: live.others,
    pending: live.pending,
    today_volume: denominator,
    numerator,
  };
}

function percentage(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return parseFloat(Math.min((numerator / denominator) * 100, 100).toFixed(2));
}

// Resolve the Clean Floor metric for one hub.
//
// Before 08:00 WIB the metric is live and unlocked. After 08:00 the
// denominator is the locked 08:00 Volume Overall; only the numerator moves.
export async function resolveCleanFloor(params: {
  req: NextRequest | null;
  facility: string;
  date: string;
  wibHour: number;
  live: CleanFloorLive;
}): Promise<CleanFloorResult> {
  const { req, facility, date, wibHour, live } = params;
  const numerator = live.ongoing + live.delivered + live.ftd + live.others;
  const lockedAt = cleanFloorLockedAt(date);

  if (wibHour < LOCK_HOUR_WIB) {
    return {
      payload: {
        value: percentage(numerator, live.todayVolume),
        breakdown: buildBreakdown(live, live.todayVolume, numerator),
        is_locked: false,
        locked_at: lockedAt,
        quality: "live",
        captured_at: new Date().toISOString(),
        lock_source: "live",
      },
    };
  }

  const key = lockKey(facility, date);
  const cookieName = cleanFloorCookieName(facility);
  let entry = lockMemory().get(key) ?? null;

  if (!entry && req) {
    const fromCookie = decodeCookie(req.cookies.get(cookieName)?.value, date);
    if (fromCookie) entry = { ...fromCookie, source: "cookie" };
  }

  if (!entry) {
    const row = await dbRead(
      () =>
        prisma.cleanFloorSnapshot.findUnique({
          where: { facility_date: { facility, date } },
        }),
      null,
      "cleanFloorSnapshot.findUnique"
    );
    if (row && row.denominator > 0) {
      entry = {
        denominator: row.denominator,
        capturedAt: row.capturedAt.toISOString(),
        source: "database",
      };
    }
  }

  const isNewLock = !entry;
  if (!entry) {
    entry = {
      denominator: live.todayVolume,
      capturedAt: new Date().toISOString(),
      source: "observed",
    };
  }

  const lock: LockEntry = entry;
  lockMemory().set(key, lock);

  if (isNewLock) {
    // First observation after 08:00: persist the frozen denominator. The
    // update branch deliberately leaves denominator alone so a re-run can
    // never unlock it.
    await dbWrite(
      () =>
        prisma.cleanFloorSnapshot.upsert({
          where: { facility_date: { facility, date } },
          create: {
            facility,
            date,
            value: percentage(numerator, lock.denominator),
            numerator,
            denominator: lock.denominator,
            delivered: live.delivered,
            ongoing: live.ongoing,
            ftd: live.ftd,
            others: live.others,
          },
          update: {
            numerator,
            delivered: live.delivered,
            ongoing: live.ongoing,
            ftd: live.ftd,
            others: live.others,
          },
        }),
      "cleanFloorSnapshot.upsert"
    );
  }

  return {
    payload: {
      value: percentage(numerator, lock.denominator),
      breakdown: buildBreakdown(live, lock.denominator, numerator),
      is_locked: true,
      locked_at: lockedAt,
      quality: qualityOf(lock, date),
      captured_at: lock.capturedAt,
      lock_source: lock.source,
    },
    cookie: {
      name: cookieName,
      value: encodeCookie(lock, date),
      maxAge: 36 * 60 * 60,
    },
  };
}

// Attach the lock cookie so the next request (or lambda instance) keeps it.
export function applyCleanFloorCookie(
  res: NextResponse,
  cookie: CleanFloorCookie | undefined
): void {
  if (!cookie) return;
  res.cookies.set(cookie.name, cookie.value, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: cookie.maxAge,
  });
}