import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";

export default async function HubLeadDashboard() {
  const session = await auth();
  if (!session?.user || session.user.role !== "HUB_LEAD") redirect("/");

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold">Hub Lead Dashboard</h1>
      <p className="text-gray-600 mt-2">
        Halo {session.user.name}, kamu login sebagai <b>HUB LEAD</b>
      </p>
      <pre className="mt-4 bg-gray-100 p-4 rounded text-xs">
        {JSON.stringify(session.user, null, 2)}
      </pre>
    </div>
  );
}