import { auth } from "@/lib/auth";
import { redirect, notFound } from "next/navigation";
import DashboardView from "@/components/dashboard/dashboard-view";
import { getSpvAfifHub, SPV_AFIF_HUBS } from "@/lib/spv-afif-hubs";

export function generateStaticParams() {
  return SPV_AFIF_HUBS.map((hub) => ({ slug: hub.slug }));
}

export default async function SpvAfifHubHourlyPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const session = await auth();
  const { slug } = await params;
  if (!session?.user) redirect(`/login?callbackUrl=/hourly/spv-afif/${slug}`);

  const hub = getSpvAfifHub(slug);
  if (!hub) notFound();

  return (
    <DashboardView
      user={session.user as any}
      hubId={hub.hmsHubId}
      hubName={hub.name}
      showSubdistrict
      backHref="/hourly/spv-afif"
    />
  );
}
