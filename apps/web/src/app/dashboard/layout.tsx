"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  LayoutDashboard,
  ClipboardList,
    ClipboardCheck,

  Users,
  Car,
  Package,
  Receipt,
  BarChart3,
  UserCog,
  LogOut,
  Search,
  Command,
  Zap,
  ChevronRight,
  CalendarCheck2,
  Kanban,
  Bot,
  Truck,
  ShieldCheck,
} from "lucide-react";
import { useAuth, Role } from "@/lib/auth-context";
import { ROLE_META } from "@/lib/roles";
import { CommandBar } from "@/components/CommandBar";
import { GearLoader } from "@/components/ui";
import { NotificationBell } from "@/components/notifications/NotificationBell";

type NavItem = {
  href: string;
  label: string;
  icon: React.ElementType;
  roles: Role[];
};

const CORE_NAV: NavItem[] = [
  { href: "/dashboard",            label: "Overview",       icon: LayoutDashboard, roles: ["owner","manager","advisor","technician","accountant"] },
  { href: "/dashboard/job-cards",  label: "Job Cards",      icon: ClipboardList,   roles: ["owner","manager","advisor","technician","accountant"] },
  { href: "/dashboard/job-cards/finished-jobs", label: "Finished Jobs", icon: ClipboardCheck, roles: ["owner","manager","advisor","technician","accountant"] },
  { href: "/dashboard/services",   label: "Services",       icon: ClipboardCheck,  roles: ["owner","manager","advisor","technician","accountant"] },
  { href: "/dashboard/workshop",   label: "Workshop Board", icon: Kanban,          roles: ["owner","manager","advisor","technician","accountant"] },
  { href: "/dashboard/technician-assistant", label: "Technician Assistant", icon: Bot, roles: ["owner","manager","advisor","technician"] },
  { href: "/dashboard/customers",  label: "Customers",      icon: Users,           roles: ["owner","manager","advisor","accountant"] },
  { href: "/dashboard/vehicles",   label: "Vehicles",       icon: Car,             roles: ["owner","manager","advisor","accountant"] },
  { href: "/dashboard/inventory",  label: "Inventory",      icon: Package,         roles: ["owner","manager","advisor"] },
  { href: "/dashboard/billing",    label: "Billing",        icon: Receipt,         roles: ["owner","manager","advisor","accountant"] },
  { href: "/dashboard/insurance",  label: "Insurance",      icon: ShieldCheck,     roles: ["owner","manager","advisor"] },
  { href: "/dashboard/reports",    label: "Reports",        icon: BarChart3,       roles: ["owner","manager","advisor","accountant"] },
  { href: "/dashboard/employees",  label: "Employees",      icon: UserCog,         roles: ["owner","manager"] },
  { href: "/dashboard/employees/attendance", label: "Attendance", icon: CalendarCheck2, roles: ["owner","manager"] },
  { href: "/dashboard/suppliers",  label: "Suppliers",      icon: Truck,           roles: ["owner","manager"] },
  { href: "/dashboard/users",      label: "Users & Roles",  icon: UserCog,         roles: ["owner","manager"] },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { user, role, branchId, loading, roleResolved, logout } = useAuth();
  const router   = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [user, loading, router]);

  useEffect(() => {
    if (!user || !roleResolved) return;
    if (role) return;
    (async () => {
      const ref  = doc(db, "users", user.uid);
      const snap = await getDoc(ref);
      if (!snap.exists()) {
        await setDoc(ref, {
          role: "pending", branchId: "main",
          displayName: user.displayName ?? user.email ?? "",
          email: user.email ?? "", active: false,
          createdAt: serverTimestamp(),
        }).catch(() => {});
      }
    })();
  }, [user, role, roleResolved]);

  if (loading || !user || !roleResolved) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-canvas">
        <div className="flex flex-col items-center gap-4">
          <GearLoader size={52} />
          <p className="text-sm text-ink-faint">Loading workspace…</p>
        </div>
      </div>
    );
  }

  if (!role || role === "pending" || role === "customer") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-canvas px-6">
        <div className="card max-w-md p-8 text-center shadow-luxe">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-burgundy-deep text-white shadow-luxe">
            <UserCog size={26} />
          </div>
          <h1 className="font-serif text-2xl font-semibold text-ink">
            {role === "customer" ? "Customer portal coming soon" : "Waiting for access"}
          </h1>
          <p className="mt-2 font-sans text-sm text-ink-soft">
            {role === "customer"
              ? "Customer accounts will use a dedicated self-service portal in a later release."
              : "Your account is registered. An owner or manager needs to assign you a role before you can start."}
          </p>
          <p className="mt-4 font-sans text-xs text-ink-faint">Signed in as {user.email}</p>
          <button onClick={() => logout()} className="btn-ghost mt-6">
            <LogOut size={16} /> Sign out
          </button>
        </div>
      </div>
    );
  }

  const visibleNav = CORE_NAV.filter((n) => !role || n.roles.includes(role));
  const roleLabel  = role ? ROLE_META[role].label : "No role assigned";
  const initials   = (user.displayName ?? user.email ?? "?")[0]?.toUpperCase();

  return (
    <div className="flex min-h-screen bg-canvas">
      <CommandBar />

      <aside className="relative hidden w-64 flex-col border-r border-white/5 lg:flex overflow-hidden"
        style={{ background: "linear-gradient(180deg, #1A1D2E 0%, #20243A 50%, #1A1D2E 100%)" }}
      >
        <div className="pointer-events-none absolute -top-12 left-1/2 h-32 w-48 -translate-x-1/2 rounded-full bg-burgundy-400/10 blur-3xl" />

        <div className="relative flex items-center gap-3 px-5 py-5 border-b border-white/8">
          <div className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-burgundy-deep text-white text-sm font-bold shadow-glow">
            B
          </div>
          <div>
            <p className="text-[14px] font-bold leading-none tracking-tight text-white">Belt-Kit</p>
            <p className="mt-1 text-[9px] uppercase tracking-[0.25em] text-white/40">Garage ERP</p>
          </div>
        </div>

        <div className="px-3 pt-4 pb-2">
          <button
            onClick={() =>
              window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true }))
            }
            className="flex w-full items-center gap-2.5 rounded-xl border border-white/10 bg-white/6 px-3 py-2 text-[12px] text-white/40 transition-all duration-200 hover:border-white/20 hover:text-white/70 hover:bg-white/10"
          >
            <Search size={13} className="shrink-0" />
            <span className="flex-1 text-left">Search…</span>
            <kbd className="flex items-center gap-0.5 rounded border border-white/10 bg-white/8 px-1.5 py-0.5 text-[9px] font-medium text-white/40">
              <Command size={8} />K
            </kbd>
          </button>
        </div>

        <div className="px-5 pt-3 pb-1.5 flex items-center gap-2 text-[9px] font-semibold uppercase tracking-[0.18em] text-white/30">
          <Zap size={9} className="text-burgundy-400" />
          Workspace
        </div>
        <nav className="flex-1 space-y-0.5 px-2 overflow-y-auto">
          {visibleNav.map((item) => {
            const active =
              pathname === item.href ||
              (item.href !== "/dashboard" && pathname.startsWith(item.href));
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-150 ${
                  active
                    ? "bg-white/10 text-white"
                    : "text-white/50 hover:bg-white/5 hover:text-white/80"
                }`}
              >
                <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition-colors ${
                  active ? "bg-white/15 text-white" : "bg-white/6 text-white/40"
                }`}>
                  <Icon size={14} />
                </span>
                <span className="flex-1 text-[13px]">{item.label}</span>
                {active && (
                  <span className="h-1.5 w-1.5 rounded-full bg-burgundy-400 shadow-glow" />
                )}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-white/8 p-3">
          <div className="flex items-center gap-2.5 rounded-xl bg-white/6 px-3 py-2.5">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
              style={{ background: "linear-gradient(135deg, #6941F0, #F59000)" }}>
              {initials}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[12px] font-semibold text-white/85">
                {user.displayName ?? user.email?.split("@")[0]}
              </p>
              <p className="truncate text-[10px] text-white/40">{roleLabel}</p>
            </div>
            <button
              onClick={() => logout()}
              className="rounded-lg p-1.5 text-white/40 transition hover:bg-white/10 hover:text-rose-400"
              title="Sign out"
            >
              <LogOut size={13} />
            </button>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-line bg-white px-6 py-4 lg:hidden">
          <span className="text-[15px] font-bold tracking-tight text-ink">Belt-Kit</span>
          <div className="flex items-center gap-2">
            <NotificationBell />
            <button onClick={() => logout()} className="p-2 text-ink-soft hover:text-burgundy-500" aria-label="Sign out">
              <LogOut size={18} />
            </button>
          </div>
        </header>

        <div className="hidden lg:flex items-center justify-between border-b border-line bg-white px-8 py-3 shadow-soft">
          <div className="flex items-center gap-2 text-xs text-ink-faint">
            <span className="font-semibold text-ink">Dashboard</span>
            <ChevronRight size={12} />
            <span>{CORE_NAV.find((n) => n.href === pathname)?.label ?? "Overview"}</span>
          </div>
          <NotificationBell />
        </div>

        <motion.main
          key={pathname}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
          className="flex-1 px-6 py-6 lg:px-8 lg:py-8"
        >
          {children}
        </motion.main>
      </div>
    </div>
  );
}
