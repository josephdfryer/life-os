import { NextRequest, NextResponse } from "next/server"
import { handleRouteError } from "@/server/api/respond"
import { requireAccess } from "@/server/domain/access"
import { confirmImport } from "@/server/domain/imports"
import { confirmImportContract } from "@life-os/contracts"
import { parseJsonBody } from "@/server/api/contracts"

export async function POST(req: NextRequest) {
  try {
    const access = await requireAccess("people.write")
    const { results, fileData } = await parseJsonBody(req, confirmImportContract)
    const { created } = await confirmImport(results, access.workspaceId, { fileData, actor: access.actor })
    return NextResponse.json({ created })
  } catch (error) {
    return handleRouteError(error)
  }
}
