import { redirect } from "next/navigation"
import { AppError } from "@/server/api/errors"
import { requireAccess } from "@/server/domain/access"
import { getPlaceProfile } from "@/server/domain/places"
import PlaceProfileClient from "./PlaceProfileClient"

export const dynamic = "force-dynamic"

export default async function PlaceProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    const actor = await requireAccess("places.read")
    const profile = await getPlaceProfile(id, actor.workspaceId)
    return <PlaceProfileClient initialProfile={profile as never} />
  } catch (error) {
    if (error instanceof AppError && error.status === 401) {
      redirect(`/login?callbackUrl=%2Fplaces%2F${encodeURIComponent(id)}`)
    }
    if (error instanceof AppError && error.status === 404) {
      return <PlaceProfileClient initialProfile={null} />
    }
    return <PlaceProfileClient initialProfile={null} />
  }
}
