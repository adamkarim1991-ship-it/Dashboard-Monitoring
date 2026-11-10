const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;

export function parseWibDateToUnixRange(dateStr: string) {
  if (!/^\d{8}$/.test(dateStr)) return null;
  const year = parseInt(dateStr.slice(0, 4), 10);
  const month = parseInt(dateStr.slice(4, 6), 10) - 1;
  const day = parseInt(dateStr.slice(6, 8), 10);

  // UTC epoch for the numeric values provided
  const utcBaseMs = Date.UTC(year, month, day, 0, 0, 0);
  
  // 2026-11-04 00:00:00 WIB is 2026-11-03 17:00:00 UTC
  // To get from WIB wall-clock to UTC epoch: subtract 7 hours
  const startMs = utcBaseMs - WIB_OFFSET_MS;
  const endMs = startMs + 24 * 60 * 60 * 1000 - 1;

  const d = new Date(startMs + WIB_OFFSET_MS);
  if (
    d.getUTCFullYear() !== year ||
    d.getUTCMonth() !== month ||
    d.getUTCDate() !== day
  ) {
    return null;
  }

  return { from: Math.floor(startMs / 1000), to: Math.floor(endMs / 1000) };
}

export function getWibRangeEpoch(startStr: string, endStr: string) {
  const start = parseWibDateToUnixRange(startStr);
  const end = parseWibDateToUnixRange(endStr);
  if (!start || !end) return null;
  if (start.from > end.from) return null;
  return { from: start.from, to: end.to };
}
