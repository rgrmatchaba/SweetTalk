import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./use-auth";

export interface Profile {
  id: string;
  user_id: string;
  name: string | null;
  diabetes_type: string | null;
  glucose_unit: "mmol/L" | "mg/dL";
  recording_frequency: number;
  reminder_times: string[];
  onboarded: boolean;
  caregiver_name: string | null;
  caregiver_email: string | null;
  caregiver_phone: string | null;
  caregiver_summary_time: string | null;
}

export function useProfile() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["profile", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase.from("profiles").select("*").eq("user_id", user!.id).maybeSingle();
      if (error) throw error;
      return data as Profile | null;
    },
  });
}
