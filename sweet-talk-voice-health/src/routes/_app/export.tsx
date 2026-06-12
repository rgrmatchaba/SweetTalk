import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useProfile } from "@/hooks/use-profile";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FileDown } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/export")({ component: ExportPage });

function ExportPage() {
  const { user } = useAuth();
  const { data: profile } = useProfile();
  const today = new Date().toISOString().slice(0, 10);
  const monthAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const [from, setFrom] = useState(monthAgo);
  const [to, setTo] = useState(today);
  const [busy, setBusy] = useState(false);

  const exportPdf = async () => {
    if (!user || !profile) return;
    setBusy(true);
    try {
      const fromIso = new Date(from + "T00:00:00").toISOString();
      const toIso = new Date(to + "T23:59:59.999").toISOString();
      const { data: logs, error: logsError } = await supabase.from("glucose_logs").select("*")
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

      const { default: jsPDF } = await import("jspdf");
      const autoTable = (await import("jspdf-autotable")).default;
      const doc = new jsPDF();
      doc.setFontSize(18);
      doc.text("Glucose Log", 14, 18);
      doc.setFontSize(11);
      doc.text(`Patient: ${profile.name || "—"}`, 14, 28);
      doc.text(`Diabetes type: ${profile.diabetes_type || "—"}`, 14, 34);
      doc.text(`Unit: ${profile.glucose_unit}`, 14, 40);
      doc.text(`Range: ${from} to ${to}`, 14, 46);
      doc.text("Medications:", 14, 56);
      (meds || []).forEach((m, i) => {
        doc.text(`  • ${m.name} — ${m.dosage || ""} (${m.type || ""}, ${m.frequency || ""}x/day)`, 14, 62 + i * 6);
      });
      const startY = 62 + (meds?.length || 0) * 6 + 6;
      autoTable(doc, {
        startY,
        head: [["Date", "Time", "Value", "Unit", "Foods", "Comments", "Tag"]],
        body: (logs || []).map((l) => {
          const d = new Date(l.logged_at);
          return [d.toLocaleDateString(), d.toLocaleTimeString(), String(l.glucose_value), l.glucose_unit, l.foods_eaten || "", l.comments || "", l.entry_tag];
        }),
        styles: { fontSize: 9 },
      });
      doc.save(`glucose-log-${from}-to-${to}.pdf`);
      toast.success("PDF exported");
    } catch (e: any) {
      toast.error(e.message);
    } finally { setBusy(false); }
  };

  return (
    <div className="space-y-6">
      <h1 className="font-display text-3xl">Export</h1>
      <Card className="p-6 space-y-4">
        <p className="text-sm text-muted-foreground">Clinical log PDF to share with your doctor.</p>
        <div className="flex gap-4">
          <div><Label>From</Label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
          <div><Label>To</Label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
        </div>
        <Button onClick={exportPdf} disabled={busy}>
          <FileDown className="size-4 mr-1" /> {busy ? "Generating…" : "Download PDF"}
        </Button>
      </Card>
    </div>
  );
}
