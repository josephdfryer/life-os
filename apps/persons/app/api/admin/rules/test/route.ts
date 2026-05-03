import { NextRequest } from "next/server"
import { handleRouteError, json } from "@/server/api/respond"
import { requireAccess } from "@/server/domain/access"
import { testRule } from "@/server/domain/rules"

export async function POST(req: NextRequest) {
  try {
    const actor = await requireAccess("rules.manage")
    return json(await testRule(await req.json(), actor))
  } catch (error) {
    return handleRouteError(error)
  }
}
