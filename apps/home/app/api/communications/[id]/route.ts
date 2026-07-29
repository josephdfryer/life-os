import { NextResponse } from "next/server"
import { db } from "@life-os/db"
import { workspaceForHomeRequest } from "@/lib/request-access"
import { HOME_TIME_ZONE, dayKey } from "@/lib/daily"

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const workspaceId = await workspaceForHomeRequest()
  if (!workspaceId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await context.params
  const body = await request.json().catch(() => null) as { action?: unknown } | null
  if (body?.action !== "accept" && body?.action !== "dismiss") {
    return NextResponse.json({ error: "Action must be accept or dismiss" }, { status: 400 })
  }

  const item = await db.stagedInteraction.findFirst({
    where: {
      id,
      workspaceId,
      status: { in: ["pending", "blocked"] },
      source: { in: ["imessage", "gmail", "whatsapp"] },
      type: { not: "financial" },
    },
  })
  if (!item) return NextResponse.json({ error: "Communication was not found or was already reviewed" }, { status: 404 })

  if (body.action === "dismiss") {
    await db.$transaction([
      db.stagedInteraction.update({ where: { id: item.id }, data: { status: "dismissed" } }),
      db.auditLog.create({
        data: {
          workspaceId,
          action: "inbox.dismiss",
          targetType: "stagedInteraction",
          targetId: item.id,
          actorType: "user",
          actorLabel: "Home",
        },
      }),
    ])
    return NextResponse.json({ status: "dismissed" })
  }

  if (!item.candidatePersonId) {
    return NextResponse.json({ error: "Choose a Person before accepting this communication" }, { status: 400 })
  }
  const person = await db.person.findFirst({
    where: { id: item.candidatePersonId, workspaceId },
    select: { id: true },
  })
  if (!person) return NextResponse.json({ error: "The matched Person no longer exists" }, { status: 404 })

  const result = await acceptCommunication(item, workspaceId)
  return NextResponse.json({ status: "accepted", ...result })
}

async function acceptCommunication(
  item: {
    id: string
    source: string
    sourceId: string
    candidatePersonId: string | null
    type: string
    timestamp: Date
    summary: string | null
    body: string | null
    direction: string | null
  },
  workspaceId: string,
) {
  const personId = item.candidatePersonId!
  const sourceMarker = `${item.source}:${item.sourceId}`
  const existing = await db.interaction.findMany({
    where: { workspaceId, personId, notes: { contains: sourceMarker } },
    select: { id: true, notes: true },
    take: 20,
  })
  const exact = existing.find(row => sourceMarkers(row.notes).includes(sourceMarker))
  if (exact) {
    await markAccepted(item.id, personId, exact.id, workspaceId)
    return { interactionId: exact.id, created: false }
  }

  const marker = `${item.source}-day:${dayKey(item.timestamp)}`
  const line = messageLine(item.timestamp, item.direction, item.summary || item.body || "(no text)")
  const daily = await db.interaction.findFirst({
    where: { workspaceId, personId, type: item.type, notes: { contains: marker } },
    select: { id: true, summary: true, notes: true, direction: true },
    orderBy: { timestamp: "asc" },
  })

  if (daily) {
    const updated = await db.interaction.update({
      where: { id: daily.id },
      data: {
        summary: appendUniqueLine(daily.summary, line),
        notes: appendUniqueLine(daily.notes, sourceMarker),
        direction: daily.direction === item.direction ? daily.direction : "mixed",
      },
      select: { id: true },
    })
    await markAccepted(item.id, personId, updated.id, workspaceId)
    return { interactionId: updated.id, created: false }
  }

  const result = await db.$transaction(async tx => {
    const event = ["imessage", "whatsapp"].includes(item.source)
      ? null
      : await tx.event.create({
          data: {
            workspaceId,
            name: `${item.source} ${dayKey(item.timestamp)}`.slice(0, 80),
            type: item.type,
            start: item.timestamp,
            timestamp: item.timestamp,
            metadata: JSON.stringify({ source: item.source, day: dayKey(item.timestamp) }),
          },
          select: { id: true },
        })
    const interaction = await tx.interaction.create({
      data: {
        workspaceId,
        personId,
        eventId: event?.id ?? null,
        type: item.type,
        timestamp: item.timestamp,
        summary: line,
        notes: `${marker}\n${sourceMarker}`,
        direction: item.direction,
      },
      select: { id: true },
    })
    await tx.interactionParticipant.createMany({
      data: [
        { interactionId: interaction.id, entityType: "Person", entityId: personId, workspaceId },
        ...(event ? [{ interactionId: interaction.id, entityType: "Event", entityId: event.id, workspaceId }] : []),
      ],
    })
    return interaction
  })
  await markAccepted(item.id, personId, result.id, workspaceId)
  return { interactionId: result.id, created: true }
}

async function markAccepted(id: string, personId: string, interactionId: string, workspaceId: string) {
  await db.$transaction([
    db.stagedInteraction.update({
      where: { id },
      data: { status: "accepted", acceptedAt: new Date(), acceptedPersonId: personId, interactionId },
    }),
    db.auditLog.create({
      data: {
        workspaceId,
        action: "inbox.accept",
        targetType: "stagedInteraction",
        targetId: id,
        actorType: "user",
        actorLabel: "Home",
        metadata: JSON.stringify({ interactionId }),
      },
    }),
  ])
}

function sourceMarkers(value: string | null) {
  return (value ?? "").split(/\s+/).map(part => part.trim()).filter(part => /^[a-z0-9_-]+:.+/i.test(part))
}

function appendUniqueLine(existing: string | null, next: string) {
  const clean = existing?.trim()
  if (!clean) return next
  if (clean.split(/\n+/).map(line => line.trim()).includes(next.trim())) return clean
  return `${clean}\n${next}`
}

function messageLine(timestamp: Date, direction: string | null, summary: string) {
  const time = new Intl.DateTimeFormat("en-US", {
    timeZone: HOME_TIME_ZONE,
    hour: "numeric",
    minute: "2-digit",
  }).format(timestamp)
  return `[${time}${direction ? ` ${direction}` : ""}] ${summary}`
}
