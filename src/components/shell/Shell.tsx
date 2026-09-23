"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { clsx } from "clsx";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, useState, type ReactNode } from "react";
import { get, post } from "@/lib/api";
import type { SessionInfo } from "@/lib/session";
import { ROLE_LABEL } from "@/core/auth/rbac";

const SessionCtx = createContext<SessionInfo | null>(null);
export function useSession(): SessionInfo {
  const s = useContext(SessionCtx);
  if (!s) throw new Error("no session");
  return s;
}
export function useCan(permission: string) {
  return useSession().permissions.includes(permission);
}

type NavItem = { href: string; label: string; icon: string; perm?: string; roles?: string[]; section?: string };
const NAV: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: "▦" },
  { href: "/queue", label: "Pickup queue", icon: "⚡", roles: ["ITARANG_ADMIN"] },
  { href: "/leads", label: "Leads & cases", icon: "☰" },
  { href: "/calculator", label: "Energy calculator", icon: "∑" },
  { href: "/eligibility-queue", label: "Eligibility queue", icon: "✓", roles: ["ECOFY_ADMIN", "ITARANG_ADMIN"], section: "Financing" },
  { href: "/financing-queue", label: "Financing queue", icon: "₹", roles: ["ECOFY_ADMIN", "ITARANG_ADMIN"] },
  { href: "/assets", label: "Assets", icon: "◉", roles: ["ECOFY_ADMIN", "ITARANG_ADMIN"] },
  { href: "/calculator/designer", label: "Calculator designer", icon: "⚙", roles: ["ITARANG_ADMIN", "ECOFY_ADMIN"], section: "Admin" },
  { href: "/admin/users", label: "Users & seats", icon: "♟", roles: ["ITARANG_ADMIN", "ECOFY_ADMIN"] },
  { href: "/admin/settings", label: "Settings & masters", icon: "⚒", roles: ["ITARANG_ADMIN", "ECOFY_ADMIN"] },
  { href: "/admin/audit", label: "Audit log", icon: "≡", roles: ["ITARANG_ADMIN", "ECOFY_ADMIN"] },
  { href: "/admin/usage", label: "Usage", icon: "▤", roles: ["ITARANG_ADMIN", "ECOFY_ADMIN"] },
];

export function Shell({ session, children }: { session: SessionInfo; children: ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const bell = useQuery({ queryKey: ["notifications", "unread"], queryFn: () => get<Array<{ id: number; type: string; title: string; body: string | null; caseId: string | null; createdAt: string }>>("/notifications?unread=true&limit=20"), refetchInterval: 30_000 });
  const queueCount = useQuery({ queryKey: ["queue", "count"], queryFn: () => get<Array<{ id: string }>>("/queue?limit=100"), enabled: session.role === "ITARANG_ADMIN", refetchInterval: 60_000 });
  const items = NAV.filter((n) => !n.roles || n.roles.includes(session.role));
  const orgCls = session.org === "ECOFY" ? "bg-ecofy-soft text-ecofy" : "bg-sky-soft text-sky";

  async function logout() {
    try { await post("/auth/logout"); } catch { /* ignore */ }
    router.replace("/login");
  }

  async function markRead(id: number) {
    await post(`/notifications/${id}/read`);
    qc.invalidateQueries({ queryKey: ["notifications"] });
  }

  return (
    <SessionCtx.Provider value={session}>
      <div className="flex h-screen overflow-hidden">
        <aside className="flex w-[220px] shrink-0 flex-col bg-navy text-[#c9dce8]">
          <div className="px-4 py-4">
            <div className="text-[17px] font-bold text-white">iTarang <span className="text-[#3baf7c]">×</span> Ecofy</div>
            <div className="text-[11px] text-[#9dc4db]">RESI · ESS · C&I lead workspace</div>
          </div>
          <nav className="flex-1 space-y-0.5 px-2">
            {items.map((n) => (
              <div key={n.href}>
                {n.section && <div className="mt-3 px-2 pb-1 text-[10.5px] font-bold uppercase tracking-[0.1em] text-[#7fa6bc]">{n.section}</div>}
                <Link href={n.href} className={clsx("flex items-center gap-2 rounded-lg px-2.5 py-2 text-[13.5px] hover:bg-white/10", path === n.href || (n.href !== "/dashboard" && path.startsWith(n.href + "/")) || (n.href === "/leads" && path.startsWith("/cases")) ? "bg-sky text-white" : "")}>
                  <span className="w-4 text-center opacity-80">{n.icon}</span>
                  <span className="flex-1">{n.label}</span>
                  {n.href === "/queue" && queueCount.data?.data?.length ? <span className="rounded-full bg-bad px-1.5 text-[10.5px] font-bold text-white">{queueCount.data.data.length}</span> : null}
                </Link>
              </div>
            ))}
          </nav>
          <div className="border-t border-white/10 px-4 py-3 text-[11.5px]">
            <div className="font-semibold text-white">{session.fullName}</div>
            <div className={clsx("chip mt-1", orgCls)}>{ROLE_LABEL[session.role]}</div>
            <button className="mt-2 text-[11.5px] text-[#9dc4db] hover:text-white" onClick={logout} type="button">Sign out</button>
          </div>
        </aside>
        <main className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-[58px] items-center gap-3 border-b border-line bg-white px-5">
            <h1 className="text-[16px] font-semibold">{items.find((n) => path === n.href || path.startsWith(n.href + "/"))?.label ?? (path.startsWith("/cases") ? "Case" : "Ecofy Lead Workspace")}</h1>
            <div className="ml-auto relative">
              <button className="btn btn-sm" type="button" onClick={() => setOpen((o) => !o)}>
                🔔 {bell.data?.data?.length ? <span className="rounded-full bg-bad px-1.5 text-[10px] font-bold text-white">{bell.data.data.length}</span> : null}
              </button>
              {open && (
                <div className="absolute right-0 z-30 mt-2 w-[360px] card" onMouseLeave={() => setOpen(false)}>
                  <div className="card-h">Notifications <Link className="text-[12px] font-normal text-sky" href="/notifications" onClick={() => setOpen(false)}>All</Link></div>
                  <div className="max-h-[360px] overflow-y-auto">
                    {(bell.data?.data ?? []).length === 0 && <div className="px-4 py-6 text-center text-[12.5px] text-muted">Nothing unread.</div>}
                    {(bell.data?.data ?? []).map((n) => (
                      <div key={n.id} className="border-b border-line px-4 py-2.5 text-[12.5px]">
                        <div className="flex items-start gap-2">
                          <div className="flex-1">
                            <div className="font-semibold">{n.title}</div>
                            {n.body && <div className="text-muted">{n.body}</div>}
                            <div className="mt-0.5 text-[11px] text-muted">{new Date(n.createdAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}</div>
                          </div>
                          <div className="flex flex-col gap-1">
                            {n.caseId && <Link className="text-[11.5px] text-sky" href={`/cases/${n.caseId}`} onClick={() => { markRead(n.id); setOpen(false); }}>Open</Link>}
                            <button className="text-[11.5px] text-muted" type="button" onClick={() => markRead(n.id)}>Read</button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </header>
          <div className="flex-1 overflow-y-auto p-5">{children}</div>
        </main>
      </div>
    </SessionCtx.Provider>
  );
}
