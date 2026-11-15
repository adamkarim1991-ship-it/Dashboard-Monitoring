import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import OccDashboard from "@/components/occ/occ-dashboard";
import { getOccHub } from "@/lib/occ-hubs";

export default async function OccPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const hub = getOccHub("jatinegara");
  if (!hub) redirect("/");

  return <OccDashboard user={session.user as any} initialHub={hub} />;
}
