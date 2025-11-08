"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, Database, Settings } from "lucide-react";
import { clsx } from "clsx";

const navItems = [
  { href: "/reports", label: "Reports", icon: BarChart3 },
  { href: "/contacts", label: "Contacts", icon: Database },
  { href: "/settings", label: "Settings", icon: Settings }
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="hidden min-h-screen w-64 flex-col border-r border-slate-900 bg-slate-950/70 p-6 md:flex">
      <div className="mb-8">
        <h2 className="text-lg font-semibold text-white">Salesforce Sync</h2>
        <p className="text-sm text-slate-400">Choose a report to import contacts</p>
      </div>
      <nav className="space-y-2">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = pathname?.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={clsx(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition",
                isActive ? "bg-slate-900 text-white" : "text-slate-400 hover:bg-slate-900/80 hover:text-white"
              )}
            >
              <Icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="mt-auto hidden text-xs text-slate-500 lg:block">
        Built with Next.js 15, Supabase, and Prisma.
      </div>
    </aside>
  );
}
