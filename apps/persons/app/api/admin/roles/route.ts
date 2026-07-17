import { NextRequest } from "next/server"
import { created, handleRouteError, json } from "@/server/api/respond"
import { accessOverview, createRole, requireAccess } from "@/server/domain/access"
import { createRoleContract } from "@life-os/contracts"
import { parseJsonBody } from "@/server/api/contracts"

export async function GET() {
  try {
    const actor = await requireAccess("roles.manage")
    const overview = await accessOverview(actor)
    return json({ roles: overview.roles, permissions: overview.permissions, users: overview.users })
  } catch (error) {
    return handleRouteError(error)
  }
}

export async function POST(req: NextRequest) {
  try {
    const actor = await requireAccess("roles.manage")
    return created(await createRole(await parseJsonBody(req, createRoleContract), actor))
  } catch (error) {
    return handleRouteError(error)
  }
}
