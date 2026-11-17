import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import DatbuyTab from "@/components/occ/datbuy-tab";

export const dynamic = "force-dynamic";

export default async function EastOccPage() {
  const session = await auth();
  if (!session?.user) {
    redirect(`/login?callbackUrl=${encodeURIComponent("/occ/east")}`);
  }

  return (
    <div className="min-h-screen bg-[#0f172a] text-white">
      <header className="border-b border-slate-800 bg-slate-950/80 px-6 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-emerald-300">EAST OCC</p>
            <h1 className="text-2xl font-bold">Jatinegara + Duren Sawit OCC</h1>
            <p className="mt-1 text-xs text-slate-400">
              Temporary OCC workspace limited to Datbuy lookup for GTL Jatinegara and GTL Duren Sawit. Other East hubs are disabled until shared-team coverage is verified.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href="/occ" className="rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800">Jatinegara OCC</Link>
            <Link href="/occ/duren-sawit" className="rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800">Duren Sawit OCC</Link>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-[1800px]">
        <div className="border-b border-slate-800 bg-slate-900/70 px-6 py-3">
          <span className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white">Datbuy</span>
        </div>
        <DatbuyTab hubId="east" scopeLabel="Jatinegara + Duren Sawit coverage" />
      </main>
    </div>
  );
}
