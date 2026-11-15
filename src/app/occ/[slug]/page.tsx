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

  return <OccDashboard user={session.user as any} initialHub={hub} />;
}