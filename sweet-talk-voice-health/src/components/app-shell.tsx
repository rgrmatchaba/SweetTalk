import { Link, useRouterState } from "@tanstack/react-router";
import { LayoutDashboard, History, LineChart, User, FileDown, LogOut, Mic, HeartHandshake } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

const NAV = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/history", label: "History", icon: History },
  { to: "/analysis", label: "Analysis", icon: LineChart },
  { to: "/profile", label: "Profile", icon: User },
  { to: "/caregiver", label: "Caregiver", icon: HeartHandshake },
  { to: "/export", label: "Export", icon: FileDown },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  const { location } = useRouterState();

  return (
    <div className="flex min-h-screen bg-background">
      {/* Desktop sidebar */}
      <aside className="hidden md:flex w-64 shrink-0 flex-col border-r bg-sidebar p-5">
        <div className="flex items-center gap-2 mb-8">
          <div className="size-9 rounded-xl bg-primary text-primary-foreground grid place-items-center">
            <Mic className="size-5" />
          </div>
          <div>
            <h1 className="font-display text-xl text-sidebar-foreground leading-none">Sweet Talk</h1>
            <p className="text-xs text-muted-foreground mt-1">Voice glucose log</p>
          </div>
        </div>
        <nav className="flex flex-col gap-1 flex-1">
          {NAV.map((n) => {
            const active = location.pathname === n.to;
            return (
              <Link
                key={n.to}
                to={n.to}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors",
                  active
                    ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                    : "text-sidebar-foreground/80 hover:bg-sidebar-accent/50",
                )}
              >
                <n.icon className="size-4" />
                {n.label}
              </Link>
            );
          })}
        </nav>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => supabase.auth.signOut()}
          className="justify-start gap-2 text-muted-foreground hover:text-foreground"
        >
          <LogOut className="size-4" /> Sign out
        </Button>
      </aside>

      {/* Mobile top */}
      <div className="md:hidden fixed top-0 inset-x-0 z-20 bg-sidebar/95 backdrop-blur border-b px-4 h-14 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="size-8 rounded-lg bg-primary text-primary-foreground grid place-items-center">
            <Mic className="size-4" />
          </div>
          <h1 className="font-display text-lg">Sweet Talk</h1>
        </div>
        <Button variant="ghost" size="icon" onClick={() => supabase.auth.signOut()}>
          <LogOut className="size-4" />
        </Button>
      </div>

      <main className="flex-1 md:p-8 p-4 pt-20 md:pt-8 pb-24 md:pb-8 max-w-6xl mx-auto w-full">
        {children}
      </main>

      {/* Mobile bottom nav */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-20 bg-sidebar border-t flex justify-around py-2">
        {NAV.map((n) => {
          const active = location.pathname === n.to;
          return (
            <Link
              key={n.to}
              to={n.to}
              className={cn(
                "flex flex-col items-center gap-1 px-3 py-1.5 rounded-lg text-[11px]",
                active ? "text-primary" : "text-muted-foreground",
              )}
            >
              <n.icon className="size-5" />
              {n.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
