// Shared WIB date-range helpers.
//
// Every HMS query that filters by created_at must use the same window: the
// last N operating days ending with today (D0) fully included. The window is
// computed from the wall clock at request time, so it rolls forward on its own.

const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;

export const DEFAULT_RANGE_DAYS = 30;

function todayStartWibMs(now = new Date()): number {
  const wib = new Date(now.getTime() + WIB_OFFSET_MS);
  return (
    Date.UTC(wib.getUTCFullYear(), wib.getUTCMonth(), wib.getUTCDate(), 0, 0, 0) -
    WIB_OFFSET_MS
  );
}

export function getWibRangeUnix(days = DEFAULT_RANGE_DAYS): {
  from: number;
  to: number;
  days: number;
} {
  const safeDays = Math.min(Math.max(Math.floor(days) || DEFAULT_RANGE_DAYS, 1), 90);
  const todayStart = todayStartWibMs();
  const fromMs = todayStart - (safeDays - 1) * 24 * 60 * 60 * 1000;
  const toMs = todayStart + 24 * 60 * 60 * 1000 - 1000;
  return {
    from: Math.floor(fromMs / 1000),
    to: Math.floor(toMs / 1000),
    days: safeDays,
  };
}

export function getWibRangeStartDate(days = DEFAULT_RANGE_DAYS): string {
  const { from } = getWibRangeUnix(days);
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