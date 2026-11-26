"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowRight, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FreshnessStatus } from "@/components/ui/freshness-status";
import { fetchDashboardJson } from "@/lib/client-fetch";
import { SUMMARY_POLL_INTERVAL_MS } from "@/lib/constants";
import type { SessionUser } from "@/components/dashboard/dashboard-view";
import { SPV_AFIF_HUBS, type SpvAfifHubConfig } from "@/lib/spv-afif-hubs";

type HubSummaryState = {
  hub: SpvAfifHubConfig;
  loading: boolean;
  error?: string | null;
  data?: any;
  lastLoadedAt?: number;
};

function metric(value: unknown, suffix = "") {
  const n = Number(value);
  if (!Number.isFinite(n)) return "-";
  return `${n.toLocaleString("en-US")}${suffix}`;
}

function pct(value: unknown) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "-";
  return `${n.toFixed(2)}%`;
}

function lockText(summary: any) {
  const sd = summary?.sd_before_12;
  const clean = summary?.clean_floor_c1 || summary?.clean_floor;
  return {
    sd: sd?.quality ? `${sd.quality} · ${sd?.captured_at ? new Date(sd.captured_at).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" }) : "not locked"}` : "waiting",
    clean: clean?.quality ? `${clean.quality} · ${clean?.captured_at ? new Date(clean.captured_at).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" }) : "not locked"}` : "waiting",
  };
}

export default function SpvAfifHourlyView({ user }: { user: SessionUser }) {
  const [states, setStates] = useState<HubSummaryState[]>(() =>
    SPV_AFIF_HUBS.map((hub) => ({ hub, loading: true }))
  );
  const [refreshing, setRefreshing] = useState(false);

  const loadAll = useCallback(async () => {
    setRefreshing(true);
    setStates((prev) => prev.map((item) => ({ ...item, loading: true, error: null })));

    const results = await Promise.all(
      SPV_AFIF_HUBS.map(async (hub) => {
        try {
          const data = await fetchDashboardJson<any>(`/api/hms/summary?hubId=${hub.hmsHubId}`);
          return { hub, loading: false, data, lastLoadedAt: Date.now(), error: null } satisfies HubSummaryState;
        } catch (error: any) {
          return {
            hub,
            loading: false,
            error: error?.message || "Failed to load HMS summary",
            lastLoadedAt: Date.now(),
          } satisfies HubSummaryState;
        }
      })
    );

    setStates(results);
    setRefreshing(false);
  }, []);

  useEffect(() => {
    loadAll();
    const timer = window.setInterval(loadAll, SUMMARY_POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [loadAll]);

  const totals = useMemo(() => {
    return states.reduce(
      (acc, item) => {
        const d = item.data;
        if (!d || item.error) return acc;
        acc.loaded += 1;
        acc.overall += Number(d.overall?.total || d.volume?.overall || 0);
        acc.fresh += Number(d.fresh?.total || d.volume?.fresh || 0);
        acc.delivered += Number(d.delivered?.total || d.success_delivered?.delivered || 0);
        return acc;
      },
      { loaded: 0, overall: 0, fresh: 0, delivered: 0 }
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
            <div className="rounded-2xl bg-slate-900/80 p-4">
              <p className="text-xs uppercase tracking-wider text-slate-400">Loaded hubs</p>
              <p className="mt-1 text-2xl font-bold">{totals.loaded}/9</p>
            </div>
            <div className="rounded-2xl bg-slate-900/80 p-4">
              <p className="text-xs uppercase tracking-wider text-slate-400">Overall volume</p>
              <p className="mt-1 text-2xl font-bold">{metric(totals.overall)}</p>
            </div>
            <div className="rounded-2xl bg-slate-900/80 p-4">
              <p className="text-xs uppercase tracking-wider text-slate-400">Fresh volume</p>
              <p className="mt-1 text-2xl font-bold">{metric(totals.fresh)}</p>
            </div>
            <div className="rounded-2xl bg-slate-900/80 p-4">
              <p className="text-xs uppercase tracking-wider text-slate-400">Delivered</p>
              <p className="mt-1 text-2xl font-bold">{metric(totals.delivered)}</p>
            </div>
          </div>
        </header>

        <section className="grid gap-4 lg:grid-cols-3">
          {states.map((item) => {
            const d = item.data;
            const locks = lockText(d);
            const sd = d?.sd_before_12;
            const clean = d?.clean_floor_c1 || d?.clean_floor;
            const overall = d?.overall?.total ?? d?.volume?.overall;
            const fresh = d?.fresh?.total ?? d?.volume?.fresh;
            const success = d?.success_delivered?.value ?? d?.successDelivered;
            return (
              <article key={item.hub.slug} className="rounded-3xl border border-white/10 bg-white/[0.05] p-5 shadow-xl shadow-black/10">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">{item.hub.shortName}</p>
                    <h2 className="mt-1 text-xl font-bold">{item.hub.name}</h2>
                    <p className="text-xs text-slate-400">HMS hub ID: {item.hub.hmsHubId}</p>
                  </div>
                  {item.lastLoadedAt && <FreshnessStatus fetchedAt={new Date(item.lastLoadedAt).toISOString()} />}
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
                      <div className="rounded-2xl bg-slate-900/70 p-3"><p className="text-xs text-slate-400">Overall</p><p className="text-xl font-bold">{metric(overall)}</p></div>
                      <div className="rounded-2xl bg-slate-900/70 p-3"><p className="text-xs text-slate-400">Fresh</p><p className="text-xl font-bold">{metric(fresh)}</p></div>
                      <div className="rounded-2xl bg-slate-900/70 p-3"><p className="text-xs text-slate-400">SD&lt;12</p><p className="text-xl font-bold text-cyan-200">{pct(sd?.value ?? sd?.sd_before_12)}</p><p className="mt-1 text-[11px] text-slate-500">{locks.sd}</p></div>
                      <div className="rounded-2xl bg-slate-900/70 p-3"><p className="text-xs text-slate-400">Clean Floor</p><p className="text-xl font-bold text-emerald-200">{pct(clean?.value)}</p><p className="mt-1 text-[11px] text-slate-500">{locks.clean}</p></div>
                    </div>
                    <div className="mt-4 grid grid-cols-2 gap-3 text-sm text-slate-300">
                      <div>Delivered success: <span className="font-semibold text-white">{pct(success)}</span></div>
                      <div>Fetched: <span className="font-semibold text-white">{d?.fetched_at ? new Date(d.fetched_at).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" }) : "-"}</span></div>
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
