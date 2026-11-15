import { auth } from "@/lib/auth";
import { redirect, notFound } from "next/navigation";
import OccDashboard from "@/components/occ/occ-dashboard";
import { getOccHub } from "@/lib/occ-hubs";

export default async function OccHubPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const { slug } = await params;
  const hub = getOccHub(slug);
  if (!hub) notFound();

  const user = session.user as any;
  const accessibleHmsHubIds = (user.hmsHubIds ?? []).map(String);
  if (accessibleHmsHubIds.length > 0 && !accessibleHmsHubIds.includes(hub.hmsHubId)) {
    redirect("/occ");
  }

  return <OccDashboard user={user} initialHub={hub} />;
}
