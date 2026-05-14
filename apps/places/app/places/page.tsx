import { redirect } from "next/navigation"
import { AppError } from "@/server/api/errors"
import { requireAccess } from "@/server/domain/access"
import { getPlacesForMap } from "@/server/domain/places"
import PlacesClient from "./PlacesClient"

export const dynamic = "force-dynamic"

export default async function PlacesPage() {
  try {
    const actor = await requireAccess("places.read")
    const places = await getPlacesForMap(actor.workspaceId)
    return <PlacesClient places={places} />
  } catch (error) {
    if (error instanceof AppError && error.status === 401) {
      redirect("/login?callbackUrl=%2Fplaces")
    }
    return <PlacesClient places={[]} />
  }
}
