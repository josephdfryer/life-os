import Link from "next/link"
import { requireLevelUpAccess } from "@/lib/access"
import { loadBundle, BUILDS } from "@life-os/level-up"
import { COMMUNICATION_SKILL } from "@/lib/skills/communication"
import { db } from "@/lib/db"

export const dynamic = "force-dynamic"

export default async function CharacterPage() {
  const access = await requireLevelUpAccess()
  if (!access) {
    return (
      <div className="lu-page">
        <p className="lu-kicker">Level Up</p>
        <h1 className="lu-greeting">No workspace yet</h1>
        <p className="lu-lede">Sign in from Home to open your character sheet.</p>
        <a className="lu-btn" href="https://home.lacollecteur.com">
          Open Home
        </a>
      </div>
    )
  }

  const [{ card, coldStartDone, profileExists }, relatedPlans] = await Promise.all([
    loadBundle(access.workspaceId),
    db.plan.findMany({
      where: {
        workspaceId: access.workspaceId,
        status: "active",
        OR: [
          { text: { contains: "speak" } },
          { text: { contains: "writing" } },
          { text: { contains: "written" } },
          { text: { contains: "communication" } },
          { text: { contains: "present" } },
          { focusedAt: { not: null } },
        ],
      },
      orderBy: [{ focusedAt: "asc" }, { createdAt: "desc" }],
      take: 6,
      select: { id: true, text: true, focusedAt: true, timescale: true },
    }),
  ])

  const build = BUILDS[card.primaryBuild]
  const name = access.user.name?.split(" ")[0] ?? "You"

  return (
    <div className="lu-page">
      <p className="lu-kicker">Character</p>
      <h1 className="lu-greeting">{name}</h1>
      <p className="lu-lede">
        Skills you are leveling — ranks stay honest, Plans stay in the life graph.
      </p>

      {(!coldStartDone || !profileExists) && (
        <div className="lu-empty" style={{ marginTop: 24 }}>
          Fitness is still provisional until a profile and combine exist.{" "}
          <Link href="/start" style={{ color: "var(--cognac)" }}>
            Finish setup
          </Link>
        </div>
      )}

      <div className="lu-skill-grid">
        <Link href="/skills/fitness" className="lu-skill-card">
          <div className="lu-skill-card-top">
            <h2 className="lu-skill-name">Fitness</h2>
            <span className="lu-skill-meta">{build.label}</span>
          </div>
          <div className="lu-skill-stat">{card.ovr}</div>
          <p className="lu-skill-blurb">
            Verified athletic OVR. Now {card.currentOvr}
            {card.archetype?.label ? ` · ${card.archetype.label}` : ""}.
          </p>
        </Link>

        <Link href="/skills/communication" className="lu-skill-card">
          <div className="lu-skill-card-top">
            <h2 className="lu-skill-name">{COMMUNICATION_SKILL.label}</h2>
            <span className="lu-badge lu-badge-provisional">Provisional</span>
          </div>
          <div className="lu-skill-stat lu-skill-stat-muted">—</div>
          <p className="lu-skill-blurb">
            {COMMUNICATION_SKILL.tracks.length} tracks · unranked until evidence lands.
          </p>
        </Link>
      </div>

      <section className="lu-plans">
        <h2>Related Plans</h2>
        <p className="lu-lede" style={{ marginTop: 0, fontSize: 14 }}>
          Same Plan primitive as Home — improvement intent for skills on this sheet.
        </p>
        {relatedPlans.length === 0 ? (
          <div className="lu-empty">
            No matching Plans yet. Create one in Home Focus, or open Communication to see the tracks.
          </div>
        ) : (
          <ul className="lu-plan-list">
            {relatedPlans.map((plan) => (
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
        <a className="lu-btn lu-btn-ghost" href="https://home.lacollecteur.com">
          Manage Plans in Home
        </a>
      </section>
    </div>
  )
}
