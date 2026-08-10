import { TaskDashboard } from "./task-dashboard";

export default function Home() {
  return (
    <main className="app-page-shell overflow-hidden">
      <TaskDashboard mode="manage" />
    </main>
  );
}
