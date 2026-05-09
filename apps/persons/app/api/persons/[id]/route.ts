import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { parseTags } from "@/lib/utils"
import type { Interaction } from "@/types"
import { deletePerson, updatePerson } from "@/server/domain/people"
import { handleRouteError, noContent } from "@/server/api/respond"
import { requireAccess } from "@/server/domain/access"

type Params = { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params
  const actor = await requireAccess("people.read")
  const person = await db.person.findFirst({
    where: { id, workspaceId: actor.workspaceId },
    include: {
      interactions: {
        include: { event: true, sourceFile: true },
        orderBy: { timestamp: "desc" },
      },
      plans: {
        orderBy: { createdAt: "desc" },
      },
    },
  })

  if (!person) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const interactions: Interaction[] = person.interactions.map((ix: typeof person.interactions[number]) => ({
    ...ix,
    actionItems: parseTags(ix.actionItems) as unknown as string[],
    event: ix.event
      ? { ...ix.event, metadata: ix.event.metadata ? JSON.parse(ix.event.metadata) : null }
      : null,
  })) as unknown as Interaction[]

  return NextResponse.json({
    ...person,
    tags:   parseTags(person.tags),
    values: parseTags(person.values),
    emails: parseTags(person.emails),
    phones: parseTags(person.phones),
    interactions,
    plans: person.plans.map(p => ({
      ...p,
      successSignals: parseTags(p.successSignals),
      children: [],
    })),
  })
}

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const { id } = await params
    const actor = await requireAccess("people.write")
    return NextResponse.json(await updatePerson(id, await req.json(), actor.actor))
  } catch (error) {
    return handleRouteError(error)
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const { id } = await params
    const actor = await requireAccess("people.write")
    await deletePerson(id, actor.actor)
    return noContent()
  } catch (error) {
    return handleRouteError(error)
  }
}
