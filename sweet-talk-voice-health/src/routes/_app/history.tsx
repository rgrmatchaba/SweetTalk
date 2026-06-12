import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Trash2, Pencil } from "lucide-react";
import { toast } from "sonner";
import { useState } from "react";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/_app/history")({ component: HistoryPage });

function HistoryPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<string | null>(null);
  const [editVal, setEditVal] = useState("");

  const { data: logs, error, isError } = useQuery({
    queryKey: ["history", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase.from("glucose_logs").select("*").eq("user_id", user!.id).order("logged_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  if (isError) {
    return (
      <div className="space-y-4">
        <h1 className="font-display text-3xl">History</h1>
        <p className="text-destructive text-sm">{error?.message || "Could not load history"}</p>
      </div>
    );
  }

  const del = async (id: string) => {
    const { error } = await supabase.from("glucose_logs").delete().eq("id", id);
    if (error) toast.error(error.message);
    else { toast.success("Deleted"); qc.invalidateQueries({ queryKey: ["history"] }); }
  };

  const saveEdit = async (id: string) => {
    const v = parseFloat(editVal);
    if (isNaN(v)) return;
    const { error } = await supabase.from("glucose_logs").update({ glucose_value: v }).eq("id", id);
    if (error) toast.error(error.message);
    else { setEditing(null); qc.invalidateQueries({ queryKey: ["history"] }); }
  };

  return (
    <div className="space-y-4">
      <h1 className="font-display text-3xl">History</h1>
      {!logs?.length && <p className="text-muted-foreground">No entries yet. Log your first reading from the Dashboard.</p>}
      {logs?.map((l) => (
        <Card key={l.id} className="p-4 flex items-center gap-4">
          <div className="flex-1">
            <div className="flex items-baseline gap-3">
              {editing === l.id ? (
                <Input type="number" step="0.1" value={editVal} onChange={(e) => setEditVal(e.target.value)} className="w-24" />
              ) : (
                <span className="font-display text-2xl">{l.glucose_value}</span>
              )}
              <span className="text-sm text-muted-foreground">{l.glucose_unit}</span>
              <span className={`text-xs px-2 py-0.5 rounded ${l.entry_tag === "on_time" ? "bg-success/20 text-success-foreground" : "bg-warning/20"}`}>
                {l.entry_tag === "on_time" ? "On time" : "Late"}
              </span>
            </div>
            <p className="text-xs text-muted-foreground mt-1">{new Date(l.logged_at).toLocaleString()}</p>
            {l.foods_eaten && <p className="text-sm mt-1"><span className="text-muted-foreground">Food: </span>{l.foods_eaten}</p>}
            {l.comments && <p className="text-sm"><span className="text-muted-foreground">Note: </span>{l.comments}</p>}
          </div>
          <div className="flex gap-1">
            {editing === l.id ? (
              <Button size="sm" onClick={() => saveEdit(l.id)}>Save</Button>
            ) : (
              <Button size="icon" variant="ghost" onClick={() => { setEditing(l.id); setEditVal(String(l.glucose_value)); }}><Pencil className="size-4" /></Button>
            )}
            <Button size="icon" variant="ghost" onClick={() => del(l.id)}><Trash2 className="size-4" /></Button>
          </div>
        </Card>
      ))}
    </div>
  );
}
