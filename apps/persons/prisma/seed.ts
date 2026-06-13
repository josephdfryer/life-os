import "dotenv/config"
import { db } from "@life-os/db"
import { assignColor } from "../lib/colors"

async function main() {
  if (process.env.TURSO_DATABASE_URL && process.env.ALLOW_DESTRUCTIVE_SEED !== "I_UNDERSTAND") {
    throw new Error(
      "Refusing to run the destructive demo seed against Turso. " +
      "Set ALLOW_DESTRUCTIVE_SEED=I_UNDERSTAND only when replacing remote data is intentional."
    )
  }

  // Clear existing data
  await db.interaction.deleteMany()
  await db.plan.deleteMany()
  await db.event.deleteMany()
  await db.person.deleteMany()

  const now = new Date()
  const daysAgo = (n: number) => new Date(now.getTime() - n * 24 * 60 * 60 * 1000)

  // Seed persons
  const marcus = await db.person.create({
    data: {
      first: "Marcus",
      last: "Chen",
      headline: "Founder & CEO at BuildStack",
      emails: JSON.stringify(["marcus@buildstack.io"]),
      phones: JSON.stringify(["+1 415 555 0101"]),
      birthday: "1988-03-15",
      closeness: 3, // Inner Circle
      tags: JSON.stringify(["founder", "investor", "bay area", "YC"]),
      values: JSON.stringify(["ambition", "honesty", "craft"]),
      notes: "Met at YC W22 batch dinner. One of the sharpest operators I know. Currently raising Series A. Intro'd him to Sequoia in Jan.",
      ...assignColor(0),
    },
  })

  const sarah = await db.person.create({
    data: {
      first: "Sarah",
      last: "Okafor",
      headline: "Partner at Meridian Ventures",
      emails: JSON.stringify(["sarah@meridianvc.com"]),
      birthday: "1984-07-22",
      closeness: 2, // Friend
      tags: JSON.stringify(["vc", "investor", "new york", "fintech"]),
      values: JSON.stringify(["rigor", "diversity"]),
      notes: "Lead investor in two of my portfolio companies. Brilliant networker. Tends to follow up fast — expects the same.",
      ...assignColor(1),
    },
  })

  const lily = await db.person.create({
    data: {
      first: "Lily",
      last: "Torres",
      headline: "Head of Design at Vercel",
      emails: JSON.stringify(["lily@vercel.com"]),
      birthday: "1992-11-03",
      closeness: 2, // Friend
      tags: JSON.stringify(["design", "product", "remote"]),
      values: JSON.stringify(["beauty", "systems thinking"]),
      notes: "Went to RISD together. Followed her to SF. Best taste of anyone I know.",
      ...assignColor(2),
    },
  })

  const jordan = await db.person.create({
    data: {
      first: "Jordan",
      last: "Reeves",
      headline: "Staff Eng at Stripe",
      emails: JSON.stringify(["jordan@stripe.com"]),
      birthday: "1990-05-30",
      closeness: 1, // Acquaintance (plan attached to reconnect)
      tags: JSON.stringify(["engineering", "payments", "ex-colleague"]),
      values: JSON.stringify(["precision", "autonomy"]),
      notes: "Worked together at Square 2017–2019. Reconnected at Config last year. Worth keeping warm — Stripe eng is a small world.",
      ...assignColor(3),
    },
  })

  const derek = await db.person.create({
    data: {
      first: "Derek",
      last: "Ashworth",
      headline: "Angel Investor / ex-CTO at Brex",
      emails: JSON.stringify(["derek.ashworth@gmail.com"]),
      birthday: "1980-09-14",
      closeness: 1, // Acquaintance (plan attached to revive)
      tags: JSON.stringify(["angel", "ex-cto", "advisor"]),
      values: JSON.stringify(["directness", "leverage"]),
      notes: "Wrote a $25K check into my last company. Helpful but hard to reach. Haven't spoken in 6 months.",
      ...assignColor(4),
    },
  })

  // Events + Interactions for Marcus (recent — inner circle, stays current)
  const marcusCall1 = await db.event.create({
    data: {
      name: "Series A strategy call with Marcus",
      type: "call",
      timestamp: daysAgo(3),
    },
  })
  await db.interaction.create({
    data: {
      personId: marcus.id,
      eventId: marcusCall1.id,
      type: "call",
      timestamp: daysAgo(3),
      duration: 45,
      emotionalWeight: "Energizing",
      outcome: "Action required",
      summary: "Marcus walked through his deck. Sequoia meeting went well but they want 6 months of revenue data first. We agreed I'd connect him with two more funds this week. He's aiming to close by May.",
      actionItems: JSON.stringify(["Intro Marcus to Benchmark contact", "Forward deck to Andreessen scout"]),
      notes: "He seemed confident but stressed. Needs warm intros more than advice.",
    },
  })

  const marcusDinner = await db.event.create({
    data: {
      name: "Dinner at Nopa with Marcus",
      type: "dinner",
      timestamp: daysAgo(10),
    },
  })
  await db.interaction.create({
    data: {
      personId: marcus.id,
      eventId: marcusDinner.id,
      type: "dinner",
      timestamp: daysAgo(10),
      duration: 150,
      emotionalWeight: "Positive",
      outcome: "Follow-up needed",
      summary: "Long dinner at Nopa. Talked about his co-founder tensions and how to handle the board composition pre-raise. Also caught up on family stuff — his dad is dealing with health issues.",
      notes: "Remember to ask about his dad next time.",
    },
  })

  const marcusMeeting = await db.event.create({
    data: {
      name: "BuildStack product review",
      type: "meeting",
      timestamp: daysAgo(18),
    },
  })
  await db.interaction.create({
    data: {
      personId: marcus.id,
      eventId: marcusMeeting.id,
      type: "meeting",
      timestamp: daysAgo(18),
      duration: 60,
      emotionalWeight: "Positive",
      outcome: "Complete",
      summary: "Reviewed BuildStack's new dashboard with Marcus and his PM. Strong retention numbers. Suggested they sharpen the ICP to mid-market before the raise.",
      actionItems: JSON.stringify(["Review updated ICP doc"]),
    },
  })

  // Events + Interactions for Sarah (moderate — been a few weeks)
  const sarahCall = await db.event.create({
    data: {
      name: "Call with Sarah re: fintech portfolio",
      type: "call",
      timestamp: daysAgo(28),
    },
  })
  await db.interaction.create({
    data: {
      personId: sarah.id,
      eventId: sarahCall.id,
      type: "call",
      timestamp: daysAgo(28),
      duration: 30,
      emotionalWeight: "Positive",
      outcome: "Follow-up needed",
      summary: "Quick check-in on Meridian's latest fund. She mentioned they're active in fintech infra right now. Suggested I send any deals fitting that thesis.",
      actionItems: JSON.stringify(["Send Sarah two fintech deals for review"]),
    },
  })

  const sarahConference = await db.event.create({
    data: {
      name: "Fintech Nexus Conference",
      type: "conference",
      timestamp: daysAgo(55),
    },
  })
  await db.interaction.create({
    data: {
      personId: sarah.id,
      eventId: sarahConference.id,
      type: "meeting",
      timestamp: daysAgo(55),
      duration: 40,
      emotionalWeight: "Positive",
      outcome: "Complete",
      summary: "Ran into Sarah at Fintech Nexus. She introduced me to two of her LPs. Solid conversation about the state of B2B SaaS valuations.",
    },
  })

  // Events + Interactions for Lily (needs attention — hasn't connected in a while)
  const lilyMessage = await db.event.create({
    data: {
      name: "Slack message with Lily about design system",
      type: "message",
      timestamp: daysAgo(25),
    },
  })
  await db.interaction.create({
    data: {
      personId: lily.id,
      eventId: lilyMessage.id,
      type: "message",
      timestamp: daysAgo(25),
      duration: null,
      emotionalWeight: "Neutral",
      outcome: "Complete",
      summary: "Quick back-and-forth about design systems tooling. She shared a Figma plugin that auto-generates tokens. Nothing deep.",
    },
  })

  // Events + Interactions for Jordan (borderline overdue for colleague)
  const jordanCall = await db.event.create({
    data: {
      name: "Catch-up call with Jordan",
      type: "call",
      timestamp: daysAgo(40),
    },
  })
  await db.interaction.create({
    data: {
      personId: jordan.id,
      eventId: jordanCall.id,
      type: "call",
      timestamp: daysAgo(40),
      duration: 25,
      emotionalWeight: "Positive",
      outcome: "Complete",
      summary: "Caught up after Config. He's leading a new payments infra team at Stripe. Mentioned he might be exploring options in 2025. Worth staying close.",
      notes: "Could be a great hire or intro opportunity.",
    },
  })

  // Derek — very overdue for colleague (90 days+)
  const derekEmail = await db.event.create({
    data: {
      name: "Email thread with Derek about advisory terms",
      type: "email",
      timestamp: daysAgo(185),
    },
  })
  await db.interaction.create({
    data: {
      personId: derek.id,
      eventId: derekEmail.id,
      type: "email",
      timestamp: daysAgo(185),
      duration: null,
      emotionalWeight: "Neutral",
      outcome: "Complete",
      summary: "Exchanged emails about refreshing his advisory equity. He was open to a new 1-year cliff arrangement. Nothing signed yet.",
      notes: "He mentioned his daughter just started at Stanford.",
    },
  })

  // StateDefinition seed — idempotent via skipDuplicates
  const stateDefinitions = [
    // Person
    { entityType: "Person", type: "capacity",     value: "depleted"    },
    { entityType: "Person", type: "capacity",     value: "low"         },
    { entityType: "Person", type: "capacity",     value: "optimal"     },
    { entityType: "Person", type: "health",       value: "sick"        },
    { entityType: "Person", type: "health",       value: "recovering"  },
    { entityType: "Person", type: "health",       value: "healthy"     },
    { entityType: "Person", type: "mood",         value: "low"         },
    { entityType: "Person", type: "mood",         value: "neutral"     },
    { entityType: "Person", type: "mood",         value: "elevated"    },
    { entityType: "Person", type: "availability", value: "unavailable" },
    { entityType: "Person", type: "availability", value: "busy"        },
    { entityType: "Person", type: "availability", value: "available"   },
    // Place
    { entityType: "Place", type: "availability",  value: "closed"      },
    { entityType: "Place", type: "availability",  value: "open"        },
    { entityType: "Place", type: "condition",     value: "degraded"    },
    { entityType: "Place", type: "condition",     value: "functional"  },
    { entityType: "Place", type: "condition",     value: "optimal"     },
    { entityType: "Place", type: "access",        value: "restricted"  },
    { entityType: "Place", type: "access",        value: "open"        },
    // Object
    { entityType: "Object", type: "condition",    value: "degraded"    },
    { entityType: "Object", type: "condition",    value: "functional"  },
    { entityType: "Object", type: "condition",    value: "optimal"     },
    { entityType: "Object", type: "availability", value: "unavailable" },
    { entityType: "Object", type: "availability", value: "available"   },
    { entityType: "Object", type: "ownership",    value: "owned"       },
    { entityType: "Object", type: "ownership",    value: "loaned_out"  },
    { entityType: "Object", type: "ownership",    value: "sold"        },
    // Event
    { entityType: "Event", type: "status",        value: "planned"     },
    { entityType: "Event", type: "status",        value: "confirmed"   },
    { entityType: "Event", type: "status",        value: "in_progress" },
    { entityType: "Event", type: "status",        value: "completed"   },
    { entityType: "Event", type: "status",        value: "cancelled"   },
    { entityType: "Event", type: "energy",        value: "low"         },
    { entityType: "Event", type: "energy",        value: "neutral"     },
    { entityType: "Event", type: "energy",        value: "high"        },
    // Plan
    { entityType: "Plan", type: "status",         value: "draft"       },
    { entityType: "Plan", type: "status",         value: "active"      },
    { entityType: "Plan", type: "status",         value: "blocked"     },
    { entityType: "Plan", type: "status",         value: "completed"   },
    { entityType: "Plan", type: "status",         value: "abandoned"   },
    { entityType: "Plan", type: "momentum",       value: "stalled"     },
    { entityType: "Plan", type: "momentum",       value: "slow"        },
    { entityType: "Plan", type: "momentum",       value: "moving"      },
    { entityType: "Plan", type: "momentum",       value: "fast"        },
    // Group
    { entityType: "Group", type: "status",        value: "forming"     },
    { entityType: "Group", type: "status",        value: "active"      },
    { entityType: "Group", type: "status",        value: "dormant"     },
    { entityType: "Group", type: "status",        value: "disbanded"   },
    { entityType: "Group", type: "cohesion",      value: "fragmented"  },
    { entityType: "Group", type: "cohesion",      value: "neutral"     },
    { entityType: "Group", type: "cohesion",      value: "strong"      },
  ]

  for (const d of stateDefinitions) {
    await db.stateDefinition.upsert({
      where: { workspaceId_entityType_type_value: { workspaceId: "default-workspace", entityType: d.entityType, type: d.type, value: d.value } },
      create: { ...d, workspaceId: "default-workspace" },
      update: {},
    })
  }

  // Plans
  await db.plan.create({
    data: {
      personId: marcus.id,
      text: "Help Marcus close his Series A by May 2026",
      timescale: "By May 2026",
      successSignals: JSON.stringify(["Term sheet from tier-1 fund", "Board composition finalized", "Wire received"]),
      status: "active",
    },
  })

  await db.plan.create({
    data: {
      personId: sarah.id,
      text: "Co-invest with Sarah on a fintech infra deal",
      timescale: "H1 2026",
      successSignals: JSON.stringify(["Deal identified", "Sarah commits", "Deal closes"]),
      status: "active",
    },
  })

  await db.plan.create({
    data: {
      personId: derek.id,
      text: "Revive relationship with Derek — start with a short coffee",
      timescale: "Next 30 days",
      successSignals: JSON.stringify(["Meeting scheduled", "Advisory terms refreshed"]),
      status: "active",
    },
  })

  console.log(`✓ Seeded ${stateDefinitions.length} StateDefinitions across 6 entity types`)
  console.log("✓ Seeded 5 persons with interactions and plans")
  console.log("  Marcus Chen (Inner Circle) — 3 interactions, 1 plan")
  console.log("  Sarah Okafor (Friend) — 2 interactions, 1 plan")
  console.log("  Lily Torres (Friend) — 1 interaction")
  console.log("  Jordan Reeves (Colleague) — 1 interaction")
  console.log("  Derek Ashworth (Colleague) — 1 interaction, 1 plan")
}

main()
  .then(() => db.$disconnect())
  .catch((e: unknown) => {
    console.error(e)
    db.$disconnect()
    process.exit(1)
  })
