import { redirect } from "next/navigation"
import { db } from "@/lib/db"
import { parseStoredRecord, parseTags } from "@/lib/utils"
import { requireAccess } from "@/server/domain/access"
import { AppError } from "@/server/api/errors"
import { getPersonHealthSummary } from "@/server/domain/health"
import PersonDetailClient from "./PersonDetailClient"
import type { Interaction } from "@/types"

export const dynamic = "force-dynamic"

export default async function PersonDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    const actor = await requireAccess("people.read")
    const person = await db.person.findFirst({
      where: { id, workspaceId: actor.workspaceId },
      include: {
        interactions: {
          include: { event: true, sourceFile: true },
          orderBy: { timestamp: "desc" },
        },
        plans: { orderBy: { createdAt: "desc" } },
      },
    })

    if (!person) {
      return <PersonDetailClient id={id} initialData={null} />
    }

    const acceptedMessages = await db.stagedInteraction.findMany({
      where: {
        workspaceId: actor.workspaceId,
        acceptedPersonId: person.id,
        interactionId: { not: null },
        body: { not: null },
        source: { in: ["imessage", "gmail", "whatsapp"] },
      },
      select: { interactionId: true, timestamp: true, direction: true, body: true },
      orderBy: { timestamp: "asc" },
      take: 1000,
    })
    const fullMessagesByInteraction = new Map<string, string[]>()
    for (const message of acceptedMessages) {
      if (!message.interactionId || !message.body) continue
      const lines = fullMessagesByInteraction.get(message.interactionId) ?? []
      lines.push(formatMessage(message.timestamp, message.direction, message.body))
      fullMessagesByInteraction.set(message.interactionId, lines)
    }

    const interactions: Interaction[] = person.interactions.map((ix: typeof person.interactions[number]) => ({
      ...ix,
      summary: fullMessagesByInteraction.get(ix.id)?.join("\n\n") ?? ix.summary,
      actionItems: parseTags(ix.actionItems) as unknown as string[],
      event: ix.event
        ? { ...ix.event, metadata: ix.event.metadata ? parseStoredRecord(ix.event.metadata, "Event.metadata") : null }
        : null,
    })) as unknown as Interaction[]

    const health = await getPersonHealthSummary(person.id, actor.workspaceId)

    return (
      <PersonDetailClient
        id={id}
        initialData={{
          ...person,
          tags:   parseTags(person.tags),
          values: parseTags(person.values),
          emails: parseTags(person.emails),
          phones: parseTags(person.phones),
          interactions,
          health,
          plans: person.plans.map((p: typeof person.plans[number]) => ({
            ...p,
            successSignals: parseTags(p.successSignals),
            children: [],
          })),
        } as never}
      />
    )
  } catch (error) {
    if (error instanceof AppError && error.status === 401) {
      redirect(`/login?callbackUrl=%2Fpersons%2F${encodeURIComponent(id)}`)
    }
    return <PersonDetailClient id={id} initialData={null} />
  }
}

function formatMessage(timestamp: Date, direction: string | null, body: string) {
  const time = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    hour: "numeric",
    minute: "2-digit",
  }).format(timestamp)
  return `[${time}${direction ? ` ${direction}` : ""}] ${body}`
}
