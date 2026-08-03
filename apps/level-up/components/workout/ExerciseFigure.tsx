import { artFor } from "@/lib/workout/art"

// ─────────────────────────────────────────────
// THE FIGURE
//
// Two drawings — the stretched position and the contracted one — alternating on
// a slow loop. That is the whole animation, and it's the same two-frame
// structure the source dataset ships.
//
// The art is painted, not drawn: each frame is a CSS mask over a block of
// `--ink`, so the linework takes its colour from the token system instead of
// carrying its own. That's what lets a black-on-white illustration live on a
// dark instrument panel without a white card around it — and it means the
// figure recolours for free if the palette ever moves.
//
// Server component: no state, no effects, nothing to hydrate.
// ─────────────────────────────────────────────

export default function ExerciseFigure({
  exerciseKey,
  label,
  height = 200,
}: {
  exerciseKey: string
  label: string
  height?: number
}) {
  const art = artFor(exerciseKey)
  if (!art) return null

  return (
    <figure className="exercise-figure">
      <div className="exercise-frames" style={{ height }}>
        <div
          className="exercise-frame"
          style={{ ["--frame" as string]: `url(/exercises/${art.stem}-relaxation.svg)` }}
          role="img"
          aria-label={`${label}, stretched position`}
        />
        <div
          className="exercise-frame exercise-frame-b"
          style={{ ["--frame" as string]: `url(/exercises/${art.stem}-tension.svg)` }}
          aria-hidden="true"
        />
      </div>
      {art.note && <figcaption className="exercise-figure-note mono">{art.note}</figcaption>}
    </figure>
  )
}
