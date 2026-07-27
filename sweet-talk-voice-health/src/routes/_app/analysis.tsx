import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useProfile } from "@/hooks/use-profile";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Line, LineChart, ResponsiveContainer, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import { useServerFn } from "@tanstack/react-start";
import { analyseGlucose } from "@/lib/ai.functions";
import { Loader2 } from "lucide-react";

export const Route = createFileRoute("/_app/analysis")({ component: Analysis });

function Analysis() {
  const { user } = useAuth();
  const { data: profile } = useProfile();
  const analyse = useServerFn(analyseGlucose);
  const today = new Date().toISOString().slice(0, 10);
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  const [from, setFrom] = useState(weekAgo);
  const [to, setTo] = useState(today);
  const [narrative, setNarrative] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const { data: logs } = useQuery({
    queryKey: ["analysis", user?.id, from, to],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase.from("glucose_logs").select("*")
        .eq("user_id", user!.id)
        .gte("logged_at", from + "T00:00:00")
        .lte("logged_at", to + "T23:59:59")
        .order("logged_at", { ascending: true });
      if (error) throw error;
      return data;
    },
  });

  const runAnalysis = async () => {
    if (!logs?.length) return;
    setLoading(true);
    setError(null);
    setNarrative(null);
    try {
      const res = await analyse({ data: { from, to } });
      setNarrative(res.narrative);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Analysis failed. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const chartData = logs?.map((l) => ({
    time: new Date(l.logged_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit" }),
    value: Number(l.glucose_value),
  })) || [];

  return (
    <div className="space-y-6">
      <h1 className="font-display text-3xl">Analysis</h1>

      <Card className="p-6">
        <div className="flex flex-wrap gap-4 items-end">
          <div><Label>From</Label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
          <div><Label>To</Label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
          <Button onClick={runAnalysis} disabled={loading || !logs?.length}>
            {loading ? <><Loader2 className="size-4 mr-1 animate-spin" /> Analysing…</> : "Run AI analysis"}
          </Button>
        </div>
      </Card>

      <Card className="p-4 sm:p-6">
        <h2 className="font-display text-lg mb-4">Readings ({profile?.glucose_unit})</h2>
        <div className="h-52 sm:h-64">
          <ResponsiveContainer>
            <LineChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.3} vertical={false} />
              <XAxis
                dataKey="time"
                tick={{ fontSize: 10 }}
                tickLine={false}
                axisLine={false}
                tickMargin={6}
                minTickGap={32}
                interval="preserveStartEnd"
              />
              <YAxis
                width={30}
                tick={{ fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                domain={["auto", "auto"]}
              />
              <Tooltip />
              <Line
                type="monotone"
                dataKey="value"
                stroke="var(--color-primary)"
                strokeWidth={2}
                dot={{ r: 2.5 }}
                activeDot={{ r: 5 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Card>

      {error && (
        <Card className="p-6 border-destructive/50 bg-destructive/5">
          <p className="text-sm text-destructive">{error}</p>
        </Card>
      )}

      {narrative && (
        <Card className="p-6">
          <h2 className="font-display text-lg mb-3">AI insights</h2>
          <div className="prose prose-sm max-w-none whitespace-pre-wrap text-foreground">{narrative}</div>
        </Card>
      )}
    </div>
  );
}
