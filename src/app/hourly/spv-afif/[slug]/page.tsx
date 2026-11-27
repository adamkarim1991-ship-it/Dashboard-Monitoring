import { notFound } from "next/navigation";
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
  const { slug } = await params;
  const hub = getSpvAfifHub(slug);
  if (!hub) notFound();

  return (
    <DashboardView
      hubId={hub.hmsHubId}
      hubName={hub.name}
      showSubdistrict
      backHref="/hourly/spv-afif"
      publicMode
    />
  );
}
