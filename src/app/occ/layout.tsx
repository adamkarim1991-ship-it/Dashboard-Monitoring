import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "OCC Dashboard - Jatinegara",
  description: "Operations Control Center Dashboard for Jatinegara Hub",
};

export default function OccLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}