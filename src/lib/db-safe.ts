// Resilient Prisma access.
// Keeps read paths serving data (and write paths non-fatal) when the database
// is unreachable, so a DB outage degrades the dashboard instead of 500-ing it.

type PrismaLikeError = { code?: string; message?: string };

const state = globalThis as unknown as {
  __dbDownUntil?: number;
  __dbDownReason?: string;
};

const DOWN_COOLDOWN_MS = 30_000;

const OUTAGE_CODES = new Set([
  "P1000",
  "P1001",
  "P1002",
  "P1003",
  "P1008",
  "P1010",
  "P1017",
  "P2021",
  "P2022",
]);

const OUTAGE_PATTERNS =
  /quota|can't reach database|could not connect|connection refused|ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENOTFOUND|too many connections|terminating connection|does not exist in the current database/i;

export function isDbOutage(err: unknown): boolean {
  const e = (err ?? {}) as PrismaLikeError;
  if (e.code && OUTAGE_CODES.has(e.code)) return true;
  return OUTAGE_PATTERNS.test(String(e.message ?? ""));
}

export function dbDown(): boolean {
  return (state.__dbDownUntil ?? 0) > Date.now();
}

function markDown(err: unknown, label: string): void {
  const message = String((err as PrismaLikeError)?.message ?? err).slice(0, 300);
  const wasDown = dbDown();
  state.__dbDownUntil = Date.now() + DOWN_COOLDOWN_MS;
  state.__dbDownReason = message;
  if (!wasDown) console.warn(`[db-safe] database unavailable (${label}): ${message}`);
}

/**
 * Read from the DB. Returns `fallback` when the database is unreachable,
 * rethrows application-level errors (constraint violations, etc.).
 */
export async function dbRead<T>(
  fn: () => Promise<T>,
  fallback: T,
  label: string
): Promise<T> {
  if (dbDown()) return fallback;
  try {
    const result = await fn();
    state.__dbDownUntil = 0;
    return result;
  } catch (err) {
    if (!isDbOutage(err)) throw err;
    markDown(err, label);
    return fallback;
  }
}

/**
 * Best-effort write. Never throws: a failing write must not break a request
 * whose data comes from HMS rather than from the database.
 */
export async function dbWrite<T>(
  fn: () => Promise<T>,
  label: string
): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
  if (dbDown()) {
    return { ok: false, error: state.__dbDownReason ?? "database unavailable" };
  }
  try {
    const value = await fn();
    state.__dbDownUntil = 0;
    return { ok: true, value };
  } catch (err) {
    if (isDbOutage(err)) markDown(err, label);
    else console.warn(`[db-safe] write failed (${label}):`, String((err as Error)?.message ?? err));
    return { ok: false, error: String((err as Error)?.message ?? err) };
  }
}
