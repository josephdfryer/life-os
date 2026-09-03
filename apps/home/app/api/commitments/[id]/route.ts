import { NextResponse } from "next/server"
import { cookies } from "next/headers"
import { db } from "@life-os/db"
import { resolveTimeZone, TZ_COOKIE } from "@life-os/ui"
import { workspaceForHomeRequest } from "@/lib/request-access"
import { dayToDate, isStale, snoozeTarget, canPullIntoFocus, type CommitmentAction } from "@/lib/commitments"

const ACTIONS: readonly CommitmentAction[] = ["done", "snooze", "drop", "schedule", "focus", "unfocus"]

function isAction(value: unknown): value is CommitmentAction {
  return typeof value === "string" && (ACTIONS as readonly string[]).includes(value)
}

/**
 * The gestures a commitment supports: `done`, `snooze`, `drop`, `schedule`,
 * plus `focus`/`unfocus` to pull into or swap out of the 5-item Focus queue.
 * Every one of them resolves the row somehow — a commitment you looked at and
 * did nothing about is the failure mode this whole surface exists to prevent.
 */
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const workspaceId = await workspaceForHomeRequest()
  if (!workspaceId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await context.params
  const body = await request.json().catch(() => null) as {
    action?: unknown
    scheduledStart?: unknown
  } | null

  if (!isAction(body?.action)) {
    return NextResponse.json({ error: `Action must be one of ${ACTIONS.join(", ")}` }, { status: 400 })
  }
  const action = body.action

  const plan = await db.plan.findFirst({
    where: { id, workspaceId, status: { in: ["active", "blocked", "draft"] } },
    select: { id: true, deferCount: true, focusedAt: true },
  })
  if (!plan) {
    return NextResponse.json({ error: "Commitment was not found or is already closed" }, { status: 404 })
  }

  const tz = resolveTimeZone((await cookies()).get(TZ_COOKIE)?.value)
  const now = new Date()

  if (action === "snooze" && isStale(plan.deferCount)) {
    return NextResponse.json(
      { error: "This commitment has been pushed too many times — schedule it or drop it" },
      { status: 409 },
    )
  }

  if (action === "focus" && !plan.focusedAt) {
    // Focus is a hard-capped pull queue, not a due list — enforce the cap here
    // rather than in the schema, since "at most 5" is a product rule, not a
    // structural one.
    const focusedCount = await db.plan.count({
      where: { workspaceId, status: { in: ["active", "blocked"] }, focusedAt: { not: null } },
    })
    if (!canPullIntoFocus(focusedCount)) {
      return NextResponse.json(
        { error: "Focus is full — finish, swap, or drop something first" },
        { status: 409 },
      )
    }
  }

  let data: Parameters<typeof db.plan.update>[0]["data"]
  switch (action) {
    case "done":
      data = { status: "completed", completedAt: now, dueOn: null, focusedAt: null }
      break
    case "drop":
      data = { status: "abandoned", dueOn: null, focusedAt: null }
      break
    case "snooze":
      data = {
        dueOn: dayToDate(snoozeTarget(plan.deferCount, now, tz), tz),
        deferCount: { increment: 1 },
      }
      break
    case "schedule": {
      const scheduledStart = typeof body.scheduledStart === "string"
        ? new Date(body.scheduledStart)
        : null
      if (!scheduledStart || Number.isNaN(scheduledStart.getTime())) {
        return NextResponse.json({ error: "scheduledStart must be a valid date" }, { status: 400 })
      }
      // Scheduling converts the commitment into a calendar-backed prediction:
      // it leaves the commitments list (and Focus, if it was there) and shows
      // up on the schedule instead.
      data = { status: "active", scheduledStart, dueOn: null, focusedAt: null }
      break
    }
    case "focus":
      // Pulling in is always a deliberate, individual choice — never a batch
      // fill — so this only ever sets one Plan's focusedAt at a time.
      data = { status: "active", focusedAt: now }
      break
    case "unfocus":
      data = { focusedAt: null }
      break
  }

  const [updated] = await db.$transaction([
    db.plan.update({ where: { id: plan.id }, data, select: { id: true, status: true, dueOn: true, focusedAt: true } }),
    db.auditLog.create({
      data: {
        workspaceId,
        action: `commitment.${action}`,
        targetType: "plan",
        targetId: plan.id,
        actorType: "user",
        actorLabel: "Home",
      },
    }),
  ])

  return NextResponse.json({
    status: updated.status,
    dueOn: updated.dueOn?.toISOString() ?? null,
    focusedAt: updated.focusedAt?.toISOString() ?? null,
  })
}
