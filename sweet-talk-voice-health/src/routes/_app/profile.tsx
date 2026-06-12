import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useProfile } from "@/hooks/use-profile";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/profile")({ component: ProfilePage });

function ProfilePage() {
  const { user } = useAuth();
  const { data: profile } = useProfile();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [type, setType] = useState("Type 2");
  const [unit, setUnit] = useState<"mmol/L" | "mg/dL">("mmol/L");
  const [freq, setFreq] = useState(3);
  const [times, setTimes] = useState<string[]>([]);

  useEffect(() => {
    if (profile) {
      setName(profile.name || "");
      setType(profile.diabetes_type || "Type 2");
      setUnit(profile.glucose_unit);
      setFreq(profile.recording_frequency);
      setTimes(profile.reminder_times || []);
    }
  }, [profile]);

  const { data: meds } = useQuery({
    queryKey: ["meds", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase.from("medications").select("*").eq("user_id", user!.id);
      return data || [];
    },
  });

  const save = async () => {
    const { error } = await supabase.from("profiles").update({
      name, diabetes_type: type, glucose_unit: unit, recording_frequency: freq, reminder_times: times,
    }).eq("user_id", user!.id);
    if (error) toast.error(error.message);
    else { toast.success("Saved"); qc.invalidateQueries({ queryKey: ["profile"] }); }
  };

  const addMed = async () => {
    const { error } = await supabase.from("medications").insert({
      profile_id: profile!.id, user_id: user!.id, name: "New medication", dosage: "", frequency: 1, type: "tablet",
    });
    if (!error) qc.invalidateQueries({ queryKey: ["meds"] });
  };

  const updateMed = async (id: string, patch: any) => {
    await supabase.from("medications").update(patch).eq("id", id);
    qc.invalidateQueries({ queryKey: ["meds"] });
  };

  const delMed = async (id: string) => {
    await supabase.from("medications").delete().eq("id", id);
    qc.invalidateQueries({ queryKey: ["meds"] });
  };

  return (
    <div className="space-y-6">
      <h1 className="font-display text-3xl">Profile</h1>

      <Card className="p-6 space-y-4">
        <h2 className="font-display text-lg">Personal</h2>
        <div><Label>Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div><Label>Diabetes type</Label>
          <Select value={type} onValueChange={setType}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="Type 1">Type 1</SelectItem>
              <SelectItem value="Type 2">Type 2</SelectItem>
              <SelectItem value="Gestational">Gestational</SelectItem>
              <SelectItem value="Other">Other</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div><Label>Preferred unit</Label>
          <Select value={unit} onValueChange={(v) => setUnit(v as any)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="mmol/L">mmol/L</SelectItem>
              <SelectItem value="mg/dL">mg/dL</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div><Label>Recordings per day</Label>
          <Input type="number" min={1} max={8} value={freq} onChange={(e) => {
            const n = +e.target.value;
            setFreq(n);
            setTimes(Array.from({ length: n }, (_, i) => times[i] || "12:00"));
          }} />
        </div>
        <div><Label>Reminder times</Label>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {times.map((t, i) => (
              <Input key={i} type="time" value={t} onChange={(e) => setTimes(times.map((x, j) => j === i ? e.target.value : x))} />
            ))}
          </div>
        </div>
        <Button onClick={save}>Save changes</Button>
      </Card>

      <Card className="p-6 space-y-3">
        <div className="flex justify-between items-center">
          <h2 className="font-display text-lg">Medications</h2>
          <Button size="sm" variant="outline" onClick={addMed}><Plus className="size-4 mr-1" /> Add</Button>
        </div>
        {meds?.map((m) => (
          <div key={m.id} className="grid grid-cols-2 md:grid-cols-5 gap-2 p-3 border rounded-lg">
            <Input value={m.name} onChange={(e) => updateMed(m.id, { name: e.target.value })} />
            <Input placeholder="Dosage" value={m.dosage || ""} onChange={(e) => updateMed(m.id, { dosage: e.target.value })} />
            <Input type="number" value={m.frequency || 1} onChange={(e) => updateMed(m.id, { frequency: +e.target.value })} />
            <Select value={m.type || "tablet"} onValueChange={(v) => updateMed(m.id, { type: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="insulin">Insulin</SelectItem>
                <SelectItem value="tablet">Tablet</SelectItem>
                <SelectItem value="combination">Combination</SelectItem>
              </SelectContent>
            </Select>
            <Button size="icon" variant="ghost" onClick={() => delMed(m.id)}><Trash2 className="size-4" /></Button>
          </div>
        ))}
      </Card>
    </div>
  );
}
