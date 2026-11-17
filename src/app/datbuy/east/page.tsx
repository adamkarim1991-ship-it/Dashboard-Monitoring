import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import DatbuyTab from "@/components/occ/datbuy-tab";

export const dynamic = "force-dynamic";

export default async function SpvEastDatbuyPage() {
  const session = await auth();
  if (!session?.user) {
    redirect(`/login?callbackUrl=${encodeURIComponent("/datbuy/east")}`);
  }

  return (
    <div className="min-h-screen bg-[#0f172a] text-white">
      <header className="border-b border-slate-800 bg-slate-950/80 px-6 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-blue-300">SPV East Coverage</p>
            <h1 className="text-2xl font-bold">Datbuy Hub Coverage</h1>
            <p className="mt-1 text-xs text-slate-400">
              Dedicated Datbuy dashboard for SPV East HMS access. Searches use the authenticated GTL/HMS session and do not store customer data.
            </p>
          </div>
          <Link href="/occ" className="rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800">
            Back to OCC Jatinegara
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-[1800px]">
        <DatbuyTab hubId="all" scopeLabel="SPV East coverage" />
      </main>
    </div>
  );
}
