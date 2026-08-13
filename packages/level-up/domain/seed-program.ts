// ─────────────────────────────────────────────
// THE DEFAULT PROGRAM
//
// Three days a week, full gym, pointed at vertical jump and explosiveness while
// losing weight. That goal shapes the structure: jumps go first while the
// nervous system is fresh (they are the adaptation, not a warm-up), heavy
// low-rep strength follows, and trunk work closes rather than opens so nothing
// fatigues the spine before the loaded lifts.
//
// Two constraints are structural, not notes. Every movement carries the joints
// it actually stresses, and every movement that stresses one carries the
// lighter thing to do instead. `substituteKey` is what the "knee is cranky
// today" toggle reads — the hip thrust recurs because it is the honest answer
// for both a knee and a lumbar flare: loaded hip extension with no knee shear
// and no spinal compression.
// ─────────────────────────────────────────────

export type JointTag = "knee" | "lumbar" | "shoulder"
export type Modality = "load" | "duration" | "bodyweight"

export type SeedExercise = {
  key: string
  label: string
  modality: Modality
  /** Engine EXERCISE_CATALOG key — present only where a defensible norm exists. */
  catalogKey?: string
  defaultRestSec: number
  muscleGroup: string
  jointLoad: JointTag[]
  substituteKey?: string
}

export const SEED_EXERCISES: SeedExercise[] = [
  // ── Jumps: the actual target adaptation ──
  {
    key: "box_jump", label: "Box jump", modality: "bodyweight", defaultRestSec: 90,
    muscleGroup: "power", jointLoad: ["knee"], substituteKey: "pogo_hops",
  },
  {
    key: "broad_jump", label: "Broad jump", modality: "bodyweight", defaultRestSec: 90,
    muscleGroup: "power", jointLoad: ["knee"], substituteKey: "pogo_hops",
  },
  {
    key: "pogo_hops", label: "Pogo hops", modality: "bodyweight", defaultRestSec: 60,
    muscleGroup: "power", jointLoad: [],
  },

  // ── Rated strength (engine catalog) ──
  {
    key: "trap_bar_deadlift", label: "Trap-bar deadlift", modality: "load",
    catalogKey: "trap_bar_deadlift", defaultRestSec: 180, muscleGroup: "posterior",
    jointLoad: ["lumbar"], substituteKey: "hip_thrust",
  },
  {
    key: "back_squat", label: "Back squat", modality: "load", catalogKey: "back_squat",
    defaultRestSec: 180, muscleGroup: "legs", jointLoad: ["knee", "lumbar"],
    substituteKey: "hip_thrust",
  },
  {
    key: "front_squat", label: "Front squat", modality: "load", catalogKey: "front_squat",
    defaultRestSec: 150, muscleGroup: "legs", jointLoad: ["knee", "lumbar"],
    substituteKey: "hip_thrust",
  },
  {
    key: "bulgarian_split_squat", label: "Bulgarian split squat", modality: "load",
    catalogKey: "bulgarian_split_squat", defaultRestSec: 90, muscleGroup: "legs",
    jointLoad: ["knee"], substituteKey: "hip_thrust",
  },
  {
    key: "romanian_deadlift", label: "Romanian deadlift", modality: "load",
    catalogKey: "romanian_deadlift", defaultRestSec: 120, muscleGroup: "posterior",
    jointLoad: ["lumbar"], substituteKey: "hip_thrust",
  },
  {
    key: "hip_thrust", label: "Hip thrust", modality: "load", catalogKey: "hip_thrust",
    defaultRestSec: 90, muscleGroup: "posterior", jointLoad: [],
  },
  {
    key: "bench_press", label: "Bench press", modality: "load", catalogKey: "bench_press",
    defaultRestSec: 150, muscleGroup: "push", jointLoad: ["shoulder"],
  },
  {
    key: "incline_press", label: "Incline press", modality: "load", catalogKey: "incline_press",
    defaultRestSec: 120, muscleGroup: "push", jointLoad: ["shoulder"],
  },
  {
    key: "overhead_press", label: "Overhead press", modality: "load", catalogKey: "overhead_press",
    defaultRestSec: 120, muscleGroup: "push", jointLoad: ["shoulder", "lumbar"],
    substituteKey: "incline_press",
  },
  {
    key: "weighted_pullup", label: "Weighted pull-up", modality: "bodyweight",
    catalogKey: "weighted_pullup", defaultRestSec: 120, muscleGroup: "pull", jointLoad: [],
  },
  {
    key: "barbell_row", label: "Barbell row", modality: "load", catalogKey: "barbell_row",
    defaultRestSec: 90, muscleGroup: "pull", jointLoad: ["lumbar"],
    substituteKey: "chest_supported_row",
  },
  {
    key: "chest_supported_row", label: "Chest-supported row", modality: "load",
    defaultRestSec: 90, muscleGroup: "pull", jointLoad: [],
  },
  {
    key: "lat_pulldown", label: "Lat pulldown", modality: "load", defaultRestSec: 90,
    muscleGroup: "pull", jointLoad: [],
  },

  // ── Trunk and carries: timed work ──
  {
    key: "farmer_carry", label: "Farmer carry", modality: "duration", defaultRestSec: 90,
    muscleGroup: "trunk", jointLoad: ["lumbar"], substituteKey: "dead_bug",
  },
  {
    key: "suitcase_carry", label: "Suitcase carry", modality: "duration", defaultRestSec: 90,
    muscleGroup: "trunk", jointLoad: ["lumbar"], substituteKey: "dead_bug",
  },
  {
    key: "plank", label: "Plank", modality: "duration", defaultRestSec: 60,
    muscleGroup: "trunk", jointLoad: [],
  },
  {
    key: "side_plank", label: "Side plank", modality: "duration", defaultRestSec: 60,
    muscleGroup: "trunk", jointLoad: [],
  },
  {
    key: "dead_bug", label: "Dead bug", modality: "duration", defaultRestSec: 45,
    muscleGroup: "trunk", jointLoad: [],
  },
]

export type SeedEntry = {
  exerciseKey: string
  targetSets: number
  targetReps?: number
  targetDurationSec?: number
  restSec?: number
}

export type SeedDay = {
  name: string
  entries: SeedEntry[]
}

export const SEED_PROGRAM: { name: string; notes: string; days: SeedDay[] } = {
  name: "Vertical — 3 day",
  notes:
    "Jump first, heavy second, trunk last. Built for vertical jump and explosiveness "
    + "in a calorie deficit: low reps and long rest on the strength work so the "
    + "stimulus stays neural rather than metabolic, which is what holds power while "
    + "bodyweight comes down.",
  days: [
    {
      name: "A — Pull & press",
      entries: [
        { exerciseKey: "box_jump", targetSets: 4, targetReps: 3 },
        { exerciseKey: "trap_bar_deadlift", targetSets: 4, targetReps: 5 },
        { exerciseKey: "bench_press", targetSets: 3, targetReps: 8 },
        { exerciseKey: "bulgarian_split_squat", targetSets: 3, targetReps: 8 },
        { exerciseKey: "farmer_carry", targetSets: 3, targetDurationSec: 45 },
        { exerciseKey: "plank", targetSets: 3, targetDurationSec: 45 },
      ],
    },
    {
      name: "B — Squat & row",
      entries: [
        { exerciseKey: "pogo_hops", targetSets: 3, targetReps: 10 },
        { exerciseKey: "back_squat", targetSets: 4, targetReps: 5 },
        { exerciseKey: "weighted_pullup", targetSets: 3, targetReps: 6 },
        { exerciseKey: "romanian_deadlift", targetSets: 3, targetReps: 8 },
        { exerciseKey: "barbell_row", targetSets: 3, targetReps: 10 },
        { exerciseKey: "side_plank", targetSets: 3, targetDurationSec: 40 },
      ],
    },
    {
      name: "C — Power & overhead",
      entries: [
        { exerciseKey: "broad_jump", targetSets: 4, targetReps: 3 },
        { exerciseKey: "front_squat", targetSets: 3, targetReps: 5 },
        { exerciseKey: "overhead_press", targetSets: 3, targetReps: 8 },
        { exerciseKey: "hip_thrust", targetSets: 3, targetReps: 10 },
        { exerciseKey: "lat_pulldown", targetSets: 3, targetReps: 10 },
        { exerciseKey: "suitcase_carry", targetSets: 3, targetDurationSec: 45 },
      ],
    },
  ],
}

/**
 * Which movement to actually perform, given today's flares. Returns the
 * substitute only when the exercise stresses a joint that is flaring and a
 * substitute exists — a knee flare must not quietly swap a bench press.
 */
export function resolveSubstitution<T extends { jointLoad: JointTag[]; substituteKey?: string }>(
  exercise: T,
  flares: { knee: boolean; lumbar: boolean },
): string | null {
  if (!exercise.substituteKey) return null
  const flaring: JointTag[] = []
  if (flares.knee) flaring.push("knee")
  if (flares.lumbar) flaring.push("lumbar")
  return exercise.jointLoad.some(joint => flaring.includes(joint)) ? exercise.substituteKey : null
}
