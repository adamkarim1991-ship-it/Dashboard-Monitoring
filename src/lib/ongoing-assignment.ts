// Verified HMS order_view Driver column renders assigned_drivers, a string.
export const ownerKey = (name: string) => name.trim().split(new RegExp("\\s+")).filter(Boolean).join(" ").toLocaleLowerCase("en-US");
export type Shipment = { id?: string | number; awb_number?: string; status?: string; assigned_drivers?: unknown; hub_id?: string | number };
export type Assignment = { counts: Map<string, { name: string; count: number }>; pages: number; shipments: number; unassigned: number; ambiguous: number };
export async function singleFlight<T>(pending: Map<string, Promise<T>>, key: string, load: () => Promise<T>): Promise<T> {
  const previous = pending.get(key);
  if (previous) return previous;
  const promise = Promise.resolve().then(load);
  pending.set(key, promise);
  try { return await promise; }
  finally { if (pending.get(key) === promise) pending.delete(key); }
}
export class MovingAssignmentSnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MovingAssignmentSnapshotError";
  }
}
// At most two fresh snapshots. Neither pages nor counts from a failed snapshot survive.
// The caller supplies the same route deadline; retries never extend it.
export async function loadCurrentAssignmentsWithRetry(
  fetchPage: (page: number) => Promise<unknown>,
  hubId: string,
  signal: AbortSignal,
  maxPages = 120
): Promise<Assignment & { snapshotAttempts: number }> {
  for (let attempt = 1; attempt <= 2; attempt++) {
    signal.throwIfAborted();
    try {
      const assignment = await loadCurrentAssignments(async page => {
        signal.throwIfAborted();
        const result = await fetchPage(page);
        signal.throwIfAborted();
        return result;
      }, hubId, maxPages);
      return { ...assignment, snapshotAttempts: attempt };
    } catch (error) {
      signal.throwIfAborted();
      if (!(error instanceof MovingAssignmentSnapshotError) || attempt === 2) throw error;
    }
  }
  throw new Error("Current assignment snapshot attempts exhausted");
}
export async function loadCurrentAssignments(fetchPage: (page: number) => Promise<unknown>, hubId: string, maxPages = 120): Promise<Assignment> {
  const unique = new Map<string, Shipment>();
  let total = -1, pageSize = 0, received = 0, pages = 0;
  type Page = { data?: { shipments?: Shipment[]; total_records?: number; page?: number; per_page?: number }; code?: number };
  function consume(json: Page, page: number) {
    const data = json?.data;
    if ((json.code !== undefined && json.code !== 200) || !Array.isArray(data?.shipments) || !Number.isSafeInteger(data.total_records) || data.total_records! < 0 || Number(data.page) !== page || !Number.isSafeInteger(data.per_page) || data.per_page! <= 0) throw new Error("Invalid current assignment page contract");
    if (total < 0) { total = data.total_records!; pageSize = data.per_page!; }
    if (data.per_page !== pageSize) throw new Error("Invalid current assignment page contract");
    if (data.total_records !== total) throw new MovingAssignmentSnapshotError("Current assignment total changed during pagination");
    const expected = Math.min(pageSize, Math.max(total - (page - 1) * pageSize, 0));
    if (data.shipments.length !== expected) throw new Error("Current assignment page missing or truncated");
    received += data.shipments.length;
    pages++;
    for (const row of data.shipments) {
      const key = String(row.awb_number || row.id || "").trim();
      if (!key) throw new Error("Current shipment missing AWB/ID");
      const old = unique.get(key);
      if (old && (old.assigned_drivers !== row.assigned_drivers || old.status !== row.status || old.hub_id !== row.hub_id)) throw new MovingAssignmentSnapshotError("Current assignment changed during pagination");
      unique.set(key, row);
    }
  }
  consume(await fetchPage(1) as Page, 1);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (totalPages > maxPages) throw new Error(`Current assignment pagination limit exceeded: ${totalPages} pages required, cap ${maxPages}`);
  // Fixed batches never start more than three requests. Failure prevents later batches.
  for (let start = 2; start <= totalPages; start += 3) {
    const batch = Array.from({ length: Math.min(3, totalPages - start + 1) }, (_, i) => start + i);
    const results = await Promise.all(batch.map(page => fetchPage(page)));
    results.forEach((json, i) => consume(json as Page, batch[i]));
  }
  if (received !== total) throw new Error("Current assignment page missing");
  const counts: Assignment["counts"] = new Map();
  let unassigned = 0, ambiguous = 0;
  for (const row of unique.values()) {
    if (row.hub_id === undefined) throw new Error("Current shipment missing hub_id");
    if (String(row.hub_id) !== hubId || !["picked", "out_for_delivery"].includes(row.status || "")) continue;
    if (typeof row.assigned_drivers !== "string") { ambiguous++; continue; }
    const name = row.assigned_drivers.trim();
    if (!name) { unassigned++; continue; }
    // No splitting an unverified multi-owner encoding and no double-credit.
    if ([",", ";", "\n", "\r", "|"].some(separator => name.includes(separator))) { ambiguous++; continue; }
    const key = ownerKey(name), current = counts.get(key);
    counts.set(key, { name: current?.name || name, count: (current?.count || 0) + 1 });
  }
  return { counts, pages, shipments: unique.size, unassigned, ambiguous };
}
export function mergeCurrentCounts<T extends { name: string }>(rows: T[], assignment: Assignment, empty: (name: string) => T) {
  const existing = new Map<string, T>();
  for (const row of rows) {
    const key = ownerKey(row.name);
    if (existing.has(key)) throw new Error("Ambiguous normalized productivity courier name");
    existing.set(key, row);
  }
  for (const [key, owner] of assignment.counts) if (!existing.has(key)) existing.set(key, empty(owner.name));
  return [...existing].map(([key, row]) => ({ ...row, ongoing: assignment.counts.get(key)?.count || 0 }));
}
// Map insertion order is oldest-first; callers delete an existing key before replacing it.
export function pruneTimedCache<T extends { timestamp: number }>(cache: Map<string, T>, now: number, ttlMs: number, maxEntries = 64) {
  for (const [key, entry] of cache) if (now - entry.timestamp >= ttlMs) cache.delete(key);
  while (cache.size > maxEntries) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}