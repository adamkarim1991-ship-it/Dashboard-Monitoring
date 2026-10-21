import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import OccDashboard from "@/components/occ/occ-dashboard";

export default async function OccPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  
  return <OccDashboard user={session.user as any} />;
}