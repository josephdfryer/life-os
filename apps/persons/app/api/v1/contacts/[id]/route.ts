import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { authorizeApiRequest, unauthorized } from "@/lib/api-auth"
import { parseTags } from "@/lib/utils"
import { parseStoredRecord } from "@/lib/utils"
import { formatPerson } from "@/server/domain/dto"
import { deletePerson, updatePerson } from "@/server/domain/persons"
import { handleRouteError, noContent } from "@/server/api/respond"

type Params = { params: Promise<{ id: string }> }

export async function GET(req: NextRequest, { params }: Params) {
  const auth = await authorizeApiRequest(req, "people.read")
  if (!auth) return unauthorized()
  const { id } = await params

  const person = await db.person.findFirst({
    where: { id, workspaceId: auth.workspaceId },
    include: {
      interactions: {
        where: { timestamp: { lte: new Date() } },
        include: { event: true, sourceFile: true },
        orderBy: { timestamp: "desc" },
      },
      plans: { orderBy: { createdAt: "desc" } },
    },
  })

  if (!person) return NextResponse.json({ error: "Not found" }, { status: 404 })

  return NextResponse.json({
    ...formatPerson(person as Record<string, unknown>),
    interactions: person.interactions.map((ix: typeof person.interactions[number]) => ({
      ...ix,
      keyTopics: parseTags(ix.actionItems),
      event: ix.event
        ? { ...ix.event, metadata: ix.event.metadata ? parseStoredRecord(ix.event.metadata, "Event.metadata") : null }
        : null,
      file: ix.sourceFile
        ? { id: ix.sourceFile.id, filename: ix.sourceFile.filename, retrieveUrl: `/api/v1/files/${ix.sourceFile.id}` }
        : null,
    })),
  })
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const auth = await authorizeApiRequest(req, "people.write")
  if (!auth) return unauthorized()
  try {
    const { id } = await params
    return NextResponse.json(await updatePerson(id, await req.json(), auth.actor))
  } catch (error) {
    return handleRouteError(error)
  }
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const auth = await authorizeApiRequest(req, "people.write")
  if (!auth) return unauthorized()
  try {
    const { id } = await params
    await deletePerson(id, auth.actor)
    return noContent()
  } catch (error) {
    return handleRouteError(error)
  }
}
