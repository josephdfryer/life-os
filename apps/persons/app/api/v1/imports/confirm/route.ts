import { NextRequest, NextResponse } from "next/server"
import { authorizeApiRequest, unauthorized } from "@/lib/api-auth"
import { confirmImport } from "@/server/domain/imports"
import { handleRouteError } from "@/server/api/respond"
import type { ImportedPerson } from "@/types"

export async function POST(req: NextRequest) {
  const auth = await authorizeApiRequest(req, "ingest.write")
  if (!auth) return unauthorized()

  try {
    const body = await req.json()
    const { results, filename, source } = body as {
      results: ImportedPerson[]
      filename?: string
      source?: string
    }

    if (!Array.isArray(results)) {
      return NextResponse.json({ error: "results must be an array" }, { status: 400 })
    }

    const outcome = await confirmImport(results, auth.workspaceId, {
      fileData: filename ? { name: filename, format: source ?? "api", content: "" } : undefined,
      actor: auth.actor,
    })

    return NextResponse.json({
      importedFileId: outcome.importedFileId,
      persons: outcome.created.map(p => ({
        action: p.action,
        personId: p.personId,
        name: p.name,
        interactionsCreated: p.interactionCount,
      })),
      totalInteractions: outcome.created.reduce((s, p) => s + p.interactionCount, 0),
    }, { status: 201 })
  } catch (error) {
    return handleRouteError(error)
  }
}
