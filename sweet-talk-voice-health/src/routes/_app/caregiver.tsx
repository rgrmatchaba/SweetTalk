import { createFileRoute } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useProfile } from "@/hooks/use-profile";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { HeartHandshake } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/caregiver")({ component: CaregiverPage });

function CaregiverPage() {
  const { user } = useAuth();
  const { data: profile } = useProfile();
  const qc = useQueryClient();

  const [caregiverName, setCaregiverName] = useState("");
  const [caregiverEmail, setCaregiverEmail] = useState("");
  const [caregiverPhone, setCaregiverPhone] = useState("");
  const [caregiverSummaryTime, setCaregiverSummaryTime] = useState("21:00");

  useEffect(() => {
    if (profile) {
      setCaregiverName(profile.caregiver_name || "");
      setCaregiverEmail(profile.caregiver_email || "");
      setCaregiverPhone(profile.caregiver_phone || "");
      setCaregiverSummaryTime(profile.caregiver_summary_time || "21:00");
    }
  }, [profile]);

  const saveCaregiver = async () => {
    const email = caregiverEmail.trim();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      toast.error("That doesn't look like a valid email address");
      return;
    }
    const { error } = await supabase.from("profiles").update({
      caregiver_name: caregiverName.trim() || null,
      caregiver_email: email || null,
      caregiver_phone: caregiverPhone.trim() || null,
      caregiver_summary_time: caregiverSummaryTime,
    }).eq("user_id", user!.id);
    if (error) toast.error(error.message);
    else { toast.success("Caregiver details saved"); qc.invalidateQueries({ queryKey: ["profile"] }); }
  };

  const removeCaregiver = async () => {
    const { error } = await supabase.from("profiles").update({
      caregiver_name: null,
      caregiver_email: null,
      caregiver_phone: null,
    }).eq("user_id", user!.id);
    if (error) toast.error(error.message);
    else {
      setCaregiverName("");
      setCaregiverEmail("");
      setCaregiverPhone("");
      toast.success("Caregiver removed");
      qc.invalidateQueries({ queryKey: ["profile"] });
    }
  };

  const hasCaregiver = !!(profile?.caregiver_email || profile?.caregiver_phone);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl flex items-center gap-2">
          <HeartHandshake className="size-7 text-primary" />
          Caregiver
        </h1>
        <p className="text-muted-foreground">
          Share daily summaries of your readings, food, and notes with someone who supports your care.
        </p>
      </div>

      <Card className="p-6 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <Label>Caregiver name</Label>
            <Input value={caregiverName} onChange={(e) => setCaregiverName(e.target.value)} placeholder="e.g. Mom" />
          </div>
          <div>
            <Label>Summary sent at</Label>
            <Input type="time" value={caregiverSummaryTime} onChange={(e) => setCaregiverSummaryTime(e.target.value)} />
          </div>
          <div>
            <Label>Email address</Label>
            <Input type="email" value={caregiverEmail} onChange={(e) => setCaregiverEmail(e.target.value)} placeholder="caregiver@example.com" />
          </div>
          <div>
            <Label>Phone number</Label>
            <Input type="tel" value={caregiverPhone} onChange={(e) => setCaregiverPhone(e.target.value)} placeholder="+1 555 123 4567" />
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Phone number is stored for future SMS/WhatsApp support — daily summaries are currently sent by email only.
        </p>
        <div className="flex gap-2">
          <Button onClick={saveCaregiver}>Save caregiver details</Button>
          {hasCaregiver && (
            <Button variant="outline" onClick={removeCaregiver}>Remove caregiver</Button>
          )}
        </div>
      </Card>

      <Card className="p-6 space-y-2">
        <h2 className="font-display text-lg">How it works</h2>
        <p className="text-sm text-muted-foreground">
          Every day around the time you choose, a summary of your glucose readings, food, and any notes from
          that day is emailed to your caregiver's address. You can update or remove these details at any time —
          your caregiver will only receive summaries while an email address is on file.
        </p>
      </Card>
    </div>
  );
}
