import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildClinicalReportPdf, computeExportStats, type ExportLogRow } from "../src/lib/export-report";
import type { Profile } from "../src/hooks/use-profile";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(__dirname, "../tmp");

const profile: Profile = {
  id: "test-profile",
  user_id: "test-user",
  name: "Test Patient",
  diabetes_type: "Type 2",
  glucose_unit: "mmol/L",
  recording_frequency: 3,
  reminder_times: [],
  onboarded: true,
  caregiver_name: null,
  caregiver_email: null,
  caregiver_phone: null,
  caregiver_summary_time: null,
  low_glucose_threshold: 3.9,
  high_glucose_threshold: 10.0,
};

const logs: ExportLogRow[] = [
  {
    glucose_value: 5.2,
    glucose_unit: "mmol/L",
    foods_eaten: "oatmeal and berries",
    snacks: "none",
    comments: "felt fine in the morning",
    logged_at: "2026-06-01T08:15:00.000Z",
    entry_tag: "on_time",
  },
  {
    glucose_value: 11.4,
    glucose_unit: "mmol/L",
    foods_eaten: "pasta, garlic bread",
    snacks: "chocolate bar",
    comments: "very thirsty after lunch",
    logged_at: "2026-06-01T13:30:00.000Z",
    entry_tag: "on_time",
  },
  {
    glucose_value: 3.5,
    glucose_unit: "mmol/L",
    foods_eaten: "skipped lunch",
    snacks: "none",
    comments: "shaky and lightheaded",
    logged_at: "2026-06-02T16:45:00.000Z",
    entry_tag: "late_entry",
  },
  {
    glucose_value: 6.8,
    glucose_unit: "mmol/L",
    foods_eaten: "grilled chicken, sweet potato",
    snacks: "apple",
    comments: "energy improved after dinner",
    logged_at: "2026-06-02T19:20:00.000Z",
    entry_tag: "on_time",
  },
];

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

async function main() {
  console.log("Testing computeExportStats…");
  const stats = computeExportStats(logs, profile);

  assert(stats.count === 4, `expected 4 readings, got ${stats.count}`);
  assert(stats.daysCovered === 2, `expected 2 days, got ${stats.daysCovered}`);
  assert(stats.lowCount === 1, `expected 1 low reading, got ${stats.lowCount}`);
  assert(stats.highCount === 1, `expected 1 high reading, got ${stats.highCount}`);
  assert(stats.notableReadings.length === 2, `expected 2 notable readings, got ${stats.notableReadings.length}`);
  assert(stats.patientComments.length === 4, `expected 4 comments, got ${stats.patientComments.length}`);
  assert(stats.dailyAverages.length === 2, `expected 2 daily averages, got ${stats.dailyAverages.length}`);
  assert(stats.timeOfDay.length >= 2, "expected time-of-day buckets");
  console.log("  ✓ stats:", {
    avg: stats.avg,
    inRangePct: stats.inRangePct,
    foodPatterns: stats.foodPatterns.map((f) => f.food),
  });

  console.log("Testing buildClinicalReportPdf…");
  const blob = await buildClinicalReportPdf({
    profile,
    from: "2026-06-01",
    to: "2026-06-02",
    logs,
    stats,
    medications: [{ name: "Metformin", dosage: "500mg", type: "oral", frequency: 2 }],
    aiNarrative:
      "**Overall trend**\nGlucose varied with meals.\n\n**Food & meal patterns**\nPasta correlated with a post-lunch spike.",
  });

  assert(blob.size > 5000, `PDF too small (${blob.size} bytes)`);
  const buffer = Buffer.from(await blob.arrayBuffer());
  assert(buffer.subarray(0, 4).toString() === "%PDF", "output is not a valid PDF");

  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "test-clinical-export.pdf");
  fs.writeFileSync(outPath, buffer);
  console.log(`  ✓ PDF written (${buffer.length} bytes) → ${outPath}`);

  console.log("\nAll export tests passed.");
}

main().catch((err) => {
  console.error("Export test failed:", err);
  process.exit(1);
});
