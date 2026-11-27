import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import SpvAfifHourlyView from "@/components/hourly/spv-afif-hourly-view";

export default async function SpvAfifHourlyPage() {
  const session = await auth();
  if (!session?.user) redirect("/login?callbackUrl=/hourly/spv-afif");

  return <SpvAfifHourlyView />;
}
