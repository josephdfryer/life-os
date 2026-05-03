import { NextRequest, NextResponse } from "next/server"
import { handleRouteError } from "@/server/api/respond"
import { confirmImport } from "@/server/domain/imports"
import type { ImportedPerson } from "@/types"

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { results, fileData }: { results: ImportedPerson[]; fileData?: { name: string; format: string; content: string } } = body
    const { created } = await confirmImport(results, { fileData })
    return NextResponse.json({ created })
  } catch (error) {
    return handleRouteError(error)
  }
}
