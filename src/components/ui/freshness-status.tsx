"use client";
import React, { useEffect, useState } from "react";
import { Clock, AlertTriangle } from "lucide-react";
import { SUMMARY_STALE_THRESHOLD_MS, SUMMARY_TICK_MS } from "@/lib/constants";

export function FreshnessStatus({ fetchedAt }: { fetchedAt?: string }) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), SUMMARY_TICK_MS);
    return () => clearInterval(t);
  }, []);

  if (!fetchedAt) return null;

  const fetchedDate = new Date(fetchedAt);
  if (isNaN(fetchedDate.getTime())) return null;

  const ageMs = now - fetchedDate.getTime();
  const isStale = ageMs > SUMMARY_STALE_THRESHOLD_MS;

  const timeStr = fetchedDate.toLocaleTimeString("en-GB", {
    timeZone: "Asia/Jakarta",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  });

  return (
    <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full border text-[10px] font-medium transition-colors ${
      isStale ? "bg-red-950/30 text-red-400 border-red-800" : "bg-slate-800/50 text-slate-300 border-slate-700"
    }`}>
      <Clock className="w-3 h-3" />
      <span>HMS (WIB): {timeStr}</span>
      {isStale && (
        <span className="flex items-center gap-1 text-red-400 ml-1">
          <AlertTriangle className="w-3 h-3" />
          STALE
        </span>
      )}
    </div>
  );
}
