import { NextRequest } from "next/server"
import { created, handleRouteError, json } from "@/server/api/respond"
import { accessOverview, addApprovedEmail, requireAccess } from "@/server/domain/access"
import { approvedEmailContract } from "@life-os/contracts"
import { parseJsonBody } from "@/server/api/contracts"

export async function GET() {
  try {
    const actor = await requireAccess("settings.manage")
    const overview = await accessOverview(actor)
    return json({ approvedEmails: overview.approvedEmails, workspaces: overview.workspaces })
  } catch (error) {
    return handleRouteError(error)
  }
}

export async function POST(req: NextRequest) {
  try {
    const actor = await requireAccess("settings.manage")
    return created(await addApprovedEmail(await parseJsonBody(req, approvedEmailContract), actor))
  } catch (error) {
    return handleRouteError(error)
  }
}
