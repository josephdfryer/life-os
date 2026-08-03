// ─────────────────────────────────────────────
// EXERCISE ART REGISTRY
//
// Which movements have a drawing, and how faithful it is. This mirrors
// `ART_MAP` in scripts/level-up/fetch-exercise-art.ts — that script vendors the
// files, this decides what the UI is allowed to claim about them.
//
// The honesty rule: a `substitute` drawing is a different movement in the same
// pattern, so the card says so. Showing a barbell lunge under the heading
// "Bulgarian split squat" without a word would teach the wrong movement, and
// this app's whole premise is evidence you can trust.
//
// Absence is meaningful too. Jumps, carries, hip thrusts and dead bugs have no
// entry because the open dataset contains none — the UI shows form cues and the
// muscle map for those rather than inventing a picture.
// ─────────────────────────────────────────────

export type Fidelity = "exact" | "close" | "substitute"

export type ExerciseArt = {
  /** Public path stem — `${stem}-relaxation.svg` / `${stem}-tension.svg`. */
  stem: string
  fidelity: Fidelity
  /** Shown to the user whenever the drawing isn't the movement exactly. */
  note?: string
}

const ART: Record<string, ExerciseArt> = {
  back_squat:        { stem: "back_squat",        fidelity: "exact" },
  front_squat:       { stem: "front_squat",       fidelity: "exact" },
  bench_press:       { stem: "bench_press",       fidelity: "exact" },
  incline_press:     { stem: "incline_press",     fidelity: "exact" },
  romanian_deadlift: { stem: "romanian_deadlift", fidelity: "exact" },
  side_plank:        { stem: "side_plank",        fidelity: "exact" },
  lat_pulldown:      { stem: "lat_pulldown",      fidelity: "exact" },

  weighted_pullup: {
    stem: "weighted_pullup", fidelity: "close",
    note: "Drawn unweighted — add the belt yourself.",
  },
  overhead_press: {
    stem: "overhead_press", fidelity: "close",
    note: "Drawn seated; the program presses standing.",
  },
  barbell_row: {
    stem: "barbell_row", fidelity: "close",
    note: "Drawn with an underhand grip.",
  },

  trap_bar_deadlift: {
    stem: "trap_bar_deadlift", fidelity: "substitute",
    note: "Conventional deadlift shown. The trap bar sits you inside the load, which shortens the lever on your lower back — the reason it's the prescribed version.",
  },
  bulgarian_split_squat: {
    stem: "bulgarian_split_squat", fidelity: "substitute",
    note: "Barbell lunge shown. The split squat keeps the rear foot elevated and the stance static.",
  },
  chest_supported_row: {
    stem: "chest_supported_row", fidelity: "substitute",
    note: "Seated cable row shown. Same pull, without the chest pad taking your lower back out of it.",
  },
}

export function artFor(exerciseKey: string): ExerciseArt | null {
  return ART[exerciseKey] ?? null
}

export const ART_CREDIT = {
  author: "Everkinetic",
  href: "https://github.com/everkinetic/data",
  license: "CC BY-SA 4.0",
  licenseHref: "https://creativecommons.org/licenses/by-sa/4.0/",
}
