import { NextRequest } from "next/server"
import { handleRouteError, json } from "@/server/api/respond"
import { mergePersonPairs } from "@/server/domain/merge"

export async function POST(req: NextRequest) {
  try {
    const { pairs } = await req.json() as { pairs: { keepId: string; deleteId: string }[] }
    return json(await mergePersonPairs(pairs))
  } catch (error) {
    return handleRouteError(error)
  }
}
