// Single source of truth for the operating day.
//
// Wall clock is WIB (UTC+7) and the operating day is 00:00:00 - 23:59:59 WIB.
// Every timestamp comparison adds WIB_OFFSET_MS and then reads the UTC fields,
// so the result is identical on a UTC host and on a WIB host.

export const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;
const DAY_SECONDS = 24 * 60 * 60;

// HMS OPC (Last Mile > Performance) anchors its day at 17:00 of the previous
// WIB day. "today 00:00" is accepted by the API but re-keys every field: fresh
// arrivals collapse to the 00:00-now slice and backlog absorbs the whole
// previous day (just_arrived 5.867 -> 2.927, backlog 366 -> 3.287), so the OPC
// slice keeps the HMS anchor while every created_at range uses the 00:00 day.
export const HMS_OPC_ANCHOR_HOUR = 17;

export function wibShiftedDate(now: Date = new Date()): Date {
  return new Date(now.getTime() + WIB_OFFSET_MS);
}

export function formatWibDate(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function wibDate(now: Date = new Date()): string {
  return formatWibDate(wibShiftedDate(now));
}

export function wibHour(now: Date = new Date()): number {
  return wibShiftedDate(now).getUTCHours();
}

// Unix seconds of a WIB wall-clock time on the current WIB date.
export function wibUnixAt(hour: number, minute = 0, now: Date = new Date()): number {
  const wib = wibShiftedDate(now);
  const utcMs =
    Date.UTC(wib.getUTCFullYear(), wib.getUTCMonth(), wib.getUTCDate(), hour, minute, 0) -
    WIB_OFFSET_MS;
  return Math.floor(utcMs / 1000);
}

export interface OperatingDay {
  date: string;
  // 00:00:00 WIB today and 23:59:59 WIB today, unix seconds.
  startUnix: number;
  endUnix: number;
}

export function operatingDay(now: Date = new Date()): OperatingDay {
  const startUnix = wibUnixAt(0, 0, now);
  return {
    date: wibDate(now),
    startUnix,
    endUnix: startUnix + DAY_SECONDS - 1,
  };
}

export interface HMSRange {
  from: number;
  to: number;
  date: string;
}

export function hmsDayRange(now: Date = new Date()): HMSRange {
  const day = operatingDay(now);
  return { from: day.startUnix, to: day.endUnix, date: day.date };
}

// "YYYY-MM-DD 17:00:00" for the previous WIB day: the value HMS OPC expects in
// curr_date / curr_date_start.
export function opcCurrDate(now: Date = new Date()): string {
  const wib = wibShiftedDate(now);
  wib.setUTCDate(wib.getUTCDate() - 1);
  return `${formatWibDate(wib)} ${String(HMS_OPC_ANCHOR_HOUR).padStart(2, "0")}:00:00`;
}

// The HMS OPC window in unix seconds: 17:00 WIB yesterday -> 17:00 WIB today.
export function opcDayRangeUnix(now: Date = new Date()): { from: number; to: number } {
  const to = wibUnixAt(HMS_OPC_ANCHOR_HOUR, 0, now);
  return { from: to - DAY_SECONDS, to };
}

export function opcCycleList(now: Date = new Date()): string {
  const { from, to } = opcDayRangeUnix(now);
  return JSON.stringify([`${from}-${to}`]);
}

// Unix seconds -> milliseconds. HMS mixes the two, so normalise on the way in.
export function toEpochMs(value: unknown): number {
  const num = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(num) || num <= 0) return 0;
  return num > 1_000_000_000_000 ? Math.round(num) : Math.round(num * 1000);
}

// True when the timestamp falls on the current WIB date before `hour` WIB.
export function isWibTodayBefore(
  value: unknown,
  hour: number,
  now: Date = new Date()
): boolean {
  const ms = toEpochMs(value);
  if (!ms) return false;
  const wib = new Date(ms + WIB_OFFSET_MS);
  if (formatWibDate(wib) !== wibDate(now)) return false;
  return wib.getUTCHours() < hour;
}