import { redirect } from "next/navigation"
import AdminClient from "./AdminClient"
import { AppError } from "@/server/api/errors"
import { accessOverview, requireAccess } from "@/server/domain/access"

export const dynamic = "force-dynamic"

export default async function AdminPage() {
  try {
    const actor = await requireAccess("settings.manage")
    const overview = JSON.parse(JSON.stringify(await accessOverview(actor)))
    return <AdminClient initialOverview={overview} />
  } catch (error) {
    if (error instanceof AppError && error.status === 401) {
      redirect("/login?callbackUrl=%2Fadmin")
    }

    const message = error instanceof Error ? error.message : "Could not load admin data"
    return <AdminClient initialOverview={null} initialError={message} />
  }
}
