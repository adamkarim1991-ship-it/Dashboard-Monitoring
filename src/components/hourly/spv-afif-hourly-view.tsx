"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowRight, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FreshnessStatus } from "@/components/ui/freshness-status";
import { fetchDashboardJson } from "@/lib/client-fetch";
import { SUMMARY_POLL_INTERVAL_MS } from "@/lib/constants";
import type { SessionUser } from "@/components/dashboard/dashboard-view";
import { SPV_AFIF_HUBS, type SpvAfifHubConfig } from "@/lib/spv-afif-hubs";

type SummaryPayload = {
  hub_id?: number | string;
  hub_name?: string;
  today_volume?: number;
  just_arrived?: number;
  delivered?: number;
  delivered_percentage?: number;
  sd_before_12?: number;
  sd_before_12_quality?: string;
  sd_before_12_captured_at?: string | null;
  clean_floor_c1?: {
    value?: number;
    numerator?: number;
    denominator?: number;
    quality?: string;
    captured_at?: string | null;
  };
  fetched_at?: string;
};

type HubSummaryState = {
  hub: SpvAfifHubConfig;
  loading: boolean;
  error?: string | null;
  data?: SummaryPayload;
};

const WIB_FORMATTER = new Intl.DateTimeFormat("id-ID", {
  timeZone: "Asia/Jakarta",
  hour: "2-digit",
  minute: "2-digit",
});

function readNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function metric(value: unknown, suffix = "") {
  const n = readNumber(value);
  if (n === null) return "-";
  return `${n.toLocaleString("en-US")}${suffix}`;
}

function pct(value: unknown) {
  const n = readNumber(value);
  if (n === null) return "-";
  return `${n.toFixed(2)}%`;
}

function wibTime(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return WIB_FORMATTER.format(date);
}

function lockText(quality?: string, capturedAt?: string | null) {
  if (!quality) return "waiting";
  const time = wibTime(capturedAt);
  return `${quality} - ${time ? `${time} WIB` : "not locked"}`;
}

function unwrapSummary(payload: any): SummaryPayload {
  return payload?.summary ?? payload;
}

async function fetchHubSummary(hub: SpvAfifHubConfig): Promise<HubSummaryState> {
  try {
    const response = await fetchDashboardJson<any>(`/api/hms/summary?hubId=${hub.hmsHubId}`);
    if (!response?.success || !response?.summary) {
      const message = response?.message || response?.detail || response?.error || "HMS summary returned no data";
      throw new Error(String(message));
    }
    return { hub, loading: false, data: unwrapSummary(response), error: null };
  } catch (error: any) {
    return {
      hub,
      loading: false,
      error: error?.message || "Failed to load HMS summary",
    };
  }
}

export default function SpvAfifHourlyView({ user }: { user: SessionUser }) {
  const [states, setStates] = useState<HubSummaryState[]>(() =>
    SPV_AFIF_HUBS.map((hub) => ({ hub, loading: true }))
  );
  const [refreshing, setRefreshing] = useState(false);
  const requestIdRef = useRef(0);

  const loadAll = useCallback(async () => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setRefreshing(true);
    setStates((prev) => prev.map((item) => ({ ...item, loading: true, error: null })));

    const results: HubSummaryState[] = [];
    for (let i = 0; i < SPV_AFIF_HUBS.length; i += 3) {
      const batch = SPV_AFIF_HUBS.slice(i, i + 3);
      results.push(...(await Promise.all(batch.map(fetchHubSummary))));
      if (requestIdRef.current !== requestId) return;
    }

    setStates(results);
    setRefreshing(false);
  }, []);

  useEffect(() => {
    loadAll();
    const timer = window.setInterval(loadAll, SUMMARY_POLL_INTERVAL_MS);
    return () => {
      requestIdRef.current += 1;
      window.clearInterval(timer);
    };
  }, [loadAll]);

  const totals = useMemo(() => {
    return states.reduce(
      (acc, item) => {
        const d = item.data;
        if (!d || item.error) return acc;
        const overall = readNumber(d.today_volume);
        const fresh = readNumber(d.just_arrived);
        const delivered = readNumber(d.delivered);
        acc.loaded += 1;
        if (overall !== null) acc.overall += overall;
        else acc.incomplete = true;
        if (fresh !== null) acc.fresh += fresh;
        else acc.incomplete = true;
        if (delivered !== null) acc.delivered += delivered;
        else acc.incomplete = true;
        return acc;
      },
      { loaded: 0, overall: 0, fresh: 0, delivered: 0, incomplete: false }
    );
  }, [states]);

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 md:px-8">
        <header className="rounded-3xl border border-white/10 bg-white/[0.04] p-5 shadow-2xl shadow-black/20">
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.28em] text-cyan-300">SPV Afif Coverage</p>
              <h1 className="mt-2 text-3xl font-bold md:text-4xl">9 Hub Hourly Monitoring</h1>
              <p className="mt-2 max-w-3xl text-sm text-slate-300">
                One page for East coverage. Every card calls the same HMS summary route as the hub dashboard, so 08:00 / 12:00 WIB cutoff locks stay backend-owned.
              </p>
            </div>
            <div className="flex flex-col items-start gap-2 md:items-end">
              <Button onClick={loadAll} disabled={refreshing} className="bg-cyan-400 text-slate-950 hover:bg-cyan-300">
                <RefreshCw className={`mr-2 h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
                Refresh all
              </Button>
              <p className="text-xs text-slate-400">User: {user.name || user.email || "active session"}</p>
            </div>
          </div>

          <div className="mt-5 grid gap-3 md:grid-cols-4">
            <div className="rounded-2xl bg-slate-900/80 p-4"><p className="text-xs uppercase tracking-wider text-slate-400">Loaded hubs</p><p className="mt-1 text-2xl font-bold">{totals.loaded}/9</p></div>
            <div className="rounded-2xl bg-slate-900/80 p-4"><p className="text-xs uppercase tracking-wider text-slate-400">Overall volume</p><p className="mt-1 text-2xl font-bold">{metric(totals.overall)}</p></div>
            <div className="rounded-2xl bg-slate-900/80 p-4"><p className="text-xs uppercase tracking-wider text-slate-400">Fresh volume</p><p className="mt-1 text-2xl font-bold">{metric(totals.fresh)}</p></div>
            <div className="rounded-2xl bg-slate-900/80 p-4"><p className="text-xs uppercase tracking-wider text-slate-400">Delivered</p><p className="mt-1 text-2xl font-bold">{metric(totals.delivered)}</p></div>
          </div>
          {totals.incomplete && <p className="mt-3 text-xs text-amber-200">Some aggregate totals exclude fields that were missing from a hub response.</p>}
        </header>

        <section className="grid gap-4 lg:grid-cols-3">
          {states.map((item) => {
            const d = item.data;
            const clean = d?.clean_floor_c1;
            return (
              <article key={item.hub.slug} className="rounded-3xl border border-white/10 bg-white/[0.05] p-5 shadow-xl shadow-black/10">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">{item.hub.shortName}</p>
                    <h2 className="mt-1 text-xl font-bold">{item.hub.name}</h2>
                    <p className="text-xs text-slate-400">HMS hub ID: {item.hub.hmsHubId}</p>
                  </div>
                  {d?.fetched_at && <FreshnessStatus fetchedAt={d.fetched_at} />}
                </div>

                {item.error ? (
                  <div className="mt-5 rounded-2xl border border-rose-400/30 bg-rose-500/10 p-4 text-sm text-rose-100">
                    <div className="flex items-center gap-2 font-semibold"><AlertTriangle className="h-4 w-4" />Failed to load</div>
                    <p className="mt-2 text-rose-100/80">{item.error}</p>
                  </div>
                ) : item.loading ? (
                  <div className="mt-5 h-40 animate-pulse rounded-2xl bg-slate-800/70" />
                ) : (
                  <>
                    <div className="mt-5 grid grid-cols-2 gap-3">
                      <div className="rounded-2xl bg-slate-900/70 p-3"><p className="text-xs text-slate-400">Overall</p><p className="text-xl font-bold">{metric(d?.today_volume)}</p></div>
                      <div className="rounded-2xl bg-slate-900/70 p-3"><p className="text-xs text-slate-400">Fresh</p><p className="text-xl font-bold">{metric(d?.just_arrived)}</p></div>
                      <div className="rounded-2xl bg-slate-900/70 p-3"><p className="text-xs text-slate-400">SD&lt;12</p><p className="text-xl font-bold text-cyan-200">{pct(d?.sd_before_12)}</p><p className="mt-1 text-[11px] text-slate-500">{lockText(d?.sd_before_12_quality, d?.sd_before_12_captured_at)}</p></div>
                      <div className="rounded-2xl bg-slate-900/70 p-3"><p className="text-xs text-slate-400">Clean Floor</p><p className="text-xl font-bold text-emerald-200">{pct(clean?.value)}</p><p className="mt-1 text-[11px] text-slate-500">{lockText(clean?.quality, clean?.captured_at)}</p></div>
                    </div>
                    <div className="mt-4 grid grid-cols-2 gap-3 text-sm text-slate-300">
                      <div>Delivered success: <span className="font-semibold text-white">{pct(d?.delivered_percentage)}</span></div>
                      <div>Fetched: <span className="font-semibold text-white">{wibTime(d?.fetched_at) ? `${wibTime(d?.fetched_at)} WIB` : "-"}</span></div>
                    </div>
                  </>
                )}

                <Link href={`/hourly/spv-afif/${item.hub.slug}`} className="mt-5 inline-flex w-full items-center justify-center rounded-2xl bg-white px-4 py-3 text-sm font-bold text-slate-950 transition hover:bg-cyan-200">
                  Open dedicated hub page <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </article>
            );
          })}
        </section>
      </div>
    </main>
  );
}