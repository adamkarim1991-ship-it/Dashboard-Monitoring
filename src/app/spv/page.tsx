import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import DashboardView from "@/components/dashboard/dashboard-view";

export default async function SpvDashboard() {
  const session = await auth();
  if (!session?.user || session.user.role !== "SPV") redirect("/");

  return <DashboardView user={session.user} />;
}
