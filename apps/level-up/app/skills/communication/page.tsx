import Link from "next/link"
import { requireLevelUpAccess } from "@/lib/access"
import { COMMUNICATION_SKILL } from "@/lib/skills/communication"
import { db } from "@/lib/db"

export const dynamic = "force-dynamic"

const PLAN_MATCH = [
  { text: { contains: "speak" } },
  { text: { contains: "writing" } },
  { text: { contains: "written" } },
  { text: { contains: "communication" } },
  { text: { contains: "present" } },
  { text: { contains: "email" } },
]

export default async function CommunicationSkillPage() {
  const access = await requireLevelUpAccess()
  if (!access) {
    return (
      <div className="lu-page">
        <p className="lu-kicker">Skills</p>
        <h1 className="lu-greeting">Sign in from Home</h1>
      </div>
    )
  }

  const plans = await db.plan.findMany({
    where: {
      workspaceId: access.workspaceId,
      status: "active",
      OR: PLAN_MATCH,
    },
    orderBy: [{ focusedAt: "asc" }, { createdAt: "desc" }],
    take: 12,
    select: { id: true, text: true, focusedAt: true, timescale: true },
  })

  return (
    <div className="lu-page">
      <Link href="/" className="lu-back">
        ← Character
      </Link>
      <p className="lu-kicker">Skill</p>
      <h1 className="lu-greeting">{COMMUNICATION_SKILL.label}</h1>
      <p className="lu-lede">{COMMUNICATION_SKILL.blurb}</p>

      <div className="lu-track-list">
        {COMMUNICATION_SKILL.tracks.map((track) => (
          <div key={track.key} className="lu-track-row">
            <div>
              <h2 className="lu-track-label">{track.label}</h2>
              <p className="lu-track-blurb">{track.blurb}</p>
            </div>
            <span className="lu-badge lu-badge-provisional">Unranked</span>
          </div>
        ))}
      </div>

      <section className="lu-plans">
        <h2>Related Plans</h2>
        <p className="lu-lede" style={{ marginTop: 0, fontSize: 14 }}>
          Graph Plans that look like communication work. Deeper linking comes later.
        </p>
        {plans.length === 0 ? (
          <div className="lu-empty">
            Nothing matched yet. Add a Plan in Home about speaking or writing and it will
            show up here.
          </div>
        ) : (
          <ul className="lu-plan-list">
            {plans.map((plan) => (
              <li key={plan.id}>
                {plan.text}
                <span className="meta">
                  {plan.focusedAt ? "In Focus" : "Active"}
                  {plan.timescale ? ` · ${plan.timescale}` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
        <a className="lu-btn" href="https://home.lacollecteur.com">
          Add a Plan in Home
        </a>
      </section>
    </div>
  )
}
