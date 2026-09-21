"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Layers3,
  UsersRound,
  List,
  PlugZap,
  Activity,
  LogOut,
  ChevronRight,
  ArrowUpRight,
} from "lucide-react";
import { api } from "./common";
const links = [
  ["/audiences", "Audiences", UsersRound],
  ["/lists", "Constant Contact lists", List],
  ["/resubscriptions", "Resubscriptions", UsersRound],
  ["/activity", "Pull history", Activity],
  ["/connections", "Connections", PlugZap],
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
        <Link href="/audiences" className="brand">
          <span className="brand-symbol">
            <Layers3 size={22} />
          </span>
          <span>
            Force<span className="brand-light">Multiplier</span>
          </span>
        </Link>
        <div className="workspace-label">
          <span className="workspace-avatar">F</span>
          <div>
            Your workspace<small>Salesforce + Constant Contact</small>
          </div>
        </div>
        <div className="nav-label">WORKSPACE</div>
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
          <div className="sidebar-tip">
            <div className="tip-dot" />
            Connections come first
            <p>
              Connect your accounts, then bring your first audience into the
              workspace.
            </p>
            <Link href="/connections">
              Manage connections
              <ArrowUpRight size={15} />
            </Link>
          </div>
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
            <span>
              {email}
              <small>Workspace administrator</small>
            </span>
            <LogOut size={16} />
          </button>
        </div>
      </aside>
      <div className="main-shell">
        <div className="topbar">
          <span>
            Workspace <ChevronRight size={13} />{" "}
            <strong>
              {links.find(([href]) => pathname.startsWith(href))?.[1] ??
                "Audience"}
            </strong>
          </span>
          <div className="topbar-actions">
            <span className="topbar-label">
              <span className="status-dot" /> Manual pulls
            </span>
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
        </div>
        <main className="main-content">{children}</main>
        <footer className="footer">
          ForceMultiplier <span>Built for a more connected workflow.</span>
        </footer>
      </div>
    </div>
  );
}
