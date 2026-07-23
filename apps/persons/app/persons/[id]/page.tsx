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

    const interactions: Interaction[] = person.interactions.map((ix: typeof person.interactions[number]) => ({
      ...ix,
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
