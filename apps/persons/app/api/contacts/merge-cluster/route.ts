import { NextRequest } from "next/server"
import { handleRouteError, json } from "@/server/api/respond"
import { mergePersonClusters } from "@/server/domain/merge"

export async function POST(req: NextRequest) {
  try {
    const { pairs } = await req.json() as { pairs: { aId: string; bId: string }[] }
    return json(await mergePersonClusters(pairs))
  } catch (error) {
    return handleRouteError(error)
  }
}
