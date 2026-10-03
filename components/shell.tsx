"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Layers3,
  Send,
  UsersRound,
  List,
  Mail,
  FilePenLine,
  PlugZap,
  Activity,
  LogOut,
  ChevronRight,
  ShieldCheck,
  Settings,
  PanelBottom,
} from "lucide-react";
import { api } from "./common";
const links = [
  ["/audiences", "Audiences", UsersRound],
  ["/campaigns", "Campaigns", Send],
  ["/templates", "Email templates", FilePenLine],
  ["/footers", "Email footers", PanelBottom],
  ["/suppressions", "Suppressions", ShieldCheck],
  ["/archive", "Email archive", Mail],
  ["/lists", "Constant Contact lists", List],
  ["/resubscriptions", "Resubscriptions", UsersRound],
  ["/activity", "Pull history", Activity],
  ["/connections", "Connections", PlugZap],
  ["/settings", "Settings", Settings],
] as const;
export function Shell({
  children,
  email,
}: {
  children: React.ReactNode;
  email: string;
}) {
  const pathname = usePathname();
  return (
    <div className="workspace">
      <aside className="sidebar">
        <div className="sidebar-header">
          <Link href="/audiences" className="brand">
            <span className="brand-symbol">
              <Layers3 size={22} />
            </span>
            <span>
              Force<span className="brand-light">Multiplier</span>
            </span>
          </Link>
          <button
            className="mobile-signout"
            aria-label="Sign out"
            onClick={async () => {
              try {
                await api("auth/logout", "POST");
              } finally {
                window.location.assign("/login");
              }
            }}
          >
            <LogOut size={15} />
          </button>
        </div>
        <nav>
          {links.map(([href, label, Icon]) => (
            <Link
              key={href}
              href={href}
              className={pathname.startsWith(href) ? "active" : ""}
            >
              <Icon size={18} />
              {label}
              {pathname.startsWith(href) && (
                <ChevronRight size={15} className="nav-arrow" />
              )}
            </Link>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <button
            className="signout"
            onClick={async () => {
              try {
                await api("auth/logout", "POST");
                window.location.assign("/login");
              } catch {
                window.location.assign("/login");
              }
            }}
          >
            <span className="avatar">{email[0]?.toUpperCase()}</span>
            <span>{email}</span>
            <LogOut size={16} />
          </button>
        </div>
      </aside>
      <div className="main-shell">
        <main className="main-content">{children}</main>
      </div>
    </div>
  );
}
