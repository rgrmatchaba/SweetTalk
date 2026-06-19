import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useProfile } from "@/hooks/use-profile";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Bar, BarChart, ResponsiveContainer, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
// import { VoiceAgent } from "@/components/voice-agent";
import { ChatAgent } from "@/components/chat-agent";
import { GlucoseAlertModal } from "@/components/glucose-alert-modal";
import { Bell, Check } from "lucide-react";

export const Route = createFileRoute("/_app/dashboard")({ component: Dashboard });

// type AgentTab = "voice" | "chat";

function Dashboard() {
  const { user } = useAuth();
  const { data: profile } = useProfile();
  const qc = useQueryClient();
  // const [tab, setTab] = useState<AgentTab>("voice");
  const [glucoseAlert, setGlucoseAlert] = useState<{ reading: number; type: "low" | "high" } | null>(null);
  const lastLogCountRef = useRef<number | null>(null);

  const { data: notifications } = useQuery({
    queryKey: ["notifications", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("notifications")
        .select("id, type, message, read, created_at")
        .eq("user_id", user!.id)
        .order("created_at", { ascending: false })
        .limit(10);
      if (error) throw error;
      return data;
    },
  });

  const markRead = async (id: string) => {
    await supabase.from("notifications").update({ read: true }).eq("id", id);
    qc.invalidateQueries({ queryKey: ["notifications", user?.id] });
  };

  const unread = notifications?.filter((n) => !n.read) ?? [];

  const { data: logs } = useQuery({
    queryKey: ["dashboard-logs", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const since = new Date(Date.now() - 7 * 86400000).toISOString();
      const { data, error } = await supabase
        .from("glucose_logs")
        .select("glucose_value, logged_at")
        .eq("user_id", user!.id)
        .gte("logged_at", since)
        .order("logged_at", { ascending: true });
      if (error) throw error;
      return data;
    },
  });

  // Fire alert whenever a NEW reading appears (agent invalidates this query after saving).
  useEffect(() => {
    if (!logs || !profile) return;
    const prev = lastLogCountRef.current;
    const curr = logs.length;
    lastLogCountRef.current = curr;

    // Only check on an increase (new entry was added), not on initial load.
    if (prev === null || curr <= prev) return;

    const newest = logs[logs.length - 1];
    if (!newest) return;
    const val = Number(newest.glucose_value);
    const low = profile.low_glucose_threshold ?? (profile.glucose_unit === "mg/dL" ? 70 : 3.9);
    const high = profile.high_glucose_threshold ?? (profile.glucose_unit === "mg/dL" ? 180 : 10.0);

    if (val < low) setGlucoseAlert({ reading: val, type: "low" });
    else if (val > high) setGlucoseAlert({ reading: val, type: "high" });
  }, [logs, profile]);

  const chartData = (() => {
    const buckets: Record<string, { sum: number; n: number }> = {};
    const days: string[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86400000);
      const key = d.toISOString().slice(0, 10);
      buckets[key] = { sum: 0, n: 0 };
      days.push(key);
    }
    logs?.forEach((l) => {
      const key = new Date(l.logged_at).toISOString().slice(0, 10);
      if (buckets[key]) {
        buckets[key].sum += Number(l.glucose_value);
        buckets[key].n += 1;
      }
    });
    return days.map((k) => ({
      day: new Date(k).toLocaleDateString(undefined, { weekday: "short" }),
      avg: buckets[k].n ? +(buckets[k].sum / buckets[k].n).toFixed(1) : 0,
    }));
  })();

  return (
    <div className="space-y-6">
      {glucoseAlert && (
        <GlucoseAlertModal
          reading={glucoseAlert.reading}
          unit={profile?.glucose_unit ?? "mmol/L"}
          type={glucoseAlert.type}
          onDismiss={() => setGlucoseAlert(null)}
        />
      )}

      <div>
        <h1 className="font-display text-3xl">Hi {profile?.name || "there"}</h1>
        <p className="text-muted-foreground">Your glucose at a glance.</p>
      </div>

      {notifications && notifications.length > 0 && (
        <Card className="p-6 space-y-3">
          <h2 className="font-display text-lg flex items-center gap-2">
            <Bell className="size-4" />
            Notifications
            {unread.length > 0 && (
              <span className="text-xs font-normal rounded-full bg-primary text-primary-foreground px-2 py-0.5">
                {unread.length} new
              </span>
            )}
          </h2>
          <div className="space-y-2">
            {notifications.map((n) => (
              <div
                key={n.id}
                className={`flex items-start justify-between gap-3 p-3 rounded-lg border text-sm ${
                  n.read ? "text-muted-foreground" : "bg-muted"
                }`}
              >
                <div>
                  <p>{n.message}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {new Date(n.created_at).toLocaleString()}
                  </p>
                </div>
                {!n.read && (
                  <Button size="icon" variant="ghost" onClick={() => markRead(n.id)} title="Mark as read">
                    <Check className="size-4" />
                  </Button>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card className="p-6">
        <h2 className="font-display text-lg mb-1">Last 7 days</h2>
        <p className="text-sm text-muted-foreground mb-4">Daily average ({profile?.glucose_unit})</p>
        <div className="h-56">
          <ResponsiveContainer>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
              <XAxis dataKey="day" />
              <YAxis />
              <Tooltip />
              <Bar dataKey="avg" fill="var(--color-primary)" radius={[8, 8, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>

      {/* Chat agent — voice tab hidden while we focus on chat */}
      <div>
        {/* Voice / Chat toggle — re-enable when voice is ready
        <div className="flex gap-1 p-1 bg-muted rounded-xl w-fit mb-4">
          <button onClick={() => setTab("voice")} ...>Voice</button>
          <button onClick={() => setTab("chat")} ...>Chat</button>
        </div>
        {tab === "voice" ? <VoiceAgent /> : <ChatAgent />}
        */}
        <ChatAgent />
      </div>
    </div>
  );
}
