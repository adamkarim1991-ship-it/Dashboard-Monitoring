import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import DashboardView from "@/components/dashboard/dashboard-view";

export default async function ManagerDashboard() {
  const session = await auth();
  if (!session?.user || session.user.role !== "MANAGER") redirect("/");

  return <DashboardView user={session.user} />;
}
