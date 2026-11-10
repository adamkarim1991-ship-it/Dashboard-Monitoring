export type FtdRecordEntry = {
  name: string;
  currentFtd: number;
  ftdToday: number;
  lastTotalFtd: number;
  updatedAt: number;
};
export type FtdRecordState = {
  version: 2;
  hubId: string;
  dateWib: string;
  entries: Record<string, FtdRecordEntry>;
};
export function getWibDate(now = Date.now()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date(now));
  const part = (type: string) => parts.find(p => p.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}
export const ftdStorageKey = (hubId: string, dateWib: string) =>
  `occ_ftd_record_v2_${hubId}_${dateWib}`;
export const validCount = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;
export const validSample = (row: unknown): row is { name: string; totalFtd: number } => {
  if (!row || typeof row !== "object") return false;
  const c = row as { name?: unknown; totalFtd?: unknown };
  return typeof c.name === "string" && c.name.trim().length > 0 && validCount(c.totalFtd);
};
export function emptyFtdRecord(hubId: string, dateWib: string): FtdRecordState {
  return { version: 2, hubId, dateWib, entries: {} };
}
export function accumulateFtd(prev: FtdRecordState | null, hubId: string,
  rows: readonly unknown[], now = Date.now(), incomplete = false): FtdRecordState {
  const dateWib = getWibDate(now);
  const base = prev?.hubId === hubId && prev.dateWib === dateWib
    ? prev : emptyFtdRecord(hubId, dateWib);
  if (incomplete || !rows.every(validSample)) return base;
  const entries = { ...base.entries };
  for (const c of rows) {
    if (!validSample(c)) continue;
    const prior = Object.prototype.hasOwnProperty.call(entries, c.name) ? entries[c.name] : undefined;
    Object.defineProperty(entries, c.name, { enumerable: true, configurable: true, writable: true, value: {
      name: c.name, currentFtd: c.totalFtd,
      ftdToday: (prior?.ftdToday ?? 0) + Math.max(0, c.totalFtd - (prior?.lastTotalFtd ?? 0)),
      lastTotalFtd: c.totalFtd, updatedAt: now,
    } });
  }
  return { ...base, entries };
}
export function parseFtdRecord(raw: string | null, hubId: string, dateWib: string): FtdRecordState | null {
  try {
    const p = JSON.parse(raw ?? "null");
    if (!p || p.version !== 2 || p.hubId !== hubId || p.dateWib !== dateWib ||
      !p.entries || typeof p.entries !== "object" || Array.isArray(p.entries)) return null;
    if (!Object.entries(p.entries).every(([key, value]) => {
      const e = value as FtdRecordEntry;
      return e && e.name === key && validCount(e.currentFtd) && validCount(e.ftdToday) &&
        validCount(e.lastTotalFtd) && validCount(e.updatedAt);
    })) return null;
    return p;
  } catch { return null; }
}
