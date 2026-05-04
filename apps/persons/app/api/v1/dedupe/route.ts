import { NextRequest } from "next/server"
import { authorizeApiRequest, unauthorized } from "@/lib/api-auth"
import { findPersonDuplicates } from "@/server/domain/merge"
import { handleRouteError, json } from "@/server/api/respond"

export async function GET(req: NextRequest) {
  if (!(await authorizeApiRequest(req, "contacts.write"))) return unauthorized()
  try {
    return json(await findPersonDuplicates())
  } catch (error) {
    return handleRouteError(error)
  }
}
