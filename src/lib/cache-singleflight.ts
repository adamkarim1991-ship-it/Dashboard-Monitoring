import { NextResponse } from "next/server";
export type SerializedResponse = { body: string; headers: Record<string, string>; status: number; fetchedAt: string };
type Result = { data: SerializedResponse; leaderRes?: NextResponse };
export class ScopedSingleflightCache {
  private cache = new Map<string, { data: SerializedResponse; expiresAt: number }>();
  private inflight = new Map<string, Promise<Result>>();
  constructor(private maxEntries = 64, private clock = Date.now) {}
  async getOrFetch(key: string, ttlMs: number, fetcher: () => Promise<NextResponse>): Promise<Result & { source: "cache" | "inflight" | "fresh" }> {
    const entry = this.cache.get(key);
    if (entry && entry.expiresAt > this.clock()) return { data: entry.data, source: "cache" };
    this.cache.delete(key);
    const pending = this.inflight.get(key);
    if (pending) return { data: (await pending).data, source: "inflight" };
    const promise = Promise.resolve().then(async () => {
      const res = await fetcher();
      const body = await res.clone().text();
      const headers: Record<string, string> = {};
      res.headers.forEach((v, k) => {
        if (!["set-cookie", "x-middleware-set-cookie"].includes(k.toLowerCase())) headers[k] = v;
      });
      let payload: any;
      try { payload = JSON.parse(body); } catch { payload = null; }
      const fetchedAt = typeof payload?.summary?.fetched_at === "string" ? payload.summary.fetched_at : "";
      const data = { body, headers, status: res.status, fetchedAt };
      if (res.status === 200 && payload?.success === true && payload?.auth_error !== true && Number.isFinite(Date.parse(fetchedAt))) {
        this.cache.set(key, { data, expiresAt: this.clock() + ttlMs });
        while (this.cache.size > this.maxEntries) this.cache.delete(this.cache.keys().next().value!);
      }
      return { data, leaderRes: res };
    });
    this.inflight.set(key, promise);
    try { return { ...await promise, source: "fresh" }; }
    finally { this.inflight.delete(key); }
  }
}
