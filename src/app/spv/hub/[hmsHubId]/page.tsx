import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import DashboardView from "@/components/dashboard/dashboard-view";

export default async function SpvHubDashboard({
  params,
}: {
  params: Promise<{ hmsHubId: string }>;
}) {
  const session = await auth();
  if (!session?.user || session.user.role !== "SPV") redirect("/");

  const { hmsHubId } = await params;

  // Verifikasi user punya akses ke hub ini
  const membership = await prisma.userHub.findFirst({
    where: {
      userId: session.user.id,
      hub: { hmsHubId },
    },
    include: { hub: true },
  });

  if (!membership) {
    redirect("/spv");
  }

  return (
    <DashboardView
      user={session.user as any}
      hubId={hmsHubId}
      hubName={membership.hub.name}
      showSubdistrict={false}
      backHref="/spv"
    />
  );
}
