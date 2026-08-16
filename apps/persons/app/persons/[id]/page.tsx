import { redirect } from "next/navigation"
import { db } from "@/lib/db"
import { parseStoredRecord, parseTags } from "@/lib/utils"
import { requireAccess } from "@/server/domain/access"
import { AppError } from "@/server/api/errors"
import { getPersonHealthSummary } from "@/server/domain/health"
import PersonDetailClient from "./PersonDetailClient"
import type { Interaction } from "@/types"
import { getPersonFileEvidence, getTheoryEvidenceState } from "@life-os/files"
import { getCurrentTheorySnapshot } from "@life-os/intelligence"

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

    const [health, fileEvidence, currentTheory, evidenceState, aboutNotes] = await Promise.all([
      getPersonHealthSummary(person.id, actor.workspaceId),
      getPersonFileEvidence(person.id, actor.workspaceId),
      getCurrentTheorySnapshot(person.id, actor.workspaceId),
      getTheoryEvidenceState(person.id, actor.workspaceId),
      db.note.findMany({
        where: { workspaceId: actor.workspaceId, aboutPersonId: person.id },
        orderBy: { timestamp: "desc" },
        take: 5,
        select: { id: true, content: true, timestamp: true, type: true },
      }),
    ])

    return (
      <PersonDetailClient
        id={id}
        theory={{
          version: currentTheory?.version ?? null,
          confidence: currentTheory?.confidence ?? null,
          synthesizedAt: currentTheory?.synthesizedAt?.toISOString() ?? null,
          stale: evidenceState.stale,
          newEvidenceCount: evidenceState.newEvidenceCount,
          invalidationCount: evidenceState.invalidationCount,
          notes: aboutNotes.map(note => ({
            id: note.id,
            content: note.content.length > 180 ? `${note.content.slice(0, 180)}…` : note.content,
            timestamp: note.timestamp.toISOString(),
            type: note.type,
          })),
        }}
        initialData={{
          ...person,
          tags:   parseTags(person.tags),
          values: parseTags(person.values),
          emails: parseTags(person.emails),
          phones: parseTags(person.phones),
          interactions,
          health,
          fileEvidence: fileEvidence.map(claim => ({
            id: claim.id,
            assertion: claim.assertion,
            classification: claim.classification,
            status: claim.status,
            exactQuote: claim.exactQuote,
            confidence: claim.confidence,
            fileId: claim.sourceFile.id,
            filename: claim.sourceFile.filename,
            chunkId: claim.chunk.id,
            locator: claim.chunk.locator,
            inCurrentTheory: claim.theorySnapshotSources.length > 0,
            subjects: claim.subjects.filter(subject => subject.mention.resolvedPersonId === person.id).map(subject => ({
              mentionId: subject.mention.id,
              role: subject.mention.role,
              sourceText: subject.mention.sourceText,
              resolutionConfidence: subject.mention.confidence,
              relevanceWeight: subject.relevanceWeight,
            })),
          })),
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
