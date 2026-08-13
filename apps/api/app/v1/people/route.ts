import { NextRequest, NextResponse } from "next/server"
import { contractIssues, personCreateContract } from "@life-os/contracts"
import { createPerson } from "@life-os/domain"
import { runRulesForTarget } from "@life-os/automation"
import { authorizeRequest } from "@/lib/auth"
import { formatPersonResource, listPeople } from "@/lib/people"
import { errorResponse, handleRouteError, unauthorizedResponse } from "@/lib/respond"

export async function GET(req: NextRequest) {
  const auth = await authorizeRequest(req, "people.read")
  if (!auth) return unauthorizedResponse()

  try {
    const { searchParams } = new URL(req.url)
    const rawLimit = searchParams.get("limit")
    return NextResponse.json(await listPeople({
      cursor: searchParams.get("cursor"),
      limit: rawLimit === null || rawLimit === "" ? undefined : Number(rawLimit),
      q: searchParams.get("q") ?? searchParams.get("search"),
    }, auth.workspaceId))
  } catch (error) {
    return handleRouteError(error)
  }
}

export async function POST(req: NextRequest) {
  const auth = await authorizeRequest(req, "people.write")
  if (!auth) return unauthorizedResponse()

  try {
    const parsed = personCreateContract.safeParse(await req.json())
    if (!parsed.success) return errorResponse(400, "validation", "Invalid person.", contractIssues(parsed.error))
    const person = await createPerson(parsed.data, auth.workspaceId, auth.actor)
    await runRulesForTarget({
      trigger: "person.create",
      targetType: "person",
      targetId: person.id,
      payload: { personId: person.id, first: person.first, last: person.last },
      actor: auth.actor,
    })
    return NextResponse.json(formatPersonResource(person), { status: 201 })
  } catch (error) {
    return handleRouteError(error)
  }
}
