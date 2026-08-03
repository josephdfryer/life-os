# Exercise art — attribution

The exercise line art in this directory comes from the Everkinetic open
dataset and is used under its licence.

- **Source:** https://github.com/everkinetic/data
- **Licence:** Creative Commons Attribution-ShareAlike 4.0 International
  (CC BY-SA 4.0) — https://creativecommons.org/licenses/by-sa/4.0/
- **Author:** Everkinetic

## Modifications

Each file has had its opaque white background group removed so the linework
can be masked and painted with the app's own `--ink` token. No linework was
altered. These modified files remain licensed CC BY-SA 4.0; the share-alike
term applies to the images, not to the application source that displays them.

Regenerate with `npx tsx scripts/level-up/fetch-exercise-art.ts`.

## Mapping

| Exercise | Everkinetic drawing | Fidelity |
|---|---|---|
| `back_squat` | barbell-squat (0122) | exact |
| `front_squat` | front-squat-with-barbell (0138) | exact |
| `bench_press` | bench-press (0042) | exact |
| `incline_press` | incline-bench-press (0043) | exact |
| `romanian_deadlift` | romanian-dead-lift (0118) | exact |
| `side_plank` | side-plank (0113) | exact |
| `lat_pulldown` | v-bar-pull-down (0096) | exact |
| `weighted_pullup` | pull-ups (0087) | close |
| `overhead_press` | seated-military-press (0004) | close |
| `barbell_row` | reverse-grips-bent-over-barbell-rows (0026) | close |
| `trap_bar_deadlift` | barbell-dead-lifts (0099) | substitute |
| `bulgarian_split_squat` | barbell-lunges (0114) | substitute |
| `chest_supported_row` | seated-cable-rows (0025) | substitute |

Exercises absent from this table have no art: the dataset contains no jumps,
carries, hip thrusts or dead bugs.
