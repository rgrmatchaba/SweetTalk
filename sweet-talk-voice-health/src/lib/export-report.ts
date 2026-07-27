import type { Profile } from "@/hooks/use-profile";

export interface ExportLogRow {
  glucose_value: number;
  glucose_unit: string;
  foods_eaten: string | null;
  snacks: string | null;
  comments: string | null;
  logged_at: string;
  entry_tag: string;
}

export interface DailyAverage {
  date: string;
  avg: number;
  count: number;
}

export interface TimeOfDayBucket {
  period: string;
  avg: number;
  count: number;
}

export interface NotableReading {
  logged_at: string;
  glucose_value: number;
  type: "low" | "high";
  foods_eaten: string | null;
  snacks: string | null;
  comments: string | null;
}

export interface FoodPattern {
  food: string;
  avgGlucose: number;
  count: number;
}

export interface ExportStats {
  count: number;
  daysCovered: number;
  avg: number;
  min: number;
  max: number;
  lowThreshold: number;
  highThreshold: number;
  inRangeCount: number;
  inRangePct: number;
  lowCount: number;
  highCount: number;
  onTimeCount: number;
  lateCount: number;
  dailyAverages: DailyAverage[];
  timeOfDay: TimeOfDayBucket[];
  notableReadings: NotableReading[];
  foodPatterns: FoodPattern[];
  patientComments: string[];
}

const PAGE_HEIGHT = 297;
const MARGIN = 14;
const CONTENT_WIDTH = 182;
const LINE_HEIGHT = 5;

function round1(n: number) {
  return Math.round(n * 10) / 10;
}

function defaultThresholds(unit: string) {
  return unit === "mg/dL" ? { low: 70, high: 180 } : { low: 3.9, high: 10.0 };
}

function timeOfDayPeriod(date: Date): string {
  const hour = date.getHours();
  if (hour >= 5 && hour < 11) return "Morning (5am–11am)";
  if (hour >= 11 && hour < 17) return "Afternoon (11am–5pm)";
  if (hour >= 17 && hour < 22) return "Evening (5pm–10pm)";
  return "Night (10pm–5am)";
}

function tokenizeFoods(text: string | null): string[] {
  if (!text?.trim()) return [];
  return text
    .toLowerCase()
    .split(/[,;]|\band\b/)
    .map((s) => s.trim())
    .filter((s) => s.length > 2 && !/^(none|no|n\/a)$/.test(s));
}

export function computeExportStats(logs: ExportLogRow[], profile: Profile): ExportStats {
  const unit = profile.glucose_unit;
  const defaults = defaultThresholds(unit);
  const lowThreshold = profile.low_glucose_threshold ?? defaults.low;
  const highThreshold = profile.high_glucose_threshold ?? defaults.high;

  const values = logs.map((l) => Number(l.glucose_value));
  const count = values.length;
  const sum = values.reduce((a, b) => a + b, 0);
  const avg = count ? sum / count : 0;
  const min = count ? Math.min(...values) : 0;
  const max = count ? Math.max(...values) : 0;

  const uniqueDays = new Set(logs.map((l) => l.logged_at.slice(0, 10)));
  const inRangeCount = values.filter((v) => v >= lowThreshold && v <= highThreshold).length;
  const lowCount = values.filter((v) => v < lowThreshold).length;
  const highCount = values.filter((v) => v > highThreshold).length;
  const onTimeCount = logs.filter((l) => l.entry_tag === "on_time").length;
  const lateCount = logs.filter((l) => l.entry_tag === "late_entry").length;

  const dailyMap = new Map<string, { sum: number; n: number }>();
  for (const log of logs) {
    const key = log.logged_at.slice(0, 10);
    const bucket = dailyMap.get(key) ?? { sum: 0, n: 0 };
    bucket.sum += Number(log.glucose_value);
    bucket.n += 1;
    dailyMap.set(key, bucket);
  }
  const dailyAverages = [...dailyMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, { sum: s, n }]) => ({ date, avg: round1(s / n), count: n }));

  const todMap = new Map<string, { sum: number; n: number }>();
  for (const log of logs) {
    const period = timeOfDayPeriod(new Date(log.logged_at));
    const bucket = todMap.get(period) ?? { sum: 0, n: 0 };
    bucket.sum += Number(log.glucose_value);
    bucket.n += 1;
    todMap.set(period, bucket);
  }
  const periodOrder = [
    "Morning (5am–11am)",
    "Afternoon (11am–5pm)",
    "Evening (5pm–10pm)",
    "Night (10pm–5am)",
  ];
  const timeOfDay = periodOrder
    .filter((p) => todMap.has(p))
    .map((period) => {
      const { sum: s, n } = todMap.get(period)!;
      return { period, avg: round1(s / n), count: n };
    });

  const notableReadings: NotableReading[] = logs
    .map((l) => {
      const v = Number(l.glucose_value);
      if (v >= lowThreshold && v <= highThreshold) return null;
      return {
        logged_at: l.logged_at,
        glucose_value: v,
        type: (v < lowThreshold ? "low" : "high") as "low" | "high",
        foods_eaten: l.foods_eaten,
        snacks: l.snacks,
        comments: l.comments,
      };
    })
    .filter((r): r is NotableReading => r !== null)
    .sort((a, b) => new Date(a.logged_at).getTime() - new Date(b.logged_at).getTime());

  const foodMap = new Map<string, { sum: number; n: number }>();
  for (const log of logs) {
    const tokens = [...tokenizeFoods(log.foods_eaten), ...tokenizeFoods(log.snacks)];
    for (const food of tokens) {
      const bucket = foodMap.get(food) ?? { sum: 0, n: 0 };
      bucket.sum += Number(log.glucose_value);
      bucket.n += 1;
      foodMap.set(food, bucket);
    }
  }
  const foodPatterns = [...foodMap.entries()]
    .map(([food, { sum: s, n }]) => ({ food, avgGlucose: round1(s / n), count: n }))
    .filter((f) => f.count >= 2)
    .sort((a, b) => b.avgGlucose - a.avgGlucose)
    .slice(0, 8);

  const patientComments = [...new Set(logs.map((l) => l.comments?.trim()).filter(Boolean) as string[])];

  return {
    count,
    daysCovered: uniqueDays.size,
    avg: round1(avg),
    min: round1(min),
    max: round1(max),
    lowThreshold,
    highThreshold,
    inRangeCount,
    inRangePct: count ? round1((inRangeCount / count) * 100) : 0,
    lowCount,
    highCount,
    onTimeCount,
    lateCount,
    dailyAverages,
    timeOfDay,
    notableReadings,
    foodPatterns,
    patientComments,
  };
}

type JsPDFDoc = InstanceType<(typeof import("jspdf"))["default"]>;

function ensureSpace(doc: JsPDFDoc, y: number, needed: number): number {
  if (y + needed > PAGE_HEIGHT - MARGIN) {
    doc.addPage();
    return MARGIN;
  }
  return y;
}

function writeHeading(doc: JsPDFDoc, title: string, y: number): number {
  y = ensureSpace(doc, y, 12);
  doc.setFontSize(13);
  doc.setFont("helvetica", "bold");
  doc.text(title, MARGIN, y);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  return y + 8;
}

function writeLines(doc: JsPDFDoc, lines: string[], y: number): number {
  for (const line of lines) {
    y = ensureSpace(doc, y, LINE_HEIGHT);
    doc.text(line, MARGIN, y);
    y += LINE_HEIGHT;
  }
  return y;
}

function writeParagraph(doc: JsPDFDoc, text: string, y: number): number {
  const wrapped = doc.splitTextToSize(text, CONTENT_WIDTH);
  return writeLines(doc, wrapped, y);
}

function formatFoodContext(foods: string | null, snacks: string | null): string {
  const parts = [foods, snacks && snacks !== "none" ? `Snacks: ${snacks}` : null].filter(Boolean);
  return parts.join(" · ") || "—";
}

export interface ClinicalReportInput {
  profile: Profile;
  from: string;
  to: string;
  logs: ExportLogRow[];
  stats: ExportStats;
  medications: Array<{ name: string; dosage: string | null; type: string | null; frequency: number | null }>;
  aiNarrative?: string | null;
}

export async function buildClinicalReportPdf(input: ClinicalReportInput): Promise<Blob> {
  const { default: jsPDF } = await import("jspdf");
  const autoTable = (await import("jspdf-autotable")).default;
  const { profile, from, to, logs, stats, medications, aiNarrative } = input;
  const unit = profile.glucose_unit;
  const doc = new jsPDF();
  const generatedAt = new Date().toLocaleString();

  let y = MARGIN;
  doc.setFontSize(18);
  doc.setFont("helvetica", "bold");
  doc.text("Clinical Glucose Report", MARGIN, y);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  y += 8;
  doc.text(`Generated ${generatedAt}`, MARGIN, y);
  y += 10;

  doc.setFontSize(10);
  y = writeLines(
    doc,
    [
      `Patient: ${profile.name || "—"}`,
      `Diabetes type: ${profile.diabetes_type || "—"}`,
      `Glucose unit: ${unit}`,
      `Report period: ${from} to ${to}`,
      `Target range: ${stats.lowThreshold} – ${stats.highThreshold} ${unit}`,
      `Recording frequency: ${profile.recording_frequency ?? "—"}x per day`,
    ],
    y,
  );
  y += 4;

  if (medications.length) {
    y = writeHeading(doc, "Medications", y);
    y = writeLines(
      doc,
      medications.map(
        (m) => `• ${m.name}${m.dosage ? ` — ${m.dosage}` : ""} (${m.type || "—"}, ${m.frequency ?? "—"}x/day)`,
      ),
      y,
    );
    y += 4;
  }

  y = writeHeading(doc, "Summary statistics", y);
  y = writeLines(
    doc,
    [
      `Total readings: ${stats.count} across ${stats.daysCovered} day(s)`,
      `Average: ${stats.avg} ${unit} · Min: ${stats.min} · Max: ${stats.max}`,
      `In target range: ${stats.inRangeCount} (${stats.inRangePct}%)`,
      `Below range: ${stats.lowCount} · Above range: ${stats.highCount}`,
      `Logged on time: ${stats.onTimeCount} · Backdated/late: ${stats.lateCount}`,
    ],
    y,
  );
  y += 4;

  if (stats.timeOfDay.length) {
    y = writeHeading(doc, "Time-of-day patterns", y);
    y = writeLines(
      doc,
      stats.timeOfDay.map((t) => `${t.period}: avg ${t.avg} ${unit} (${t.count} reading${t.count === 1 ? "" : "s"})`),
      y,
    );
    y += 4;
  }

  if (stats.foodPatterns.length) {
    y = writeHeading(doc, "Food associations (2+ occurrences)", y);
    y = writeLines(
      doc,
      stats.foodPatterns.map((f) => `• ${f.food}: avg ${f.avgGlucose} ${unit} (${f.count} logs)`),
      y,
    );
    y += 4;
  }

  if (stats.patientComments.length) {
    y = writeHeading(doc, "Patient notes & symptoms", y);
    for (const comment of stats.patientComments.slice(0, 12)) {
      y = writeParagraph(doc, `• ${comment}`, y);
      y += 2;
    }
    y += 2;
  }

  if (aiNarrative) {
    y = writeHeading(doc, "AI clinical observations", y);
    doc.setFontSize(9);
    y = writeParagraph(doc, aiNarrative, y);
    doc.setFontSize(10);
    y += 4;
    doc.setFontSize(8);
    y = writeParagraph(
      doc,
      "AI-generated observations for discussion only — not a diagnosis or treatment recommendation.",
      y,
    );
    doc.setFontSize(10);
    y += 4;
  }

  if (stats.dailyAverages.length) {
    y = ensureSpace(doc, y, 20);
    autoTable(doc, {
      startY: y,
      head: [["Date", "Readings", `Daily avg (${unit})`]],
      body: stats.dailyAverages.map((d) => [d.date, String(d.count), String(d.avg)]),
      styles: { fontSize: 9 },
      margin: { left: MARGIN },
    });
    y = (doc as JsPDFDoc & { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y;
    y += 8;
  }

  if (stats.notableReadings.length) {
    y = writeHeading(doc, "Notable readings (outside target range)", y);
    y = ensureSpace(doc, y, 20);
    autoTable(doc, {
      startY: y,
      head: [["Date/time", "Value", "Type", "Food & snacks", "Comments"]],
      body: stats.notableReadings.map((r) => {
        const d = new Date(r.logged_at);
        return [
          `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`,
          `${r.glucose_value} ${unit}`,
          r.type === "low" ? "Low" : "High",
          formatFoodContext(r.foods_eaten, r.snacks),
          r.comments || "—",
        ];
      }),
      styles: { fontSize: 8 },
      columnStyles: { 3: { cellWidth: 45 }, 4: { cellWidth: 45 } },
      margin: { left: MARGIN },
    });
    y = (doc as JsPDFDoc & { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y;
    y += 8;
  }

  y = writeHeading(doc, "Detailed glucose log", y);
  autoTable(doc, {
    startY: y,
    head: [["Date", "Time", "Value", "Foods", "Snacks", "Comments", "Tag"]],
    body: logs.map((l) => {
      const d = new Date(l.logged_at);
      return [
        d.toLocaleDateString(),
        d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        String(l.glucose_value),
        l.foods_eaten || "—",
        l.snacks && l.snacks !== "none" ? l.snacks : "—",
        l.comments || "—",
        l.entry_tag === "on_time" ? "On time" : "Late",
      ];
    }),
    styles: { fontSize: 7 },
    columnStyles: {
      3: { cellWidth: 28 },
      4: { cellWidth: 22 },
      5: { cellWidth: 35 },
    },
    margin: { left: MARGIN },
  });

  return doc.output("blob");
}
