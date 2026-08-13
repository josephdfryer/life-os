import { NextRequest, NextResponse } from "next/server"
import { authorizeApiRequest, unauthorized } from "@/lib/api-auth"
import { storeFile } from "@/lib/file-storage"
import { handleRouteError } from "@/server/api/respond"
import { confirmImport } from "@/server/domain/imports"
import { analyzeContactHistory } from "@/server/domain/import-analysis"

export async function POST(req: NextRequest) {
  const auth = await authorizeApiRequest(req, "ingest.write")
  if (!auth) return unauthorized()

  try {
    let content: string
    let filename: string
    let source: string | null = null

    const contentType = req.headers.get("content-type") ?? ""

    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData()
      const file = form.get("file") as File | null
      if (!file) return NextResponse.json({ error: "No file field in form data" }, { status: 400 })
      content = await file.text()
      filename = file.name
      source = (form.get("source") as string | null) ?? null
    } else {
      const body = await req.json()
      content = body.content
      filename = body.filename ?? "api-ingest"
      source = body.source ?? null
    }

    if (!content?.trim()) {
      return NextResponse.json({ error: "No content provided" }, { status: 400 })
    }

    const results = await analyzeContactHistory({ workspaceId: auth.workspaceId, content, filename, source })

    const fileRecord = await storeFile(filename, source ?? "api", content, auth.workspaceId)

    const { created } = await confirmImport(results, auth.workspaceId, {
      importedFileId: fileRecord.id,
      actor: auth.actor,
    })
    const persons = created.map(person => ({
      action: person.action,
      personId: person.personId,
      name: person.name,
      interactionsCreated: person.interactionCount,
    }))

    return NextResponse.json({
      fileId: fileRecord.id,
      filename: fileRecord.filename,
      retrieveUrl: `/api/v1/files/${fileRecord.id}`,
      source,
      persons,
      totalInteractions: persons.reduce((s, p) => s + p.interactionsCreated, 0),
    }, { status: 201 })

  } catch (error) {
    return handleRouteError(error)
  }
}
