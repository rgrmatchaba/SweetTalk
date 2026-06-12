import { createFileRoute, useNavigate, redirect } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useProfile } from "@/hooks/use-profile";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/onboarding")({
  ssr: false,
  beforeLoad: async () => {
    const { data } = await supabase.auth.getSession();
    if (!data.session) throw redirect({ to: "/auth" });
  },
  component: Onboarding,
});

interface Med { name: string; dosage: string; frequency: number; type: string }

function Onboarding() {
  const { user } = useAuth();
  const { data: profile } = useProfile();
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [name, setName] = useState("");
  const [type, setType] = useState("Type 2");
  const [unit, setUnit] = useState<"mmol/L" | "mg/dL">("mmol/L");
  const [freq, setFreq] = useState(3);
  const [times, setTimes] = useState<string[]>(["08:00", "13:00", "20:00"]);
  const [meds, setMeds] = useState<Med[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (profile?.onboarded) navigate({ to: "/dashboard", replace: true });
  }, [profile, navigate]);

  useEffect(() => {
    const defaults = ["08:00", "13:00", "18:00", "22:00", "10:00", "15:00"];
    setTimes(Array.from({ length: freq }, (_, i) => times[i] ?? defaults[i] ?? "12:00"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [freq]);

  const save = async () => {
    if (!user) return;
    setSaving(true);
    try {
      const { data: prof, error } = await supabase.from("profiles").update({
        name, diabetes_type: type, glucose_unit: unit,
        recording_frequency: freq, reminder_times: times, onboarded: true,
      }).eq("user_id", user.id).select().single();
      if (error) throw error;
      if (meds.length) {
        const { error: e2 } = await supabase.from("medications").insert(
          meds.map((m) => ({ ...m, profile_id: prof.id, user_id: user.id })),
        );
        if (e2) throw e2;
      }
      toast.success("All set!");
      navigate({ to: "/dashboard", replace: true });
    } catch (e: any) {
      toast.error(e.message);
    } finally { setSaving(false); }
  };

  return (
    <div className="min-h-screen p-4 md:p-8 grid place-items-center" style={{ background: "var(--gradient-warm)" }}>
      <Card className="max-w-2xl w-full p-6 md:p-8">
        <div className="mb-6">
          <p className="text-sm text-muted-foreground">Step {step} of 4</p>
          <h1 className="font-display text-3xl mt-1">Let's set up your profile</h1>
        </div>

        {step === 1 && (
          <div className="space-y-4">
            <div>
              <Label>First name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" />
            </div>
            <div>
              <Label>Type of diabetes</Label>
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
            <div>
              <Label>Preferred glucose unit</Label>
              <Select value={unit} onValueChange={(v) => setUnit(v as any)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="mmol/L">mmol/L</SelectItem>
                  <SelectItem value="mg/dL">mg/dL</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">Add your current medications. You can skip and add later in Profile.</p>
            {meds.map((m, i) => (
              <div key={i} className="grid grid-cols-2 md:grid-cols-4 gap-2 p-3 border rounded-lg">
                <Input placeholder="Name" value={m.name} onChange={(e) => setMeds(meds.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} />
                <Input placeholder="Dosage" value={m.dosage} onChange={(e) => setMeds(meds.map((x, j) => j === i ? { ...x, dosage: e.target.value } : x))} />
                <Input type="number" placeholder="x/day" value={m.frequency} onChange={(e) => setMeds(meds.map((x, j) => j === i ? { ...x, frequency: +e.target.value } : x))} />
                <div className="flex gap-1">
                  <Select value={m.type} onValueChange={(v) => setMeds(meds.map((x, j) => j === i ? { ...x, type: v } : x))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="insulin">Insulin</SelectItem>
                      <SelectItem value="tablet">Tablet</SelectItem>
                      <SelectItem value="combination">Combination</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button size="icon" variant="ghost" onClick={() => setMeds(meds.filter((_, j) => j !== i))}><Trash2 className="size-4" /></Button>
                </div>
              </div>
            ))}
            <Button variant="outline" onClick={() => setMeds([...meds, { name: "", dosage: "", frequency: 1, type: "tablet" }])}>
              <Plus className="size-4 mr-1" /> Add medication
            </Button>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4">
            <Label>How many times per day do you want to record glucose?</Label>
            <Select value={String(freq)} onValueChange={(v) => setFreq(+v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {[1, 2, 3, 4, 5, 6].map((n) => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        )}

        {step === 4 && (
          <div className="space-y-4">
            <Label>Preferred reminder times</Label>
            {times.map((t, i) => (
              <Input key={i} type="time" value={t} onChange={(e) => setTimes(times.map((x, j) => j === i ? e.target.value : x))} />
            ))}
          </div>
        )}

        <div className="flex justify-between mt-8">
          <Button variant="ghost" disabled={step === 1} onClick={() => setStep(step - 1)}>Back</Button>
          {step < 4 ? (
            <Button onClick={() => setStep(step + 1)} disabled={step === 1 && !name}>Continue</Button>
          ) : (
            <Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Finish"}</Button>
          )}
        </div>
      </Card>
    </div>
  );
}
