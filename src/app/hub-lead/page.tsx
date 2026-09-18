import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import DashboardView from "@/components/dashboard/dashboard-view";

export default async function HubLeadDashboard() {
  const session = await auth();
  if (!session?.user || session.user.role !== "HUB_LEAD") redirect("/");

  return <DashboardView user={session.user} />;
}
