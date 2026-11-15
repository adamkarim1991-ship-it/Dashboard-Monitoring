import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "OCC Dashboard",
  description: "Operations Control Center Dashboard",
};

export default function OccLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
