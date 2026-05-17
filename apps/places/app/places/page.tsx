import { redirect } from "next/navigation"
import { AppError } from "@/server/api/errors"
import { requireAccess } from "@/server/domain/access"
import { getMapLayerData } from "@/server/domain/map-layers"
import { getPlacesForMap } from "@/server/domain/places"
import PlacesClient from "./PlacesClient"

export const dynamic = "force-dynamic"

export default async function PlacesPage() {
  try {
    const actor = await requireAccess("places.read")
    const places = await getPlacesForMap(actor.workspaceId)
    const layers = await getMapLayerData(actor.workspaceId, places.map(place => place.id))
    return <PlacesClient places={places} layers={layers} />
  } catch (error) {
    if (error instanceof AppError && error.status === 401) {
      redirect("/login?callbackUrl=%2Fplaces")
    }
    return <PlacesClient places={[]} layers={{ unresolvedVisits: [], interactions: [], finance: [], photos: [] }} />
  }
}
