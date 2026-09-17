import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";

export default async function Home() {
  const session = await auth();

  if (!session?.user) {
    redirect("/login");
  }

  switch (session.user.role) {
    case "MANAGER":
      redirect("/manager");
    case "SPV":
      redirect("/spv");
    case "HUB_LEAD":
      redirect("/hub-lead");
    default:
      redirect("/login");
  }
}