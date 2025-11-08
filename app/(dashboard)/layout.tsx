import { ReactNode } from "react";

import { Sidebar } from "@/components/sidebar";
import { Topbar } from "@/components/topbar";

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen bg-slate-950">
      <Sidebar />
      <div className="flex w-full flex-col">
        <Topbar />
        <main className="flex-1 overflow-y-auto px-6 pb-12 pt-6 text-slate-100">{children}</main>
      </div>
    </div>
  );
}
