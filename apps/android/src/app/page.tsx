import { TaskDashboard } from "./task-dashboard";

export default function Home() {
  return (
    <main className="h-[calc(100dvh-4rem)] overflow-hidden">
      <TaskDashboard mode="manage" />
    </main>
  );
}
