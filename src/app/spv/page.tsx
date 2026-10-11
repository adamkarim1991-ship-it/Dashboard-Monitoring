import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import CoverageView from "@/components/spv/coverage-view";

export default async function SpvDashboard() {
  const session = await auth();
  if (!session?.user || session.user.role !== "SPV") redirect("/");

  return <CoverageView user={session.user as any} />;
}