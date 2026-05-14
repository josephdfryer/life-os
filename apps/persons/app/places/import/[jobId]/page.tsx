import { redirect } from "next/navigation"
import { AppError } from "@/server/api/errors"
import { requireAccess } from "@/server/domain/access"
import { getImportJob } from "@/server/domain/import"
import ImportProgressClient from "./ImportProgressClient"

export const dynamic = "force-dynamic"

export default async function ImportJobPage({ params }: { params: Promise<{ jobId: string }> }) {
  try {
    const actor = await requireAccess("ingest.write")
    const { jobId } = await params
    const job = await getImportJob(jobId, actor.workspaceId)
    return <ImportProgressClient initialJob={job} />
  } catch (error) {
    if (error instanceof AppError && error.status === 401) redirect("/login?callbackUrl=%2Fplaces%2Fimport")
    throw error
  }
}
