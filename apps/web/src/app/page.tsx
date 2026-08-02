import { redirect } from "next/navigation";
import { getCurrentSession } from "@/lib/auth-session";
import { TaskDashboard } from "./task-dashboard";

export default async function Home() {
  const session = await getCurrentSession();

  if (!session) {
    redirect("/login");
  }

  return (
    <main className="h-[calc(100dvh-4rem)] overflow-hidden">
      <TaskDashboard mode="manage" />
    </main>
  );
}
