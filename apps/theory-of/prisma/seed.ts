import "dotenv/config"
import { db } from "@life-os/db"
import {
  getTheorySourcesForPerson,
  createTheorySnapshot,
  listTheorySnapshots,
} from "@life-os/theory"

// Seeds the first ("v1") Theory of Joseph snapshot if Joseph exists and has no
// theory yet. Idempotent and additive — safe to re-run; it never overwrites.
async function main() {
  const joseph = await db.person.findFirst({
    where: { OR: [{ first: "Joseph" }, { nickname: "Joseph" }] },
    orderBy: { createdAt: "asc" },
    select: { id: true, first: true, last: true, workspaceId: true },
  })

  if (!joseph) {
    console.log("No person named Joseph found — nothing to seed.")
    return
  }

  const existing = await listTheorySnapshots(joseph.id)
  if (existing.length > 0) {
    console.log(`Joseph already has ${existing.length} theory snapshot(s) — skipping seed.`)
    return
  }

  const bundle = await getTheorySourcesForPerson(joseph.id, joseph.workspaceId)
  const sources = bundle.sources.length > 0
    ? bundle.sources
    : [{ sourceType: "person" as const, sourceId: joseph.id }]

  const snapshotId = await createTheorySnapshot(
    joseph.id,
    {
      title: "Theory of Joseph",
      summary:
        "Joseph is building toward “Be present. Grow. Make an impact.” — becoming more " +
        "intentional across family, relationships, health, work, creativity, and legacy. He wants " +
        "Life OS to be a counsel, not a productivity app. Early model (confidence 0.35).",
      markdownBody: JOSEPH_V1_BODY,
      confidence: 0.35,
      sources,
    },
    joseph.workspaceId
  )

  console.log(`Seeded Theory of Joseph (snapshot ${snapshotId}) with ${sources.length} source(s).`)
}

const JOSEPH_V1_BODY = `# Theory of Joseph

## Current Best Model

Joseph is building toward a life philosophy summarized as:

> Be present. Grow. Make an impact.

He is attempting to become more intentional across family, relationships, health, work, creativity, and legacy. He does not want a productivity app. He wants Life OS to become a counsel: a system that notices the gap between what he says matters and what his behavior shows.

## Confidence

Overall confidence: 0.35

This model is early. It is useful enough to guide better questions, but not mature enough to make strong predictions.

## Observed

- Joseph values presence with his family, especially his daughter.
- Joseph intentionally stops lower-urgency work when his daughter approaches him.
- Joseph sees many work urgencies as perceived urgency rather than true urgency.
- Joseph wants to build Life OS as a system for intentional living.
- Joseph resonates with the phrase: "Be present. Grow. Make an impact."
- Joseph enjoys designing products and systems.
- Joseph does not primarily enter flow from writing code itself; coding is currently largely delegated to AI tools.
- Joseph is interested in building a version-controlled Living Theory of Joseph.
- Joseph wants Life OS to eventually support living theories of people he deeply cares about.

## Inferred

- Joseph’s core orientation is not simple productivity. It is intentionality.
- Joseph appears to derive meaning from building useful systems.
- Joseph is motivated by legacy, but not only status.
- Joseph wants Life OS to help him perceive reality more accurately and act more intentionally.
- Joseph’s strongest current identity cluster appears to include builder, father, systems thinker, mentor, and seeker of impact.

## Hypotheses

- Joseph’s distraction loops may come less from laziness and more from misdirected curiosity and novelty seeking.
- Joseph may struggle with rigid goal tracking because he is more opportunity-driven than plan-driven.
- Joseph may over-index on solving things independently before seeking help.
- Joseph’s desire for sovereignty and local-first ownership may be partly philosophical and partly protective.

## Principles

- Urgency is usually fake. Presence rarely is.
- Self-care is not selfish when it enables care for others.
- A model that cannot be audited cannot be trusted.
- Semantic honesty beats convenience.
- The goal is not to collect data. The goal is to understand what the data means.
- Do not confuse observation with context.
- Store atomic truth. Derive meaning.

## Behavioral Patterns

- Enters flow through product design, system architecture, conceptual modeling, and imagining how parts connect.
- Can get pulled into YouTube or dopamine loops when craving stimulation or learning.
- Thrives in chaos professionally, especially when others need clarity under pressure.
- Often prefers mentoring and alignment before confrontation.
- Can be overly lenient when morale or relationship repair feels possible.
- Dislikes being overly controlled or micromanaged.
- Wants trust, but recognizes that trust often requires proactive visibility.

## Contradictions / Tensions

- Joseph wants intentional goals but struggles with consistent goal-setting and tracking.
- Joseph values building, but can fall into consumption loops.
- Joseph wants support but often defaults to handling things solo.
- Joseph values presence but is also highly engaged by work and building.

## Unknowns

- Physical identity and athletic history are not yet modeled.
- Childhood and family-of-origin patterns are not yet modeled.
- Money psychology is not yet modeled.
- Friendship patterns are not yet deeply modeled.
- Religion and its lasting effects are only partially modeled.
- Attachment style is not yet modeled.
- Life OS primitives are known from the manifesto but Joseph’s deeper theory of why these primitives are complete still needs exploration.

## Open Questions

- What physical activities has Joseph historically picked up naturally?
- What sports or movement patterns feel native to him?
- What early childhood experiences shaped his relationship with responsibility and martyrdom?
- When does Joseph ask for help easily, and when does he isolate?
- What makes Joseph feel most alive outside of work and family?
- What are Joseph’s non-business personal principles?
- What should count as evidence strong enough to update a theory?
- What should trigger a new theory snapshot?

## Evidence Trail

Initial theory based on direct conversation with Joseph on 2026-06-29 and Life OS manifesto / architecture documents.
`

main()
  .catch(e => { console.error(e); process.exit(1) })
  .finally(() => db.$disconnect())
