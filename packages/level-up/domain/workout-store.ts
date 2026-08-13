import { db } from "@life-os/db"
import { SEED_EXERCISES, SEED_PROGRAM, type JointTag } from "./seed-program"
import { neutralReadinessSnapshot } from "./workout-commands"

// ─────────────────────────────────────────────
// THE WORKOUT READ PATH
//
// Loads the shapes the session screen needs, already resolved: the day's
// entries with today's substitutions applied and each exercise pre-seeded with
// what was lifted last time. Pre-seeding is the highest-value detail in the
// product — it turns the common case from an entry into a confirm — so it
// happens here, once, rather than being fetched per exercise mid-session.
// ─────────────────────────────────────────────

export type Flares = { knee: boolean; lumbar: boolean }

export type PreparedExercise = {
  id: string
  key: string
  label: string
  modality: string
  catalogKey: string | null
  defaultRestSec: number
  jointLoad: JointTag[]
}

export type PreparedEntry = {
  entryId: string
  order: number
  exercise: PreparedExercise
  /** Set when a flare swapped the prescribed movement out. */
  substitutedFor: string | null
  targetSets: number
  targetReps: number | null
  targetLoadKg: number | null
  targetDurationSec: number | null
  restSec: number
  /** Last session's numbers for this movement — what the wheels seed to. */
  lastLoadKg: number | null
  lastReps: number | null
  lastDurationSec: number | null
  lastIsBodyweight: boolean
}

function parseJointLoad(value: string | null): JointTag[] {
  if (!value) return []
  try {
    const parsed: unknown = JSON.parse(value)
    return Array.isArray(parsed) ? (parsed.filter(tag => typeof tag === "string") as JointTag[]) : []
  } catch {
    return []
  }
}

/**
 * Creates the default exercises and program the first time the workspace opens
 * the workout module. Idempotent: keyed on the exercise slug and the program
 * name, so re-running adds nothing.
 */
export async function ensureSeeded(workspaceId: string) {
  const existing = await db.levelUpProgram.findFirst({
    where: { workspaceId },
    select: { id: true },
  })
  if (existing) return existing.id

  // Two passes: create every exercise, then wire substitutions, because a
  // substitute may be defined after the movement that points at it.
  for (const seed of SEED_EXERCISES) {
    await db.levelUpExercise.upsert({
      where: { workspaceId_key: { workspaceId, key: seed.key } },
      create: {
        workspaceId,
        key: seed.key,
        label: seed.label,
        modality: seed.modality,
        catalogKey: seed.catalogKey ?? null,
        defaultRestSec: seed.defaultRestSec,
        muscleGroup: seed.muscleGroup,
        jointLoad: JSON.stringify(seed.jointLoad),
      },
      update: {},
    })
  }
  const created = await db.levelUpExercise.findMany({
    where: { workspaceId, key: { in: SEED_EXERCISES.map(seed => seed.key) } },
    select: { id: true, key: true },
    take: SEED_EXERCISES.length,
  })
  const idByKey = new Map(created.map(exercise => [exercise.key, exercise.id]))
  for (const seed of SEED_EXERCISES) {
    if (!seed.substituteKey) continue
    const id = idByKey.get(seed.key)
    const substituteId = idByKey.get(seed.substituteKey)
    if (id && substituteId) {
      await db.levelUpExercise.update({ where: { id }, data: { substituteId } })
    }
  }

  const program = await db.levelUpProgram.create({
    data: { workspaceId, name: SEED_PROGRAM.name, notes: SEED_PROGRAM.notes, isActive: true },
    select: { id: true },
  })
  for (const [dayIndex, day] of SEED_PROGRAM.days.entries()) {
    const programDay = await db.levelUpProgramDay.create({
      data: { workspaceId, programId: program.id, name: day.name, order: dayIndex },
      select: { id: true },
    })
    for (const [entryIndex, entry] of day.entries.entries()) {
      const exerciseId = idByKey.get(entry.exerciseKey)
      if (!exerciseId) continue
      await db.levelUpProgramEntry.create({
        data: {
          workspaceId,
          programDayId: programDay.id,
          exerciseId,
          targetSets: entry.targetSets,
          targetReps: entry.targetReps ?? null,
          targetDurationSec: entry.targetDurationSec ?? null,
          order: entryIndex,
        },
      })
    }
  }
  await db.levelUpProfile.updateMany({
    where: { workspaceId },
    data: { activeProgramId: program.id },
  })
  return program.id
}

export async function loadProgramDays(workspaceId: string) {
  const result: Awaited<ReturnType<typeof loadProgramDayPage>> = []
  let cursor: string | undefined
  do {
    const rows = await loadProgramDayPage(workspaceId, cursor)
    result.push(...rows)
    cursor = rows.length === 100 ? rows.at(-1)?.id : undefined
  } while (cursor)
  return result.sort((a, b) => a.order - b.order)
}

function loadProgramDayPage(workspaceId: string, cursor?: string) {
  return db.levelUpProgramDay.findMany({
    where: { workspaceId, program: { isActive: true } },
    orderBy: { id: "asc" },
    take: 100,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    select: {
      id: true,
      name: true,
      order: true,
      entries: {
        orderBy: { order: "asc" },
        select: {
          id: true,
          targetSets: true,
          targetReps: true,
          targetDurationSec: true,
          exercise: { select: { label: true, modality: true } },
        },
      },
    },
  })
}

/**
 * The day's work as the session screen needs it: substitutions applied, rest
 * resolved, wheels pre-seeded. One query for the entries and one for history,
 * because a phone on gym wifi should wait on the network exactly once.
 */
export async function prepareDay(
  workspaceId: string,
  programDayId: string,
  flares: Flares,
): Promise<{ dayName: string; entries: PreparedEntry[] } | null> {
  const day = await db.levelUpProgramDay.findFirst({
    where: { id: programDayId, workspaceId },
    select: {
      name: true,
      entries: {
        orderBy: { order: "asc" },
        select: {
          id: true,
          order: true,
          targetSets: true,
          targetReps: true,
          targetLoadKg: true,
          targetDurationSec: true,
          restSec: true,
          exercise: {
            select: {
              id: true, key: true, label: true, modality: true, catalogKey: true,
              defaultRestSec: true, jointLoad: true,
              substitute: {
                select: {
                  id: true, key: true, label: true, modality: true, catalogKey: true,
                  defaultRestSec: true, jointLoad: true,
                },
              },
            },
          },
        },
      },
    },
  })
  if (!day) return null

  const flaring: JointTag[] = []
  if (flares.knee) flaring.push("knee")
  if (flares.lumbar) flaring.push("lumbar")

  const resolved = day.entries.map(entry => {
    const prescribed = entry.exercise
    const jointLoad = parseJointLoad(prescribed.jointLoad)
    // Swap only when this movement stresses a joint that is actually flaring.
    const shouldSwap = prescribed.substitute !== null && jointLoad.some(joint => flaring.includes(joint))
    const performed = shouldSwap && prescribed.substitute ? prescribed.substitute : prescribed
    return {
      entry,
      performed,
      substitutedFor: shouldSwap ? prescribed.label : null,
      jointLoad: parseJointLoad(performed.jointLoad),
    }
  })

  const exerciseIds = [...new Set(resolved.map(item => item.performed.id))]
  const history = await db.levelUpTrainingSet.findMany({
    where: { workspaceId, exerciseId: { in: exerciseIds } },
    orderBy: { performedAt: "desc" },
    distinct: ["exerciseId"],
    select: {
      exerciseId: true, loadKg: true, reps: true, durationSec: true, isBodyweight: true,
    },
  })
  const lastByExercise = new Map(history.map(set => [set.exerciseId, set]))

  const entries: PreparedEntry[] = resolved.map(({ entry, performed, substitutedFor, jointLoad }) => {
    const last = lastByExercise.get(performed.id)
    return {
      entryId: entry.id,
      order: entry.order,
      exercise: {
        id: performed.id,
        key: performed.key,
        label: performed.label,
        modality: performed.modality,
        catalogKey: performed.catalogKey,
        defaultRestSec: performed.defaultRestSec,
        jointLoad,
      },
      substitutedFor,
      targetSets: entry.targetSets,
      targetReps: entry.targetReps,
      targetLoadKg: entry.targetLoadKg,
      targetDurationSec: entry.targetDurationSec,
      restSec: entry.restSec ?? performed.defaultRestSec,
      lastLoadKg: last?.loadKg ?? null,
      lastReps: last?.reps ?? null,
      lastDurationSec: last?.durationSec ?? null,
      lastIsBodyweight: last?.isBodyweight ?? false,
    }
  })

  return { dayName: day.name, entries }
}

export async function loadWorkoutProfile(workspaceId: string) {
  const profile = await db.levelUpProfile.findUnique({
    where: { workspaceId },
    select: { bodyweightKg: true, unitPreference: true, microPlates: true },
  })
  return {
    bodyweightKg: profile?.bodyweightKg ?? null,
    unit: (profile?.unitPreference === "kg" ? "kg" : "lb") as "kg" | "lb",
    microPlates: profile?.microPlates ?? false,
  }
}

export type TodayBundle = {
  programDayId: string
  dayName: string
  entries: PreparedEntry[]
  profile: { bodyweightKg: number | null; unit: "kg" | "lb"; microPlates: boolean }
  readiness: ReturnType<typeof neutralReadinessSnapshot>
}

/**
 * Assembles the versioned session bundle a native client renders: the day's
 * prescribed work with substitutions and previous-set defaults applied, plus
 * profile units and a readiness snapshot. Defaults to the next day in
 * rotation — the day after whichever program day the most recently completed
 * session used — when the caller doesn't request a specific one. The
 * readiness snapshot is synthetic-neutral until HealthKit (M3) and Oura (M4)
 * feed real inputs; see docs/IOS_PLATFORM_PLAN.md section 9.
 */
export async function today(
  workspaceId: string,
  input: { programDayId?: string | null; flares: Flares },
): Promise<TodayBundle | null> {
  await ensureSeeded(workspaceId)
  const days = await loadProgramDays(workspaceId)
  if (days.length === 0) return null

  let programDayId = input.programDayId ?? null
  if (!programDayId) {
    const lastCompleted = await db.levelUpSession.findFirst({
      where: { workspaceId, endedAt: { not: null } },
      orderBy: { endedAt: "desc" },
      select: { programDayId: true },
    })
    const lastIndex = lastCompleted?.programDayId
      ? days.findIndex(day => day.id === lastCompleted.programDayId)
      : -1
    const nextIndex = lastIndex === -1 ? 0 : (lastIndex + 1) % days.length
    programDayId = days[nextIndex].id
  }

  const [prepared, profile] = await Promise.all([
    prepareDay(workspaceId, programDayId, input.flares),
    loadWorkoutProfile(workspaceId),
  ])
  if (!prepared) return null

  return {
    programDayId,
    dayName: prepared.dayName,
    entries: prepared.entries,
    profile,
    readiness: neutralReadinessSnapshot(new Date().toISOString().slice(0, 10)),
  }
}
