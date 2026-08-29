import type { Prisma } from "@life-os/db";
import {
  ensureStateDefinition,
  replaceStatesForSourceNoteInTransaction,
} from "@life-os/domain";
import { runRulesForTarget } from "@life-os/automation";

// One taxonomy for daily HealthKit-derived metrics, shared by every live
// ingestion path — the native device companion and Health Auto Export's REST
// webhook — so a metric key means the same thing and carries the same unit
// everywhere it's recorded. Mirrors scripts/health/metrics.ts's
// HEALTH_METRIC_TAXONOMY for the manual zip import; keep the two in sync if
// either changes.
export const HEALTH_METRIC_TAXONOMY: Record<string, string> = {
  active_energy: "kcal",
  resting_energy: "kcal",
  apple_exercise_time: "min",
  apple_stand_hours: "count (hours meeting stand goal)",
  apple_stand_time: "min",
  step_count: "count",
  flights_climbed: "count",
  physical_effort: "kcal/hr·kg",
  walking_running_distance: "mi",
  time_in_daylight: "min",
  heart_rate_min: "bpm",
  heart_rate_max: "bpm",
  heart_rate_avg: "bpm",
  resting_heart_rate: "bpm",
  heart_rate_variability: "ms",
  walking_heart_rate_avg: "bpm",
  respiratory_rate: "breaths/min",
  blood_oxygen_saturation: "%",
  sleep_total_hours: "hr",
  sleep_in_bed_hours: "hr",
  sleep_core_hours: "hr",
  sleep_deep_hours: "hr",
  sleep_rem_hours: "hr",
  sleep_awake_hours: "hr",
  walking_speed: "mi/hr",
  walking_step_length: "in",
  walking_asymmetry_pct: "%",
  walking_double_support_pct: "%",
  stair_speed_up: "ft/s",
  stair_speed_down: "ft/s",
  environmental_audio_exposure: "dBASPL",
};

export type HealthDailySample = { key: string; value: number };
export type HealthDailyActor = {
  type: "system";
  id?: string;
  label: string;
  workspaceId?: string;
};

export type RecordHealthDailyDigestInput = {
  workspaceId: string;
  personId: string;
  /** Calendar day, YYYY-MM-DD (UTC), matching scripts/health-sync.ts's dayKey/dayDate. */
  day: string;
  samples: HealthDailySample[];
  /** State.source — "healthkit" (device) or "health-auto-export" (REST webhook). */
  source: string;
  /** Marks the one Note this source+day owns; re-syncing the same day is a replace, not a duplicate. */
  marker: string;
  contentLabel: string;
  metadataExtra?: Record<string, unknown>;
  actor: HealthDailyActor;
};

// Shared by native `health.daily` ingest and POST /v1/health/samples.
// Default 5s interactive-transaction timeout is not enough for ~30 sequential
// State+GraphEvent writes over Turso; a full daily digest times out mid-write.
export const HEALTH_DAILY_TRANSACTION = {
  maxWait: 10_000,
  timeout: 30_000,
} as const;

/**
 * Resolves (creating if needed) the StateDefinition for every metric key
 * about to be recorded. Each call opens its own transaction internally
 * (ensureStateDefinition), so this must run and fully finish *before* the
 * caller opens the transaction it passes to recordHealthDailyDigestInTransaction
 * — nesting a transaction inside another deadlocks the single sqlite
 * connection this app runs against locally.
 */
export async function ensureHealthMetricDefinitions(
  workspaceId: string,
  keys: Iterable<string>,
) {
  const definitions = new Map<string, string>();
  for (const key of new Set(keys)) {
    const definition = await ensureStateDefinition(
      {
        entityType: "Person",
        type: "health_metric",
        value: key,
        description: HEALTH_METRIC_TAXONOMY[key] ?? null,
      },
      workspaceId,
    );
    definitions.set(key, definition.id);
  }
  return definitions;
}

/**
 * Writes one day's health metrics as a single import Note plus its State
 * digest, replacing whatever that source previously recorded for the day.
 * The shared write path behind every live daily-health ingestion route — see
 * docs/COMPANION_ARCHITECTURE.md — so device ingestion and the Health Auto
 * Export webhook cannot drift into two different shapes for the same data.
 *
 * Takes the transaction client so a caller that also needs an atomic receipt
 * write (device ingestion's DeviceIngestItem) can share one transaction, and
 * takes pre-resolved StateDefinition ids (call ensureHealthMetricDefinitions
 * first, outside any transaction) for the reason documented on that function.
 */
export async function recordHealthDailyDigestInTransaction(
  tx: Prisma.TransactionClient,
  definitions: Map<string, string>,
  input: RecordHealthDailyDigestInput,
) {
  const byKey = new Map<string, number>();
  for (const sample of input.samples) byKey.set(sample.key, sample.value);

  const dayDate = new Date(`${input.day}T00:00:00.000Z`);
  const digest = [...byKey.entries()]
    .map(([key, value]) => `${key}=${value}`)
    .join(" ");
  const content = `${input.contentLabel} for ${input.day}: ${digest || "(no populated metrics)"}`;
  const metadata = JSON.stringify({
    sourceMarker: input.marker,
    ...input.metadataExtra,
    raw: Object.fromEntries(byKey),
  });

  const existingNotes = await tx.note.findMany({
    where: {
      workspaceId: input.workspaceId,
      type: "import",
      metadata: { contains: input.marker, mode: "insensitive" as const },
    },
    take: 10,
  });
  const existingNote = existingNotes.find(
    (note) => parseMetadata(note.metadata).sourceMarker === input.marker,
  );
  const note = existingNote
    ? await tx.note.update({
        where: { id: existingNote.id },
        data: { content, metadata },
        select: { id: true },
      })
    : await tx.note.create({
        data: {
          workspaceId: input.workspaceId,
          type: "import",
          timestamp: dayDate,
          content,
          metadata,
        },
        select: { id: true },
      });

  const states = await replaceStatesForSourceNoteInTransaction(
    tx,
    note.id,
    [...byKey.entries()].map(([key, value]) => ({
      entityType: "Person",
      entityId: input.personId,
      definitionId: definitions.get(key)!,
      severity: value,
      source: input.source,
      recordedAt: dayDate,
    })),
    input.workspaceId,
    input.actor,
  );
  return { noteId: note.id, states };
}

export async function fireHealthDailyRules(
  states: Awaited<
    ReturnType<typeof recordHealthDailyDigestInTransaction>
  >["states"],
  actor: HealthDailyActor,
) {
  await Promise.all(
    states.map(({ state, definition }) =>
      runRulesForTarget({
        trigger: "state.record",
        targetType: "state",
        targetId: state.id,
        payload: {
          stateId: state.id,
          entityType: state.entityType,
          entityId: state.entityId,
          definitionType: definition.type,
          definitionValue: definition.value,
          severity: state.severity,
        },
        actor,
      }),
    ),
  );
}

function parseMetadata(value: string | null) {
  try {
    return JSON.parse(value ?? "{}") as Record<string, unknown>;
  } catch {
    return {};
  }
}
