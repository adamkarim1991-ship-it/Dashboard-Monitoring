"use client";

import { useSession } from "next-auth/react";
import { useState, useTransition } from "react";
import { Building2, Check, ChevronDown, Loader2 } from "lucide-react";
import type { UserHubInfo } from "@/type/auth";

export default function HubSwitcher() {
  const { data: session, status, update } = useSession();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  // Kalau session masih loading, tampilkan skeleton
  if (status === "loading") {
    return (
      <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-white/10 border border-white/20 text-gray-400 text-xs">
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
        <span>Memuat hub...</span>
      </div>
    );
  }

  const hubs = session?.user?.hubs ?? [];
  const activeHubId = session?.user?.activeHubId ?? null;
  const activeHub = hubs.find((h) => h.id === activeHubId) ?? hubs[0];

  if (hubs.length === 0) {
    return (
      <div className="text-[11px] text-amber-300">
        Tidak ada hub akses
      </div>
    );
  }

  // Kalau cuma 1 hub, tampilkan statis
  if (hubs.length === 1) {
    return (
      <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-white/10 border border-white/20 text-white text-xs">
        <Building2 className="w-3.5 h-3.5" />
        <span className="font-medium">{hubs[0].name}</span>
      </div>
    );
  }

  const handleSwitch = (hub: UserHubInfo) => {
    if (hub.id === activeHubId) {
      setOpen(false);
      return;
    }

    startTransition(async () => {
      try {
        // Verifikasi akses di server
        const res = await fetch("/api/hubs/switch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ hubId: hub.id }),
        });

        if (!res.ok) {
          const err = await res.json().catch(() => null);
          alert(err?.error || "Gagal ganti hub");
          return;
        }

        // Update session
        await update({ activeHubId: hub.id });
        setOpen(false);

        // Reload data dashboard
        window.location.reload();
      } catch (e) {
        alert(e instanceof Error ? e.message : "Gagal ganti hub");
      }
    });
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        disabled={pending}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-white/10 border border-white/20 text-white text-xs hover:bg-white/20 transition disabled:opacity-50"
      >
        {pending ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
        ) : (
          <Building2 className="w-3.5 h-3.5" />
        )}
        <span className="font-medium max-w-[180px] truncate">
          {activeHub?.name ?? "Pilih Hub"}
        </span>
        <ChevronDown className="w-3 h-3 opacity-70" />
      </button>

      {open && !pending && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setOpen(false)}
          />
          <div className="absolute right-0 mt-1 z-50 w-64 rounded-md bg-white text-gray-900 shadow-lg border border-gray-200 py-1">
            <div className="px-3 py-1.5 text-[10px] font-semibold text-gray-500 uppercase tracking-wide border-b border-gray-100">
              Pilih Hub ({hubs.length})
            </div>
            {hubs.map((hub) => {
              const isActive = hub.id === activeHubId;
              return (
                <button
                  key={hub.id}
                  type="button"
                  onClick={() => handleSwitch(hub)}
                  className={`w-full text-left px-3 py-2 text-xs hover:bg-gray-50 flex items-center justify-between gap-2 ${
                    isActive ? "bg-blue-50/50" : ""
                  }`}
                >
                  <div className="min-w-0">
                    <div className="font-medium truncate">{hub.name}</div>
                    <div className="text-[10px] text-gray-500">
                      Role: {hub.role}
                    </div>
                  </div>
                  {isActive && (
                    <Check className="w-4 h-4 text-blue-600 flex-shrink-0" />
                  )}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}