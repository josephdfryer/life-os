// Taxonomy of Apple Health daily metrics ingested as State rows.
// Selected as the columns in HealthAutoExport's daily aggregate CSV that are
// populated on >50% of days across a real 91-day export (see health-sync.ts).
// Sparse manual-entry columns (nutrition, vitamins, weight, blood pressure,
// VO2 max, etc.) are intentionally excluded — revisit if tracked consistently.

export type MetricGroup = "activity" | "heart" | "vitals" | "sleep" | "mobility" | "environmental"

export type MetricDefinition = {
  key: string
  column: string
  group: MetricGroup
  description: string
}

export const HEALTH_METRIC_TAXONOMY: MetricDefinition[] = [
  { key: "active_energy", column: "Active Energy (kcal)", group: "activity", description: "kcal" },
  { key: "resting_energy", column: "Resting Energy (kcal)", group: "activity", description: "kcal" },
  { key: "apple_exercise_time", column: "Apple Exercise Time (min)", group: "activity", description: "min" },
  { key: "apple_stand_hours", column: "Apple Stand Hour (count)", group: "activity", description: "count (hours meeting stand goal)" },
  { key: "apple_stand_time", column: "Apple Stand Time (min)", group: "activity", description: "min" },
  { key: "step_count", column: "Step Count (count)", group: "activity", description: "count" },
  { key: "flights_climbed", column: "Flights Climbed (count)", group: "activity", description: "count" },
  { key: "physical_effort", column: "Physical Effort (kcal/hr·kg)", group: "activity", description: "kcal/hr·kg" },
  { key: "walking_running_distance", column: "Walking + Running Distance (mi)", group: "activity", description: "mi" },
  { key: "time_in_daylight", column: "Time in Daylight (min)", group: "activity", description: "min" },

  { key: "heart_rate_min", column: "Heart Rate [Min] (count/min)", group: "heart", description: "bpm" },
  { key: "heart_rate_max", column: "Heart Rate [Max] (count/min)", group: "heart", description: "bpm" },
  { key: "heart_rate_avg", column: "Heart Rate [Avg] (count/min)", group: "heart", description: "bpm" },
  { key: "resting_heart_rate", column: "Resting Heart Rate (count/min)", group: "heart", description: "bpm" },
  { key: "heart_rate_variability", column: "Heart Rate Variability (ms)", group: "heart", description: "ms" },
  { key: "walking_heart_rate_avg", column: "Walking Heart Rate Average (count/min)", group: "heart", description: "bpm" },

  { key: "respiratory_rate", column: "Respiratory Rate (count/min)", group: "vitals", description: "breaths/min" },
  { key: "blood_oxygen_saturation", column: "Blood Oxygen Saturation (%)", group: "vitals", description: "%" },

  { key: "sleep_total_hours", column: "Sleep Analysis [Total] (hr)", group: "sleep", description: "hr" },
  { key: "sleep_in_bed_hours", column: "Sleep Analysis [In Bed] (hr)", group: "sleep", description: "hr" },
  { key: "sleep_core_hours", column: "Sleep Analysis [Core] (hr)", group: "sleep", description: "hr" },
  { key: "sleep_deep_hours", column: "Sleep Analysis [Deep] (hr)", group: "sleep", description: "hr" },
  { key: "sleep_rem_hours", column: "Sleep Analysis [REM] (hr)", group: "sleep", description: "hr" },
  { key: "sleep_awake_hours", column: "Sleep Analysis [Awake] (hr)", group: "sleep", description: "hr" },

  { key: "walking_speed", column: "Walking Speed (mi/hr)", group: "mobility", description: "mi/hr" },
  { key: "walking_step_length", column: "Walking Step Length (in)", group: "mobility", description: "in" },
  { key: "walking_asymmetry_pct", column: "Walking Asymmetry Percentage (%)", group: "mobility", description: "%" },
  { key: "walking_double_support_pct", column: "Walking Double Support Percentage (%)", group: "mobility", description: "%" },
  { key: "stair_speed_up", column: "Stair Speed: Up (ft/s)", group: "mobility", description: "ft/s" },
  { key: "stair_speed_down", column: "Stair Speed: Down (ft/s)", group: "mobility", description: "ft/s" },

  { key: "environmental_audio_exposure", column: "Environmental Audio Exposure (dBASPL)", group: "environmental", description: "dBASPL" },
]

export function dailyRowToMetrics(raw: Record<string, string>): Array<{ key: string; value: number }> {
  const out: Array<{ key: string; value: number }> = []
  for (const def of HEALTH_METRIC_TAXONOMY) {
    const cell = raw[def.column]
    if (cell === undefined || cell.trim() === "") continue
    const value = Number(cell)
    if (!Number.isFinite(value)) continue
    out.push({ key: def.key, value })
  }
  return out
}
