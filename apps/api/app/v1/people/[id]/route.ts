import { NextRequest, NextResponse } from "next/server"
import { contractIssues, personUpdateContract } from "@life-os/contracts"
import { deletePerson, updatePerson } from "@life-os/domain"
import { runRulesForTarget } from "@life-os/automation"
import { authorizeRequest } from "@/lib/auth"
import { formatPersonResource, getPersonResource } from "@/lib/people"
import { errorResponse, handleRouteError, unauthorizedResponse } from "@/lib/respond"

type Params = { params: Promise<{ id: string }> }

export async function GET(req: NextRequest, { params }: Params) {
  const auth = await authorizeRequest(req, "people.read")
  if (!auth) return unauthorizedResponse()

  try {
    const { id } = await params
    return NextResponse.json(await getPersonResource(id, auth.workspaceId))
  } catch (error) {
    return handleRouteError(error)
  }
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const auth = await authorizeRequest(req, "people.write")
  if (!auth) return unauthorizedResponse()

  try {
    const parsed = personUpdateContract.safeParse(await req.json())
    if (!parsed.success) return errorResponse(400, "validation", "Invalid person update.", contractIssues(parsed.error))
    const { id } = await params
    const person = await updatePerson(id, parsed.data, auth.workspaceId, auth.actor)
    await runRulesForTarget({
      trigger: "person.update",
      targetType: "person",
      targetId: id,
      payload: { personId: id, fields: Object.keys(parsed.data) },
      actor: auth.actor,
    })
    return NextResponse.json(formatPersonResource(person))
  } catch (error) {
    return handleRouteError(error)
  }
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const auth = await authorizeRequest(req, "people.write")
  if (!auth) return unauthorizedResponse()

  try {
    const { id } = await params
    await deletePerson(id, auth.workspaceId, auth.actor)
    return new NextResponse(null, { status: 204 })
  } catch (error) {
    return handleRouteError(error)
  }
}
