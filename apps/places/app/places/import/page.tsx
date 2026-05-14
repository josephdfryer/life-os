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
    return <ImportUploadClient />
  }
}
