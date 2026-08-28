import { db } from "@/lib/db";

const HEALTH_SOURCE = "health-auto-export";

// Curated highlight metrics for the compact snapshot — the full daily digest
// (all ~20-30 populated metrics) lives in the Note content below it.
const HIGHLIGHT_METRICS: Array<{ key: string; label: string }> = [
  { key: "step_count", label: "Steps" },
  { key: "active_energy", label: "Active Energy" },
  { key: "resting_heart_rate", label: "Resting HR" },
  { key: "heart_rate_variability", label: "HRV" },
  { key: "sleep_total_hours", label: "Sleep" },
  { key: "walking_running_distance", label: "Distance" },
];

export type HealthMetricPoint = {
  key: string;
  label: string;
  value: number;
  unit: string;
};

export type HealthDailyLogEntry = {
  id: string;
  date: string;
  content: string;
};

export type PersonHealthSummary = {
  latestDate: string;
  metrics: HealthMetricPoint[];
  recentLog: HealthDailyLogEntry[];
  totalReadings: number;
};

export async function getPersonHealthSummary(
  personId: string,
  workspaceId: string,
): Promise<PersonHealthSummary | null> {
  const latest = await db.state.findFirst({
    where: {
      workspaceId,
      entityId: personId,
      entityType: "Person",
      source: HEALTH_SOURCE,
    },
    orderBy: { recordedAt: "desc" },
    select: { recordedAt: true },
  });
  if (!latest) return null;

  const [latestDayStates, recentNotes, totalReadings] = await Promise.all([
    db.state.findMany({
      where: {
        workspaceId,
        entityId: personId,
        entityType: "Person",
        source: HEALTH_SOURCE,
        recordedAt: latest.recordedAt,
      },
      include: { definition: true },
    }),
    db.note.findMany({
      where: {
        workspaceId,
        type: "import",
        metadata: {
          contains: `"${HEALTH_SOURCE}:day:`,
          mode: "insensitive" as const,
        },
      },
      orderBy: { timestamp: "desc" },
      take: 7,
      select: { id: true, timestamp: true, content: true },
    }),
    db.state.count({
      where: {
        workspaceId,
        entityId: personId,
        entityType: "Person",
        source: HEALTH_SOURCE,
      },
    }),
  ]);

  const byKey = new Map(latestDayStates.map((s) => [s.definition.value, s]));
  const metrics: HealthMetricPoint[] = HIGHLIGHT_METRICS.map(
    ({ key, label }) => {
      const state = byKey.get(key);
      if (!state || state.severity === null) return null;
      return {
        key,
        label,
        value: state.severity,
        unit: state.definition.description ?? "",
      };
    },
  ).filter((m): m is HealthMetricPoint => m !== null);

  return {
    latestDate: latest.recordedAt.toISOString(),
    metrics,
    recentLog: recentNotes.map((n) => ({
      id: n.id,
      date: n.timestamp.toISOString(),
      content: n.content,
    })),
    totalReadings,
  };
}
