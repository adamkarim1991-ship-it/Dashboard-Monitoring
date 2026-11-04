// Shared WIB date-range helpers.
//
// Every HMS query that filters by created_at must use the same window: one full
// calendar month back from today (D0 fully included), computed from the wall
// clock at request time so it rolls forward on its own.
//
// 2026-11-04 WIB -> 2026-10-04 00:00:00 WIB .. 2026-11-04 23:59:59 WIB

const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export const DEFAULT_RANGE_DAYS = 30;

function todayStartWibMs(now = new Date()): number {
  const wib = new Date(now.getTime() + WIB_OFFSET_MS);
  return (
    Date.UTC(wib.getUTCFullYear(), wib.getUTCMonth(), wib.getUTCDate(), 0, 0, 0) -
    WIB_OFFSET_MS
  );
}

// Same day of the previous calendar month, clamped to the last day when the
// previous month is shorter (e.g. 31 Mar -> 28/29 Feb).
function monthBackStartWibMs(now = new Date()): number {
  const wib = new Date(now.getTime() + WIB_OFFSET_MS);
  const year = wib.getUTCFullYear();
  const month = wib.getUTCMonth();
  const day = wib.getUTCDate();
  const lastDayOfPrevMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const targetDay = Math.min(day, lastDayOfPrevMonth);
  return Date.UTC(year, month - 1, targetDay, 0, 0, 0) - WIB_OFFSET_MS;
}

export function getWibRangeDayCount(now = new Date()): number {
  const fromMs = monthBackStartWibMs(now);
  const toStartMs = todayStartWibMs(now);
  return Math.round((toStartMs - fromMs) / DAY_MS) + 1;
}

export function getWibRangeUnix(now = new Date()): {
  from: number;
  to: number;
  days: number;
} {
  const fromMs = monthBackStartWibMs(now);
  const todayStart = todayStartWibMs(now);
  const toMs = todayStart + DAY_MS - 1000;
  return {
    from: Math.floor(fromMs / 1000),
    to: Math.floor(toMs / 1000),
    days: Math.round((todayStart - fromMs) / DAY_MS) + 1,
  };
}

export function getWibRangeStartDate(now = new Date()): string {
  const { from } = getWibRangeUnix(now);
  const wib = new Date(from * 1000 + WIB_OFFSET_MS);
  return `${wib.getUTCFullYear()}-${String(wib.getUTCMonth() + 1).padStart(2, "0")}-${String(
    wib.getUTCDate()
  ).padStart(2, "0")}`;
}

export function getWibTodayDate(now = new Date()): string {
  const wib = new Date(now.getTime() + WIB_OFFSET_MS);
  return `${wib.getUTCFullYear()}-${String(wib.getUTCMonth() + 1).padStart(2, "0")}-${String(
    wib.getUTCDate()
  ).padStart(2, "0")}`;
}
