import { NextRequest, NextResponse } from "next/server"
import { authorizeRequest } from "@/lib/auth"
import { unauthorizedResponse, handleRouteError, errorResponse } from "@/lib/respond"
import { ensureHealthMetricDefinitions, recordHealthDailyDigestInTransaction, fireHealthDailyRules } from "@/lib/health-daily"

/**
 * Ingests Health Auto Export's REST API automation payload as a live trigger
 * for the same write path scripts/health-sync.ts drives from a manually
 * exported zip and apps/api/lib/device-ingest.ts drives from the native
 * Companion: recordHealthDailyDigestInTransaction in @/lib/health-daily —
 * same StateDefinition taxonomy, same one-Note-per-day digest keyed by a
 * sourceMarker (a re-sync of the same day replaces rather than duplicates),
 * same rule dispatch per recorded State. Three ingestion paths, one data
 * shape — do not let them drift.
 *
 * REST metric "name" values are mapped to taxonomy keys via
 * REST_METRIC_KEY_MAP below. Names Health Auto Export sends that aren't in
 * that map are skipped (not guessed at) and reported back in `unmapped` so
 * the map can be corrected against real traffic — check Vercel logs for
 * "[health/samples] unmapped" after a live sync.
 *
 *   POST /v1/health/samples
 *   { "data": { "metrics": [{ "name": "step_count", "data": [{ "date": "2026-08-10 00:00:00 -0700", "qty": 8203 }] }] } }
 */

const SOURCE = "health-auto-export"

// Health Auto Export REST metric name -> taxonomy key, for metrics that
// report a plain `qty`. Best-effort against the app's published naming
// pattern (snake_case of its display label) — unverified names are listed
// here on the same confidence basis; anything that doesn't actually match
// incoming traffic falls into `unmapped` for correction rather than failing.
const REST_METRIC_KEY_MAP: Record<string, string> = {
  step_count: "step_count",
  active_energy: "active_energy",
  resting_energy: "resting_energy",
  apple_exercise_time: "apple_exercise_time",
  apple_stand_hour: "apple_stand_hours",
  apple_stand_time: "apple_stand_time",
  flights_climbed: "flights_climbed",
  physical_effort: "physical_effort",
  walking_running_distance: "walking_running_distance",
  time_in_daylight: "time_in_daylight",
  resting_heart_rate: "resting_heart_rate",
  heart_rate_variability: "heart_rate_variability",
  walking_heart_rate_average: "walking_heart_rate_avg",
  respiratory_rate: "respiratory_rate",
  blood_oxygen_saturation: "blood_oxygen_saturation",
  oxygen_saturation: "blood_oxygen_saturation",
  walking_speed: "walking_speed",
  walking_step_length: "walking_step_length",
  walking_asymmetry_percentage: "walking_asymmetry_pct",
  walking_double_support_percentage: "walking_double_support_pct",
  stair_speed_up: "stair_speed_up",
  stair_speed_down: "stair_speed_down",
  environmental_audio_exposure: "environmental_audio_exposure",
  basal_energy_burned: "resting_energy",
}

// Heart Rate reports Min/Avg/Max per point instead of qty.
const HEART_RATE_FIELD_MAP: Record<string, string> = { Min: "heart_rate_min", Avg: "heart_rate_avg", Max: "heart_rate_max" }

// Sleep Analysis (aggregated / "Summarize Data" on) reports several duration
// fields per point instead of qty. No aggregated field maps to
// sleep_awake_hours — that key stays zip-import-only for now.
const SLEEP_FIELD_MAP: Record<string, string> = { totalSleep: "sleep_total_hours", inBed: "sleep_in_bed_hours", core: "sleep_core_hours", deep: "sleep_deep_hours", rem: "sleep_rem_hours" }

type DaySample = { key: string; value: number }

export async function POST(req: NextRequest) {
  const auth = await authorizeRequest(req, "states.write")
  if (!auth) return unauthorizedResponse()

  try {
    const body = await req.json()
    const metrics = Array.isArray(body?.data?.metrics) ? body.data.metrics : []
    if (!metrics.length) return errorResponse(400, "validation", "data.metrics (non-empty array) is required")

    const { db } = await import("@life-os/db")
    const workspaceId = auth.workspaceId

    const workspace = await db.workspace.findUnique({
      where: { id: workspaceId },
      select: {
        ownerUserId: true,
        members: { where: { status: "active" }, orderBy: { createdAt: "asc" }, take: 1, select: { userId: true } },
      },
    })
    const ownerUserId = workspace?.ownerUserId ?? workspace?.members[0]?.userId
    const owner = ownerUserId ? await db.user.findUnique({ where: { id: ownerUserId }, select: { personId: true } }) : null
    const personId = owner?.personId
    if (!personId) return errorResponse(400, "validation", "Workspace owner has no linked Person to record health States against")

    // Bucket every sample by calendar day (UTC), matching scripts/health-sync.ts's dayKey/dayDate.
    const byDay = new Map<string, { dayDate: Date; samples: DaySample[] }>()
    const unmapped = new Set<string>()

    for (const metric of metrics) {
      const name = typeof metric?.name === "string" ? metric.name.trim() : ""
      const points = Array.isArray(metric?.data) ? metric.data : []
      if (!name || !points.length) continue

      for (const point of points) {
        if (!point || typeof point !== "object") continue
        const recordedAt = typeof point.date === "string" ? parseHealthDate(point.date) : null
        if (!recordedAt) continue

        const fieldMap = name === "heart_rate" ? HEART_RATE_FIELD_MAP : name === "sleep_analysis" ? SLEEP_FIELD_MAP : null
        const samples: DaySample[] = []
        if (fieldMap) {
          for (const [field, key] of Object.entries(fieldMap)) {
            const value = (point as Record<string, unknown>)[field]
            if (typeof value === "number" && Number.isFinite(value)) samples.push({ key, value })
          }
        } else if (typeof point.qty === "number" && Number.isFinite(point.qty)) {
          const key = REST_METRIC_KEY_MAP[name]
          if (key) samples.push({ key, value: point.qty })
          else unmapped.add(name)
        }
        if (!samples.length) continue

        const dayKey = recordedAt.toISOString().slice(0, 10)
        const dayDate = new Date(`${dayKey}T00:00:00.000Z`)
        const bucket = byDay.get(dayKey) ?? { dayDate, samples: [] }
        bucket.samples.push(...samples)
        byDay.set(dayKey, bucket)
      }
    }

    if (unmapped.size) console.log("[health/samples] unmapped metric names:", [...unmapped].join(", "))

    const actor = { type: "system" as const, label: "health-sync", workspaceId }
    let daysProcessed = 0
    let statesWritten = 0

    // Resolve every StateDefinition once, up front, outside any transaction —
    // ensureStateDefinition opens its own, and nesting one inside another
    // deadlocks the single sqlite connection this app runs against locally.
    const definitions = await ensureHealthMetricDefinitions(workspaceId, [...byDay.values()].flatMap(bucket => bucket.samples.map(sample => sample.key)))

    for (const [dayKey, { samples }] of byDay) {
      const { states } = await db.$transaction(
        tx => recordHealthDailyDigestInTransaction(tx, definitions, {
          workspaceId, personId, day: dayKey, samples,
          source: SOURCE, marker: `${SOURCE}:day:${dayKey}`, contentLabel: "Health Auto Export daily digest",
          metadataExtra: { zipFilename: "rest-api-live-sync" },
          actor,
        }),
        // Default 5s interactive-transaction timeout isn't enough for ~30
        // sequential State+GraphEvent writes over Turso's network round-trip
        // per query — a "All Selected" daily digest was timing out mid-write.
        { maxWait: 10_000, timeout: 30_000 },
      )
      await fireHealthDailyRules(states, actor)

      daysProcessed++
      statesWritten += states.length
    }

    return NextResponse.json({ daysProcessed, statesWritten, unmapped: [...unmapped] })
  } catch (error) {
    return handleRouteError(error)
  }
}

// Health Auto Export sends "YYYY-MM-DD HH:mm:ss ±HHMM" (space before the
// offset, no colon in it) — not valid ISO-8601 as-is.
function parseHealthDate(raw: string): Date | null {
  const match = raw.match(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) ([+-]\d{2})(\d{2})$/)
  const iso = match ? `${match[1]}T${match[2]}${match[3]}:${match[4]}` : raw
  const parsed = new Date(iso)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}
