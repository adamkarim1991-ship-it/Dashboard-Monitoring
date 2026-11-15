import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import DashboardView from "@/components/dashboard/dashboard-view";
import { OCC_HUBS } from "@/lib/occ-hubs";

export default async function DurenSawitManagerHourly() {
  const session = await auth();
  if (!session?.user) redirect("/login?callbackUrl=/manager/duren-sawit");

  const hub = OCC_HUBS["duren-sawit"];

  return (
    <DashboardView
      user={session.user as any}
      hubId={hub.hmsHubId}
      hubName={hub.name}
      showSubdistrict
    />
  );
}