"use client";

import { useMemo, useState } from "react";

export default function DatbuyAccessPage() {
  const [key, setKey] = useState("");
  const next = useMemo(() => {
    if (typeof window === "undefined") return "/datbuy/east";
    const params = new URLSearchParams(window.location.search);
    return params.get("next") || "/datbuy/east";
  }, []);

  return (
    <div className="mx-auto max-w-xl space-y-4 p-6 text-gray-100">
      <h1 className="text-2xl font-bold">Datbuy Access</h1>
      <p className="text-sm text-gray-300">
        This Datbuy page is restricted. Please enter the team access key.
      </p>
      <div className="rounded-xl border border-slate-700 bg-slate-900 p-4">
        <label className="block text-xs font-semibold text-gray-300">Access key</label>
        <input
          className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
          placeholder="Enter access key"
          value={key}
          onChange={(e) => setKey(e.target.value)}
        />
        <button
          className="mt-3 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-500"
          onClick={() => {
            // key is sent via query once, middleware will set cookie and strip it.
            window.location.href = `${next}${next.includes("?") ? "&" : "?"}key=${encodeURIComponent(key)}`;
          }}
        >
          Continue
        </button>
      </div>
      <p className="text-xs text-gray-400">
        Tip: after successful access, you will not need to enter the key again on this device.
      </p>
    </div>
  );
}
