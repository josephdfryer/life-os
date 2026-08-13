import { NextRequest, NextResponse } from "next/server"
import { contractIssues, interactionCreateContract } from "@life-os/contracts"
import { createInteraction, streamInteractions, type StreamParams } from "@life-os/domain"
import { runRulesForTarget } from "@life-os/automation"
import { authorizeRequest } from "@/lib/auth"
import { formatInteractionResource } from "@/lib/interactions"
import { errorResponse, handleRouteError, unauthorizedResponse } from "@/lib/respond"

export async function GET(req: NextRequest) {
  const auth = await authorizeRequest(req, "interactions.read")
  if (!auth) return unauthorizedResponse()
  try {
    const { searchParams } = new URL(req.url)
    const number = (key: string) => {
      const raw = searchParams.get(key)
      return raw === null || raw === "" ? null : Number(raw)
    }
    const params: StreamParams = {
      cursor: searchParams.get("cursor"), limit: number("limit") ?? undefined,
      order: searchParams.get("order") === "asc" ? "asc" : "desc",
      type: searchParams.get("type"), subtype: searchParams.get("subtype"),
      since: searchParams.get("since"), until: searchParams.get("until"),
      personId: searchParams.get("personId"), actorPersonId: searchParams.get("actorPersonId"),
      groupId: searchParams.get("groupId"), placeId: searchParams.get("placeId"),
      eventId: searchParams.get("eventId"), category: searchParams.get("category"),
      direction: searchParams.get("direction"), source: searchParams.get("source"),
      q: searchParams.get("q"), minAmount: number("minAmount"), maxAmount: number("maxAmount"),
      include: searchParams.get("include"),
      withTotal: searchParams.get("withTotal") === "1" || searchParams.get("withTotal") === "true",
    }
    return NextResponse.json(await streamInteractions(params, auth.workspaceId))
  } catch (error) {
    return handleRouteError(error)
  }
}

export async function POST(req: NextRequest) {
  const auth = await authorizeRequest(req, "interactions.write")
  if (!auth) return unauthorizedResponse()
  try {
    const parsed = interactionCreateContract.safeParse(await req.json())
    if (!parsed.success) return errorResponse(400, "validation", "Invalid interaction.", contractIssues(parsed.error))
    const interaction = await createInteraction(parsed.data, auth.workspaceId, auth.actor)
    await runRulesForTarget({
      trigger: "interaction.create",
      targetType: "interaction",
      targetId: interaction.id,
      payload: {
        interactionId: interaction.id, personId: interaction.personId, eventId: interaction.eventId,
        type: interaction.type, timestamp: interaction.timestamp.toISOString(), summary: interaction.summary,
        emotionalWeight: interaction.emotionalWeight, outcome: interaction.outcome,
        direction: interaction.direction, sourceFileId: interaction.sourceFileId,
      },
      actor: auth.actor,
    })
    return NextResponse.json(formatInteractionResource(interaction), { status: 201 })
  } catch (error) {
    return handleRouteError(error)
  }
}
