#!/usr/bin/env tsx
/**
 * Vendors exercise line art from the Everkinetic open dataset.
 *
 *   https://github.com/everkinetic/data  —  CC BY-SA 4.0
 *
 * Two things happen to each file. First the white group is stripped: upstream
 * SVGs paint an opaque white background plus white body fills, which would sit
 * as a bright rectangle on a dark instrument panel. What remains is pure
 * linework. Second, nothing is recoloured here — the app masks these shapes and
 * paints them with `--ink`, so the art picks up the token system instead of
 * shipping a colour of its own.
 *
 * Assets are committed rather than fetched at runtime: the gym has bad wifi,
 * and a workout screen should never depend on raw.githubusercontent.com.
 *
 *   npx tsx scripts/level-up/fetch-exercise-art.ts
 */

import fs from "node:fs/promises"
import path from "node:path"

const RAW = "https://raw.githubusercontent.com/everkinetic/data/main/dist/svg"
const OUT = path.resolve(import.meta.dirname, "../../apps/level-up/public/exercises")

/**
 * Our exercise key → the Everkinetic drawing that depicts it.
 *
 * `fidelity` is the honest part. `exact` means the drawing IS the movement.
 * `close` means it differs in a detail that doesn't change what the body does
 * (grip, seated vs standing). `substitute` means it's a different movement in
 * the same pattern — the UI labels these so a lunge is never passed off as a
 * Bulgarian split squat. Anything absent from this map has no art at all, which
 * is the truthful outcome for jumps, carries, hip thrusts and dead bugs: the
 * open dataset simply doesn't contain them.
 */
export type Fidelity = "exact" | "close" | "substitute"

export const ART_MAP: Record<string, { id: string; source: string; fidelity: Fidelity; note?: string }> = {
  back_squat:            { id: "0122", source: "barbell-squat",                       fidelity: "exact" },
  front_squat:           { id: "0138", source: "front-squat-with-barbell",            fidelity: "exact" },
  bench_press:           { id: "0042", source: "bench-press",                         fidelity: "exact" },
  incline_press:         { id: "0043", source: "incline-bench-press",                 fidelity: "exact" },
  romanian_deadlift:     { id: "0118", source: "romanian-dead-lift",                  fidelity: "exact" },
  side_plank:            { id: "0113", source: "side-plank",                          fidelity: "exact" },
  lat_pulldown:          { id: "0096", source: "v-bar-pull-down",                     fidelity: "exact" },
  weighted_pullup:       { id: "0087", source: "pull-ups",                            fidelity: "close",
                           note: "Drawn unweighted — add the belt yourself." },
  overhead_press:        { id: "0004", source: "seated-military-press",               fidelity: "close",
                           note: "Drawn seated; the program presses standing." },
  barbell_row:           { id: "0026", source: "reverse-grips-bent-over-barbell-rows", fidelity: "close",
                           note: "Drawn with an underhand grip." },
  trap_bar_deadlift:     { id: "0099", source: "barbell-dead-lifts",                  fidelity: "substitute",
                           note: "Conventional barbell deadlift — the trap bar changes the bar path and shifts load off the lower back." },
  bulgarian_split_squat: { id: "0114", source: "barbell-lunges",                      fidelity: "substitute",
                           note: "Barbell lunge — the split squat keeps the rear foot elevated and static." },
  chest_supported_row:   { id: "0025", source: "seated-cable-rows",                   fidelity: "substitute",
                           note: "Seated cable row — same pull, no chest pad." },
}

const FRAMES = ["relaxation", "tension"] as const

/**
 * Remove the opaque white group; keep only the linework paths.
 *
 * The upstream files are not consistent — fills appear as `#FFF`, `#fff`,
 * `#333` and `#2e2e2c` across the set — so groups are classified by luminance
 * rather than by matching a literal colour. Throwing when nothing is stripped
 * (or nothing survives) is deliberate: a silently unstripped file ships a white
 * rectangle into a dark UI, which is worse than a failed build.
 */
function isWhitish(hex: string) {
  const value = hex.replace("#", "")
  const full = value.length === 3 ? value.split("").map(c => c + c).join("") : value
  if (full.length !== 6) return false
  const [r, g, b] = [0, 2, 4].map(i => parseInt(full.slice(i, i + 2), 16))
  return (r + g + b) / 3 > 200
}

function stripBackground(svg: string) {
  let removed = 0
  const stripped = svg.replace(
    /<g fill="(#[0-9a-fA-F]{3,6})">[\s\S]*?<\/g>/g,
    (group, fill: string) => {
      if (!isWhitish(fill)) return group
      removed += 1
      return ""
    },
  )
  if (removed === 0) throw new Error("no background group found — upstream format changed")
  if (!/<path/.test(stripped)) throw new Error("stripping removed every path")
  return stripped
}

async function main() {
  await fs.mkdir(OUT, { recursive: true })
  let written = 0

  for (const [key, entry] of Object.entries(ART_MAP)) {
    for (const frame of FRAMES) {
      const url = `${RAW}/${entry.id}-${frame}.svg`
      const response = await fetch(url)
      if (!response.ok) throw new Error(`${key}: ${url} → HTTP ${response.status}`)
      const svg = stripBackground(await response.text())
      await fs.writeFile(path.join(OUT, `${key}-${frame}.svg`), svg)
      written += 1
    }
    console.log(`  ${key} ← ${entry.source} (${entry.fidelity})`)
  }

  const attribution = [
    "# Exercise art — attribution",
    "",
    "The exercise line art in this directory comes from the Everkinetic open",
    "dataset and is used under its licence.",
    "",
    "- **Source:** https://github.com/everkinetic/data",
    "- **Licence:** Creative Commons Attribution-ShareAlike 4.0 International",
    "  (CC BY-SA 4.0) — https://creativecommons.org/licenses/by-sa/4.0/",
    "- **Author:** Everkinetic",
    "",
    "## Modifications",
    "",
    "Each file has had its opaque white background group removed so the linework",
    "can be masked and painted with the app's own `--ink` token. No linework was",
    "altered. These modified files remain licensed CC BY-SA 4.0; the share-alike",
    "term applies to the images, not to the application source that displays them.",
    "",
    "Regenerate with `npx tsx scripts/level-up/fetch-exercise-art.ts`.",
    "",
    "## Mapping",
    "",
    "| Exercise | Everkinetic drawing | Fidelity |",
    "|---|---|---|",
    ...Object.entries(ART_MAP).map(([key, e]) =>
      `| \`${key}\` | ${e.source} (${e.id}) | ${e.fidelity} |`),
    "",
    "Exercises absent from this table have no art: the dataset contains no jumps,",
    "carries, hip thrusts or dead bugs.",
    "",
  ].join("\n")
  await fs.writeFile(path.join(OUT, "ATTRIBUTION.md"), attribution)

  console.log(`\n${written} SVGs + ATTRIBUTION.md → ${path.relative(process.cwd(), OUT)}`)
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
