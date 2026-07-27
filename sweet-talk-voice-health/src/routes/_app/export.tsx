import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useProfile } from "@/hooks/use-profile";
import { analyseGlucoseForExport } from "@/lib/ai.functions";
import { buildClinicalReportPdf, computeExportStats, type ExportLogRow } from "@/lib/export-report";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { FileDown, Loader2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/export")({ component: ExportPage });

function ExportPage() {
  const { user } = useAuth();
  const { data: profile } = useProfile();
  const analyseForExport = useServerFn(analyseGlucoseForExport);
  const today = new Date().toISOString().slice(0, 10);
  const monthAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const [from, setFrom] = useState(monthAgo);
  const [to, setTo] = useState(today);
  const [includeAi, setIncludeAi] = useState(true);
  const [busy, setBusy] = useState(false);

  const exportPdf = async () => {
    if (!user || !profile) return;
    setBusy(true);
    try {
      const fromIso = new Date(from + "T00:00:00").toISOString();
      const toIso = new Date(to + "T23:59:59.999").toISOString();
      const { data: logs, error: logsError } = await supabase
        .from("glucose_logs")
        .select("*")
        .eq("user_id", user.id)
        .gte("logged_at", fromIso)
        .lte("logged_at", toIso)
        .order("logged_at", { ascending: true });
      if (logsError) throw logsError;
      if (!logs?.length) {
        toast.info("No readings in that date range.");
        return;
      }

      const { data: meds } = await supabase.from("medications").select("*").eq("user_id", user.id);

      const exportLogs: ExportLogRow[] = logs.map((l) => ({
        glucose_value: Number(l.glucose_value),
        glucose_unit: l.glucose_unit,
        foods_eaten: l.foods_eaten,
        snacks: l.snacks ?? null,
        comments: l.comments,
        logged_at: l.logged_at,
        entry_tag: l.entry_tag,
      }));

      const stats = computeExportStats(exportLogs, profile);

      let aiNarrative: string | null = null;
      if (includeAi) {
        const statsSummary = [
          `${stats.count} readings over ${stats.daysCovered} days`,
          `avg ${stats.avg} ${profile.glucose_unit}, min ${stats.min}, max ${stats.max}`,
          `${stats.inRangePct}% in range (${stats.lowCount} low, ${stats.highCount} high)`,
          `${stats.onTimeCount} on-time, ${stats.lateCount} late/backdated`,
        ].join("; ");

        const res = await analyseForExport({
          data: {
            logs: exportLogs.map((l) => ({
              glucose_value: l.glucose_value,
              glucose_unit: l.glucose_unit,
              foods_eaten: l.foods_eaten,
              snacks: l.snacks,
              comments: l.comments,
              logged_at: l.logged_at,
            })),
            diabetes_type: profile.diabetes_type || undefined,
            statsSummary,
            targetRange: `${stats.lowThreshold} – ${stats.highThreshold} ${profile.glucose_unit}`,
          },
        });
        aiNarrative = res.narrative;
      }

      const blob = await buildClinicalReportPdf({
        profile,
        from,
        to,
        logs: exportLogs,
        stats,
        medications: (meds || []).map((m) => ({
          name: m.name,
          dosage: m.dosage,
          type: m.type,
          frequency: m.frequency,
        })),
        aiNarrative,
      });

      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `clinical-glucose-report-${from}-to-${to}.pdf`;
      link.click();
      URL.revokeObjectURL(url);
      toast.success("Clinical report downloaded");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Export failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <h1 className="font-display text-3xl">Export</h1>
      <Card className="p-6 space-y-5">
        <div>
          <p className="text-sm text-muted-foreground">
            Download a clinical PDF to share with your doctor. The report includes summary statistics,
            food patterns, patient notes, notable highs and lows, and a full reading log.
          </p>
        </div>

        <div className="flex flex-wrap gap-4">
          <div>
            <Label>From</Label>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <Label>To</Label>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
        </div>

        <div className="rounded-lg border p-4 space-y-2 text-sm">
          <p className="font-medium">Report includes</p>
          <ul className="text-muted-foreground space-y-1 list-disc list-inside">
            <li>Patient profile, medications, and target glucose range</li>
            <li>Summary stats — average, min/max, in-range %, logging adherence</li>
            <li>Time-of-day patterns and recurring food associations</li>
            <li>Patient comments and symptoms</li>
            <li>Notable readings outside target range with food context</li>
            <li>Full detailed log with foods, snacks, and comments</li>
          </ul>
        </div>

        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <Checkbox checked={includeAi} onCheckedChange={(v) => setIncludeAi(v === true)} />
          Include AI clinical observations (may take a few seconds)
        </label>

        <Button onClick={exportPdf} disabled={busy || !profile}>
          {busy ? (
            <>
              <Loader2 className="size-4 mr-1 animate-spin" /> Generating report…
            </>
          ) : (
            <>
              <FileDown className="size-4 mr-1" /> Download clinical PDF
            </>
          )}
        </Button>
      </Card>
    </div>
  );
}
