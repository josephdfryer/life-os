import { NextRequest } from "next/server"
import { authorizeApiRequest, unauthorized } from "@/lib/api-auth"
import { mergePersonClusters } from "@/server/domain/merge"
import { handleRouteError, json } from "@/server/api/respond"

export async function POST(req: NextRequest) {
  const auth = await authorizeApiRequest(req, "contacts.write")
  if (!auth) return unauthorized()
  try {
    const { pairs } = await req.json() as { pairs: { aId: string; bId: string }[] }
    return json(await mergePersonClusters(pairs, auth.actor))
  } catch (error) {
    return handleRouteError(error)
  }
}
