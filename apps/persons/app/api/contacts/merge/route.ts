import { NextRequest } from "next/server"
import { handleRouteError, json } from "@/server/api/respond"
import { mergePersons } from "@/server/domain/merge"

export async function POST(req: NextRequest) {
  try {
    return json(await mergePersons(await req.json()))
  } catch (error) {
    return handleRouteError(error)
  }
}
