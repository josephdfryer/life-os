import { redirect } from "next/navigation"
import { AppError } from "@/server/api/errors"
import { requireAccess } from "@/server/domain/access"
import ImportUploadClient from "./ImportUploadClient"

export const dynamic = "force-dynamic"

export default async function PlacesImportPage() {
  try {
    await requireAccess("ingest.write")
    return <ImportUploadClient />
  } catch (error) {
    if (error instanceof AppError && error.status === 401) redirect("/login?callbackUrl=%2Fplaces%2Fimport")
    if (error instanceof AppError && error.status === 403) {
      return (
        <main className="places-route-state">
          <span aria-hidden="true">◇</span>
          <h1>Import access is not enabled</h1>
          <p>You can keep exploring Places, but this workspace role cannot import location history.</p>
          <a href="/places">Return to Places</a>
        </main>
      )
    }
    throw error
  }
}
