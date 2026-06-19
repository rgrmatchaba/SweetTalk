import { AlertTriangle, ArrowDown, ArrowUp, X } from "lucide-react";
import { Button } from "@/components/ui/button";

interface GlucoseAlertModalProps {
  reading: number;
  unit: string;
  type: "low" | "high";
  onDismiss: () => void;
}

const LOW_CONFIG = {
  icon: ArrowDown,
  bg: "bg-red-600",
  badge: "bg-red-800 text-red-100",
  label: "DANGEROUSLY LOW",
  headline: "Your glucose is critically low",
  advice: [
    "Eat or drink 15 g of fast-acting carbohydrates immediately",
    "Examples: 3–4 glucose tablets, 150 ml fruit juice, or 5–6 hard candies",
    "Sit down and rest — do not drive or operate machinery",
    "Re-check your glucose in 15 minutes",
    "If you feel unable to swallow, contact emergency services or your caregiver now",
  ],
  dismissLabel: "I understand — I'm treating it now",
};

const HIGH_CONFIG = {
  icon: ArrowUp,
  bg: "bg-amber-600",
  badge: "bg-amber-800 text-amber-100",
  label: "DANGEROUSLY HIGH",
  headline: "Your glucose is very high",
  advice: [
    "Drink plenty of water to help flush excess sugar",
    "Take your prescribed medication if the time is right — do not double-dose",
    "Avoid carbohydrates and sugary foods right now",
    "Light activity (a short walk) can help lower glucose",
    "If your reading stays high or you feel unwell, contact your doctor",
  ],
  dismissLabel: "I understand — I'll manage it now",
};

export function GlucoseAlertModal({ reading, unit, type, onDismiss }: GlucoseAlertModalProps) {
  const config = type === "low" ? LOW_CONFIG : HIGH_CONFIG;
  const Icon = config.icon;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/70" />

      {/* Modal */}
      <div className={`relative w-full max-w-md rounded-2xl ${config.bg} text-white shadow-2xl`}>
        {/* Header */}
        <div className="flex items-start justify-between p-6 pb-4">
          <div className="flex items-center gap-3">
            <div className="rounded-full bg-white/20 p-3">
              <AlertTriangle className="size-7" />
            </div>
            <div>
              <span className={`text-xs font-bold tracking-widest uppercase px-2 py-0.5 rounded-full ${config.badge}`}>
                {config.label}
              </span>
              <h2 className="text-xl font-bold mt-1">{config.headline}</h2>
            </div>
          </div>
        </div>

        {/* Reading */}
        <div className="mx-6 mb-4 rounded-xl bg-white/15 px-5 py-4 flex items-center gap-3">
          <Icon className="size-8 shrink-0" />
          <div>
            <p className="text-sm opacity-80">Logged reading</p>
            <p className="text-3xl font-bold tracking-tight">
              {reading} <span className="text-lg font-normal opacity-80">{unit}</span>
            </p>
          </div>
        </div>

        {/* Advice */}
        <div className="mx-6 mb-6 space-y-2">
          <p className="text-sm font-semibold opacity-90 uppercase tracking-wide">What to do now</p>
          <ul className="space-y-2">
            {config.advice.map((step, i) => (
              <li key={i} className="flex items-start gap-2 text-sm leading-snug">
                <span className="mt-0.5 shrink-0 size-5 rounded-full bg-white/20 flex items-center justify-center text-xs font-bold">
                  {i + 1}
                </span>
                {step}
              </li>
            ))}
          </ul>
        </div>

        {/* Dismiss */}
        <div className="px-6 pb-6">
          <Button
            className="w-full bg-white text-gray-900 hover:bg-white/90 font-semibold"
            onClick={onDismiss}
          >
            <X className="size-4 mr-2" />
            {config.dismissLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
