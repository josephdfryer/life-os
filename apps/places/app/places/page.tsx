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
    console.error("[places page] failed to load", error)
    const message = error instanceof AppError && error.status === 403
      ? "You do not have permission to view Places in this workspace."
      : "Places could not be loaded. Your data is unchanged; try again in a moment."
    return <PlacesClient places={[]} layers={{ unresolvedVisits: [], interactions: [], finance: [], photos: [] }} errorMessage={message} />
  }
}
